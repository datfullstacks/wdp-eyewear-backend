const path = require("path");
const mongoose = require("mongoose");

const AppError = require("../errors/AppError");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Store = require("../models/Store");
const User = require("../models/User");
const orderService = require("./orderService");
const {
  SupportTicket,
  SUPPORT_TICKET_CATEGORIES,
  GENERAL_SUPPORT_STATUSES,
  WARRANTY_SUPPORT_STATUSES,
  SUPPORT_TICKET_STATUSES,
  SUPPORT_TICKET_OWNER_ROLES,
  SUPPORT_ATTACHMENT_TYPES,
} = require("../models/SupportTicket");
const {
  isBusinessUser,
  isCustomer,
  isStaff,
  isOperation,
  isManager,
  getUserId,
} = require("../helpers/roles");
const {
  canAccessStore,
  buildStoreScopedQuery,
  getAccessibleStoreIds,
  normalizeStoreId,
} = require("../helpers/storeAccess");
const { findSingleStoreId } = require("../helpers/singleStore");

const SUPPORT_CATEGORY_SET = new Set(SUPPORT_TICKET_CATEGORIES);
const SUPPORT_STATUS_SET = new Set(SUPPORT_TICKET_STATUSES);
const SUPPORT_OWNER_ROLE_SET = new Set(SUPPORT_TICKET_OWNER_ROLES);
const GENERAL_STATUS_SET = new Set(GENERAL_SUPPORT_STATUSES);
const WARRANTY_STATUS_SET = new Set(WARRANTY_SUPPORT_STATUSES);
const WARRANTY_ELIGIBILITY_SET = new Set([
  "eligible",
  "expired",
  "not_covered",
]);
const SUPPORT_PRIORITY_SET = new Set(["low", "normal", "high"]);
const SUPPORT_ATTACHMENT_TYPE_SET = new Set(SUPPORT_ATTACHMENT_TYPES);
const WARRANTY_ORDER_STATUS_SET = new Set([
  "created",
  "in_service",
  "completed",
  "cancelled",
]);
const AFTER_SALES_EVIDENCE_REQUIRED_CATEGORIES = new Set([
  "order",
  "refund",
  "return",
  "warranty",
]);
const SUPPORT_ATTACHMENT_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
]);
const SUPPORT_ATTACHMENT_VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".webm",
  ".m4v",
]);
const MAX_SUPPORT_ATTACHMENTS = 6;
const WARRANTY_TRANSITIONS = Object.freeze({
  requested: ["under_review", "approved", "rejected"],
  under_review: ["approved", "rejected"],
  approved: ["in_service", "completed"],
  in_service: ["completed"],
  rejected: [],
  completed: [],
});
const REFUND_STATUS_SET = new Set([
  "requested",
  "reviewing",
  "waiting_customer_info",
  "escalated_to_manager",
  "approved",
  "return_pending",
  "return_received",
  "processing",
  "completed",
  "rejected",
]);

const TICKET_POPULATE = [
  { path: "userId", select: "name email role" },
  { path: "currentOwnerUserId", select: "name email role" },
  {
    path: "orderId",
    select: "paymentCode status orderType total storeId userId createdAt",
  },
  { path: "storeId", select: "name code type status city district" },
  { path: "warranty.productId", select: "name slug fulfillment.warrantyMonths" },
];

function toTrimmedString(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }

  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizeCategory(value) {
  const normalized = toTrimmedString(value, "general").toLowerCase();
  return SUPPORT_CATEGORY_SET.has(normalized) ? normalized : "general";
}

function normalizeStatus(value) {
  const normalized = toTrimmedString(value, "").toLowerCase();
  return SUPPORT_STATUS_SET.has(normalized) ? normalized : "";
}

function normalizeOwnerRole(value) {
  const normalized = toTrimmedString(value, "").toLowerCase();
  return SUPPORT_OWNER_ROLE_SET.has(normalized) ? normalized : "";
}

function normalizeWarrantyOrderStatus(value, fallback = "") {
  const normalized = toTrimmedString(value, fallback).toLowerCase();
  return WARRANTY_ORDER_STATUS_SET.has(normalized) ? normalized : fallback;
}

function isWarrantyCategory(category) {
  return normalizeCategory(category) === "warranty";
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (error) {
    return false;
  }
}

function inferSupportAttachmentType(raw = {}) {
  const explicitType = toTrimmedString(
    raw.type || raw.kind || raw.mediaType,
    "",
  ).toLowerCase();
  if (SUPPORT_ATTACHMENT_TYPE_SET.has(explicitType)) {
    return explicitType;
  }

  const mimeType = toTrimmedString(
    raw.mimeType || raw.contentType || raw.mimetype,
    "",
  ).toLowerCase();
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }

  const source = toTrimmedString(
    raw.url || raw.uri || raw.path || raw.name || "",
    "",
  )
    .split("?")[0]
    .split("#")[0];
  const ext = path.extname(source).toLowerCase();
  if (SUPPORT_ATTACHMENT_VIDEO_EXTENSIONS.has(ext)) {
    return "video";
  }
  if (SUPPORT_ATTACHMENT_IMAGE_EXTENSIONS.has(ext)) {
    return "image";
  }

  return "image";
}

