const asyncHandler = require("../helpers/asyncHandler");
const ApiResponse = require("../helpers/response");
const Order = require("../models/Order");
const Product = require("../models/Product");
const User = require("../models/User");
const { Promotion } = require("../models/Promotion");

const REFUND_ACTIVE_STATUSES = new Set([
  "requested",
  "reviewing",
  "waiting_customer_info",
  "escalated_to_manager",
  "approved",
  "return_pending",
  "return_received",
  "processing",
]);

const REFUND_ANALYTICS_SELECT =
  "_id paymentCode status paymentStatus paidAmount shippingAddress refund updatedAt createdAt invoiceId";
const REFUND_ANALYTICS_INVOICE_POPULATE = {
  path: "invoiceId",
  select: "invoiceCode status amountDue",
};

function normalizeLimit(value, fallback = 10, max = 50) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(limit)));
}

function normalizePage(value, fallback = 1) {
  const page = Number(value);
  if (!Number.isFinite(page)) return fallback;
  return Math.max(1, Math.floor(page));
}

function getMonthRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return { start, end };
}

function getPreviousMonthRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  const end = new Date(date.getFullYear(), date.getMonth(), 1);
  return { start, end };
}

function formatCurrencyNumber(value) {
  return Math.round(Number(value || 0));
}

function normalizeRefundStatus(value) {
  return String(value || "none")
    .trim()
    .toLowerCase();
}

function normalizeOwnerRole(value) {
  return String(value || "none")
    .trim()
    .toLowerCase();
}

function normalizeFilterToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeBooleanFilter(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["1", "true", "yes"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function normalizeDateFilter(value, boundary = "start") {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (boundary === "end") {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }

  return date;
}

function matchesDateRange(value, from, to) {
  if (!from && !to) return true;
  if (!value) return false;

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;

  if (from && timestamp < from.getTime()) return false;
  if (to && timestamp > to.getTime()) return false;
  return true;
}

function includesSearch(values, query) {
  if (!query) return true;

  return values.some((value) =>
    String(value || "")
      .toLowerCase()
      .includes(query),
  );
}

function getRefundAnalyticsFilters(query = {}) {
  return {
    status: normalizeFilterToken(query.status),
    ownerRole: normalizeFilterToken(query.ownerRole || query.owner_role),
    q: normalizeFilterToken(query.q || query.search),
    attentionOnly: normalizeBooleanFilter(
      query.attentionOnly || query.attention_only,
    ),
    matchStatus: normalizeFilterToken(query.matchStatus || query.match_status),
    hasProof: normalizeBooleanFilter(query.hasProof || query.has_proof),
    action: normalizeFilterToken(query.action),
    actorRole: normalizeFilterToken(query.actorRole || query.actor_role),
    from: normalizeDateFilter(query.from, "start"),
    to: normalizeDateFilter(query.to, "end"),
  };
}

function buildBaseRefundQuery(filters = {}) {
  const refundQuery = {
    "refund.status": { $nin: [null, "none"] },
  };

  if (filters.status && filters.status !== "all") {
    refundQuery["refund.status"] = filters.status;
  }

  if (filters.ownerRole && filters.ownerRole !== "all") {
    refundQuery["refund.currentOwnerRole"] = filters.ownerRole;
  }

  return refundQuery;
}

function getRefundBreakdownTotal(breakdown, fallback = 0) {
  if (!breakdown || typeof breakdown !== "object") {
    return formatCurrencyNumber(fallback);
  }

  const itemAmount = Number(breakdown.itemAmount || 0);
  const shippingFeeAmount = Number(breakdown.shippingFeeAmount || 0);
  const returnShippingFeeAmount = Number(
    breakdown.returnShippingFeeAmount || 0,
  );
  const total = Number(
    breakdown.total ??
      itemAmount + shippingFeeAmount + returnShippingFeeAmount,
  );

  return formatCurrencyNumber(total);
}

function getRefundLastTouchedAt(order) {
  const history = Array.isArray(order?.refund?.history) ? order.refund.history : [];
  const latestHistory = history.reduce((latest, entry) => {
    const timestamp = new Date(entry?.createdAt || 0).getTime();
    return Number.isFinite(timestamp) && timestamp > latest ? timestamp : latest;
  }, 0);

  const fallbackCandidates = [
    latestHistory ? new Date(latestHistory) : null,
    order?.refund?.processedAt ? new Date(order.refund.processedAt) : null,
    order?.refund?.approvedAt ? new Date(order.refund.approvedAt) : null,
    order?.refund?.requestedAt ? new Date(order.refund.requestedAt) : null,
    order?.updatedAt ? new Date(order.updatedAt) : null,
    order?.createdAt ? new Date(order.createdAt) : null,
  ].filter((value) => value instanceof Date && !Number.isNaN(value.getTime()));

  return fallbackCandidates[0] || new Date();
}

function getAttentionReason(status, ageHours, order) {
  if (status === "waiting_customer_info" && ageHours >= 48) {
    return "Waiting for customer response > 48h";
  }

  if (status === "escalated_to_manager" && ageHours >= 24) {
    return "Escalated to manager > 24h";
  }

  if (status === "approved" && ageHours >= 24) {
    return "Approved but payout has not started > 24h";
  }

  if (status === "return_pending" && ageHours >= 72) {
    return "Return inspection pending > 72h";
  }

  if (status === "processing" && ageHours >= 24) {
    return "Payout processing > 24h";
  }

  if (
    status === "completed" &&
    !String(order?.refund?.transactionRef || "").trim()
  ) {
    return "Completed refund without transaction reference";
  }

  return "";
}

function buildRefundCaseSnapshot(order) {
  const refundStatus = normalizeRefundStatus(order?.refund?.status);
  const requestedAmount = getRefundBreakdownTotal(
    order?.refund?.requestedBreakdown,
    order?.refund?.amount,
  );
  const approvedAmount = getRefundBreakdownTotal(
    order?.refund?.approvedBreakdown,
    order?.refund?.amount,
  );
  const settledAmount =
    refundStatus === "completed"
      ? formatCurrencyNumber(
          order?.refund?.amount || approvedAmount || requestedAmount,
        )
      : 0;
  const lastTouchedAt = getRefundLastTouchedAt(order);
  const ageHours = Math.max(
    0,
    Math.round((Date.now() - lastTouchedAt.getTime()) / (1000 * 60 * 60)),
  );
  const attentionReason = getAttentionReason(refundStatus, ageHours, order);

  return {
    orderId: String(order?._id || ""),
    orderCode: String(order?.paymentCode || order?._id || ""),
    customerName:
      String(order?.shippingAddress?.fullName || "").trim() || "Customer",
    customerPhone: String(order?.shippingAddress?.phone || "").trim(),
    orderStatus: String(order?.status || "unknown")
      .trim()
      .toLowerCase(),
    paymentStatus: String(order?.paymentStatus || "unknown")
      .trim()
      .toLowerCase(),
    refundStatus,
    currentOwnerRole: normalizeOwnerRole(order?.refund?.currentOwnerRole),
    nextActionCode: String(order?.refund?.nextActionCode || "")
      .trim()
      .toLowerCase(),
    paidAmount: formatCurrencyNumber(order?.paidAmount || 0),
    requestedAmount,
    approvedAmount,
    settledAmount,
    invoiceStatus: String(order?.invoiceId?.status || "")
      .trim()
      .toLowerCase(),
    transactionRef: String(order?.refund?.transactionRef || "").trim(),
    payoutProofUrl: String(order?.refund?.payoutProofUrl || "").trim(),
    requiresReturn: Boolean(order?.refund?.requiresReturn),
    updatedAt: lastTouchedAt.toISOString(),
    ageHours,
    requiresAttention: Boolean(attentionReason),
    attentionReason,
  };
}

function buildRefundReconciliationRow(order) {
  const snapshot = buildRefundCaseSnapshot(order);
  const approvedAmount = snapshot.approvedAmount;
  const settledAmount = snapshot.settledAmount;
  const requestedAmount = snapshot.requestedAmount;
  const discrepancyAmount = formatCurrencyNumber(
    Math.max(0, approvedAmount - settledAmount),
  );

  let matchStatus = "pending";

  if (approvedAmount > snapshot.paidAmount) {
    matchStatus = "mismatch";
  } else if (snapshot.refundStatus === "completed") {
    matchStatus =
      settledAmount === approvedAmount && Boolean(snapshot.transactionRef)
        ? "matched"
        : "mismatch";
  } else if (
    ["approved", "return_received", "processing", "return_pending"].includes(
      snapshot.refundStatus,
    )
  ) {
    matchStatus = "awaiting_payout";
  } else if (snapshot.refundStatus === "rejected") {
    matchStatus = "closed";
  }

  return {
    ...snapshot,
    requestedAmount,
    approvedAmount,
    settledAmount,
    discrepancyAmount,
    refundReason: String(order?.refund?.reason || "").trim(),
    invoiceCode: String(order?.invoiceId?.invoiceCode || "").trim(),
    invoiceStatus: String(order?.invoiceId?.status || "")
      .trim()
      .toLowerCase(),
    invoiceAmountDue: formatCurrencyNumber(order?.invoiceId?.amountDue || 0),
    processedAt: order?.refund?.processedAt || null,
    matchStatus,
  };
}

function buildRefundAuditRows(order) {
  const snapshot = buildRefundCaseSnapshot(order);
  const history = Array.isArray(order?.refund?.history) ? order.refund.history : [];

  return history.map((entry, index) => ({
    id: `${snapshot.orderId}-${entry?.createdAt || "event"}-${index}`,
    orderId: snapshot.orderId,
    orderCode: snapshot.orderCode,
    customerName: snapshot.customerName,
    customerPhone: snapshot.customerPhone,
    refundStatus: snapshot.refundStatus,
    currentOwnerRole: snapshot.currentOwnerRole,
    nextActionCode: snapshot.nextActionCode,
    action: normalizeFilterToken(entry?.action),
    actorRole: normalizeFilterToken(entry?.actorRole),
    actorName: String(entry?.actorName || "").trim(),
    fromStatus: normalizeRefundStatus(entry?.fromStatus),
    toStatus: normalizeRefundStatus(entry?.toStatus),
    note: String(entry?.note || "").trim(),
    createdAt: entry?.createdAt || null,
    transactionRef: snapshot.transactionRef,
    attentionReason: snapshot.attentionReason,
  }));
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRoundedNumberExpr(path, fallback = 0) {
  return {
    $round: [{ $ifNull: [path, fallback] }, 0],
  };
}

function buildBreakdownTotalExpr(basePath, fallbackPath) {
  return {
    $round: [
      {
        $let: {
          vars: {
            rawTotal: `$${basePath}.total`,
            componentTotal: {
              $add: [
                { $ifNull: [`$${basePath}.itemAmount`, 0] },
                { $ifNull: [`$${basePath}.shippingFeeAmount`, 0] },
                { $ifNull: [`$${basePath}.returnShippingFeeAmount`, 0] },
              ],
            },
            fallbackAmount: { $ifNull: [`$${fallbackPath}`, 0] },
          },
          in: {
            $cond: [
              { $ne: ["$$rawTotal", null] },
              "$$rawTotal",
              {
                $cond: [
                  { $gt: ["$$componentTotal", 0] },
                  "$$componentTotal",
                  "$$fallbackAmount",
                ],
              },
            ],
          },
        },
      },
      0,
    ],
  };
}

function buildAttentionReasonExpr() {
  return {
    $switch: {
      branches: [
        {
          case: {
            $and: [
              { $eq: ["$refundStatus", "waiting_customer_info"] },
              { $gte: ["$ageHours", 48] },
            ],
          },
          then: "Waiting for customer response > 48h",
        },
        {
          case: {
            $and: [
              { $eq: ["$refundStatus", "escalated_to_manager"] },
              { $gte: ["$ageHours", 24] },
            ],
          },
          then: "Escalated to manager > 24h",
        },
        {
          case: {
            $and: [
              { $eq: ["$refundStatus", "approved"] },
              { $gte: ["$ageHours", 24] },
            ],
          },
          then: "Approved but payout has not started > 24h",
        },
        {
          case: {
            $and: [
              { $eq: ["$refundStatus", "return_pending"] },
              { $gte: ["$ageHours", 72] },
            ],
          },
          then: "Return inspection pending > 72h",
        },
        {
          case: {
            $and: [
              { $eq: ["$refundStatus", "processing"] },
              { $gte: ["$ageHours", 24] },
            ],
          },
          then: "Payout processing > 24h",
        },
        {
          case: {
            $and: [
              { $eq: ["$refundStatus", "completed"] },
              { $eq: [{ $strLenCP: "$transactionRef" }, 0] },
            ],
          },
          then: "Completed refund without transaction reference",
        },
      ],
      default: "",
    },
  };
}

function buildMatchStatusExpr() {
  return {
    $switch: {
      branches: [
        {
          case: { $gt: ["$approvedAmount", "$paidAmount"] },
          then: "mismatch",
        },
        {
          case: { $eq: ["$refundStatus", "completed"] },
          then: {
            $cond: [
              {
                $and: [
                  { $eq: ["$settledAmount", "$approvedAmount"] },
                  { $gt: [{ $strLenCP: "$transactionRef" }, 0] },
                ],
              },
              "matched",
              "mismatch",
            ],
          },
        },
        {
          case: {
            $in: [
              "$refundStatus",
              ["approved", "return_received", "processing", "return_pending"],
            ],
          },
          then: "awaiting_payout",
        },
        {
          case: { $eq: ["$refundStatus", "rejected"] },
          then: "closed",
        },
      ],
      default: "pending",
    },
  };
}

function buildSearchMatch(fields, query) {
  if (!query) return null;
  const regex = new RegExp(escapeRegex(query), "i");
  return {
    $or: fields.map((field) => ({
      [field]: regex,
    })),
  };
}

function buildDateMatch(field, from, to) {
  if (!from && !to) return null;

  const range = {};
  if (from) range.$gte = from;
  if (to) range.$lte = to;

  return {
    [field]: range,
  };
}

function buildRefundOverviewPipeline(filters = {}) {
  const pipeline = [
    { $match: buildBaseRefundQuery(filters) },
    {
      $project: {
        _id: 0,
        orderId: { $toString: "$_id" },
        orderCode: { $ifNull: ["$paymentCode", { $toString: "$_id" }] },
        customerName: {
          $cond: [
            { $gt: [{ $strLenCP: { $ifNull: ["$shippingAddress.fullName", ""] } }, 0] },
            "$shippingAddress.fullName",
            "Customer",
          ],
        },
        customerPhone: { $ifNull: ["$shippingAddress.phone", ""] },
        orderStatus: { $toLower: { $ifNull: ["$status", "unknown"] } },
        paymentStatus: { $toLower: { $ifNull: ["$paymentStatus", "unknown"] } },
        refundStatus: { $toLower: { $ifNull: ["$refund.status", "none"] } },
        currentOwnerRole: {
          $toLower: { $ifNull: ["$refund.currentOwnerRole", "none"] },
        },
        nextActionCode: {
          $toLower: { $ifNull: ["$refund.nextActionCode", ""] },
        },
        paidAmount: buildRoundedNumberExpr("$paidAmount"),
        requestedAmount: buildBreakdownTotalExpr(
          "refund.requestedBreakdown",
          "refund.amount",
        ),
        approvedAmount: buildBreakdownTotalExpr(
          "refund.approvedBreakdown",
          "refund.amount",
        ),
        refundAmountRaw: buildRoundedNumberExpr("$refund.amount"),
        transactionRef: { $ifNull: ["$refund.transactionRef", ""] },
        payoutProofUrl: { $ifNull: ["$refund.payoutProofUrl", ""] },
        requiresReturn: { $ifNull: ["$refund.requiresReturn", false] },
        refundReason: { $ifNull: ["$refund.reason", ""] },
        updatedAt: "$updatedAt",
      },
    },
    {
      $addFields: {
        settledAmount: {
          $cond: [
            { $eq: ["$refundStatus", "completed"] },
            {
              $cond: [
                { $gt: ["$refundAmountRaw", 0] },
                "$refundAmountRaw",
                {
                  $cond: [
                    { $gt: ["$approvedAmount", 0] },
                    "$approvedAmount",
                    "$requestedAmount",
                  ],
                },
              ],
            },
            0,
          ],
        },
        ageHours: {
          $max: [
            0,
            {
              $round: [
                {
                  $divide: [{ $subtract: ["$$NOW", "$updatedAt"] }, 1000 * 60 * 60],
                },
                0,
              ],
            },
          ],
        },
      },
    },
    {
      $addFields: {
        discrepancyAmount: {
          $max: [{ $subtract: ["$approvedAmount", "$settledAmount"] }, 0],
        },
        matchStatus: buildMatchStatusExpr(),
        attentionReason: buildAttentionReasonExpr(),
      },
    },
    {
      $addFields: {
        requiresAttention: { $gt: [{ $strLenCP: "$attentionReason" }, 0] },
      },
    },
  ];

  const postMatch = [];
  if (filters.attentionOnly === true) {
    postMatch.push({ requiresAttention: true });
  }

  const dateMatch = buildDateMatch("updatedAt", filters.from, filters.to);
  if (dateMatch) {
    postMatch.push(dateMatch);
  }

  const searchMatch = buildSearchMatch(
    [
      "orderCode",
      "customerName",
      "customerPhone",
      "refundStatus",
      "currentOwnerRole",
      "nextActionCode",
      "refundReason",
      "attentionReason",
      "transactionRef",
    ],
    filters.q,
  );
  if (searchMatch) {
    postMatch.push(searchMatch);
  }

  if (postMatch.length > 0) {
    pipeline.push({
      $match: postMatch.length === 1 ? postMatch[0] : { $and: postMatch },
    });
  }

  return pipeline;
}

function buildRefundReconciliationBasePipeline(filters = {}) {
  const pipeline = [
    { $match: buildBaseRefundQuery(filters) },
    {
      $lookup: {
        from: "invoices",
        localField: "invoiceId",
        foreignField: "_id",
        as: "invoiceLookup",
      },
    },
    {
      $unwind: {
        path: "$invoiceLookup",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        orderId: { $toString: "$_id" },
        orderCode: { $ifNull: ["$paymentCode", { $toString: "$_id" }] },
        customerName: {
          $cond: [
            { $gt: [{ $strLenCP: { $ifNull: ["$shippingAddress.fullName", ""] } }, 0] },
            "$shippingAddress.fullName",
            "Customer",
          ],
        },
        customerPhone: { $ifNull: ["$shippingAddress.phone", ""] },
        orderStatus: { $toLower: { $ifNull: ["$status", "unknown"] } },
        paymentStatus: { $toLower: { $ifNull: ["$paymentStatus", "unknown"] } },
        refundStatus: { $toLower: { $ifNull: ["$refund.status", "none"] } },
        currentOwnerRole: {
          $toLower: { $ifNull: ["$refund.currentOwnerRole", "none"] },
        },
        nextActionCode: {
          $toLower: { $ifNull: ["$refund.nextActionCode", ""] },
        },
        paidAmount: buildRoundedNumberExpr("$paidAmount"),
        requestedAmount: buildBreakdownTotalExpr(
          "refund.requestedBreakdown",
          "refund.amount",
        ),
        approvedAmount: buildBreakdownTotalExpr(
          "refund.approvedBreakdown",
          "refund.amount",
        ),
        refundAmountRaw: buildRoundedNumberExpr("$refund.amount"),
        transactionRef: { $ifNull: ["$refund.transactionRef", ""] },
        payoutProofUrl: { $ifNull: ["$refund.payoutProofUrl", ""] },
        requiresReturn: { $ifNull: ["$refund.requiresReturn", false] },
        refundReason: { $ifNull: ["$refund.reason", ""] },
        invoiceCode: { $ifNull: ["$invoiceLookup.invoiceCode", ""] },
        invoiceStatus: {
          $toLower: { $ifNull: ["$invoiceLookup.status", ""] },
        },
        invoiceAmountDue: buildRoundedNumberExpr("$invoiceLookup.amountDue"),
        updatedAt: "$updatedAt",
        processedAt: "$refund.processedAt",
      },
    },
    {
      $addFields: {
        settledAmount: {
          $cond: [
            { $eq: ["$refundStatus", "completed"] },
            {
              $cond: [
                { $gt: ["$refundAmountRaw", 0] },
                "$refundAmountRaw",
                {
                  $cond: [
                    { $gt: ["$approvedAmount", 0] },
                    "$approvedAmount",
                    "$requestedAmount",
                  ],
                },
              ],
            },
            0,
          ],
        },
        ageHours: {
          $max: [
            0,
            {
              $round: [
                {
                  $divide: [{ $subtract: ["$$NOW", "$updatedAt"] }, 1000 * 60 * 60],
                },
                0,
              ],
            },
          ],
        },
        filterDate: { $ifNull: ["$processedAt", "$updatedAt"] },
      },
    },
    {
      $addFields: {
        discrepancyAmount: {
          $max: [{ $subtract: ["$approvedAmount", "$settledAmount"] }, 0],
        },
        matchStatus: buildMatchStatusExpr(),
        attentionReason: buildAttentionReasonExpr(),
      },
    },
    {
      $addFields: {
        requiresAttention: { $gt: [{ $strLenCP: "$attentionReason" }, 0] },
      },
    },
  ];

  const postMatch = [];
  if (filters.matchStatus && filters.matchStatus !== "all") {
    postMatch.push({ matchStatus: filters.matchStatus });
  }
  if (filters.hasProof === true) {
    postMatch.push({ payoutProofUrl: { $ne: "" } });
  }
  if (filters.hasProof === false) {
    postMatch.push({ payoutProofUrl: "" });
  }
  if (filters.attentionOnly === true) {
    postMatch.push({ requiresAttention: true });
  }
  const dateMatch = buildDateMatch("filterDate", filters.from, filters.to);
  if (dateMatch) {
    postMatch.push(dateMatch);
  }
  const searchMatch = buildSearchMatch(
    [
      "orderCode",
      "customerName",
      "customerPhone",
      "refundStatus",
      "currentOwnerRole",
      "matchStatus",
      "transactionRef",
      "invoiceCode",
      "refundReason",
      "attentionReason",
    ],
    filters.q,
  );
  if (searchMatch) {
    postMatch.push(searchMatch);
  }
  if (postMatch.length > 0) {
    pipeline.push({
      $match: postMatch.length === 1 ? postMatch[0] : { $and: postMatch },
    });
  }

  return pipeline;
}

function buildRefundAuditPipeline(filters = {}) {
  const pipeline = [
    { $match: buildBaseRefundQuery(filters) },
    {
      $unwind: {
        path: "$refund.history",
        preserveNullAndEmptyArrays: false,
      },
    },
    {
      $project: {
        _id: 0,
        id: {
          $concat: [
            { $toString: "$_id" },
            "-",
            {
              $ifNull: [
                {
                  $dateToString: {
                    date: "$refund.history.createdAt",
                    format: "%Y-%m-%dT%H:%M:%S.%LZ",
                    timezone: "UTC",
                  },
                },
                "event",
              ],
            },
          ],
        },
        orderId: { $toString: "$_id" },
        orderCode: { $ifNull: ["$paymentCode", { $toString: "$_id" }] },
        customerName: {
          $cond: [
            { $gt: [{ $strLenCP: { $ifNull: ["$shippingAddress.fullName", ""] } }, 0] },
            "$shippingAddress.fullName",
            "Customer",
          ],
        },
        customerPhone: { $ifNull: ["$shippingAddress.phone", ""] },
        refundStatus: { $toLower: { $ifNull: ["$refund.status", "none"] } },
        currentOwnerRole: {
          $toLower: { $ifNull: ["$refund.currentOwnerRole", "none"] },
        },
        nextActionCode: {
          $toLower: { $ifNull: ["$refund.nextActionCode", ""] },
        },
        action: { $toLower: { $ifNull: ["$refund.history.action", ""] } },
        actorRole: { $toLower: { $ifNull: ["$refund.history.actorRole", ""] } },
        actorName: { $ifNull: ["$refund.history.actorName", ""] },
        fromStatus: {
          $toLower: { $ifNull: ["$refund.history.fromStatus", "none"] },
        },
        toStatus: {
          $toLower: { $ifNull: ["$refund.history.toStatus", "none"] },
        },
        note: { $ifNull: ["$refund.history.note", ""] },
        createdAt: "$refund.history.createdAt",
        transactionRef: { $ifNull: ["$refund.transactionRef", ""] },
        attentionReason: "",
      },
    },
  ];

  const postMatch = [];
  if (filters.action && filters.action !== "all") {
    postMatch.push({ action: filters.action });
  }
  if (filters.actorRole && filters.actorRole !== "all") {
    postMatch.push({ actorRole: filters.actorRole });
  }
  if (filters.status && filters.status !== "all") {
    postMatch.push({ refundStatus: filters.status });
  }
  if (filters.ownerRole && filters.ownerRole !== "all") {
    postMatch.push({ currentOwnerRole: filters.ownerRole });
  }
  const dateMatch = buildDateMatch("createdAt", filters.from, filters.to);
  if (dateMatch) {
    postMatch.push(dateMatch);
  }
  const searchMatch = buildSearchMatch(
    [
      "orderCode",
      "customerName",
      "customerPhone",
      "action",
      "actorName",
      "actorRole",
      "note",
      "fromStatus",
      "toStatus",
      "transactionRef",
    ],
    filters.q,
  );
  if (searchMatch) {
    postMatch.push(searchMatch);
  }
  if (postMatch.length > 0) {
    pipeline.push({
      $match: postMatch.length === 1 ? postMatch[0] : { $and: postMatch },
    });
  }

  return pipeline;
}

function summarizeRefundReconciliationRows(rows) {
  return rows.reduce(
    (accumulator, row) => {
      accumulator.requestedTotal += row.requestedAmount;
      accumulator.approvedTotal += row.approvedAmount;
      accumulator.settledTotal += row.settledAmount;
      accumulator.totalPaidAmount += row.paidAmount;
      accumulator.outstandingTotal += row.discrepancyAmount;
      if (row.matchStatus === "mismatch") {
        accumulator.mismatchedCases += 1;
      }
      if (row.matchStatus === "awaiting_payout") {
        accumulator.awaitingPayoutCases += 1;
      }
      return accumulator;
    },
    {
      requestedTotal: 0,
      approvedTotal: 0,
      settledTotal: 0,
      totalPaidAmount: 0,
      outstandingTotal: 0,
      mismatchedCases: 0,
      awaitingPayoutCases: 0,
    },
  );
}

function toCsvCell(value) {
  const stringValue = String(value ?? "");
  const escaped = stringValue.replace(/"/g, '""');
  return `"${escaped}"`;
}

function buildRefundReconciliationCsv(rows) {
  const header = [
    "orderCode",
    "customerName",
    "customerPhone",
    "refundStatus",
    "currentOwnerRole",
    "matchStatus",
    "paidAmount",
    "requestedAmount",
    "approvedAmount",
    "settledAmount",
    "discrepancyAmount",
    "invoiceCode",
    "invoiceStatus",
    "invoiceAmountDue",
    "transactionRef",
    "processedAt",
    "attentionReason",
  ];

  const lines = rows.map((row) =>
    [
      row.orderCode,
      row.customerName,
      row.customerPhone,
      row.refundStatus,
      row.currentOwnerRole,
      row.matchStatus,
      row.paidAmount,
      row.requestedAmount,
      row.approvedAmount,
      row.settledAmount,
      row.discrepancyAmount,
      row.invoiceCode,
      row.invoiceStatus,
      row.invoiceAmountDue,
      row.transactionRef,
      row.processedAt || "",
      row.attentionReason,
    ]
      .map(toCsvCell)
      .join(","),
  );

  return `\uFEFF${header.join(",")}\n${lines.join("\n")}`;
}

async function aggregateRevenue(match) {
  const [result] = await Order.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        revenue: { $sum: "$total" },
        collected: { $sum: "$paidAmount" },
        orders: { $sum: 1 },
      },
    },
  ]);

  return {
    revenue: formatCurrencyNumber(result?.revenue || 0),
    collected: formatCurrencyNumber(result?.collected || 0),
    orders: Number(result?.orders || 0),
  };
}