function normalizeSupportAttachment(raw = {}, fieldName = "attachments") {
  if (typeof raw === "string") {
    const url = toTrimmedString(raw, "");
    if (!url) {
      return null;
    }

    if (!isHttpUrl(url)) {
      throw new AppError(`${fieldName}.url must be a valid URL`, 400);
    }

    return {
      url,
      type: inferSupportAttachmentType({ url }),
      mimeType: "",
      name: "",
      path: "",
      size: null,
    };
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AppError(`${fieldName} items must be objects`, 400);
  }

  const url = toTrimmedString(raw.url || raw.uri || raw.publicUrl, "");
  if (!url) {
    throw new AppError(`${fieldName}.url is required`, 400);
  }
  if (!isHttpUrl(url)) {
    throw new AppError(`${fieldName}.url must be a valid URL`, 400);
  }

  const type = inferSupportAttachmentType(raw);
  if (!SUPPORT_ATTACHMENT_TYPE_SET.has(type)) {
    throw new AppError(`${fieldName}.type is invalid`, 400);
  }

  let size = null;
  if (raw.size !== undefined && raw.size !== null && raw.size !== "") {
    size = Number(raw.size);
    if (!Number.isFinite(size) || size < 0) {
      throw new AppError(`${fieldName}.size must be a positive number`, 400);
    }
  }

  return {
    url,
    type,
    mimeType: toTrimmedString(
      raw.mimeType || raw.contentType || raw.mimetype,
      "",
    ).toLowerCase(),
    name: toTrimmedString(raw.name || raw.filename, ""),
    path: toTrimmedString(raw.path, ""),
    size,
  };
}

function normalizeSupportAttachments(raw, fieldName = "attachments") {
  if (raw === undefined || raw === null) {
    return [];
  }

  if (!Array.isArray(raw)) {
    throw new AppError(`${fieldName} must be an array`, 400);
  }

  if (raw.length > MAX_SUPPORT_ATTACHMENTS) {
    throw new AppError(
      `${fieldName} supports at most ${MAX_SUPPORT_ATTACHMENTS} attachments`,
      400,
    );
  }

  const seen = new Set();
  const attachments = [];
  for (const item of raw) {
    const normalized = normalizeSupportAttachment(item, fieldName);
    if (!normalized || seen.has(normalized.url)) {
      continue;
    }

    seen.add(normalized.url);
    attachments.push(normalized);
  }

  return attachments;
}

function requiresAfterSalesEvidence(category, orderId) {
  return (
    Boolean(toTrimmedString(orderId, "")) &&
    AFTER_SALES_EVIDENCE_REQUIRED_CATEGORIES.has(normalizeCategory(category))
  );
}

function buildSupportRoutingHistoryEntry({
  fromOwnerRole = "none",
  toOwnerRole = "none",
  actorUserId = null,
  note = "",
}) {
  return {
    fromOwnerRole,
    toOwnerRole,
    actorUserId: actorUserId || null,
    note: toTrimmedString(note, ""),
    createdAt: new Date(),
  };
}

function resolveTicketRoutingState(category, status, ticketUserId = null) {
  const normalizedCategory = normalizeCategory(category);
  const normalizedStatus = normalizeStatus(status);

  if (normalizedCategory === "warranty") {
    switch (normalizedStatus) {
      case "requested":
        return {
          currentOwnerRole: "sales",
          currentOwnerUserId: null,
          nextActionCode: "review_warranty",
        };
      case "under_review":
        return {
          currentOwnerRole: "sales",
          currentOwnerUserId: null,
          nextActionCode: "decide_warranty",
        };
      case "approved":
        return {
          currentOwnerRole: "operations",
          currentOwnerUserId: null,
          nextActionCode: "start_service",
        };
      case "in_service":
        return {
          currentOwnerRole: "operations",
          currentOwnerUserId: null,
          nextActionCode: "complete_service",
        };
      case "rejected":
      case "completed":
        return {
          currentOwnerRole: "none",
          currentOwnerUserId: null,
          nextActionCode: "",
        };
      default:
        break;
    }
  }

  if (["return", "refund"].includes(normalizedCategory)) {
    switch (normalizedStatus) {
      case "open":
        return {
          currentOwnerRole: "sales",
          currentOwnerUserId: null,
          nextActionCode: "review_ticket",
        };
      case "in_progress":
        return {
          currentOwnerRole: "sales",
          currentOwnerUserId: null,
          nextActionCode: "follow_up_customer",
        };
      case "resolved":
        return {
          currentOwnerRole: "sales",
          currentOwnerUserId: null,
          nextActionCode: "close_ticket",
        };
      case "closed":
        return {
          currentOwnerRole: "none",
          currentOwnerUserId: null,
          nextActionCode: "",
        };
      default:
        break;
    }
  }

  if (normalizedCategory === "prescription") {
    return {
      currentOwnerRole: "sales",
      currentOwnerUserId: null,
      nextActionCode:
        normalizedStatus === "closed" ? "" : "follow_up_customer",
    };
  }

  if (normalizedCategory === "general" && ticketUserId) {
    return {
      currentOwnerRole: "sales",
      currentOwnerUserId: null,
      nextActionCode: normalizedStatus === "closed" ? "" : "reply_customer",
    };
  }

  return {
    currentOwnerRole: "none",
    currentOwnerUserId: null,
    nextActionCode: "",
  };
}

function applyTicketRoutingState(ticket, currentUser, note = "", { onCreate = false } = {}) {
  if (!ticket) return ticket;

  const actorUserId = getUserId(currentUser);
  const previousOwnerRole = normalizeOwnerRole(ticket.currentOwnerRole) || "none";
  const previousNextAction = toTrimmedString(ticket.nextActionCode, "");
  const routing = resolveTicketRoutingState(
    ticket.category,
    ticket.status,
    ticket.userId || null,
  );

  ticket.currentOwnerRole = routing.currentOwnerRole;
  ticket.currentOwnerUserId = routing.currentOwnerUserId;
  ticket.nextActionCode = routing.nextActionCode;

  const shouldAppendHistory =
    onCreate ||
    previousOwnerRole !== routing.currentOwnerRole ||
    previousNextAction !== routing.nextActionCode;

  if (shouldAppendHistory) {
    const history = Array.isArray(ticket.routingHistory) ? [...ticket.routingHistory] : [];
    history.push(
      buildSupportRoutingHistoryEntry({
        fromOwnerRole: previousOwnerRole,
        toOwnerRole: routing.currentOwnerRole,
        actorUserId,
        note,
      }),
    );
    ticket.routingHistory = history;
  }

  return ticket;
}

function buildMissingOwnerClause() {
  return {
    $or: [
      { currentOwnerRole: { $exists: false } },
      { currentOwnerRole: null },
      { currentOwnerRole: "" },
      { currentOwnerRole: "none" },
    ],
  };
}

function buildOwnerRoleFilter(ownerRole, category = "") {
  const normalizedOwnerRole = normalizeOwnerRole(ownerRole);
  const normalizedCategory = normalizeCategory(category);
  if (!normalizedOwnerRole) return null;

  const clauses = [{ currentOwnerRole: normalizedOwnerRole }];
  const missingOwnerClause = buildMissingOwnerClause();

  if (
    normalizedOwnerRole === "sales" &&
    (!normalizedCategory || normalizedCategory === "warranty")
  ) {
    clauses.push({
      category: "warranty",
      status: { $in: ["requested", "under_review"] },
      ...missingOwnerClause,
    });
  }

  if (
    normalizedOwnerRole === "operations" &&
    (!normalizedCategory || normalizedCategory === "warranty")
  ) {
    clauses.push({
      category: "warranty",
      status: { $in: ["approved", "in_service"] },
      ...missingOwnerClause,
    });
  }

  if (
    normalizedOwnerRole === "sales" &&
    (!normalizedCategory || normalizedCategory === "return")
  ) {
    clauses.push({
      category: "return",
      status: { $in: ["open", "in_progress", "resolved"] },
      ...missingOwnerClause,
    });
  }

  if (
    normalizedOwnerRole === "sales" &&
    (!normalizedCategory || normalizedCategory === "refund")
  ) {
    clauses.push({
      category: "refund",
      status: { $in: ["open", "in_progress", "resolved"] },
      ...missingOwnerClause,
    });
  }

  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

function decorateTicketWorkflow(ticket) {
  if (!ticket) return ticket;

  if (isWarrantyCategory(ticket.category)) {
    syncWarrantyServiceOrder(ticket);
  }

  const currentOwnerRole = normalizeOwnerRole(ticket.currentOwnerRole);
  const nextActionCode = toTrimmedString(ticket.nextActionCode, "");
  if (currentOwnerRole && nextActionCode) {
    return ticket;
  }

  const routing = resolveTicketRoutingState(ticket.category, ticket.status, ticket.userId || null);
  if (!currentOwnerRole) {
    ticket.currentOwnerRole = routing.currentOwnerRole;
  }
  if (!nextActionCode) {
    ticket.nextActionCode = routing.nextActionCode;
  }

  return ticket;
}

function parsePagination(options = {}) {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 10));
  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

function addMonths(date, months) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  const next = new Date(date);
  next.setMonth(next.getMonth() + Number(months || 0));
  return next;
}

function resolveWarrantyEligibilitySnapshot(warranty = {}, referenceTime = new Date()) {
  const warrantyMonths = Math.max(0, Number(warranty?.warrantyMonths || 0));
  if (warrantyMonths <= 0) {
    return "not_covered";
  }

  const expiresAt = warranty?.expiresAt ? new Date(warranty.expiresAt) : null;
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
    return "not_covered";
  }

  return expiresAt >= referenceTime ? "eligible" : "expired";
}

function ensureWarrantyMetadata(ticket) {
  if (!ticket.warranty || typeof ticket.warranty !== "object") {
    ticket.warranty = {};
  }
  return ticket.warranty;
}

function mapWarrantyOrderStatusFromTicketStatus(ticketStatus, fallback = "created") {
  const normalizedStatus = normalizeStatus(ticketStatus);
  if (normalizedStatus === "approved") {
    return "created";
  }
  if (normalizedStatus === "in_service") {
    return "in_service";
  }
  if (normalizedStatus === "completed") {
    return "completed";
  }
  if (normalizedStatus === "rejected") {
    return "cancelled";
  }

  return normalizeWarrantyOrderStatus(fallback, "created");
}

function syncWarrantyServiceOrder(ticket, referenceTime = new Date()) {
  const warranty = ensureWarrantyMetadata(ticket);
  warranty.eligibility = resolveWarrantyEligibilitySnapshot(
    warranty,
    referenceTime,
  );

  if (!warranty.serviceOrder || typeof warranty.serviceOrder !== "object") {
    return ticket;
  }

  warranty.serviceOrder.status = mapWarrantyOrderStatusFromTicketStatus(
    ticket.status,
    warranty.serviceOrder.status,
  );
  warranty.serviceOrder.updatedAt = referenceTime;

  return ticket;
}