exports.getManagerOverview = asyncHandler(async (req, res) => {
  const now = new Date();
  const thisMonth = getMonthRange(now);
  const prevMonth = getPreviousMonthRange(now);

  const [currentMonth, previousMonth, totalOrders, cancelledOrders, activeProducts, activeCustomers, activePromotions] =
    await Promise.all([
      aggregateRevenue({
        status: { $ne: "cancelled" },
        createdAt: { $gte: thisMonth.start, $lt: thisMonth.end },
      }),
      aggregateRevenue({
        status: { $ne: "cancelled" },
        createdAt: { $gte: prevMonth.start, $lt: prevMonth.end },
      }),
      Order.countDocuments({}),
      Order.countDocuments({ status: "cancelled" }),
      Product.countDocuments({ status: "active" }),
      User.countDocuments({ role: "customer" }),
      Promotion.countDocuments({
        active: true,
        $and: [
          { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
          { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
        ],
      }),
    ]);

  const growth =
    previousMonth.revenue > 0
      ? Math.round(
          ((currentMonth.revenue - previousMonth.revenue) / previousMonth.revenue) *
            100,
        )
      : currentMonth.revenue > 0
        ? 100
        : 0;

  ApiResponse.success(
    res,
    {
      monthlyRevenue: currentMonth.revenue,
      monthlyOrders: currentMonth.orders,
      collectedThisMonth: currentMonth.collected,
      totalOrders,
      cancelledOrders,
      activeProducts,
      activeCustomers,
      activePromotions,
      monthOverMonthGrowth: growth,
    },
    "Manager overview retrieved successfully",
  );
});

exports.getAdminRefundOverview = asyncHandler(async (req, res) => {
  const now = new Date();
  const thisMonth = getMonthRange(now);
  const previewLimit = normalizeLimit(req.query.limit, 8, 20);
  const filters = getRefundAnalyticsFilters(req.query);
  const [facet] = await Order.aggregate([
    ...buildRefundOverviewPipeline(filters),
    {
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              totalCases: { $sum: 1 },
              activeCases: {
                $sum: {
                  $cond: [
                    { $in: ["$refundStatus", Array.from(REFUND_ACTIVE_STATUSES)] },
                    1,
                    0,
                  ],
                },
              },
              waitingCustomer: {
                $sum: {
                  $cond: [{ $eq: ["$refundStatus", "waiting_customer_info"] }, 1, 0],
                },
              },
              escalated: {
                $sum: {
                  $cond: [{ $eq: ["$refundStatus", "escalated_to_manager"] }, 1, 0],
                },
              },
              payoutPending: {
                $sum: {
                  $cond: [
                    {
                      $in: [
                        "$refundStatus",
                        ["approved", "return_pending", "return_received", "processing"],
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              flaggedCases: {
                $sum: {
                  $cond: ["$requiresAttention", 1, 0],
                },
              },
              completedThisMonth: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ["$refundStatus", "completed"] },
                        { $gte: ["$updatedAt", thisMonth.start] },
                        { $lt: ["$updatedAt", thisMonth.end] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              rejectedThisMonth: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ["$refundStatus", "rejected"] },
                        { $gte: ["$updatedAt", thisMonth.start] },
                        { $lt: ["$updatedAt", thisMonth.end] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
          { $project: { _id: 0 } },
        ],
        byStatus: [
          { $group: { _id: "$refundStatus", count: { $sum: 1 } } },
          { $project: { _id: 0, status: "$_id", count: 1 } },
          { $sort: { count: -1, status: 1 } },
        ],
        byOwner: [
          { $group: { _id: "$currentOwnerRole", count: { $sum: 1 } } },
          { $project: { _id: 0, owner: "$_id", count: 1 } },
          { $sort: { count: -1, owner: 1 } },
        ],
        flaggedCases: [
          { $match: { requiresAttention: true } },
          { $sort: { ageHours: -1, updatedAt: -1 } },
          { $limit: previewLimit },
        ],
        recentCompleted: [
          { $match: { refundStatus: "completed" } },
          { $sort: { updatedAt: -1 } },
          { $limit: previewLimit },
        ],
      },
    },
  ]).allowDiskUse(true);

  const summary = facet?.summary?.[0] || {
    totalCases: 0,
    activeCases: 0,
    waitingCustomer: 0,
    escalated: 0,
    payoutPending: 0,
    flaggedCases: 0,
    completedThisMonth: 0,
    rejectedThisMonth: 0,
  };

  ApiResponse.success(
    res,
    {
      summary,
      filters: {
        status: filters.status || "all",
        ownerRole: filters.ownerRole || "all",
        q: filters.q || "",
        attentionOnly: Boolean(filters.attentionOnly),
        from: filters.from ? filters.from.toISOString() : null,
        to: filters.to ? filters.to.toISOString() : null,
      },
      byStatus: facet?.byStatus || [],
      byOwner: facet?.byOwner || [],
      flaggedCases: facet?.flaggedCases || [],
      recentCompleted: facet?.recentCompleted || [],
    },
    "Admin refund overview retrieved successfully",
  );
});

exports.getRefundReconciliation = asyncHandler(async (req, res) => {
  const page = normalizePage(req.query.page, 1);
  const limit = normalizeLimit(req.query.limit, 20, 100);
  const skip = (page - 1) * limit;
  const filters = getRefundAnalyticsFilters(req.query);
  const [facet] = await Order.aggregate([
    ...buildRefundReconciliationBasePipeline(filters),
    { $sort: { processedAt: -1, updatedAt: -1 } },
    {
      $facet: {
        rows: [{ $skip: skip }, { $limit: limit }],
        pagination: [{ $count: "total" }],
        summary: [
          {
            $group: {
              _id: null,
              requestedTotal: { $sum: "$requestedAmount" },
              approvedTotal: { $sum: "$approvedAmount" },
              settledTotal: { $sum: "$settledAmount" },
              totalPaidAmount: { $sum: "$paidAmount" },
              outstandingTotal: { $sum: "$discrepancyAmount" },
              mismatchedCases: {
                $sum: {
                  $cond: [{ $eq: ["$matchStatus", "mismatch"] }, 1, 0],
                },
              },
              awaitingPayoutCases: {
                $sum: {
                  $cond: [{ $eq: ["$matchStatus", "awaiting_payout"] }, 1, 0],
                },
              },
            },
          },
          { $project: { _id: 0 } },
        ],
      },
    },
  ]).allowDiskUse(true);
  const total = Number(facet?.pagination?.[0]?.total || 0);
  const rows = facet?.rows || [];
  const summary = facet?.summary?.[0] || summarizeRefundReconciliationRows([]);

  ApiResponse.success(
    res,
    {
      summary,
      rows,
      filters: {
        status: filters.status || "all",
        ownerRole: filters.ownerRole || "all",
        matchStatus: filters.matchStatus || "all",
        q: filters.q || "",
        attentionOnly: filters.attentionOnly,
        hasProof: filters.hasProof,
        from: filters.from ? filters.from.toISOString() : null,
        to: filters.to ? filters.to.toISOString() : null,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
    "Refund reconciliation retrieved successfully",
  );
});

exports.exportRefundReconciliation = asyncHandler(async (req, res) => {
  const filters = getRefundAnalyticsFilters(req.query);
  const rows = await Order.aggregate([
    ...buildRefundReconciliationBasePipeline(filters),
    { $sort: { processedAt: -1, updatedAt: -1 } },
  ]).allowDiskUse(true);
  const csv = buildRefundReconciliationCsv(rows);
  const stamp = new Date().toISOString().slice(0, 10);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="refund-reconciliation-${stamp}.csv"`,
  );
  res.status(200).send(csv);
});

exports.getRefundAuditTrail = asyncHandler(async (req, res) => {
  const page = normalizePage(req.query.page, 1);
  const limit = normalizeLimit(req.query.limit, 20, 100);
  const skip = (page - 1) * limit;
  const filters = getRefundAnalyticsFilters(req.query);
  const [facet] = await Order.aggregate([
    ...buildRefundAuditPipeline(filters),
    { $sort: { createdAt: -1 } },
    {
      $facet: {
        rows: [{ $skip: skip }, { $limit: limit }],
        pagination: [{ $count: "total" }],
        summary: [
          {
            $group: {
              _id: null,
              totalEvents: { $sum: 1 },
              uniqueOrders: { $addToSet: "$orderId" },
            },
          },
          {
            $project: {
              _id: 0,
              totalEvents: 1,
              uniqueOrders: { $size: "$uniqueOrders" },
            },
          },
        ],
        byAction: [
          {
            $group: {
              _id: { $ifNull: ["$action", "unknown"] },
              count: { $sum: 1 },
            },
          },
          { $project: { _id: 0, action: "$_id", count: 1 } },
          { $sort: { count: -1, action: 1 } },
        ],
        byActorRole: [
          {
            $group: {
              _id: { $ifNull: ["$actorRole", "system"] },
              count: { $sum: 1 },
            },
          },
          { $project: { _id: 0, role: "$_id", count: 1 } },
          { $sort: { count: -1, role: 1 } },
        ],
      },
    },
  ]).allowDiskUse(true);

  ApiResponse.success(
    res,
    {
      summary: facet?.summary?.[0] || {
        totalEvents: 0,
        uniqueOrders: 0,
      },
      filters: {
        status: filters.status || "all",
        ownerRole: filters.ownerRole || "all",
        actorRole: filters.actorRole || "all",
        action: filters.action || "all",
        q: filters.q || "",
        from: filters.from ? filters.from.toISOString() : null,
        to: filters.to ? filters.to.toISOString() : null,
      },
      byAction: facet?.byAction || [],
      byActorRole: facet?.byActorRole || [],
      rows: facet?.rows || [],
      pagination: {
        page,
        limit,
        total: Number(facet?.pagination?.[0]?.total || 0),
        totalPages: Math.ceil(Number(facet?.pagination?.[0]?.total || 0) / limit),
      },
    },
    "Refund audit trail retrieved successfully",
  );
});

exports.getRevenueSummary = asyncHandler(async (req, res) => {
  const now = new Date();
  const thisMonth = getMonthRange(now);
  const prevMonth = getPreviousMonthRange(now);

  const [currentMonth, previousMonth, yearAggregate, monthlySeries, byOrderType, byPaymentMethod] =
    await Promise.all([
      aggregateRevenue({
        status: { $ne: "cancelled" },
        createdAt: { $gte: thisMonth.start, $lt: thisMonth.end },
      }),
      aggregateRevenue({
        status: { $ne: "cancelled" },
        createdAt: { $gte: prevMonth.start, $lt: prevMonth.end },
      }),
      aggregateRevenue({
        status: { $ne: "cancelled" },
        createdAt: {
          $gte: new Date(now.getFullYear(), 0, 1),
          $lt: new Date(now.getFullYear() + 1, 0, 1),
        },
      }),
      Order.aggregate([
        {
          $match: {
            status: { $ne: "cancelled" },
            createdAt: {
              $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1),
              $lt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
            },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
            },
            revenue: { $sum: "$total" },
            collected: { $sum: "$paidAmount" },
            orders: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),
      Order.aggregate([
        { $match: { status: { $ne: "cancelled" } } },
        {
          $group: {
            _id: "$orderType",
            revenue: { $sum: "$total" },
            orders: { $sum: 1 },
          },
        },
        { $sort: { revenue: -1 } },
      ]),
      Order.aggregate([
        { $match: { status: { $ne: "cancelled" } } },
        {
          $group: {
            _id: "$paymentMethod",
            revenue: { $sum: "$total" },
            payNow: { $sum: "$payNowTotal" },
            payLater: { $sum: "$payLaterTotal" },
            orders: { $sum: 1 },
          },
        },
        { $sort: { revenue: -1 } },
      ]),
    ]);

  const growth =
    previousMonth.revenue > 0
      ? Math.round(
          ((currentMonth.revenue - previousMonth.revenue) / previousMonth.revenue) *
            100,
        )
      : currentMonth.revenue > 0
        ? 100
        : 0;

  ApiResponse.success(
    res,
    {
      summary: {
        monthlyRevenue: currentMonth.revenue,
        monthlyOrders: currentMonth.orders,
        monthlyCollected: currentMonth.collected,
        growth,
        yearlyRevenue: yearAggregate.revenue,
      },
      monthly: monthlySeries.map((row) => ({
        month: `${row._id.year}-${String(row._id.month).padStart(2, "0")}`,
        revenue: formatCurrencyNumber(row.revenue),
        collected: formatCurrencyNumber(row.collected),
        orders: Number(row.orders || 0),
      })),
      byOrderType: byOrderType.map((row) => ({
        type: row._id || "unknown",
        revenue: formatCurrencyNumber(row.revenue),
        orders: Number(row.orders || 0),
      })),
      byPaymentMethod: byPaymentMethod.map((row) => ({
        method: row._id || "unknown",
        revenue: formatCurrencyNumber(row.revenue),
        payNow: formatCurrencyNumber(row.payNow),
        payLater: formatCurrencyNumber(row.payLater),
        orders: Number(row.orders || 0),
      })),
    },
    "Revenue summary retrieved successfully",
  );
});

module.exports.__private = {
  getRefundAnalyticsFilters,
  buildBaseRefundQuery,
  buildRefundOverviewPipeline,
  buildRefundReconciliationBasePipeline,
  buildRefundAuditPipeline,
  buildRefundReconciliationCsv,
  summarizeRefundReconciliationRows,
  buildRefundCaseSnapshot,
  buildRefundReconciliationRow,
  buildRefundAuditRows,
};