function buildWarrantyOrderCode(ticket) {
  const now = new Date();
  const ymd = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  const suffixSeed = toTrimmedString(
    ticket?.orderId?.paymentCode || ticket?.orderId || ticket?._id,
    "",
  )
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  const suffix =
    suffixSeed.slice(-6) ||
    Math.random().toString(36).slice(2, 8).toUpperCase();

  return `WAR-${ymd}-${suffix}`;
}

function resolveWarrantyReferenceDate(order) {
  const deliveredState = toTrimmedString(order?.shipment?.state, "").toLowerCase();
  const shipmentDate =
    deliveredState === "delivered"
      ? order?.shipment?.lastActionAt ||
        order?.shipment?.updatedAt ||
        order?.shipment?.createdAt
      : null;
  const candidate = shipmentDate || order?.confirmedAt || order?.createdAt;
  const normalized = candidate ? new Date(candidate) : null;
  if (!normalized || Number.isNaN(normalized.getTime())) {
    return null;
  }
  return normalized;
}

function buildWarrantySnapshot(order, orderItem, product) {
  const warrantyMonths = Math.max(
    0,
    Number(product?.fulfillment?.warrantyMonths || 0),
  );
  const referenceDate = resolveWarrantyReferenceDate(order);
  const expiresAt =
    warrantyMonths > 0 && referenceDate ? addMonths(referenceDate, warrantyMonths) : null;
  const now = new Date();
  const eligibility =
    warrantyMonths <= 0
      ? "not_covered"
      : expiresAt && expiresAt >= now
        ? "eligible"
        : "expired";

  return {
    orderItemId: orderItem?._id || null,
    productId: orderItem?.productId || product?._id || null,
    variantId: orderItem?.variantId || null,
    itemName: toTrimmedString(orderItem?.name || product?.name, ""),
    warrantyMonths,
    referenceDate,
    expiresAt,
    eligibility,
    decisionNote: "",
    serviceNote: "",
    approvedBy: null,
    approvedAt: null,
    completedBy: null,
    completedAt: null,
    serviceOrder: null,
  };
}

function hasRefundBankAccount(value) {
  if (!value || typeof value !== "object") return false;
  return Boolean(
    toTrimmedString(value.bankCode, "") &&
      toTrimmedString(value.bankName, "") &&
      toTrimmedString(value.accountNumber, "") &&
      toTrimmedString(value.accountHolder, ""),
  );
}

function toPlainRefundBankAccount(value) {
  if (!hasRefundBankAccount(value)) return null;
  return {
    bankCode: toTrimmedString(value.bankCode, ""),
    bankName: toTrimmedString(value.bankName, ""),
    accountNumber: toTrimmedString(value.accountNumber, ""),
    accountHolder: toTrimmedString(value.accountHolder, ""),
    note: toTrimmedString(value.note, ""),
  };
}

function buildWarrantyRefundBreakdown(order, warranty = {}) {
  const orderItemId = toTrimmedString(warranty?.orderItemId, "");
  const orderItem = (Array.isArray(order?.items) ? order.items : []).find(
    (item) => String(item?._id || "") === orderItemId,
  );

  if (!orderItem) {
    throw new AppError("Warranty order item not found on the linked order", 404);
  }

  const lineTotal = Math.max(0, Number(orderItem?.lineTotal || 0));
  const paidAmount = Math.max(0, Number(order?.paidAmount || 0));
  const refundableItemAmount = Math.min(lineTotal, paidAmount);

  if (refundableItemAmount <= 0) {
    throw new AppError("This warranty item has no refundable paid amount", 400);
  }

  return {
    itemAmount: refundableItemAmount,
    shippingFeeAmount: 0,
    returnShippingFeeAmount: 0,
  };
}

function buildPagination(page, limit, total) {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

function assertSupportAccess(currentUser) {
  if (!currentUser || (!isCustomer(currentUser) && !isBusinessUser(currentUser))) {
    throw new AppError("Forbidden", 403);
  }
}

function assertBusinessTicketAccess(ticket, currentUser) {
  if (!isBusinessUser(currentUser)) {
    throw new AppError("Forbidden", 403);
  }

  const ticketStoreId = normalizeStoreId(ticket?.storeId);
  if (!ticketStoreId) {
    if (!isManager(currentUser)) {
      throw new AppError("Forbidden", 403);
    }
    return;
  }

  if (!canAccessStore(currentUser, ticketStoreId)) {
    throw new AppError("Forbidden", 403);
  }
}

function buildBusinessTicketVisibilityQuery(currentUser) {
  if (!isBusinessUser(currentUser)) {
    throw new AppError("Forbidden", 403);
  }

  const accessibleStoreIds = getAccessibleStoreIds(currentUser);
  if (isManager(currentUser)) {
    if (accessibleStoreIds === null) {
      return {};
    }

    return {
      $or: [
        { storeId: { $in: accessibleStoreIds } },
        { storeId: null },
      ],
    };
  }

  if (accessibleStoreIds === null) {
    return {
      storeId: { $ne: null },
    };
  }

  return {
    storeId: { $in: accessibleStoreIds },
  };
}

async function findAccessibleOrder(orderId, currentUser) {
  if (!orderId || !mongoose.isValidObjectId(orderId)) {
    throw new AppError("orderId is invalid", 400);
  }

  const order = await Order.findById(orderId).select(
    "_id userId storeId status orderType createdAt confirmedAt shipment items paymentCode",
  );
  if (!order) {
    throw new AppError("Order not found", 404);
  }

  const actorUserId = getUserId(currentUser);
  if (isCustomer(currentUser) && String(order.userId) !== String(actorUserId)) {
    throw new AppError("Forbidden", 403);
  }

  if (isBusinessUser(currentUser)) {
    const orderStoreId = normalizeStoreId(order.storeId);
    if (orderStoreId && !canAccessStore(currentUser, orderStoreId)) {
      throw new AppError("Forbidden", 403);
    }
  }

  return order;
}

async function resolveRequestedStoreId(storeId, currentUser) {
  const normalizedStoreId = normalizeStoreId(storeId);
  if (!normalizedStoreId) {
    return findSingleStoreId();
  }

  const exists = await Store.exists({ _id: normalizedStoreId });
  if (!exists) {
    throw new AppError("Store not found", 404);
  }

  if (isBusinessUser(currentUser) && !canAccessStore(currentUser, normalizedStoreId)) {
    throw new AppError("Forbidden", 403);
  }

  return findSingleStoreId();
}

function populateTicketQuery(query) {
  return query.populate(TICKET_POPULATE);
}

async function findSearchableOrderIds(currentUser, search) {
  const normalizedSearch = toTrimmedString(search, "");
  if (!normalizedSearch) {
    return [];
  }

  const orderQuery = {
    $or: [
      { paymentCode: { $regex: normalizedSearch, $options: "i" } },
      { "shippingAddress.fullName": { $regex: normalizedSearch, $options: "i" } },
      { "shippingAddress.phone": { $regex: normalizedSearch, $options: "i" } },
    ],
  };

  if (isCustomer(currentUser)) {
    orderQuery.userId = getUserId(currentUser);
  } else {
    Object.assign(orderQuery, buildStoreScopedQuery(currentUser, "storeId"));
  }

  const orders = await Order.find(orderQuery).select("_id").limit(50);
  return orders.map((order) => order?._id).filter(Boolean);
}

function validateWarrantyTransition(currentStatus, nextStatus, currentUser) {
  if (!WARRANTY_STATUS_SET.has(nextStatus)) {
    throw new AppError("Invalid warranty status", 400);
  }

  if (isManager(currentUser)) {
    return;
  }

  if (isOperation(currentUser)) {
    if (!["in_service", "completed"].includes(nextStatus)) {
      throw new AppError(
        "Operations can only move warranty cases to in_service or completed",
        403,
      );
    }
  } else if (isStaff(currentUser)) {
    if (!["under_review", "approved", "rejected"].includes(nextStatus)) {
      throw new AppError(
        "Sales/support can only review or decide warranty cases",
        403,
      );
    }
  } else {
    throw new AppError("Forbidden", 403);
  }

  const allowed = WARRANTY_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(nextStatus)) {
    throw new AppError(
      `Warranty status cannot transition from ${currentStatus} to ${nextStatus}`,
      400,
    );
  }
}

class SupportService {
  async listTickets(currentUser, options = {}) {
    assertSupportAccess(currentUser);

    const { page, limit, skip } = parsePagination(options);
    const query = {};
    const normalizedCategory = options.category
      ? normalizeCategory(options.category)
      : "";
    const normalizedStatus = normalizeStatus(options.status);
    const normalizedOwnerRole = normalizeOwnerRole(options.ownerRole);
    const normalizedEligibility = toTrimmedString(options.eligibility, "").toLowerCase();
    const normalizedSearch = toTrimmedString(options.q, "");
    const normalizedOrderId = toTrimmedString(
      options.orderId || options.order_id,
      "",
    );

    if (normalizedCategory) {
      query.category = normalizedCategory;
    }

    if (normalizedStatus) {
      query.status = normalizedStatus;
    }

    if (normalizedEligibility) {
      if (!WARRANTY_ELIGIBILITY_SET.has(normalizedEligibility)) {
        throw new AppError("Invalid warranty eligibility filter", 400);
      }
      query["warranty.eligibility"] = normalizedEligibility;
      if (!query.category) {
        query.category = "warranty";
      }
    }

    if (isCustomer(currentUser)) {
      query.userId = getUserId(currentUser);
    } else {
      Object.assign(query, buildBusinessTicketVisibilityQuery(currentUser));
      if (options.userId && mongoose.isValidObjectId(options.userId)) {
        query.userId = options.userId;
      }
    }

    if (normalizedOrderId) {
      const order = await findAccessibleOrder(normalizedOrderId, currentUser);
      query.orderId = order._id;
    }

    if (normalizedSearch) {
      const matchedOrderIds = await findSearchableOrderIds(
        currentUser,
        normalizedSearch,
      );
      const searchConditions = [
        { subject: { $regex: normalizedSearch, $options: "i" } },
      ];

      if (matchedOrderIds.length > 0) {
        searchConditions.push({ orderId: { $in: matchedOrderIds } });
      }

      query.$or = searchConditions;
    }

    if (normalizedOwnerRole) {
      const ownerRoleFilter = buildOwnerRoleFilter(
        normalizedOwnerRole,
        query.category || normalizedCategory,
      );
      if (ownerRoleFilter) {
        query.$and = [...(Array.isArray(query.$and) ? query.$and : []), ownerRoleFilter];
      }
    }

    const [tickets, total] = await Promise.all([
      populateTicketQuery(
        SupportTicket.find(query).sort({ lastMessageAt: -1, createdAt: -1 }),
      )
        .skip(skip)
        .limit(limit),
      SupportTicket.countDocuments(query),
    ]);

    return {
      tickets: tickets.map((ticket) => decorateTicketWorkflow(ticket)),
      pagination: buildPagination(page, limit, total),
    };
  }

  async listWarrantyCases(currentUser, options = {}) {
    if (!isBusinessUser(currentUser)) {
      throw new AppError("Forbidden", 403);
    }

    const result = await this.listTickets(currentUser, {
      ...options,
      category: "warranty",
    });

    return {
      cases: result.tickets,
      pagination: result.pagination,
    };
  }

  async listRefundCases(currentUser, options = {}) {
    if (!isBusinessUser(currentUser)) {
      throw new AppError("Forbidden", 403);
    }

    const { page, limit, skip } = parsePagination(options);
    const query = {
      "refund.status": { $ne: "none" },
      ...buildStoreScopedQuery(currentUser, "storeId"),
    };
    const normalizedStatus = toTrimmedString(options.status, "").toLowerCase();
    const ownerRole = toTrimmedString(options.ownerRole, "").toLowerCase();
    const search = toTrimmedString(options.q, "");

    if (normalizedStatus) {
      if (!REFUND_STATUS_SET.has(normalizedStatus)) {
        throw new AppError("Invalid refund status filter", 400);
      }
      query["refund.status"] = normalizedStatus;
    }

    if (ownerRole) {
      query["refund.currentOwnerRole"] = ownerRole;
    }

    if (search) {
      query.$or = [
        { paymentCode: { $regex: search, $options: "i" } },
        { "shippingAddress.fullName": { $regex: search, $options: "i" } },
        { "shippingAddress.phone": { $regex: search, $options: "i" } },
      ];
    }

    const [cases, total] = await Promise.all([
      Order.find(query)
        .populate([
          { path: "userId", select: "name email role" },
          { path: "storeId", select: "name code type status city district" },
        ])
        .sort({ updatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(query),
    ]);

    return {
      cases,
      pagination: buildPagination(page, limit, total),
    };
  }

  async getTicketById(id, currentUser) {
    assertSupportAccess(currentUser);

    const ticket = await populateTicketQuery(SupportTicket.findById(id));
    if (!ticket) {
      throw new AppError("Support ticket not found", 404);
    }

    const actorUserId = getUserId(currentUser);
    if (String(ticket.userId?._id || ticket.userId) === String(actorUserId)) {
      return decorateTicketWorkflow(ticket);
    }

    assertBusinessTicketAccess(ticket, currentUser);
    return decorateTicketWorkflow(ticket);
  }

  async createTicket(currentUser, payload = {}) {
    assertSupportAccess(currentUser);

    const subject = toTrimmedString(payload.subject, "");
    const message = toTrimmedString(payload.message, "");
    if (!subject) {
      throw new AppError("subject is required", 400);
    }
    if (!message) {
      throw new AppError("message is required", 400);
    }

    const category = normalizeCategory(payload.category);
    const orderId = toTrimmedString(payload.orderId || payload.order_id, "");
    const email = toTrimmedString(payload.email || currentUser?.email, "");
    const sender = isBusinessUser(currentUser) ? "staff" : "user";
    const priorityInput = toTrimmedString(payload.priority, "").toLowerCase();
    const attachments = normalizeSupportAttachments(payload.attachments, "attachments");
    const normalizedPriority = SUPPORT_PRIORITY_SET.has(priorityInput)
      ? priorityInput
      : "normal";
    const resolvedPriority = isBusinessUser(currentUser)
      ? normalizedPriority
      : "normal";

    let order = null;
    if (orderId) {
      order = await findAccessibleOrder(orderId, currentUser);
    }

    let status = "open";
    let warranty = null;
    let storeId = normalizeStoreId(order?.storeId);

    if (!storeId) {
      storeId = await resolveRequestedStoreId(
        payload.storeId || payload.store_id,
        currentUser,
      );
    }

    if (isWarrantyCategory(category)) {
      if (!order) {
        throw new AppError("Warranty requests must reference an order", 400);
      }

      const orderItemId = toTrimmedString(
        payload.orderItemId || payload.order_item_id,
        "",
      );
      if (!orderItemId || !mongoose.isValidObjectId(orderItemId)) {
        throw new AppError("orderItemId is required for warranty requests", 400);
      }

      const orderItem = (Array.isArray(order.items) ? order.items : []).find(
        (item) => String(item?._id) === orderItemId,
      );
      if (!orderItem) {
        throw new AppError("Order item not found", 404);
      }

      const product = await Product.findById(orderItem.productId).select(
        "_id name fulfillment.warrantyMonths",
      );
      if (!product) {
        throw new AppError("Product not found for warranty request", 404);
      }

      warranty = buildWarrantySnapshot(order, orderItem, product);
      status = "requested";
    }

    if (requiresAfterSalesEvidence(category, order?._id || orderId) && attachments.length === 0) {
      throw new AppError(
        "At least one image or video is required for after-sales support tickets",
        400,
      );
    }

    if (isBusinessUser(currentUser) && !isManager(currentUser) && !storeId) {
      throw new AppError(
        "storeId is required when staff creates a ticket without a store-linked order",
        400,
      );
    }

    const ticketUserId = order?.userId || getUserId(currentUser);
    const routing = resolveTicketRoutingState(category, status, ticketUserId);
    const actorUserId = getUserId(currentUser);

    const created = await SupportTicket.create({
      userId: ticketUserId,
      email,
      subject,
      category,
      status,
      priority: resolvedPriority,
      orderId: order?._id || null,
      storeId: storeId || null,
      warranty,
      currentOwnerRole: routing.currentOwnerRole,
      currentOwnerUserId: routing.currentOwnerUserId,
      nextActionCode: routing.nextActionCode,
      routingHistory:
        routing.currentOwnerRole !== "none"
          ? [
              buildSupportRoutingHistoryEntry({
                fromOwnerRole: "none",
                toOwnerRole: routing.currentOwnerRole,
                actorUserId,
                note: message,
              }),
            ]
          : [],
      messages: [
        {
          sender,
          message,
          attachments,
        },
      ],
      lastMessageAt: new Date(),
    });

    return this.getTicketById(created._id, currentUser);
  }

  async addReply(id, currentUser, payload = {}) {
    const ticket = await this.getTicketById(id, currentUser);
    const message = toTrimmedString(payload.message, "");
    const attachments = normalizeSupportAttachments(payload.attachments, "attachments");
    if (!message) {
      throw new AppError("message is required", 400);
    }

    const actorUserId = getUserId(currentUser);
    const isOwner = String(ticket.userId?._id || ticket.userId) === String(actorUserId);
    if (!isOwner && !isBusinessUser(currentUser)) {
      throw new AppError("Forbidden", 403);
    }

    const sender = isBusinessUser(currentUser) ? "staff" : "user";
    ticket.messages.push({ sender, message, attachments });
    ticket.lastMessageAt = new Date();

    if (!isWarrantyCategory(ticket.category)) {
      if (sender === "staff" && ticket.status === "open") {
        ticket.status = "in_progress";
      }
      if (sender === "user" && ["resolved", "closed"].includes(ticket.status)) {
        ticket.status = "in_progress";
      }
    }

    applyTicketRoutingState(
      ticket,
      currentUser,
      sender === "staff" ? "Staff replied on ticket" : "Customer replied on ticket",
    );

    await ticket.save();
    return this.getTicketById(ticket._id, currentUser);
  }

  async createWarrantyOrder(id, currentUser, payload = {}) {
    if (!isStaff(currentUser) && !isManager(currentUser)) {
      throw new AppError(
        "Only sales/support can create warranty service orders",
        403,
      );
    }

    const ticket = await this.getTicketById(id, currentUser);
    assertBusinessTicketAccess(ticket, currentUser);

    if (!isWarrantyCategory(ticket.category)) {
      throw new AppError("Warranty order can only be created for warranty tickets", 400);
    }

    const warranty = ensureWarrantyMetadata(ticket);
    warranty.eligibility = resolveWarrantyEligibilitySnapshot(warranty);

    if (warranty.eligibility !== "eligible") {
      throw new AppError(
        "Warranty order can only be created while the product is still within the warranty period",
        400,
      );
    }

    if (toTrimmedString(warranty.serviceOrder?.code, "")) {
      throw new AppError("Warranty order already exists for this ticket", 409);
    }

    if (["rejected", "completed"].includes(normalizeStatus(ticket.status))) {
      throw new AppError(
        "Warranty order cannot be created for a rejected or completed ticket",
        400,
      );
    }

    const createdAt = new Date();
    const note = toTrimmedString(
      payload.note || payload.decisionNote || payload.serviceNote,
      "",
    );
    const code = buildWarrantyOrderCode(ticket);

    warranty.serviceOrder = {
      code,
      status: "created",
      note,
      createdBy: getUserId(currentUser),
      createdAt,
      updatedAt: createdAt,
    };
    warranty.approvedBy = warranty.approvedBy || getUserId(currentUser);
    warranty.approvedAt = warranty.approvedAt || createdAt;
    if (note) {
      warranty.decisionNote = note;
    }

    ticket.status = "approved";
    ticket.messages.push({
      sender: "staff",
      message: `Warranty confirmed. Created warranty order ${code}.`,
      attachments: [],
    });
    ticket.lastMessageAt = createdAt;

    applyTicketRoutingState(
      ticket,
      currentUser,
      note || `Created warranty order ${code}`,
    );
    syncWarrantyServiceOrder(ticket, createdAt);

    await ticket.save();
    return this.getTicketById(ticket._id, currentUser);
  }

  async createWarrantyRefund(id, currentUser, payload = {}) {
    if (!isStaff(currentUser)) {
      throw new AppError(
        "Only sales/support can create warranty refund requests",
        403,
      );
    }

    const ticket = await this.getTicketById(id, currentUser);
    assertBusinessTicketAccess(ticket, currentUser);

    if (!isWarrantyCategory(ticket.category)) {
      throw new AppError("Warranty refund can only be created for warranty tickets", 400);
    }

    const warranty = ensureWarrantyMetadata(ticket);
    warranty.eligibility = resolveWarrantyEligibilitySnapshot(warranty);

    if (warranty.eligibility !== "eligible") {
      throw new AppError(
        "Warranty refund can only be created while the product is still within the warranty period",
        400,
      );
    }

    if (toTrimmedString(warranty.serviceOrder?.code, "")) {
      throw new AppError(
        "Warranty refund cannot be created after a warranty service order already exists",
        409,
      );
    }

    if (["rejected", "completed"].includes(normalizeStatus(ticket.status))) {
      throw new AppError(
        "Warranty refund cannot be created for a rejected or completed ticket",
        400,
      );
    }

    const orderId = toTrimmedString(ticket?.orderId?._id || ticket?.orderId, "");
    if (!orderId || !mongoose.isValidObjectId(orderId)) {
      throw new AppError("Warranty ticket is missing a linked order", 400);
    }

    const order = await Order.findById(orderId).select(
      "_id userId paidAmount items refund paymentCode",
    );
    if (!order) {
      throw new AppError("Order not found", 404);
    }

    const requestedBreakdown = buildWarrantyRefundBreakdown(order, warranty);
    const note = toTrimmedString(
      payload.note || payload.decisionNote || payload.serviceNote,
      "",
    );
    const explicitBankAccount = toPlainRefundBankAccount(
      payload.bankAccount || payload.bank_account,
    );
    const customer = explicitBankAccount
      ? null
      : await User.findById(order.userId).select("refundAccount");
    const bankAccount =
      explicitBankAccount ||
      toPlainRefundBankAccount(customer?.refundAccount) ||
      toPlainRefundBankAccount(order?.refund?.bankAccount);

    if (!bankAccount) {
      throw new AppError(
        "Customer refund bank account is required before creating a warranty refund",
        400,
      );
    }

    const itemLabel = toTrimmedString(warranty.itemName, "this product");
    await orderService.createRefundRequest(orderId, currentUser, {
      reason: `Warranty refund for ${itemLabel} because replacement stock is unavailable`,
      note:
        note ||
        `Created from warranty ticket because replacement stock is unavailable for ${itemLabel}.`,
      responsibility: "system",
      requestedBreakdown,
      bankAccount,
    });

    const createdAt = new Date();
    if (note) {
      warranty.decisionNote = note;
    }
    warranty.completedBy = getUserId(currentUser);
    warranty.completedAt = createdAt;
    ticket.status = "completed";
    ticket.messages.push({
      sender: "staff",
      message: `Warranty replacement unavailable. Created refund request for order ${order.paymentCode || order._id}.`,
      attachments: [],
    });
    ticket.lastMessageAt = createdAt;

    applyTicketRoutingState(
      ticket,
      currentUser,
      note ||
        `Created warranty refund request for order ${order.paymentCode || order._id}`,
    );

    await ticket.save();
    return this.getTicketById(ticket._id, currentUser);
  }

  async updateStatus(id, currentUser, payload = {}) {
    if (!isBusinessUser(currentUser)) {
      throw new AppError("Forbidden", 403);
    }

    const nextStatus =
      typeof payload === "string"
        ? normalizeStatus(payload)
        : normalizeStatus(payload.status);
    if (!nextStatus) {
      throw new AppError("status is required", 400);
    }

    const ticket = await this.getTicketById(id, currentUser);
    assertBusinessTicketAccess(ticket, currentUser);

    if (isWarrantyCategory(ticket.category)) {
      validateWarrantyTransition(ticket.status, nextStatus, currentUser);

      const warranty = ensureWarrantyMetadata(ticket);
      warranty.eligibility = resolveWarrantyEligibilitySnapshot(warranty);

      if (
        nextStatus === "approved" &&
        !toTrimmedString(warranty.serviceOrder?.code, "")
      ) {
        throw new AppError(
          "Use warranty-order creation after sales confirmation instead of approving the ticket directly",
          400,
        );
      }

      ticket.status = nextStatus;

      const decisionNote = toTrimmedString(payload.decisionNote || payload.note, "");
      const serviceNote = toTrimmedString(payload.serviceNote, "");

      if (decisionNote) {
        warranty.decisionNote = decisionNote;
      }
      if (serviceNote) {
        warranty.serviceNote = serviceNote;
      }

      if (nextStatus === "approved") {
        warranty.approvedBy = getUserId(currentUser);
        warranty.approvedAt = new Date();
      }
      if (nextStatus === "completed") {
        warranty.completedBy = getUserId(currentUser);
        warranty.completedAt = new Date();
      }

      syncWarrantyServiceOrder(ticket);
    } else {
      if (!GENERAL_STATUS_SET.has(nextStatus)) {
        throw new AppError("Invalid support ticket status", 400);
      }
      ticket.status = nextStatus;
    }

    applyTicketRoutingState(
      ticket,
      currentUser,
      toTrimmedString(
        payload.decisionNote || payload.serviceNote || payload.note,
        "",
      ),
    );

    ticket.lastMessageAt = new Date();
    await ticket.save();

    return this.getTicketById(ticket._id, currentUser);
  }
}

module.exports = new SupportService();
module.exports.__private = {
  normalizeCategory,
  isWarrantyCategory,
  normalizeSupportAttachments,
  requiresAfterSalesEvidence,
  resolveWarrantyReferenceDate,
  resolveWarrantyEligibilitySnapshot,
  addMonths,
  buildWarrantySnapshot,
  buildWarrantyOrderCode,
  syncWarrantyServiceOrder,
  validateWarrantyTransition,
  buildBusinessTicketVisibilityQuery,
  resolveRequestedStoreId,
};
