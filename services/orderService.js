const Product = require("../models/Product");
const Order = require("../models/Order");
const Store = require("../models/Store");
const User = require("../models/User");
const Invoice = require("../models/Invoice");
const AppError = require("../errors/AppError");
const {
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  ORDER_OPS_STAGE,
  ORDER_TYPES,
  ORDER_STATUS,
  PRODUCT_STATUS,
  PRODUCT_TYPES,
} = require("../constants");
const { generatePaymentCode } = require("../helpers/paymentCode");
const {
  isBusinessUser,
  isStaff: isStaffRole,
  isOperation,
  isManager,
  getUserId,
  getRole,
} = require("../helpers/roles");
const {
  getAccessibleStoreIds,
  canAccessStore,
} = require("../helpers/storeAccess");
const { publishStatusChange } = require("../helpers/statusEvents");
const { appendUserNotification } = require("../helpers/userNotification");
const {
  findRefundBank,
  normalizeRefundAccountNumber,
  isRefundAccountNumberFormatValid,
} = require("../helpers/refundBankCatalog");
const {
  canTransitionOpsStage,
  getInitialOpsStage,
  isOpsStageAllowedForOrderType,
  normalizeOpsStage,
  syncOpsStageWithOrder,
  syncOrderWithOpsStage,
} = require("../helpers/orderOpsStage");
const {
  commitOrderInventory,
  hasCommittedInventory,
  restoreOrderInventory,
} = require("../helpers/orderInventory");
const {
  getEffectiveSystemConfig,
  canUseGhn,
  resolvePreOrderRuntimeConfig,
} = require("../helpers/systemConfig");
const { findSingleStoreId } = require("../helpers/singleStore");
const promotionService = require("./promotionService");
const promotionRedemptionService = require("./promotionRedemptionService");
const shippingQuoteService = require("./shippingQuoteService");

const PRESCRIPTION_MODES = new Set(["none", "manual", "upload"]);
const REFUND_STATUSES = new Set([
  "none",
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
const REFUND_RESPONSIBILITIES = new Set([
  "customer",
  "system",
  "carrier",
  "mixed",
]);
const REFUND_ACTIONS = Object.freeze({
  START_REVIEW: "start_review",
  CUSTOMER_SUBMIT_INFO: "customer_submit_info",
  REQUEST_CUSTOMER_INFO: "request_customer_info",
  APPROVE: "approve",
  REJECT: "reject",
  ESCALATE: "escalate",
  MANAGER_APPROVE: "manager_approve",
  MANAGER_REJECT: "manager_reject",
  SEND_BACK_TO_STAFF: "send_back_to_staff",
  MARK_RETURN_PENDING: "mark_return_pending",
  CONFIRM_RETURN_RECEIVED: "confirm_return_received",
  INSPECTION_FAILED: "inspection_failed",
  START_PROCESSING: "start_processing",
  COMPLETE: "complete",
});
const REFUND_ACTION_VALUES = new Set(Object.values(REFUND_ACTIONS));
const DEFAULT_REFUND_WORKFLOW_SETTINGS = Object.freeze({
  staffApprovalLimit: 300000,
  requiresManagerForReturn: true,
  requiresManagerForShippingRefund: true,
  requirePayoutProof: false,
});
const OPEN_REFUND_STATUSES = new Set([
  "requested",
  "reviewing",
  "waiting_customer_info",
  "escalated_to_manager",
  "approved",
  "return_pending",
  "return_received",
  "processing",
]);
const REFUND_OVERRIDE_ACTIONS = new Set([
  "reassign_sales",
  "reassign_manager",
  "reassign_operations",
  "reset_reviewing",
  "retry_customer_notification",
]);
const CART_TYPES = {
  READY_STOCK: "ready_stock",
  PRE_ORDER: "pre_order",
};
const SHIPPING_COLLECTION_TIMINGS = new Set([
  "upfront",
  "on_delivery",
]);
const SHIPPING_FEE_MODES = new Set(["exact", "estimated"]);
const ORDER_PAYMENT_HOLD_MINUTES = 15;
const ORDER_PAYMENT_TIMEOUT_REASON =
  "Order payment window expired after 15 minutes";
const ORDER_PAYMENT_TIMEOUT_LATE_PAYMENT_REASON =
  "Payment was received after the 15-minute payment window had already expired";
const ORDER_CANCELLED_LATE_PAYMENT_REASON =
  "Payment was received after the order had already been cancelled";
const SHIPMENT_BOUND_OPS_STAGES = new Set([
  ORDER_OPS_STAGE.SHIPMENT_CREATED,
  ORDER_OPS_STAGE.HANDOVER_TO_CARRIER,
  ORDER_OPS_STAGE.IN_TRANSIT,
  ORDER_OPS_STAGE.DELIVERY_FAILED,
  ORDER_OPS_STAGE.WAITING_REDELIVERY,
  ORDER_OPS_STAGE.RETURN_PENDING,
  ORDER_OPS_STAGE.RETURN_IN_TRANSIT,
  ORDER_OPS_STAGE.EXCEPTION_HOLD,
  ORDER_OPS_STAGE.DELIVERED,
  ORDER_OPS_STAGE.RETURNED,
]);
const READY_STOCK_HOLD_REASONS = new Set([
  "payment",
  "address",
  "stock",
  "manual",
  "other",
]);
const PRESCRIPTION_FOLLOW_UP_STATUSES = new Set([
  "none",
  "needs_review",
  "needs_customer_contact",
  "waiting_customer_response",
  "customer_responded",
]);
const READY_STOCK_ISSUE_TYPES = new Set([
  "out_of_stock",
  "wrong_sku",
  "damaged_item",
  "address_issue",
  "shipping_label_error",
  "other",
]);
const READY_STOCK_CHECKLIST_KEYS = Object.freeze([
  "skuQuantityChecked",
  "productConditionChecked",
  "addressChecked",
  "packageReady",
]);
const CHECKOUT_EXCLUDED_PRODUCT_TYPES = new Set([
  PRODUCT_TYPES.SERVICE,
  PRODUCT_TYPES.GIFT_CARD,
]);

const ORDER_POPULATE = [
  {
    path: "invoiceId",
    select: "invoiceCode status total paidAmount amountDue issuedAt paidAt",
  },
  {
    path: "storeId",
    select:
      "name code type status phone email addressLine1 ward district city openingHours supportsTryOn supportsPickup isDefault",
  },
  {
    path: "items.productId",
    select: "fulfillment.supplier variants._id variants.warehouseLocation",
  },
];

function isStaff(user) {
  return isBusinessUser(user);
}

function getOrderStoreId(order) {
  return toTrimmedString(order?.storeId?._id || order?.storeId, "");
}

function isProductAvailableAtStore(product, storeId) {
  const normalizedStoreId = toTrimmedString(storeId, "");
  if (!normalizedStoreId) {
    return true;
  }

  const mode =
    String(product?.storeScope?.mode || "all").trim().toLowerCase() === "selected"
      ? "selected"
      : "all";
  if (mode !== "selected") {
    return true;
  }

  const storeIds = [
    ...new Set(
      [
        product?.storeScope?.primaryStoreId,
        ...(Array.isArray(product?.storeScope?.storeIds)
          ? product.storeScope.storeIds
          : []),
      ]
        .map((value) => toTrimmedString(value?._id || value, ""))
        .filter(Boolean),
    ),
  ];

  return storeIds.includes(normalizedStoreId);
}

async function resolveOrderStoreId({ requestedStoreId, currentUser }) {
  const normalizedRequestedStoreId = toTrimmedString(requestedStoreId, "");
  const singleStoreId = await findSingleStoreId();

  if (normalizedRequestedStoreId) {
    const exists = await Store.exists({ _id: normalizedRequestedStoreId });
    if (!exists) {
      throw new AppError("Store not found", 404);
    }
    if (
      currentUser &&
      isStaff(currentUser) &&
      !canAccessStore(currentUser, normalizedRequestedStoreId)
    ) {
      throw new AppError("Forbidden", 403);
    }
    return singleStoreId;
  }

  return singleStoreId;
}

function assertBusinessUserCanAccessOrder(order, currentUser) {
  if (!currentUser || !isStaff(currentUser)) {
    return;
  }

  const actorStoreIds = getAccessibleStoreIds(currentUser);
  if (actorStoreIds === null) {
    return;
  }

  const orderStoreId = getOrderStoreId(order);
  if (!orderStoreId || !actorStoreIds.includes(orderStoreId)) {
    throw new AppError("Forbidden", 403);
  }
}

function normalizeNonNegativeNumber(value, fieldName) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) {
    throw new AppError(`${fieldName} must be a non-negative number`, 400);
  }
  return number;
}

function normalizePositiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new AppError(`${fieldName} must be an integer >= 1`, 400);
  }
  return number;
}

function buildInvoiceCode(paymentCode, orderId) {
  const seed = String(paymentCode || orderId || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = (seed || String(orderId || "")).slice(-8).padStart(8, "0");
  return `INV-${datePart}-${suffix}`;
}

function toTrimmedString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function buildFeatureDisabledError(message, errorCode, statusCode = 400) {
  return new AppError(message, statusCode, errorCode);
}

function assertPreorderRuntimeEnabled(systemConfig) {
  if (systemConfig?.featureFlags?.preorderEnabled !== false) {
    return;
  }

  throw buildFeatureDisabledError(
    "Pre-order is currently disabled.",
    "PREORDER_DISABLED",
  );
}

function assertCodRuntimeEnabled(systemConfig) {
  if (systemConfig?.payments?.codEnabled !== false) {
    return;
  }

  throw buildFeatureDisabledError("COD is currently disabled.", "COD_DISABLED");
}

function assertRefundWorkflowRuntimeEnabled(systemConfig) {
  if (systemConfig?.featureFlags?.refundWorkflowEnabled !== false) {
    return;
  }

  throw buildFeatureDisabledError(
    "Refund workflow is currently disabled.",
    "REFUND_WORKFLOW_DISABLED",
  );
}

function assertShippingRuntimeAvailable(systemConfig) {
  if (canUseGhn(systemConfig)) {
    return;
  }

  throw new AppError(
    "Shipping carrier integration is currently unavailable.",
    503,
    "SHIPPING_UNAVAILABLE",
  );
}

function addHours(dateValue, hours = 12) {
  const date = new Date(dateValue || Date.now());
  const next = new Date(date.getTime());
  next.setHours(next.getHours() + Number(hours || 0));
  return next;
}

function addMinutes(dateValue, minutes = 15) {
  const date = new Date(dateValue || Date.now());
  const next = new Date(date.getTime());
  next.setMinutes(next.getMinutes() + Number(minutes || 0));
  return next;
}

function toDisplayName(user, fallback = "") {
  return toTrimmedString(
    user?.name || user?.fullName || user?.email || fallback,
    fallback,
  );
}

function normalizeOptionalBoolean(value, fieldName) {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new AppError(`${fieldName} must be a boolean`, 400);
}

function normalizeOptionalDate(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`${fieldName} must be a valid date`, 400);
  }
  return date;
}

function normalizeOptionalUrl(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return "";
  const normalized = toTrimmedString(value, "");
  if (!normalized) return "";
  if (!/^https?:\/\//i.test(normalized)) {
    throw new AppError(`${fieldName} must be a valid http(s) URL`, 400);
  }
  return normalized;
}

function normalizeUrlList(value, fieldName, { max = 6 } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return [];
  if (!Array.isArray(value)) {
    throw new AppError(`${fieldName} must be an array`, 400);
  }

  const normalized = value
    .map((item, index) => normalizeOptionalUrl(item, `${fieldName}[${index}]`))
    .filter(Boolean);

  if (normalized.length > max) {
    throw new AppError(`${fieldName} supports at most ${max} URLs`, 400);
  }

  return normalized;
}

function normalizeOptionalEnum(value, allowedSet, fieldName) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const normalized = toTrimmedString(value).toLowerCase();
  const allowedValues =
    allowedSet instanceof Set
      ? allowedSet
      : new Set(Array.isArray(allowedSet) ? allowedSet : []);
  if (!allowedValues.has(normalized)) {
    throw new AppError(`${fieldName} is invalid`, 400);
  }
  return normalized;
}

function normalizeShippingCollectionTiming(value, fallback = "upfront") {
  const normalized = toTrimmedString(value, "").toLowerCase();
  if (normalized === "with_balance") return "on_delivery";
  return SHIPPING_COLLECTION_TIMINGS.has(normalized) ? normalized : fallback;
}

function normalizeShippingFeeMode(value, fallback = "estimated") {
  const normalized = toTrimmedString(value, "").toLowerCase();
  return SHIPPING_FEE_MODES.has(normalized) ? normalized : fallback;
}

function normalizeRefundResponsibility(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = toTrimmedString(value).toLowerCase();
  if (!REFUND_RESPONSIBILITIES.has(normalized)) {
    throw new AppError("refund responsibility is invalid", 400);
  }
  return normalized;
}

function normalizeRefundAction(value) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = toTrimmedString(value).toLowerCase();
  return REFUND_ACTION_VALUES.has(normalized) ? normalized : null;
}

function buildRefundBreakdown({
  itemAmount = 0,
  shippingFeeAmount = 0,
  returnShippingFeeAmount = 0,
} = {}) {
  const normalizedItemAmount = Number(itemAmount || 0);
  const normalizedShippingFeeAmount = Number(shippingFeeAmount || 0);
  const normalizedReturnShippingFeeAmount = Number(returnShippingFeeAmount || 0);
  const total =
    normalizedItemAmount +
    normalizedShippingFeeAmount +
    normalizedReturnShippingFeeAmount;

  return {
    itemAmount: normalizedItemAmount,
    shippingFeeAmount: normalizedShippingFeeAmount,
    returnShippingFeeAmount: normalizedReturnShippingFeeAmount,
    total,
  };
}

function normalizeRefundBreakdownInput(value, fieldName) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(`${fieldName} must be an object`, 400);
  }

  const itemAmount = normalizeNonNegativeNumber(
    value.itemAmount ?? value.item_amount ?? 0,
    `${fieldName}.itemAmount`,
  );
  const shippingFeeAmount = normalizeNonNegativeNumber(
    value.shippingFeeAmount ?? value.shipping_fee_amount ?? 0,
    `${fieldName}.shippingFeeAmount`,
  );
  const returnShippingFeeAmount = normalizeNonNegativeNumber(
    value.returnShippingFeeAmount ?? value.return_shipping_fee_amount ?? 0,
    `${fieldName}.returnShippingFeeAmount`,
  );

  return buildRefundBreakdown({
    itemAmount,
    shippingFeeAmount,
    returnShippingFeeAmount,
  });
}

function readRefundBreakdown(value) {
  if (!value || typeof value !== "object") {
    return buildRefundBreakdown();
  }

  return buildRefundBreakdown({
    itemAmount: Number(value.itemAmount || 0),
    shippingFeeAmount: Number(value.shippingFeeAmount || 0),
    returnShippingFeeAmount: Number(value.returnShippingFeeAmount || 0),
  });
}

function splitPaidAmountIntoRefundBreakdown(order, amount, includeShippingFee = false) {
  const normalizedAmount = normalizeNonNegativeNumber(amount, "refund amount");
  const shippingFeeAmount = includeShippingFee
    ? Math.min(getRefundShippingFeeLimit(order), normalizedAmount)
    : 0;

  return buildRefundBreakdown({
    itemAmount: Math.max(0, normalizedAmount - shippingFeeAmount),
    shippingFeeAmount,
    returnShippingFeeAmount: 0,
  });
}

function resolveRequestedRefundBreakdown(order, payload = {}, defaultAmount = 0) {
  const explicit = normalizeRefundBreakdownInput(
    payload.requestedBreakdown || payload.requested_breakdown,
    "requestedBreakdown",
  );
  if (explicit) {
    return explicit;
  }

  const requestedItemAmount =
    payload.amountRequested !== undefined || payload.amount_requested !== undefined
      ? normalizeNonNegativeNumber(
          payload.amountRequested ?? payload.amount_requested,
          "amountRequested",
        )
      : Math.max(0, Number(defaultAmount || 0));
  const includeShippingFee =
    normalizeOptionalBoolean(payload.requestShippingFee, "requestShippingFee") ??
    normalizeOptionalBoolean(payload.request_shipping_fee, "request_shipping_fee") ??
    false;
  const customerPaidReturnShippingFee =
    payload.customerPaidReturnShippingFee !== undefined ||
    payload.customer_paid_return_shipping_fee !== undefined
      ? normalizeNonNegativeNumber(
          payload.customerPaidReturnShippingFee ??
            payload.customer_paid_return_shipping_fee,
          "customerPaidReturnShippingFee",
        )
      : 0;
  const shippingFeeAmount = includeShippingFee
    ? getRefundShippingFeeLimit(order)
    : 0;

  return buildRefundBreakdown({
    itemAmount: requestedItemAmount,
    shippingFeeAmount,
    returnShippingFeeAmount: customerPaidReturnShippingFee,
  });
}

function resolveApprovedRefundBreakdown(order, payload = {}) {
  const explicit = normalizeRefundBreakdownInput(
    payload.approvedBreakdown || payload.approved_breakdown,
    "approvedBreakdown",
  );
  if (explicit) {
    return explicit;
  }

  const requestedBreakdown = readRefundBreakdown(order?.refund?.requestedBreakdown);
  if (requestedBreakdown.total > 0) {
    return requestedBreakdown;
  }

  return splitPaidAmountIntoRefundBreakdown(
    order,
    Number(order?.refund?.amount || 0),
    false,
  );
}

function assertRefundBreakdownEligibility(responsibility, breakdown) {
  if (!breakdown) return;
  if (
    Number(breakdown.shippingFeeAmount || 0) > 0 &&
    !["system", "carrier", "mixed"].includes(
      normalizeRefundResponsibility(responsibility) || "customer",
    )
  ) {
    throw new AppError(
      "shipping fee refund is only allowed when responsibility is system, carrier, or mixed",
      400,
    );
  }
}

function getRefundPaidAmountLimit(order) {
  return Math.max(0, Number(order?.paidAmount || 0));
}

function getRefundShippingFeeLimit(order) {
  const shippingCollectionTiming = normalizeShippingCollectionTiming(
    order?.shippingCollectionTiming,
    "upfront",
  );
  if (shippingCollectionTiming !== "upfront") {
    return 0;
  }
  return Math.min(
    Math.max(0, Number(order?.shippingFee || 0)),
    getRefundPaidAmountLimit(order),
  );
}

function getRefundPaidComponentTotal(breakdown) {
  if (!breakdown || typeof breakdown !== "object") return 0;
  return (
    Math.max(0, Number(breakdown.itemAmount || 0)) +
    Math.max(0, Number(breakdown.shippingFeeAmount || 0))
  );
}

function assertRefundBreakdownAmountBounds(order, breakdown, fieldName) {
  if (!breakdown) return;

  const itemAmount = normalizeNonNegativeNumber(
    breakdown.itemAmount ?? 0,
    `${fieldName}.itemAmount`,
  );
  const shippingFeeAmount = normalizeNonNegativeNumber(
    breakdown.shippingFeeAmount ?? 0,
    `${fieldName}.shippingFeeAmount`,
  );
  const returnShippingFeeAmount = normalizeNonNegativeNumber(
    breakdown.returnShippingFeeAmount ?? 0,
    `${fieldName}.returnShippingFeeAmount`,
  );
  const paidComponentTotal = itemAmount + shippingFeeAmount;
  const paidAmountLimit = getRefundPaidAmountLimit(order);
  const shippingFeeLimit = getRefundShippingFeeLimit(order);

  if (paidComponentTotal <= 0 && returnShippingFeeAmount <= 0) {
    throw new AppError(`${fieldName}.total must be greater than 0`, 400);
  }

  if (shippingFeeAmount > shippingFeeLimit) {
    throw new AppError(
      `${fieldName}.shippingFeeAmount exceeds refundable shipping fee`,
      400,
    );
  }

  if (paidComponentTotal > paidAmountLimit) {
    throw new AppError(
      `${fieldName} exceeds refundable paid amount`,
      400,
    );
  }
}

function assertRefundBreakdownNotAboveRequested(
  requestedBreakdown,
  nextBreakdown,
  fieldName,
) {
  if (!nextBreakdown) return;

  const requested = readRefundBreakdown(requestedBreakdown);
  if (requested.total <= 0) return;

  if (Number(nextBreakdown.itemAmount || 0) > Number(requested.itemAmount || 0)) {
    throw new AppError(
      `${fieldName}.itemAmount exceeds requested amount`,
      400,
    );
  }

  if (
    Number(nextBreakdown.shippingFeeAmount || 0) >
    Number(requested.shippingFeeAmount || 0)
  ) {
    throw new AppError(
      `${fieldName}.shippingFeeAmount exceeds requested amount`,
      400,
    );
  }

  if (
    Number(nextBreakdown.returnShippingFeeAmount || 0) >
    Number(requested.returnShippingFeeAmount || 0)
  ) {
    throw new AppError(
      `${fieldName}.returnShippingFeeAmount exceeds requested amount`,
      400,
    );
  }
}

function shouldMarkOrderAsFullyRefunded(order, refund) {
  const paidAmountLimit = getRefundPaidAmountLimit(order);
  if (paidAmountLimit <= 0) return false;

  const approvedBreakdown = readRefundBreakdown(refund?.approvedBreakdown);
  const requestedBreakdown = readRefundBreakdown(refund?.requestedBreakdown);
  const approvedPaidComponent = getRefundPaidComponentTotal(approvedBreakdown);
  const paidComponentTotal =
    approvedPaidComponent > 0
      ? approvedPaidComponent
      : getRefundPaidComponentTotal(requestedBreakdown);

  return paidComponentTotal >= paidAmountLimit;
}

async function getRefundWorkflowSettings() {
  const config = await getEffectiveSystemConfig();
  const refunds = config?.refunds || {};

  const staffApprovalLimit = Number(refunds.staffApprovalLimit);
  return {
    staffApprovalLimit: Number.isFinite(staffApprovalLimit)
      ? Math.max(0, staffApprovalLimit)
      : DEFAULT_REFUND_WORKFLOW_SETTINGS.staffApprovalLimit,
    requiresManagerForReturn:
      typeof refunds.requiresManagerForReturn === "boolean"
        ? refunds.requiresManagerForReturn
        : DEFAULT_REFUND_WORKFLOW_SETTINGS.requiresManagerForReturn,
    requiresManagerForShippingRefund:
      typeof refunds.requiresManagerForShippingRefund === "boolean"
        ? refunds.requiresManagerForShippingRefund
        : DEFAULT_REFUND_WORKFLOW_SETTINGS.requiresManagerForShippingRefund,
    requirePayoutProof:
      typeof refunds.requirePayoutProof === "boolean"
        ? refunds.requirePayoutProof
        : DEFAULT_REFUND_WORKFLOW_SETTINGS.requirePayoutProof,
  };
}

function getRefundManagerApprovalReasons(
  order,
  refund,
  settings = DEFAULT_REFUND_WORKFLOW_SETTINGS,
) {
  const reasons = [];
  const targetBreakdown = readRefundBreakdown(
    refund?.approvedBreakdown?.total ? refund.approvedBreakdown : refund?.requestedBreakdown,
  );
  const paidComponentTotal = getRefundPaidComponentTotal(targetBreakdown);

  if (
    Number(settings.staffApprovalLimit || 0) > 0 &&
    paidComponentTotal > Number(settings.staffApprovalLimit || 0)
  ) {
    reasons.push(
      `approved amount exceeds staff approval limit (${Number(
        settings.staffApprovalLimit || 0,
      )})`,
    );
  }

  if (settings.requiresManagerForReturn && Boolean(refund?.requiresReturn)) {
    reasons.push("return-required refunds must be approved by manager");
  }

  if (
    settings.requiresManagerForShippingRefund &&
    Number(targetBreakdown.shippingFeeAmount || 0) > 0
  ) {
    reasons.push("shipping fee refunds must be approved by manager");
  }

  return reasons;
}

function getRefundActorRole(currentUser, { isOwner = false } = {}) {
  if (isOwner) return "customer";
  if (isManager(currentUser)) return "manager";
  if (isOperation(currentUser)) return "operations";
  if (isStaffRole(currentUser)) return "sales";
  const role = getRole(currentUser);
  return role || "system";
}

function getRefundRoutingState(nextStatus, order) {
  switch (nextStatus) {
    case "requested":
    case "reviewing":
      return {
        currentOwnerRole: "sales",
        currentOwnerUserId: null,
        nextActionCode: REFUND_ACTIONS.START_REVIEW,
      };
    case "waiting_customer_info":
      return {
        currentOwnerRole: "customer",
        currentOwnerUserId: order?.userId || null,
        nextActionCode: REFUND_ACTIONS.CUSTOMER_SUBMIT_INFO,
      };
    case "escalated_to_manager":
      return {
        currentOwnerRole: "manager",
        currentOwnerUserId: null,
        nextActionCode: REFUND_ACTIONS.MANAGER_APPROVE,
      };
    case "approved":
      return {
        currentOwnerRole: "sales",
        currentOwnerUserId: null,
        nextActionCode: Boolean(order?.refund?.requiresReturn)
          ? REFUND_ACTIONS.MARK_RETURN_PENDING
          : REFUND_ACTIONS.START_PROCESSING,
      };
    case "return_pending":
      return {
        currentOwnerRole: "operations",
        currentOwnerUserId: null,
        nextActionCode: REFUND_ACTIONS.CONFIRM_RETURN_RECEIVED,
      };
    case "return_received":
      return {
        currentOwnerRole: "sales",
        currentOwnerUserId: null,
        nextActionCode: REFUND_ACTIONS.START_PROCESSING,
      };
    case "processing":
      return {
        currentOwnerRole: "sales",
        currentOwnerUserId: null,
        nextActionCode: REFUND_ACTIONS.COMPLETE,
      };
    default:
      return {
        currentOwnerRole: "none",
        currentOwnerUserId: null,
        nextActionCode: "",
      };
  }
}

function applyRefundRoutingState(order, nextStatus) {
  if (!order.refund || typeof order.refund !== "object") {
    order.refund = {};
  }

  const routing = getRefundRoutingState(nextStatus, order);
  order.refund.currentOwnerRole = routing.currentOwnerRole;
  order.refund.currentOwnerUserId = routing.currentOwnerUserId;
  order.refund.nextActionCode = routing.nextActionCode;
}

function buildRefundHistoryEntry({
  action,
  fromStatus,
  toStatus,
  currentUser,
  note = "",
  meta = null,
  isOwner = false,
}) {
  return {
    action: toTrimmedString(action, ""),
    fromStatus: toTrimmedString(fromStatus, "none"),
    toStatus: toTrimmedString(toStatus, "none"),
    actorUserId: getUserId(currentUser) || null,
    actorRole: getRefundActorRole(currentUser, { isOwner }),
    actorName: toDisplayName(currentUser, isOwner ? "Customer" : "System"),
    note: toTrimmedString(note, ""),
    meta: meta && typeof meta === "object" ? meta : null,
    createdAt: new Date(),
  };
}

function appendRefundHistory(order, entry) {
  if (!order.refund || typeof order.refund !== "object") {
    order.refund = {};
  }

  const history = Array.isArray(order.refund.history) ? [...order.refund.history] : [];
  history.push(entry);
  order.refund.history = history;
  order.markModified("refund.history");
}

function ensureOpsExecution(order) {
  if (!order.opsExecution || typeof order.opsExecution !== "object") {
    order.opsExecution = {};
  }

  if (!order.opsExecution.checklist || typeof order.opsExecution.checklist !== "object") {
    order.opsExecution.checklist = {};
  }

  if (!order.opsExecution.itemStates || typeof order.opsExecution.itemStates !== "object") {
    order.opsExecution.itemStates = {};
  }

  return order.opsExecution;
}

function touchOpsExecution(order) {
  const opsExecution = ensureOpsExecution(order);
  opsExecution.lastUpdatedAt = new Date();
  return opsExecution;
}

function getPlainItemStates(order) {
  const current = ensureOpsExecution(order).itemStates;
  if (current instanceof Map) {
    return Object.fromEntries(current.entries());
  }
  if (current && typeof current.toObject === "function") {
    return current.toObject();
  }
  return current && typeof current === "object" ? { ...current } : {};
}

function normalizeChecklistPatch(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("checklist must be an object", 400);
  }

  const patch = {};
  for (const key of READY_STOCK_CHECKLIST_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      patch[key] = normalizeOptionalBoolean(value[key], `checklist.${key}`);
    }
  }
  return patch;
}

function normalizeItemStatesPatch(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("itemStates must be an object", 400);
  }

  const patch = {};
  for (const [rawKey, rawState] of Object.entries(value)) {
    const key = toTrimmedString(rawKey);
    if (!key) continue;
    if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) {
      throw new AppError(`itemStates.${key} must be an object`, 400);
    }

    const nextState = {};
    if (Object.prototype.hasOwnProperty.call(rawState, "picked")) {
      nextState.picked = normalizeOptionalBoolean(
        rawState.picked,
        `itemStates.${key}.picked`,
      );
    }
    if (Object.prototype.hasOwnProperty.call(rawState, "warehouseLocation")) {
      nextState.warehouseLocation = toTrimmedString(rawState.warehouseLocation);
    }
    if (Object.prototype.hasOwnProperty.call(rawState, "issueType")) {
      nextState.issueType = normalizeOptionalEnum(
        rawState.issueType,
        READY_STOCK_ISSUE_TYPES,
        `itemStates.${key}.issueType`,
      );
    }
    if (Object.prototype.hasOwnProperty.call(rawState, "issueNote")) {
      nextState.issueNote = toTrimmedString(rawState.issueNote);
    }
    if (Object.prototype.hasOwnProperty.call(rawState, "internalNote")) {
      nextState.internalNote = toTrimmedString(rawState.internalNote);
    }
    patch[key] = nextState;
  }

  return patch;
}

function normalizeOpsExecutionPatch(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AppError("Invalid ops execution payload", 400);
  }

  const patch = {};

  if (Object.prototype.hasOwnProperty.call(payload, "assignee")) {
    patch.assignee = toTrimmedString(payload.assignee);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "salesApprovedAt")) {
    patch.salesApprovedAt = normalizeOptionalDate(
      payload.salesApprovedAt,
      "salesApprovedAt",
    );
  }
  if (Object.prototype.hasOwnProperty.call(payload, "salesApprovedBy")) {
    patch.salesApprovedBy = toTrimmedString(payload.salesApprovedBy);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "salesHandoffNote")) {
    patch.salesHandoffNote = toTrimmedString(payload.salesHandoffNote);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "approvalState")) {
    patch.approvalState = normalizeOptionalEnum(
      payload.approvalState,
      ["none", "manager_review_requested", "sent_back_to_sale"],
      "approvalState",
    );
  }
  if (Object.prototype.hasOwnProperty.call(payload, "managerReviewRequestedAt")) {
    patch.managerReviewRequestedAt = normalizeOptionalDate(
      payload.managerReviewRequestedAt,
      "managerReviewRequestedAt",
    );
  }
  if (Object.prototype.hasOwnProperty.call(payload, "managerReviewRequestedBy")) {
    patch.managerReviewRequestedBy = toTrimmedString(payload.managerReviewRequestedBy);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "managerReviewReason")) {
    patch.managerReviewReason = toTrimmedString(payload.managerReviewReason);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "prescriptionFollowUpStatus")) {
    patch.prescriptionFollowUpStatus = normalizeOptionalEnum(
      payload.prescriptionFollowUpStatus,
      PRESCRIPTION_FOLLOW_UP_STATUSES,
      "prescriptionFollowUpStatus",
    );
  }
  if (Object.prototype.hasOwnProperty.call(payload, "prescriptionFollowUpNote")) {
    patch.prescriptionFollowUpNote = toTrimmedString(
      payload.prescriptionFollowUpNote,
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, "prescriptionFollowUpUpdatedAt")
  ) {
    patch.prescriptionFollowUpUpdatedAt = normalizeOptionalDate(
      payload.prescriptionFollowUpUpdatedAt,
      "prescriptionFollowUpUpdatedAt",
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, "prescriptionFollowUpUpdatedBy")
  ) {
    patch.prescriptionFollowUpUpdatedBy = toTrimmedString(
      payload.prescriptionFollowUpUpdatedBy,
    );
  }
  if (Object.prototype.hasOwnProperty.call(payload, "internalNote")) {
    patch.internalNote = toTrimmedString(payload.internalNote);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "holdReason")) {
    patch.holdReason = normalizeOptionalEnum(
      payload.holdReason,
      READY_STOCK_HOLD_REASONS,
      "holdReason",
    );
  }
  if (Object.prototype.hasOwnProperty.call(payload, "holdNote")) {
    patch.holdNote = toTrimmedString(payload.holdNote);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "paymentFailed")) {
    patch.paymentFailed = normalizeOptionalBoolean(
      payload.paymentFailed,
      "paymentFailed",
    );
  }
  if (Object.prototype.hasOwnProperty.call(payload, "carrierId")) {
    patch.carrierId = toTrimmedString(payload.carrierId).toLowerCase();
  }
  if (Object.prototype.hasOwnProperty.call(payload, "trackingCode")) {
    patch.trackingCode = toTrimmedString(payload.trackingCode);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "issueType")) {
    patch.issueType = normalizeOptionalEnum(
      payload.issueType,
      READY_STOCK_ISSUE_TYPES,
      "issueType",
    );
  }
  if (Object.prototype.hasOwnProperty.call(payload, "issueNote")) {
    patch.issueNote = toTrimmedString(payload.issueNote);
  }

  const checklist = normalizeChecklistPatch(payload.checklist);
  if (checklist !== undefined) patch.checklist = checklist;

  const itemStates = normalizeItemStatesPatch(payload.itemStates);
  if (itemStates !== undefined) patch.itemStates = itemStates;

  return patch;
}

function applyOpsExecutionPatch(order, patch) {
  const opsExecution = touchOpsExecution(order);

  if (patch.assignee !== undefined) opsExecution.assignee = patch.assignee;
  if (patch.salesApprovedAt !== undefined) {
    opsExecution.salesApprovedAt = patch.salesApprovedAt;
  }
  if (patch.salesApprovedBy !== undefined) {
    opsExecution.salesApprovedBy = patch.salesApprovedBy;
  }
  if (patch.salesHandoffNote !== undefined) {
    opsExecution.salesHandoffNote = patch.salesHandoffNote;
  }
  if (patch.approvalState !== undefined) {
    opsExecution.approvalState = patch.approvalState;
  }
  if (patch.managerReviewRequestedAt !== undefined) {
    opsExecution.managerReviewRequestedAt = patch.managerReviewRequestedAt;
  }
  if (patch.managerReviewRequestedBy !== undefined) {
    opsExecution.managerReviewRequestedBy = patch.managerReviewRequestedBy;
  }
  if (patch.managerReviewReason !== undefined) {
    opsExecution.managerReviewReason = patch.managerReviewReason;
  }
  if (patch.prescriptionFollowUpStatus !== undefined) {
    opsExecution.prescriptionFollowUpStatus = patch.prescriptionFollowUpStatus;
  }
  if (patch.prescriptionFollowUpNote !== undefined) {
    opsExecution.prescriptionFollowUpNote = patch.prescriptionFollowUpNote;
  }
  if (patch.prescriptionFollowUpUpdatedAt !== undefined) {
    opsExecution.prescriptionFollowUpUpdatedAt =
      patch.prescriptionFollowUpUpdatedAt;
  }
  if (patch.prescriptionFollowUpUpdatedBy !== undefined) {
    opsExecution.prescriptionFollowUpUpdatedBy =
      patch.prescriptionFollowUpUpdatedBy;
  }
  if (patch.internalNote !== undefined) {
    opsExecution.internalNote = patch.internalNote;
  }
  if (patch.holdReason !== undefined) opsExecution.holdReason = patch.holdReason;
  if (patch.holdNote !== undefined) opsExecution.holdNote = patch.holdNote;
  if (patch.paymentFailed !== undefined) {
    opsExecution.paymentFailed = patch.paymentFailed;
  }
  if (patch.carrierId !== undefined) opsExecution.carrierId = patch.carrierId;
  if (patch.trackingCode !== undefined) {
    opsExecution.trackingCode = patch.trackingCode;
  }
  if (patch.issueType !== undefined) opsExecution.issueType = patch.issueType;
  if (patch.issueNote !== undefined) opsExecution.issueNote = patch.issueNote;

  if (patch.checklist) {
    opsExecution.checklist = {
      ...(opsExecution.checklist?.toObject
        ? opsExecution.checklist.toObject()
        : opsExecution.checklist || {}),
      ...patch.checklist,
    };
    order.markModified("opsExecution.checklist");
  }

  if (patch.itemStates) {
    const currentItemStates = getPlainItemStates(order);
    const nextItemStates =
      opsExecution.itemStates &&
      typeof opsExecution.itemStates.set === "function" &&
      typeof opsExecution.itemStates.get === "function"
        ? opsExecution.itemStates
        : new Map(Object.entries(currentItemStates));

    for (const [itemKey, itemPatch] of Object.entries(patch.itemStates)) {
      const currentValue =
        typeof nextItemStates.get === "function"
          ? nextItemStates.get(itemKey)
          : currentItemStates[itemKey];
      const plainCurrentValue =
        currentValue && typeof currentValue.toObject === "function"
          ? currentValue.toObject()
          : currentValue && typeof currentValue === "object"
            ? { ...currentValue }
            : {};

      nextItemStates.set(itemKey, {
        ...plainCurrentValue,
        ...itemPatch,
      });
    }

    opsExecution.itemStates = nextItemStates;
    order.markModified("opsExecution.itemStates");
  }

  return opsExecution;
}

function syncOpsExecutionForStage(order, currentUser, nextStage) {
  const normalizedStage = normalizeOpsStage(nextStage, "");
  const opsExecution = touchOpsExecution(order);

  if (!opsExecution.salesApprovedAt && order.confirmedAt) {
    opsExecution.salesApprovedAt = order.confirmedAt;
  }
  if (!opsExecution.salesApprovedBy && order.confirmedBy) {
    opsExecution.salesApprovedBy = toDisplayName(currentUser, "Sales/Support");
  }

  if (
    [
      ORDER_OPS_STAGE.PICKING,
      ORDER_OPS_STAGE.PACKING,
      ORDER_OPS_STAGE.READY_TO_SHIP,
      ORDER_OPS_STAGE.SHIPMENT_CREATED,
      ORDER_OPS_STAGE.HANDOVER_TO_CARRIER,
      ORDER_OPS_STAGE.IN_TRANSIT,
    ].includes(normalizedStage) &&
    !toTrimmedString(opsExecution.assignee)
  ) {
    opsExecution.assignee = toDisplayName(currentUser);
  }

  if (
    [
      ORDER_OPS_STAGE.PENDING_OPERATIONS,
      ORDER_OPS_STAGE.WAITING_CUSTOMER_INFO,
    ].includes(normalizedStage)
  ) {
    opsExecution.assignee = "";
  }

  if (toTrimmedString(order?.shipment?.provider)) {
    opsExecution.carrierId = toTrimmedString(order.shipment.provider).toLowerCase();
  }
  if (toTrimmedString(order?.shipment?.orderCode || order?.shipment?.trackingCode)) {
    opsExecution.trackingCode = toTrimmedString(
      order.shipment.orderCode || order.shipment.trackingCode,
    );
  }
}

function normalizePositiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return number;
}

function normalizeOptionalPositiveInteger(value, fallback = null) {
  const number = Number(value);
  if (Number.isInteger(number) && number > 0) {
    return number;
  }
  return fallback;
}

function sanitizeShippingAddress(address = {}) {
  if (!address || typeof address !== "object") return null;

  const fields = [
    "fullName",
    "phone",
    "email",
    "line1",
    "line2",
    "ward",
    "district",
    "province",
    "country",
    "note",
  ];

  const payload = {};
  for (const field of fields) {
    if (address[field] === undefined || address[field] === null) continue;
    payload[field] = toTrimmedString(address[field]);
  }

  const provinceId = address.provinceId ?? address.province_id;
  if (provinceId !== undefined && provinceId !== null && provinceId !== "") {
    payload.provinceId = normalizePositiveInteger(
      provinceId,
      "shippingAddress.provinceId",
    );
  }

  const districtId = address.districtId ?? address.district_id;
  if (districtId !== undefined && districtId !== null && districtId !== "") {
    payload.districtId = normalizePositiveInteger(
      districtId,
      "shippingAddress.districtId",
    );
  }

  const wardCode = address.wardCode ?? address.ward_code;
  if (wardCode !== undefined && wardCode !== null) {
    payload.wardCode = toTrimmedString(wardCode);
  }

  if (!payload.country) payload.country = "VN";
  return payload;
}

function pickDefaultAddressFromUser(user) {
  const addresses = Array.isArray(user?.addresses) ? user.addresses : [];
  if (addresses.length === 0) return null;

  const defaultAddress =
    addresses.find((addr) => addr && addr.isDefault) || addresses[0];
  if (!defaultAddress) return null;
  return sanitizeShippingAddress(defaultAddress);
}

function ensureShippingAddress(shippingAddress) {
  const normalized = sanitizeShippingAddress(shippingAddress);
  if (!normalized) {
    throw new AppError("shippingAddress is required", 400);
  }

  const requiredFields = ["fullName", "phone", "line1", "district", "province"];
  for (const field of requiredFields) {
    if (!normalized[field]) {
      throw new AppError(`shippingAddress.${field} is required`, 400);
    }
  }

  return normalized;
}

function assertOrderStatusPermission(currentUser, nextStatus) {
  if (nextStatus === ORDER_STATUS.CANCELLED) {
    throw new AppError("Use cancel endpoint to cancel orders", 400);
  }

  if (isManager(currentUser)) {
    if (nextStatus === ORDER_STATUS.CONFIRMED) {
      return;
    }
    throw new AppError("Manager can only confirm escalated orders", 403);
  }

  if (isStaffRole(currentUser)) {
    if (nextStatus === ORDER_STATUS.CONFIRMED) {
      return;
    }
    throw new AppError("Staff can only confirm intake-ready orders", 403);
  }

  if (isOperation(currentUser)) {
    if (
      [
        ORDER_STATUS.PROCESSING,
        ORDER_STATUS.SHIPPED,
        ORDER_STATUS.DELIVERED,
        ORDER_STATUS.RETURNED,
      ].includes(nextStatus)
    ) {
      return;
    }
    throw new AppError("Operation can only update fulfillment statuses", 403);
  }

  throw new AppError("Forbidden", 403);
}

function assertOrderCanBeConfirmed(order, currentUser) {
  if (!order) {
    throw new AppError("Order not found", 404);
  }

  const normalizedPaymentStatus = String(order.paymentStatus || "")
    .trim()
    .toLowerCase();
  const normalizedApprovalState = String(order?.opsExecution?.approvalState || "")
    .trim()
    .toLowerCase();

  if (isManager(currentUser)) {
    if (
      normalizedPaymentStatus === PAYMENT_STATUS.FAILED ||
      normalizedPaymentStatus === PAYMENT_STATUS.REFUNDED
    ) {
      throw new AppError("Failed or refunded orders cannot be confirmed", 400);
    }

    if (normalizedApprovalState !== "manager_review_requested") {
      throw new AppError("Manager can only confirm escalated orders", 403);
    }

    if (
      normalizedPaymentStatus !== PAYMENT_STATUS.PAID &&
      normalizeCheckoutPaymentMethod(order.paymentMethod, "") !==
        PAYMENT_METHODS.COD
    ) {
      throw new AppError(
        "Manager can only confirm fully paid or COD escalated orders",
        400,
      );
    }

    return;
  }

  if (normalizedApprovalState === "manager_review_requested") {
    throw new AppError("This order is waiting for manager review", 403);
  }

  if (normalizedPaymentStatus !== PAYMENT_STATUS.PAID) {
    throw new AppError("Only fully paid orders can be confirmed", 400);
  }
}

function publishOpsStageChange(order, previousOpsStage, currentUser) {
  const nextOpsStage = normalizeOpsStage(order?.opsStage);
  if (nextOpsStage === normalizeOpsStage(previousOpsStage)) {
    return;
  }

  publishStatusChange({
    domain: "order",
    entityId: order._id,
    statusField: "opsStage",
    previousStatus: normalizeOpsStage(previousOpsStage),
    nextStatus: nextOpsStage,
    currentUser,
    recipientUserIds: [order.userId],
    meta: {
      paymentCode: order.paymentCode,
      orderType: order.orderType,
      orderStatus: order.status,
    },
  });
}

function assertRefundActionPermission(currentUser, action, options = {}) {
  if (options.isOwner && action === REFUND_ACTIONS.CUSTOMER_SUBMIT_INFO) {
    return;
  }

  const staffActions = new Set([
    REFUND_ACTIONS.START_REVIEW,
    REFUND_ACTIONS.REQUEST_CUSTOMER_INFO,
    REFUND_ACTIONS.APPROVE,
    REFUND_ACTIONS.REJECT,
    REFUND_ACTIONS.ESCALATE,
    REFUND_ACTIONS.MARK_RETURN_PENDING,
    REFUND_ACTIONS.START_PROCESSING,
    REFUND_ACTIONS.COMPLETE,
  ]);
  const managerActions = new Set([
    REFUND_ACTIONS.MANAGER_APPROVE,
    REFUND_ACTIONS.MANAGER_REJECT,
    REFUND_ACTIONS.SEND_BACK_TO_STAFF,
    REFUND_ACTIONS.MARK_RETURN_PENDING,
  ]);
  const operationActions = new Set([
    REFUND_ACTIONS.CONFIRM_RETURN_RECEIVED,
    REFUND_ACTIONS.INSPECTION_FAILED,
  ]);

  if (isStaffRole(currentUser) && staffActions.has(action)) {
    return;
  }

  if (isManager(currentUser) && managerActions.has(action)) {
    return;
  }

  if (isOperation(currentUser) && operationActions.has(action)) {
    return;
  }

  throw new AppError("Forbidden", 403);
}

function getRefundActionTargetStatus(action) {
  switch (action) {
    case REFUND_ACTIONS.START_REVIEW:
    case REFUND_ACTIONS.CUSTOMER_SUBMIT_INFO:
    case REFUND_ACTIONS.SEND_BACK_TO_STAFF:
      return "reviewing";
    case REFUND_ACTIONS.REQUEST_CUSTOMER_INFO:
      return "waiting_customer_info";
    case REFUND_ACTIONS.APPROVE:
    case REFUND_ACTIONS.MANAGER_APPROVE:
      return "approved";
    case REFUND_ACTIONS.REJECT:
    case REFUND_ACTIONS.MANAGER_REJECT:
      return "rejected";
    case REFUND_ACTIONS.ESCALATE:
      return "escalated_to_manager";
    case REFUND_ACTIONS.MARK_RETURN_PENDING:
      return "return_pending";
    case REFUND_ACTIONS.CONFIRM_RETURN_RECEIVED:
      return "return_received";
    case REFUND_ACTIONS.INSPECTION_FAILED:
      return "reviewing";
    case REFUND_ACTIONS.START_PROCESSING:
      return "processing";
    case REFUND_ACTIONS.COMPLETE:
      return "completed";
    default:
      return null;
  }
}

function assertRefundActionTransition(currentStatus, action, requiresReturn) {
  const transitionMatrix = {
    [REFUND_ACTIONS.START_REVIEW]: ["requested", "waiting_customer_info"],
    [REFUND_ACTIONS.CUSTOMER_SUBMIT_INFO]: ["waiting_customer_info"],
    [REFUND_ACTIONS.REQUEST_CUSTOMER_INFO]: [
      "requested",
      "reviewing",
      "approved",
      "return_received",
      "processing",
    ],
    [REFUND_ACTIONS.APPROVE]: ["requested", "reviewing"],
    [REFUND_ACTIONS.REJECT]: ["requested", "reviewing", "waiting_customer_info"],
    [REFUND_ACTIONS.ESCALATE]: ["requested", "reviewing"],
    [REFUND_ACTIONS.MANAGER_APPROVE]: ["escalated_to_manager"],
    [REFUND_ACTIONS.MANAGER_REJECT]: ["escalated_to_manager"],
    [REFUND_ACTIONS.SEND_BACK_TO_STAFF]: ["escalated_to_manager"],
    [REFUND_ACTIONS.MARK_RETURN_PENDING]: ["approved"],
    [REFUND_ACTIONS.CONFIRM_RETURN_RECEIVED]: ["return_pending"],
    [REFUND_ACTIONS.INSPECTION_FAILED]: ["return_pending", "return_received"],
    [REFUND_ACTIONS.START_PROCESSING]: ["approved", "return_received"],
    [REFUND_ACTIONS.COMPLETE]: ["processing"],
  };

  const allowedCurrentStatuses = transitionMatrix[action] || [];
  if (!allowedCurrentStatuses.includes(currentStatus)) {
    throw new AppError(
      `Refund action "${action}" is not allowed from status "${currentStatus}"`,
      400,
    );
  }

  if (
    action === REFUND_ACTIONS.START_PROCESSING &&
    requiresReturn &&
    currentStatus !== "return_received"
  ) {
    throw new AppError(
      "Refund that requires return must be marked return_received before processing",
      400,
    );
  }
}

function mapLegacyRefundStatusToAction(currentUser, nextStatus) {
  switch (nextStatus) {
    case "reviewing":
      return REFUND_ACTIONS.START_REVIEW;
    case "waiting_customer_info":
      return REFUND_ACTIONS.REQUEST_CUSTOMER_INFO;
    case "approved":
      return isManager(currentUser)
        ? REFUND_ACTIONS.MANAGER_APPROVE
        : REFUND_ACTIONS.APPROVE;
    case "escalated_to_manager":
      return REFUND_ACTIONS.ESCALATE;
    case "return_pending":
      return REFUND_ACTIONS.MARK_RETURN_PENDING;
    case "return_received":
      return REFUND_ACTIONS.CONFIRM_RETURN_RECEIVED;
    case "processing":
      return REFUND_ACTIONS.START_PROCESSING;
    case "completed":
      return REFUND_ACTIONS.COMPLETE;
    case "rejected":
      return isManager(currentUser)
        ? REFUND_ACTIONS.MANAGER_REJECT
        : REFUND_ACTIONS.REJECT;
    default:
      return null;
  }
}

function shouldRefreshRequestedRefundBreakdown(payload = {}) {
  return (
    payload.requestedBreakdown !== undefined ||
    payload.requested_breakdown !== undefined ||
    payload.amountRequested !== undefined ||
    payload.amount_requested !== undefined ||
    payload.requestShippingFee !== undefined ||
    payload.request_shipping_fee !== undefined ||
    payload.customerPaidReturnShippingFee !== undefined ||
    payload.customer_paid_return_shipping_fee !== undefined
  );
}

function resolveCustomerRequestedRefundBreakdown(order, payload = {}) {
  const currentRequestedBreakdown = readRefundBreakdown(
    order?.refund?.requestedBreakdown,
  );
  if (!shouldRefreshRequestedRefundBreakdown(payload)) {
    return currentRequestedBreakdown;
  }

  return resolveRequestedRefundBreakdown(
    order,
    payload,
    currentRequestedBreakdown.itemAmount ||
      Math.max(0, Number(order?.refund?.amount || 0)),
  );
}

function pickVariant(product, variantId) {
  if (!variantId) return null;
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const variant = variants.find(
    (item) => String(item._id) === String(variantId),
  );
  if (!variant) {
    throw new AppError(`Variant not found for product ${product._id}`, 404);
  }
  return variant;
}

function pickPrice(product, variant) {
  if (variant && variant.price != null) return Number(variant.price);
  const fallback = product?.pricing?.salePrice ?? product?.pricing?.basePrice;
  if (fallback == null) return null;
  return Number(fallback);
}

function normalizeCheckoutPaymentMethod(
  value,
  fallback = PAYMENT_METHODS.SEPAY,
) {
  const normalized = toTrimmedString(value, fallback).toLowerCase();
  if (
    normalized === PAYMENT_METHODS.SEPAY ||
    normalized === PAYMENT_METHODS.COD
  ) {
    return normalized;
  }
  return fallback;
}

function getRequestedCheckoutPaymentMethodForOrder(
  order = {},
  fallback = PAYMENT_METHODS.SEPAY,
) {
  if (
    normalizeCheckoutPaymentMethod(order?.paymentMethod, "") ===
      PAYMENT_METHODS.SEPAY &&
    normalizeCheckoutPaymentMethod(order?.payLaterMethod, "") ===
      PAYMENT_METHODS.COD
  ) {
    return PAYMENT_METHODS.COD;
  }

  return normalizeCheckoutPaymentMethod(order?.paymentMethod, fallback);
}

function getConfirmationPaidTarget(order = {}) {
  if (
    normalizeCheckoutPaymentMethod(order?.paymentMethod, "") ===
    PAYMENT_METHODS.COD
  ) {
    return 0;
  }

  return Math.max(0, Number(order?.payNowTotal || 0));
}

function getCurrentSepayAmountDue(order = {}) {
  if (
    normalizeCheckoutPaymentMethod(order?.paymentMethod, "") !==
    PAYMENT_METHODS.SEPAY
  ) {
    return 0;
  }

  const paidAmount = Math.max(0, Number(order?.paidAmount || 0));
  const payNowTotal = Math.max(0, Number(order?.payNowTotal || 0));

  if (paidAmount < payNowTotal) {
    return Math.max(0, payNowTotal - paidAmount);
  }

  if (
    normalizeCheckoutPaymentMethod(order?.payLaterMethod, "") ===
    PAYMENT_METHODS.SEPAY
  ) {
    const total = Math.max(payNowTotal, Number(order?.total || 0));
    return Math.max(0, total - paidAmount);
  }

  return 0;
}

function toDateOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isOrderAwaitingInitialSepayPayment(order = {}) {
  if (
    normalizeCheckoutPaymentMethod(order?.paymentMethod, "") !==
    PAYMENT_METHODS.SEPAY
  ) {
    return false;
  }

  const payNowTotal = Math.max(0, Number(order?.payNowTotal || 0));
  const paidAmount = Math.max(0, Number(order?.paidAmount || 0));
  return payNowTotal > 0 && paidAmount < payNowTotal;
}

function resolveOrderPaymentExpiresAt(
  order = {},
  { referenceTime = null, preserveExisting = true, allowCreate = true } = {},
) {
  if (!isOrderAwaitingInitialSepayPayment(order)) {
    return null;
  }

  const existing = toDateOrNull(order?.paymentExpiresAt);
  if (existing && preserveExisting) {
    return existing;
  }

  if (!allowCreate) {
    return existing || null;
  }

  return addMinutes(referenceTime || Date.now(), ORDER_PAYMENT_HOLD_MINUTES);
}

function syncOrderPaymentExpiry(order, options = {}) {
  if (!order || typeof order !== "object") {
    return null;
  }

  const nextPaymentExpiresAt = resolveOrderPaymentExpiresAt(order, options);
  if (nextPaymentExpiresAt) {
    order.paymentExpiresAt = nextPaymentExpiresAt;
    return nextPaymentExpiresAt;
  }

  order.paymentExpiresAt = undefined;
  return null;
}

function isOrderPaymentExpired(order = {}, now = new Date()) {
  if (toTrimmedString(order?.status, "").toLowerCase() !== ORDER_STATUS.PENDING) {
    return false;
  }

  const expiresAt = toDateOrNull(order?.paymentExpiresAt);
  if (!expiresAt) {
    return false;
  }

  const paymentStatus = toTrimmedString(order?.paymentStatus, "").toLowerCase();
  if (![PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PARTIAL].includes(paymentStatus)) {
    return false;
  }

  return (
    isOrderAwaitingInitialSepayPayment(order) &&
    expiresAt.getTime() <= new Date(now || Date.now()).getTime()
  );
}

function hasOutstandingSepayBalance(order = {}) {
  return getCurrentSepayAmountDue(order) > 0;
}

function getOrderTimeoutCustomerContext(order = {}) {
  return {
    id: String(order?.userId || ""),
    role: "customer",
    name: "System",
  };
}

function hasOpenRefund(order = {}) {
  const refundStatus = toTrimmedString(order?.refund?.status, "none").toLowerCase();
  return OPEN_REFUND_STATUSES.has(refundStatus);
}

function upsertLatePaymentRefundRequest(order, currentUser, reason) {
  const normalizedReason = toTrimmedString(
    reason,
    ORDER_CANCELLED_LATE_PAYMENT_REASON,
  );
  const previousRefundStatus = order?.refund?.status || "none";
  const requestedBreakdown = splitPaidAmountIntoRefundBreakdown(
    order,
    Number(order?.paidAmount || 0),
    false,
  );

  if (!hasOpenRefund(order)) {
    order.refund = buildRefundRequestState(
      order,
      currentUser,
      { reason: normalizedReason },
      {
        requestedBreakdown,
        contactChannels: ["email"],
        responsibility: "system",
        requiresReturn: false,
      },
    );
    appendRefundHistory(
      order,
      buildRefundHistoryEntry({
        action: "create_request",
        fromStatus: previousRefundStatus,
        toStatus: order.refund?.status || "requested",
        currentUser,
        note: normalizedReason,
        meta: {
          amount: Number(order.refund?.amount || 0),
          source: "late_payment_after_cancel",
        },
      }),
    );

    return {
      previousRefundStatus,
      nextRefundStatus: order.refund?.status || "requested",
    };
  }

  order.refund.reason =
    toTrimmedString(order.refund.reason, "") || normalizedReason;
  order.refund.amount = Math.max(
    Number(order.refund.amount || 0),
    requestedBreakdown.total,
  );
  order.refund.requestedBreakdown = requestedBreakdown;
  if (
    !Array.isArray(order.refund.contactChannels) ||
    order.refund.contactChannels.length === 0
  ) {
    order.refund.contactChannels = ["email"];
  }
  appendRefundHistory(
    order,
    buildRefundHistoryEntry({
      action: "late_payment_received",
      fromStatus: previousRefundStatus,
      toStatus: order.refund?.status || previousRefundStatus || "requested",
      currentUser,
      note: normalizedReason,
      meta: {
        amount: Number(order.paidAmount || 0),
        source: "late_payment_after_cancel",
      },
    }),
  );
  order.markModified("refund");

  return {
    previousRefundStatus,
    nextRefundStatus: order.refund?.status || previousRefundStatus || "requested",
  };
}

async function expireOrderForPaymentTimeout(orderInput, options = {}) {
  const order =
    orderInput && typeof orderInput === "object" && orderInput._id
      ? orderInput
      : await Order.findById(orderInput);

  if (!order || !isOrderPaymentExpired(order, options.now)) {
    return order;
  }

  return cancelOrder(
    order._id,
    getOrderTimeoutCustomerContext(order),
    {
      reason: ORDER_PAYMENT_TIMEOUT_REASON,
    },
    {
      preservePaymentExpiry: true,
    },
  );
}

function applyIncomingSepayPayment(
  order,
  normalizedAmount,
  transactionId,
  webhookId,
  options = {},
) {
  order.paidAmount = Number(order.paidAmount || 0) + normalizedAmount;
  const paidEnough =
    Number(order.paidAmount || 0) >= getConfirmationPaidTarget(order);
  order.paymentStatus = paidEnough ? "paid" : "partial";
  if (paidEnough && !order.paidAt) {
    order.paidAt = new Date();
    order.editWindowEndsAt = addHours(
      order.paidAt,
      Number(order.confirmationDeadlineHours || 12),
    );
  }

  if (transactionId) {
    order.sepayTransactionId = String(transactionId);
  }

  if (webhookId) {
    order.sepayWebhookIds = [
      ...new Set([...(order.sepayWebhookIds || []), String(webhookId)]),
    ];
  }

  syncOrderPaymentExpiry(order, {
    preserveExisting: true,
    allowCreate: options.allowCreateExpiry !== false,
  });

  return { paidEnough };
}

async function applyLateSepayPaymentToCancelledOrder(
  order,
  normalizedAmount,
  transactionId,
  webhookId,
  reason = ORDER_CANCELLED_LATE_PAYMENT_REASON,
) {
  const previousPaymentStatus = order.paymentStatus;
  const systemActor = { role: "system", name: "System" };

  applyIncomingSepayPayment(order, normalizedAmount, transactionId, webhookId, {
    allowCreateExpiry: false,
  });

  const invoice = await ensureOrderInvoice(order);
  const previousInvoiceStatus = invoice.status;
  const { previousRefundStatus, nextRefundStatus } = upsertLatePaymentRefundRequest(
    order,
    systemActor,
    reason,
  );
  syncInvoiceByOrderState(invoice, order, transactionId);

  await Promise.all([order.save(), invoice.save()]);
  await promotionRedemptionService.syncOrderPromotionRedemption(order, {
    releaseReason: "order_cancelled",
  });

  if (toTrimmedString(order.paymentStatus, "") !== toTrimmedString(previousPaymentStatus, "")) {
    publishStatusChange({
      domain: "order",
      entityId: order._id,
      statusField: "paymentStatus",
      previousStatus: previousPaymentStatus,
      nextStatus: order.paymentStatus,
      currentUser: systemActor,
      recipientUserIds: [order.userId],
      meta: {
        paymentCode: order.paymentCode,
        orderType: order.orderType,
      },
    });
  }

  if (toTrimmedString(previousRefundStatus, "") !== toTrimmedString(nextRefundStatus, "")) {
    publishStatusChange({
      domain: "order",
      entityId: order._id,
      statusField: "refund.status",
      previousStatus: previousRefundStatus,
      nextStatus: nextRefundStatus,
      currentUser: systemActor,
      recipientUserIds: [order.userId],
      meta: {
        paymentCode: order.paymentCode,
        amount: Number(order.refund?.amount || 0),
      },
    });
  }

  if (toTrimmedString(previousInvoiceStatus, "") !== toTrimmedString(invoice.status, "")) {
    publishStatusChange({
      domain: "invoice",
      entityId: invoice._id,
      previousStatus: previousInvoiceStatus,
      nextStatus: invoice.status,
      currentUser: systemActor,
      recipientUserIds: [order.userId],
      meta: {
        orderId: order._id,
        invoiceCode: invoice.invoiceCode,
      },
    });
  }

  await notifyCustomerRefundUpdate(
    order,
    "Late payment received",
    "Payment was received after the order was cancelled. A refund request has been updated automatically.",
    nextRefundStatus,
  );

  return Order.findById(order._id).populate(ORDER_POPULATE);
}

function getInvoiceExpectedPaidTarget(
  order = {},
  paidAmount = Number(order?.paidAmount || 0),
) {
  const normalizedPaidAmount = Math.max(0, Number(paidAmount || 0));
  const payNowTotal = Math.max(0, Number(order?.payNowTotal || 0));

  if (
    normalizeCheckoutPaymentMethod(order?.paymentMethod, "") !==
    PAYMENT_METHODS.SEPAY
  ) {
    return payNowTotal;
  }

  if (normalizedPaidAmount < payNowTotal) {
    return payNowTotal;
  }

  if (
    normalizeCheckoutPaymentMethod(order?.payLaterMethod, "") ===
    PAYMENT_METHODS.SEPAY
  ) {
    return Math.max(payNowTotal, Number(order?.total || 0));
  }

  return payNowTotal;
}

function normalizeProductType(value, fallback = "") {
  const normalized = toTrimmedString(value, fallback).toLowerCase();
  return Object.values(PRODUCT_TYPES).includes(normalized)
    ? normalized
    : fallback;
}

function getItemWorkflowFamily(item = {}) {
  const normalized = toTrimmedString(item?.workflowFamily, "").toLowerCase();
  if (Object.values(ORDER_TYPES).includes(normalized)) {
    return normalized;
  }

  if (itemRequiresPrescriptionWorkflow(item)) {
    return ORDER_TYPES.PRESCRIPTION;
  }

  return Boolean(item?.preOrder)
    ? ORDER_TYPES.PRE_ORDER
    : ORDER_TYPES.READY_STOCK;
}

function canUsePreOrderCod(items = [], runtimeConfig = null) {
  if (runtimeConfig?.payments?.codEnabled === false) {
    return false;
  }

  const preorderItems = (Array.isArray(items) ? items : []).filter((item) =>
    Boolean(item?.preOrder),
  );
  if (!preorderItems.length) {
    return false;
  }

  if (!preorderItems.every((item) => item?.preOrderCodAllowed !== false)) {
    return false;
  }

  return preorderItems.some((item) => Number(item?.payLater || 0) > 0);
}

function getAllowedCheckoutPaymentMethods(
  orderType,
  runtimeConfig = null,
  options = {},
) {
  const normalizedOrderType = toTrimmedString(
    orderType,
    ORDER_TYPES.READY_STOCK,
  ).toLowerCase();
  const methods = [PAYMENT_METHODS.SEPAY];

  if (
    normalizedOrderType === ORDER_TYPES.READY_STOCK &&
    runtimeConfig?.payments?.codEnabled !== false
  ) {
    methods.push(PAYMENT_METHODS.COD);
  }

  if (
    normalizedOrderType === ORDER_TYPES.PRE_ORDER &&
    options.preOrderCodAllowed
  ) {
    methods.push(PAYMENT_METHODS.COD);
  }

  return methods;
}

function assertProductSupportedForOrderCheckout(product) {
  const normalizedType = normalizeProductType(product?.type, "");
  if (!CHECKOUT_EXCLUDED_PRODUCT_TYPES.has(normalizedType)) {
    return;
  }

  throw new AppError(
    `Product type "${normalizedType}" is outside the V1 checkout workflow and cannot be ordered through this flow`,
    400,
  );
}

async function resolveBundleWorkflowFamily(product, options = {}) {
  const bundleItems = Array.isArray(product?.specs?.bundle?.items)
    ? product.specs.bundle.items
    : [];
  if (!bundleItems.length) {
    throw new AppError(
      `Bundle "${product?.name || product?._id || "product"}" must define at least one bundled item`,
      400,
    );
  }

  const seenProductIds = new Set(
    Array.isArray(options.seenProductIds) ? options.seenProductIds : [],
  );
  const currentProductId = toTrimmedString(product?._id, "");
  if (currentProductId) {
    seenProductIds.add(currentProductId);
  }

  const componentProductIds = [
    ...new Set(
      bundleItems
        .map((item) => toTrimmedString(item?.productId, ""))
        .filter(Boolean),
    ),
  ];
  const components = await Product.find({
    _id: { $in: componentProductIds },
  }).select("_id name type status preOrder specs.bundle");
  const componentMap = new Map(
    components.map((component) => [String(component._id), component]),
  );
  const families = new Set();

  for (const bundleItem of bundleItems) {
    const componentProductId = toTrimmedString(bundleItem?.productId, "");
    if (!componentProductId) {
      throw new AppError(
        `Bundle "${product?.name || product?._id || "product"}" contains an item without productId`,
        400,
      );
    }

    if (seenProductIds.has(componentProductId)) {
      throw new AppError(
        `Bundle "${product?.name || product?._id || "product"}" contains a recursive bundle reference`,
        400,
      );
    }

    const component = componentMap.get(componentProductId);
    if (!component) {
      throw new AppError(
        `Bundle "${product?.name || product?._id || "product"}" references an unknown product`,
        400,
      );
    }

    if (
      component.status &&
      component.status !== PRODUCT_STATUS.ACTIVE
    ) {
      throw new AppError(
        `Bundle "${product?.name || product?._id || "product"}" includes inactive product "${component.name}"`,
        400,
      );
    }

    const family = await resolveProductWorkflowFamily(component, {
      runtimeConfig: options.runtimeConfig,
      seenProductIds: [...seenProductIds, componentProductId],
    });
    families.add(family);
  }

  if (families.size !== 1) {
    throw new AppError(
      `Bundle "${product?.name || product?._id || "product"}" mixes workflow families and is not supported in V1 checkout`,
      400,
    );
  }

  const componentFamily = [...families][0] || ORDER_TYPES.READY_STOCK;
  const bundlePreOrder =
    typeof options.isPreOrderOverride === "boolean"
      ? options.isPreOrderOverride
      : resolvePreOrderRuntimeConfig(
          product?.preOrder || {},
          options.runtimeConfig || null,
        ).enabled;

  if (componentFamily === ORDER_TYPES.PRESCRIPTION && bundlePreOrder) {
    throw new AppError(
      `Bundle "${product?.name || product?._id || "product"}" cannot combine prescription workflow with pre-order in V1`,
      400,
    );
  }

  if (bundlePreOrder && componentFamily !== ORDER_TYPES.PRE_ORDER) {
    throw new AppError(
      `Bundle "${product?.name || product?._id || "product"}" is marked pre-order but contains non-pre-order items`,
      400,
    );
  }

  if (!bundlePreOrder && componentFamily === ORDER_TYPES.PRE_ORDER) {
    throw new AppError(
      `Bundle "${product?.name || product?._id || "product"}" contains pre-order items but is not configured as pre-order`,
      400,
    );
  }

  return bundlePreOrder ? ORDER_TYPES.PRE_ORDER : componentFamily;
}

async function resolveProductWorkflowFamily(product, options = {}) {
  assertProductSupportedForOrderCheckout(product);

  const productType = normalizeProductType(product?.type, "");
  const isPreOrder =
    typeof options.isPreOrderOverride === "boolean"
      ? options.isPreOrderOverride
      : resolvePreOrderRuntimeConfig(
          product?.preOrder || {},
          options.runtimeConfig || null,
        ).enabled;

  if (productType === PRODUCT_TYPES.BUNDLE) {
    return resolveBundleWorkflowFamily(product, {
      runtimeConfig: options.runtimeConfig || null,
      isPreOrderOverride: isPreOrder,
      seenProductIds: options.seenProductIds || [],
    });
  }

  const requiresPrescriptionWorkflow = itemRequiresPrescriptionWorkflow({
    type: productType,
    customization: options.customization || {},
  });

  if (requiresPrescriptionWorkflow && isPreOrder) {
    throw new AppError(
      `Product "${product?.name || product?._id || "product"}" cannot combine prescription workflow with pre-order in V1`,
      400,
    );
  }

  return requiresPrescriptionWorkflow
    ? ORDER_TYPES.PRESCRIPTION
    : isPreOrder
      ? ORDER_TYPES.PRE_ORDER
      : ORDER_TYPES.READY_STOCK;
}

function forceItemsToCod(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    depositPercent: 0,
    payNow: 0,
    payLater: Math.max(0, Math.round(Number(item?.lineTotal || 0))),
  }));
}

function buildProductShippingMeta(product, options = {}) {
  const dimensions = product?.specs?.dimensions || {};
  const frameWidthMm = normalizeOptionalPositiveInteger(
    dimensions.frameWidthMm,
    120,
  );
  const templeLengthMm = normalizeOptionalPositiveInteger(
    dimensions.templeLengthMm,
    140,
  );
  const lensHeightMm = normalizeOptionalPositiveInteger(
    dimensions.lensHeightMm,
    45,
  );

  return {
    weightGram: normalizeOptionalPositiveInteger(
      product?.specs?.common?.weightGram,
      300,
    ),
    lengthCm: Math.max(
      18,
      Math.ceil(Math.max(frameWidthMm, templeLengthMm) / 10),
    ),
    widthCm: Math.max(12, Math.ceil(frameWidthMm / 10)),
    heightCm: Math.max(6, Math.ceil(lensHeightMm / 10)),
    collectionTiming: normalizeShippingCollectionTiming(
      options?.collectionTiming ??
        (Boolean(product?.preOrder?.enabled)
          ? product?.preOrder?.shippingCollectionTiming
          : "upfront"),
      "upfront",
    ),
  };
}

function stripItemShippingMeta(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (!item || typeof item !== "object") return item;
    const { shippingMeta, workflowFamily, preOrderCodAllowed, ...rest } = item;
    return rest;
  });
}

function sumVariantStock(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return variants.reduce(
    (total, variant) => total + Number(variant?.stock || 0),
    0,
  );
}

function calcPaySplit(unitPrice, quantity, depositPercent) {
  const lineTotal = unitPrice * quantity;
  return {
    lineTotal,
    ...calcPaySplitFromLineTotal(lineTotal, depositPercent),
  };
}

function calcPaySplitFromLineTotal(lineTotal, depositPercent) {
  const normalizedLineTotal = Math.max(0, Number(lineTotal || 0));
  const normalizedDepositPercent = Math.max(
    0,
    Math.min(
      100,
      Number.isFinite(Number(depositPercent)) ? Number(depositPercent) : 100,
    ),
  );
  const payNow = Math.round(
    normalizedLineTotal * (normalizedDepositPercent / 100),
  );
  const payLater = Math.max(0, normalizedLineTotal - payNow);
  return { lineTotal: normalizedLineTotal, payNow, payLater };
}

function allocateAmountProportionally(totalAmount, weights = []) {
  const normalizedTotal = Math.max(0, Math.round(Number(totalAmount || 0)));
  const safeWeights = (Array.isArray(weights) ? weights : []).map((weight) =>
    Math.max(0, Number(weight || 0)),
  );
  const weightSum = safeWeights.reduce((sum, weight) => sum + weight, 0);

  if (normalizedTotal <= 0 || weightSum <= 0 || safeWeights.length === 0) {
    return safeWeights.map(() => 0);
  }

  const provisional = safeWeights.map((weight, index) => {
    const exact = (normalizedTotal * weight) / weightSum;
    const floor = Math.floor(exact);
    return {
      index,
      floor,
      remainder: exact - floor,
    };
  });

  const allocations = provisional.map((item) => item.floor);
  let remainder = normalizedTotal - allocations.reduce((sum, value) => sum + value, 0);

  provisional
    .sort((a, b) => {
      if (b.remainder !== a.remainder) {
        return b.remainder - a.remainder;
      }
      return a.index - b.index;
    })
    .forEach((item) => {
      if (remainder <= 0) return;
      allocations[item.index] += 1;
      remainder -= 1;
    });

  return allocations;
}

function applyDiscountToItems(items = [], discountAmount = 0) {
  const safeItems = Array.isArray(items) ? items : [];
  const subtotal = safeItems.reduce(
    (sum, item) => sum + Math.max(0, Number(item?.lineTotal || 0)),
    0,
  );
  const appliedDiscountAmount = Math.min(
    Math.max(0, Math.round(Number(discountAmount || 0))),
    Math.max(0, Math.round(subtotal)),
  );

  if (appliedDiscountAmount <= 0 || safeItems.length === 0) {
    return {
      items: safeItems.map((item) => ({ ...item })),
      discountAmount: 0,
    };
  }

  const allocatedDiscounts = allocateAmountProportionally(
    appliedDiscountAmount,
    safeItems.map((item) => item.lineTotal || 0),
  );

  return {
    items: safeItems.map((item, index) => {
      const discountedLineTotal = Math.max(
        0,
        Math.round(Number(item.lineTotal || 0)) - allocatedDiscounts[index],
      );
      const split = calcPaySplitFromLineTotal(
        discountedLineTotal,
        item.depositPercent,
      );

      return {
        ...item,
        payNow: split.payNow,
        payLater: split.payLater,
      };
    }),
    discountAmount: appliedDiscountAmount,
  };
}

function resolveOrderShippingCollectionTiming(items = []) {
  const preorderTimings = Array.from(
    new Set(
      (Array.isArray(items) ? items : [])
        .filter((item) => Boolean(item?.preOrder))
        .map((item) =>
          normalizeShippingCollectionTiming(
            item?.shippingMeta?.collectionTiming,
            "upfront",
          ),
        ),
    ),
  );

  if (preorderTimings.length > 1) {
    throw new AppError(
      "Pre-order items in the same order must share the same shipping collection timing",
      400,
    );
  }

  return preorderTimings[0] || "upfront";
}

function resolveShippingLegTotals(shippingFee, shippingCollectionTiming) {
  const normalizedShippingFee = Math.max(0, Number(shippingFee || 0));
  const normalizedTiming = normalizeShippingCollectionTiming(
    shippingCollectionTiming,
    "upfront",
  );

  if (normalizedTiming === "upfront") {
    return {
      shippingPayNow: normalizedShippingFee,
      shippingPayLater: 0,
    };
  }

  return {
    shippingPayNow: 0,
    shippingPayLater: normalizedShippingFee,
  };
}

function applyQuoteResultToOrder(order, quoteResult) {
  order.items = quoteResult.items;
  order.subtotal = quoteResult.subtotal;
  order.shippingFee = quoteResult.shippingFee;
  order.discountAmount = quoteResult.discountAmount;
  order.total = quoteResult.total;
  order.payNowTotal = quoteResult.payNowTotal;
  order.payLaterTotal = quoteResult.payLaterTotal;
  order.payLaterMethod = quoteResult.payLaterMethod || null;
  order.shippingCollectionTiming = quoteResult.shippingCollectionTiming || "upfront";
  order.shippingFeeMode = quoteResult.shippingFeeMode || "estimated";
  order.voucherCode = quoteResult.voucherCode || "";
  order.promotionApplied = buildOrderPromotionSnapshot(quoteResult);
}

function buildOrderPromotionSnapshot(quoteResult = {}) {
  if (!quoteResult?.promotion || !quoteResult?.voucherCode) {
    return null;
  }

  return {
    promotionId: quoteResult.promotion.id || null,
    code: quoteResult.promotion.code || quoteResult.voucherCode || "",
    name: quoteResult.promotion.name || "",
    type: quoteResult.promotion.type || "",
    value: Number(quoteResult.promotion.value || 0),
    maxDiscount: Number(quoteResult.promotion.maxDiscount || 0),
    minOrderValue: Number(quoteResult.promotion.minOrderValue || 0),
    cartType: quoteResult.promotion.cartType || "all",
    paymentScope: quoteResult.promotion.paymentScope || "all",
    applicableCategories: Array.isArray(quoteResult.promotion.applicableCategories)
      ? quoteResult.promotion.applicableCategories
      : [],
    discountAmountApplied: Number(quoteResult.discountAmount || 0),
  };
}

function normalizeEye(eye = {}, fallback = "0") {
  return {
    sphere: toTrimmedString(eye.sphere, fallback) || fallback,
    cyl: toTrimmedString(eye.cyl, fallback) || fallback,
    axis: toTrimmedString(eye.axis, fallback) || fallback,
    add: toTrimmedString(eye.add, fallback) || fallback,
  };
}

function normalizePrescription(raw = {}) {
  const modeCandidate = toTrimmedString(
    raw.mode || "none",
    "none",
  ).toLowerCase();
  const mode = PRESCRIPTION_MODES.has(modeCandidate) ? modeCandidate : "none";
  const isMyopic = Boolean(raw.isMyopic);

  const payload = {
    mode,
    isMyopic,
    rightEye: normalizeEye(raw.rightEye, isMyopic ? "" : "0"),
    leftEye: normalizeEye(raw.leftEye, isMyopic ? "" : "0"),
    pd: toTrimmedString(raw.pd, isMyopic ? "" : "0") || (isMyopic ? "" : "0"),
    note: toTrimmedString(raw.note, ""),
    attachmentUrls: Array.isArray(raw.attachmentUrls)
      ? raw.attachmentUrls.map((url) => toTrimmedString(url)).filter(Boolean)
      : [],
  };

  if (!isMyopic) {
    payload.rightEye = normalizeEye({}, "0");
    payload.leftEye = normalizeEye({}, "0");
    payload.pd = "0";
    if (!payload.note) {
      payload.note = "Khong can do can thi: dien 0 cho cac thong so.";
    }
  }

  if (payload.mode === "upload" && payload.attachmentUrls.length === 0) {
    throw new AppError(
      "customization.prescription.attachmentUrls is required for upload mode",
      400,
    );
  }

  return payload;
}

function normalizeCustomization(input = {}, { variant } = {}) {
  const raw = (input && typeof input === "object" && input.customization) || {};
  const prescription = normalizePrescription(raw.prescription || {});
  const selectedColor = toTrimmedString(
    raw.selectedColor || raw.color || variant?.options?.color,
    "",
  );
  const selectedSize = toTrimmedString(
    raw.selectedSize || raw.size || variant?.options?.size,
    "",
  );

  const combineWithRaw =
    raw.combineWith && typeof raw.combineWith === "object"
      ? raw.combineWith
      : {};
  const combineWith = {
    productId: combineWithRaw.productId || combineWithRaw.product_id || null,
    variantId: combineWithRaw.variantId || combineWithRaw.variant_id || null,
    note: toTrimmedString(combineWithRaw.note, ""),
  };

  return {
    selectedColor,
    selectedSize,
    photochromic: Boolean(raw.photochromic),
    prescription,
    orderMadeFromPrescriptionImage:
      prescription.mode === "upload" ||
      Boolean(raw.orderMadeFromPrescriptionImage),
    combineWith,
    note: toTrimmedString(raw.note, ""),
  };
}

function assertPreOrderWindow(product) {
  const now = Date.now();
  const startAt = product?.preOrder?.startAt
    ? new Date(product.preOrder.startAt).getTime()
    : null;
  const endAt = product?.preOrder?.endAt
    ? new Date(product.preOrder.endAt).getTime()
    : null;

  if (startAt && now < startAt) {
    throw new AppError(`Pre-order has not started for "${product.name}"`, 400);
  }
  if (endAt && now > endAt) {
    throw new AppError(`Pre-order has ended for "${product.name}"`, 400);
  }
}

function assertCartTypeCompatibility(cartType, isPreOrder, productName) {
  if (!cartType) return;
  if (cartType === CART_TYPES.PRE_ORDER && !isPreOrder) {
    throw new AppError(
      `"${productName}" is not pre-order and cannot be added to pre-order cart`,
      400,
    );
  }
  if (cartType === CART_TYPES.READY_STOCK && isPreOrder) {
    throw new AppError(
      `"${productName}" is pre-order and must be added to pre-order cart`,
      400,
    );
  }
}

function findExistingOrderItemSnapshot(input = {}, existingOrderItems = []) {
  const orderItemId = toTrimmedString(
    input?.orderItemId || input?._orderItemId || input?.itemId,
    "",
  );
  if (orderItemId) {
    return (
      (Array.isArray(existingOrderItems) ? existingOrderItems : []).find(
        (item) => String(item?._id || "") === orderItemId,
      ) || null
    );
  }

  const productId = toTrimmedString(input?.productId || input?.product_id, "");
  const variantId = toTrimmedString(
    input?.variantId ?? input?.variant_id,
    "",
  );

  return (
    (Array.isArray(existingOrderItems) ? existingOrderItems : []).find(
      (item) =>
        String(item?.productId || "") === productId &&
        String(item?.variantId || "") === variantId,
    ) || null
  );
}

function canReuseOrderItemSnapshot(input = {}, existingOrderItem = null) {
  if (!existingOrderItem) return false;

  const productId = toTrimmedString(input?.productId || input?.product_id, "");
  const variantId = toTrimmedString(
    input?.variantId ?? input?.variant_id,
    "",
  );
  const quantity = Number(input?.quantity || 0);

  return (
    String(existingOrderItem?.productId || "") === productId &&
    String(existingOrderItem?.variantId || "") === variantId &&
    quantity === Number(existingOrderItem?.quantity || 0)
  );
}

function buildItemDocFromOrderSnapshot(
  input = {},
  existingOrderItem = {},
  product = null,
) {
  const quantity = normalizePositiveInteger(input.quantity, "quantity");
  const unitPrice = normalizeNonNegativeNumber(
    existingOrderItem?.unitPrice ?? 0,
    "unitPrice",
  );
  const depositPercent = Math.max(
    0,
    Math.min(
      100,
      Number.isFinite(Number(existingOrderItem?.depositPercent))
        ? Number(existingOrderItem.depositPercent)
        : 100,
    ),
  );
  const { lineTotal, payNow, payLater } = calcPaySplit(
    unitPrice,
    quantity,
    depositPercent,
  );
  const variantOptions = {
    color: toTrimmedString(existingOrderItem?.variantOptions?.color, ""),
    size: toTrimmedString(existingOrderItem?.variantOptions?.size, ""),
  };
  const customization = normalizeCustomization(input, {
    variant: { options: variantOptions },
  });
  const preOrder = Boolean(existingOrderItem?.preOrder);

  return {
    productId:
      product?._id ||
      existingOrderItem?.productId ||
      input?.productId ||
      input?.product_id,
    variantId:
      existingOrderItem?.variantId ??
      input?.variantId ??
      input?.variant_id ??
      null,
    name: toTrimmedString(existingOrderItem?.name || product?.name, ""),
    type: toTrimmedString(existingOrderItem?.type || product?.type, ""),
    variantOptions,
    quantity,
    unitPrice,
    lineTotal,
    depositPercent,
    payNow,
    payLater,
    preOrder,
    preOrderCodAllowed: preOrder ? product?.preOrder?.allowCod !== false : false,
    customization,
    shippingMeta: buildProductShippingMeta(product || {}, {
      collectionTiming: preOrder
        ? normalizeShippingCollectionTiming(
            product?.preOrder?.shippingCollectionTiming,
            "upfront",
          )
        : "upfront",
    }),
  };
}

async function buildItems(itemsInput, options = {}) {
  if (!Array.isArray(itemsInput) || itemsInput.length === 0) {
    throw new AppError("items is required", 400);
  }

  const itemDocs = [];
  const runtimeConfig = options.runtimeConfig || null;

  for (const input of itemsInput) {
    const productId = input?.productId || input?.product_id;
    if (!productId) {
      throw new AppError("productId is required", 400);
    }

    const quantity = normalizePositiveInteger(input.quantity, "quantity");
    const existingOrderItem = findExistingOrderItemSnapshot(
      input,
      options.existingOrderItems,
    );
    const reuseExistingSnapshot = canReuseOrderItemSnapshot(
      input,
      existingOrderItem,
    );
    const product = await Product.findById(productId).select(
      "_id name type status pricing preOrder inventory variants specs storeScope",
    );
    if (reuseExistingSnapshot) {
      assertCartTypeCompatibility(
        options.cartType,
        Boolean(existingOrderItem?.preOrder),
        existingOrderItem?.name || product?.name || "Product",
      );
      const itemDoc = buildItemDocFromOrderSnapshot(
        input,
        existingOrderItem,
        product,
      );
      itemDoc.workflowFamily = await resolveProductWorkflowFamily(product, {
        runtimeConfig,
        customization: itemDoc.customization,
        isPreOrderOverride: Boolean(existingOrderItem?.preOrder),
      });
      itemDocs.push(itemDoc);
      continue;
    }

    if (!product) {
      throw new AppError("Product not found", 404);
    }

    assertProductSupportedForOrderCheckout(product);

    if (product.status !== PRODUCT_STATUS.ACTIVE) {
      throw new AppError(
        `Product "${product.name}" is not available for sale`,
        400,
      );
    }

    if (!isProductAvailableAtStore(product, options.storeId)) {
      throw new AppError(
        `Product "${product.name}" is not available at the selected store`,
        400,
      );
    }

    const variant = pickVariant(product, input.variantId || input.variant_id);
    const unitPrice = pickPrice(product, variant);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new AppError(`Product "${product.name}" price is missing`, 400);
    }

    const productMarkedPreOrder = Boolean(product.preOrder?.enabled);
    const effectivePreOrderConfig = resolvePreOrderRuntimeConfig(
      product.preOrder || {},
      runtimeConfig,
    );
    const isPreOrder = effectivePreOrderConfig.enabled;
    if (productMarkedPreOrder && !isPreOrder) {
      throw buildFeatureDisabledError(
        "Pre-order is currently disabled.",
        "PREORDER_DISABLED",
      );
    }
    assertCartTypeCompatibility(options.cartType, isPreOrder, product.name);

    if (isPreOrder) {
      assertPreOrderWindow(product);
      const maxQty = Number(
        effectivePreOrderConfig.maxQuantityPerOrder ||
          product.preOrder?.maxQuantityPerOrder ||
          0,
      );
      if (maxQty > 0 && quantity > maxQty) {
        throw new AppError(
          `Quantity exceeds pre-order limit for "${product.name}" (max ${maxQty})`,
          400,
        );
      }
    } else if (product.inventory?.track !== false) {
      const availableStock = variant
        ? Number(variant.stock || 0)
        : sumVariantStock(product);
      if (availableStock < quantity) {
        throw new AppError(`Insufficient stock for "${product.name}"`, 400);
      }
    }

    const depositPercent = isPreOrder
      ? Number(effectivePreOrderConfig.depositPercent ?? 100)
      : 100;
    const { lineTotal, payNow, payLater } = calcPaySplit(
      unitPrice,
      quantity,
      depositPercent,
    );
    const customization = normalizeCustomization(input, { variant });
    const workflowFamily = await resolveProductWorkflowFamily(product, {
      runtimeConfig,
      customization,
      isPreOrderOverride: isPreOrder,
    });

    itemDocs.push({
      productId: product._id,
      variantId: variant
        ? variant._id
        : input.variantId || input.variant_id || null,
      name: product.name,
      type: product.type,
      variantOptions: {
        color: toTrimmedString(variant?.options?.color, ""),
        size: toTrimmedString(variant?.options?.size, ""),
      },
      quantity,
      unitPrice,
      lineTotal,
      depositPercent,
      payNow,
      payLater,
      preOrder: isPreOrder,
      preOrderCodAllowed: isPreOrder
        ? Boolean(effectivePreOrderConfig.allowCod)
        : false,
      workflowFamily,
      customization,
      shippingMeta: buildProductShippingMeta(product, {
        collectionTiming: effectivePreOrderConfig.shippingCollectionTiming,
      }),
    });
  }

  return itemDocs;
}

function sumAmounts(items) {
  const subtotal = items.reduce((acc, item) => acc + item.lineTotal, 0);
  const payNowTotal = items.reduce((acc, item) => acc + item.payNow, 0);
  const payLaterTotal = items.reduce((acc, item) => acc + item.payLater, 0);
  return { subtotal, payNowTotal, payLaterTotal };
}

function normalizeVoucherCode(value) {
  const normalized = toTrimmedString(value, "").toUpperCase();
  return normalized || null;
}

function mapOrderItemsToInput(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    orderItemId: item._id || null,
    _orderItemId: item._id || null,
    productId: item.productId,
    variantId: item.variantId || null,
    quantity: item.quantity,
    customization: item.customization || {},
  }));
}

function itemRequiresPrescriptionWorkflow(item = {}) {
  const productType = toTrimmedString(item.type, "").toLowerCase();
  const prescriptionMode = toTrimmedString(
    item?.customization?.prescription?.mode,
    "none",
  ).toLowerCase();

  return (
    prescriptionMode !== "none" ||
    Boolean(item?.customization?.orderMadeFromPrescriptionImage) ||
    productType === "lens"
  );
}

function getOrderItemEntityId(value) {
  if (value && typeof value === "object") {
    return toTrimmedString(value._id || value.id, "");
  }

  return toTrimmedString(value, "");
}

function getOrderItemCombineTarget(item = {}) {
  const productId = getOrderItemEntityId(
    item?.customization?.combineWith?.productId,
  );
  if (!productId) {
    return null;
  }

  return {
    productId,
    variantId: getOrderItemEntityId(item?.customization?.combineWith?.variantId),
  };
}

function itemMatchesCombineTarget(item = {}, target = null) {
  if (!target?.productId) {
    return false;
  }

  const itemProductId = getOrderItemEntityId(item?.productId);
  if (!itemProductId || itemProductId !== target.productId) {
    return false;
  }

  const targetVariantId = toTrimmedString(target.variantId, "");
  if (!targetVariantId) {
    return true;
  }

  return getOrderItemEntityId(item?.variantId) === targetVariantId;
}

function itemsReferenceEachOther(sourceItem = {}, targetItem = {}) {
  const sourceTarget = getOrderItemCombineTarget(sourceItem);
  if (!sourceTarget || !itemMatchesCombineTarget(targetItem, sourceTarget)) {
    return false;
  }

  const targetSource = getOrderItemCombineTarget(targetItem);
  if (!targetSource) {
    return false;
  }

  return itemMatchesCombineTarget(sourceItem, targetSource);
}

function isAllowedPrescriptionFrameCombo(items = []) {
  const normalizedItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (normalizedItems.length < 2) {
    return false;
  }

  const lensItems = [];
  const frameItems = [];

  for (const item of normalizedItems) {
    const family = getItemWorkflowFamily(item);
    const productType = normalizeProductType(item?.type, "");

    if (family === ORDER_TYPES.PRESCRIPTION) {
      if (productType !== PRODUCT_TYPES.LENS || Boolean(item?.preOrder)) {
        return false;
      }
      lensItems.push(item);
      continue;
    }

    if (family === ORDER_TYPES.READY_STOCK) {
      if (productType !== PRODUCT_TYPES.FRAME || Boolean(item?.preOrder)) {
        return false;
      }
      frameItems.push(item);
      continue;
    }

    return false;
  }

  if (
    !lensItems.length ||
    !frameItems.length ||
    normalizedItems.length !== lensItems.length + frameItems.length
  ) {
    return false;
  }

  if (lensItems.length === 1 && frameItems.length === 1) {
    return true;
  }

  if (lensItems.length !== frameItems.length) {
    return false;
  }

  const matchedFrameIndexes = new Set();

  for (const lensItem of lensItems) {
    const frameIndex = frameItems.findIndex(
      (frameItem, index) =>
        !matchedFrameIndexes.has(index) &&
        itemsReferenceEachOther(lensItem, frameItem),
    );

    if (frameIndex < 0) {
      return false;
    }

    matchedFrameIndexes.add(frameIndex);
  }

  return matchedFrameIndexes.size === frameItems.length;
}

function mergeCustomization(base = {}, patch = {}) {
  const next = {
    ...(base || {}),
    ...(patch || {}),
  };

  if (
    patch &&
    typeof patch === "object" &&
    patch.prescription &&
    typeof patch.prescription === "object"
  ) {
    next.prescription = {
      ...(base?.prescription || {}),
      ...patch.prescription,
    };
  }

  if (
    patch &&
    typeof patch === "object" &&
    patch.combineWith &&
    typeof patch.combineWith === "object"
  ) {
    next.combineWith = {
      ...(base?.combineWith || {}),
      ...patch.combineWith,
    };
  }

  return next;
}

function mapInvoiceItemsFromOrder(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.map((item) => ({
    productId: item.productId,
    variantId: item.variantId || null,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    lineTotal: item.lineTotal,
  }));
}

function inferOrderType(items = []) {
  const families = [
    ...new Set((Array.isArray(items) ? items : []).map(getItemWorkflowFamily)),
  ].filter(Boolean);

  if (families.length > 1) {
    if (
      families.length === 2 &&
      families.includes(ORDER_TYPES.PRESCRIPTION) &&
      families.includes(ORDER_TYPES.READY_STOCK) &&
      isAllowedPrescriptionFrameCombo(items)
    ) {
      return ORDER_TYPES.PRESCRIPTION;
    }

    throw new AppError(
      "Items from different workflow families must be checked out separately",
      400,
    );
  }

  return families[0] || ORDER_TYPES.READY_STOCK;
}

function getOrderEditWindowEndsAt(order) {
  if (order?.editWindowEndsAt) return new Date(order.editWindowEndsAt);
  if (order?.paidAt) {
    const hours = Number(order?.confirmationDeadlineHours || 12);
    return addHours(order.paidAt, hours);
  }
  return null;
}

function normalizeRefundBankAccount(bankAccount, options = {}) {
  const { required = false, fieldName = "bankAccount" } = options;
  if (!bankAccount || typeof bankAccount !== "object") {
    if (required) {
      throw new AppError(`${fieldName} is required`, 400);
    }
    return null;
  }

  const rawBankCode = toTrimmedString(bankAccount.bankCode).toUpperCase();
  const rawBankName = toTrimmedString(bankAccount.bankName);
  const accountNumber = normalizeRefundAccountNumber(bankAccount.accountNumber);
  const accountHolder = toTrimmedString(bankAccount.accountHolder);
  const bank = findRefundBank({
    bankCode: rawBankCode,
    bankName: rawBankName,
  });

  if (required && !rawBankCode) {
    throw new AppError(`${fieldName}.bankCode is required`, 400);
  }
  if (!bank) {
    if (required) {
      throw new AppError(`${fieldName}.bankCode is invalid or unsupported`, 400);
    }
    return null;
  }
  if (!accountNumber) {
    if (required) {
      throw new AppError(`${fieldName}.accountNumber is required`, 400);
    }
    return null;
  }
  if (!isRefundAccountNumberFormatValid(accountNumber)) {
    throw new AppError(`${fieldName}.accountNumber must contain 8 to 19 digits`, 400);
  }
  if (!accountHolder) {
    if (required) {
      throw new AppError(`${fieldName}.accountHolder is required`, 400);
    }
    return null;
  }

  return {
    bankCode: bank.code,
    bankName: bank.name,
    accountNumber,
    accountHolder,
    note: toTrimmedString(bankAccount.note, ""),
  };
}

function requireRefundPayoutBankAccount(order) {
  try {
    return normalizeRefundBankAccount(order?.refund?.bankAccount, {
      required: true,
      fieldName: "refund.bankAccount",
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError(
        "Customer refund bank account is required before payout processing can continue",
        400,
      );
    }
    throw error;
  }
}

function syncInvoiceByOrderState(invoice, order, transactionId) {
  const paidAmount = Number(order.paidAmount || 0);
  const expectedPaidTarget = getInvoiceExpectedPaidTarget(order, paidAmount);
  const amountDue = Math.max(0, expectedPaidTarget - paidAmount);

  invoice.items = mapInvoiceItemsFromOrder(order);
  invoice.subtotal = Number(order.subtotal || 0);
  invoice.discountAmount = Number(order.discountAmount || 0);
  invoice.shippingFee = Number(order.shippingFee || 0);
  invoice.total = Number(order.total || 0);
  invoice.paidAmount = paidAmount;
  invoice.amountDue = amountDue;
  invoice.status =
    amountDue <= 0 ? "paid" : paidAmount > 0 ? "partial" : "issued";
  if (order.paymentStatus === "refunded") {
    invoice.status = "void";
    invoice.amountDue = 0;
  }
  if (order.status === ORDER_STATUS.CANCELLED && paidAmount <= 0) {
    invoice.status = "void";
    invoice.amountDue = 0;
  }
  if (invoice.status === "paid" && !invoice.paidAt) {
    invoice.paidAt = order.paidAt || new Date();
  }
  if (transactionId) {
    invoice.paymentRefs = [
      ...new Set([...(invoice.paymentRefs || []), String(transactionId)]),
    ];
  }
}

async function createInvoiceFromOrder(order) {
  const paidAmount = Number(order.paidAmount || 0);
  const expectedPaidTarget = getInvoiceExpectedPaidTarget(order, paidAmount);
  const amountDue = Math.max(0, expectedPaidTarget - paidAmount);
  const status =
    amountDue <= 0 ? "paid" : paidAmount > 0 ? "partial" : "issued";

  const invoice = await Invoice.create({
    invoiceCode: buildInvoiceCode(order.paymentCode, order._id),
    orderId: order._id,
    userId: order.userId,
    items: mapInvoiceItemsFromOrder(order),
    subtotal: Number(order.subtotal || 0),
    discountAmount: Number(order.discountAmount || 0),
    shippingFee: Number(order.shippingFee || 0),
    total: Number(order.total || 0),
    paidAmount,
    amountDue,
    currency: "VND",
    status,
    issuedAt: order.createdAt || new Date(),
    paidAt: status === "paid" ? order.paidAt || new Date() : undefined,
    notes: order.note || "",
  });

  return invoice;
}

async function ensureOrderInvoice(order) {
  if (order.invoiceId) {
    const invoice = await Invoice.findById(order.invoiceId);
    if (invoice) return invoice;
  }

  const invoice = await createInvoiceFromOrder(order);
  order.invoiceId = invoice._id;
  return invoice;
}

function normalizeRefundStatus(status) {
  const normalized = toTrimmedString(status, "").toLowerCase();
  return REFUND_STATUSES.has(normalized) ? normalized : null;
}

async function maybeRestoreReadyStockInventory(order, actorId = null) {
  if (toTrimmedString(order?.orderType, "").toLowerCase() !== ORDER_TYPES.READY_STOCK) {
    return false;
  }

  return restoreOrderInventory(order, actorId);
}

function normalizeContactChannels(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((v) => toTrimmedString(v).toLowerCase())
        .filter((v) => ["email", "phone"].includes(v)),
    ),
  ];
}

function getOrderNotificationCode(order) {
  return toTrimmedString(order?.paymentCode || order?._id, "");
}

function buildNotificationData(order, extra = {}) {
  return {
    orderId: String(order?._id || ""),
    orderCode: getOrderNotificationCode(order),
    orderStatus: toTrimmedString(order?.status).toLowerCase(),
    opsStage: normalizeOpsStage(order?.opsStage, ""),
    trackingCode: toTrimmedString(
      order?.shipment?.orderCode || order?.shipment?.trackingCode,
      "",
    ),
    ...extra,
  };
}

function getOrderStatusNotificationPayload(order) {
  const code = getOrderNotificationCode(order);
  switch (toTrimmedString(order?.status).toLowerCase()) {
    case ORDER_STATUS.CONFIRMED:
      return {
        title: "Don hang da duoc xac nhan",
        message: `Don ${code} da duoc xac nhan va chuyen sang xu ly.`,
      };
    case ORDER_STATUS.CANCELLED:
      return {
        title: "Don hang da bi huy",
        message: `Don ${code} da duoc cap nhat sang trang thai da huy.`,
      };
    case ORDER_STATUS.DELIVERED:
      return {
        title: "Don hang da giao thanh cong",
        message: `Don ${code} da duoc giao thanh cong.`,
      };
    case ORDER_STATUS.RETURNED:
      return {
        title: "Don hang da hoan hang",
        message: `Don ${code} da duoc cap nhat sang trang thai hoan hang.`,
      };
    default:
      return null;
  }
}

function getOpsStageNotificationPayload(order) {
  const code = getOrderNotificationCode(order);
  switch (normalizeOpsStage(order?.opsStage, "")) {
    case ORDER_OPS_STAGE.PICKING:
      return {
        title: "Don hang dang duoc chuan bi",
        message: `Don ${code} dang trong buoc lay hang.`,
      };
    case ORDER_OPS_STAGE.PACKING:
      return {
        title: "Don hang dang dong goi",
        message: `Don ${code} dang duoc dong goi de giao cho don vi van chuyen.`,
      };
    case ORDER_OPS_STAGE.READY_TO_SHIP:
      return {
        title: "Don hang san sang tao van don",
        message: `Don ${code} da dong goi xong va san sang tao van don.`,
      };
    case ORDER_OPS_STAGE.WAITING_ARRIVAL:
      return {
        title: "Don pre-order dang cho hang ve",
        message: `Don ${code} dang cho hang pre-order ve kho.`,
      };
    case ORDER_OPS_STAGE.ARRIVED:
      return {
        title: "Hang pre-order da ve kho",
        message: `Don ${code} da co hang ve kho va dang cho nhap kho.`,
      };
    case ORDER_OPS_STAGE.STOCKED:
      return {
        title: "Don pre-order da nhap kho",
        message: `Don ${code} da duoc nhap kho va san sang xu ly tiep.`,
      };
    case ORDER_OPS_STAGE.WAITING_LAB:
      return {
        title: "Don prescription dang cho gia cong",
        message: `Don ${code} dang cho vao khau gia cong kinh.`,
      };
    case ORDER_OPS_STAGE.LENS_PROCESSING:
      return {
        title: "Don prescription dang cat mai",
        message: `Don ${code} dang trong qua trinh cat mai lam trong.`,
      };
    case ORDER_OPS_STAGE.LENS_FITTING:
      return {
        title: "Don prescription dang lap trong",
        message: `Don ${code} dang duoc lap trong vao gong.`,
      };
    case ORDER_OPS_STAGE.QC_CHECK:
      return {
        title: "Don prescription dang QC",
        message: `Don ${code} dang duoc kiem tra chat luong sau gia cong.`,
      };
    case ORDER_OPS_STAGE.READY_TO_PACK:
      return {
        title: "Don hang san sang dong goi",
        message: `Don ${code} da san sang cho buoc dong goi.`,
      };
    case ORDER_OPS_STAGE.WAITING_CUSTOMER_INFO:
      return {
        title: "Don hang can bo sung thong tin",
        message: `Don ${code} can bo sung them thong tin giao hang de tiep tuc xu ly.`,
      };
    default:
      return null;
  }
}

async function notifyCustomerOrderStatusChange(order, previousStatus) {
  const nextStatus = toTrimmedString(order?.status).toLowerCase();
  if (!order?.userId || nextStatus === toTrimmedString(previousStatus).toLowerCase()) {
    return;
  }

  const payload = getOrderStatusNotificationPayload(order);
  if (!payload) return;

  await appendUserNotification(order.userId, {
    type: "order",
    ...payload,
    data: buildNotificationData(order),
  });
}

async function notifyCustomerOpsStageChange(order, previousOpsStage) {
  const nextOpsStage = normalizeOpsStage(order?.opsStage, "");
  if (!order?.userId || nextOpsStage === normalizeOpsStage(previousOpsStage, "")) {
    return;
  }

  const payload = getOpsStageNotificationPayload(order);
  if (!payload) return;

  await appendUserNotification(order.userId, {
    type: "order",
    ...payload,
    data: buildNotificationData(order),
  });
}

function assertCustomerCanEditOrder(order) {
  if (!order) throw new AppError("Order not found", 404);

  if (
    [
      ORDER_STATUS.CONFIRMED,
      ORDER_STATUS.PROCESSING,
      ORDER_STATUS.SHIPPED,
      ORDER_STATUS.DELIVERED,
      ORDER_STATUS.CANCELLED,
      ORDER_STATUS.RETURNED,
    ].includes(order.status)
  ) {
    throw new AppError("Order cannot be edited at this stage", 400);
  }

  const editWindowEndsAt = getOrderEditWindowEndsAt(order);
  if (editWindowEndsAt && Date.now() > editWindowEndsAt.getTime()) {
    throw new AppError(
      "Order edit window has expired (12h before confirmation)",
      400,
    );
  }
}

async function quote(
  itemsInput,
  shippingFee = 0,
  discountAmount = 0,
  options = {},
) {
  const runtimeConfig = await getEffectiveSystemConfig();
  const manualShippingFee = normalizeNonNegativeNumber(
    shippingFee,
    "shippingFee",
  );
  const manualDiscount = normalizeNonNegativeNumber(
    discountAmount,
    "discountAmount",
  );
  const resolvedStoreId = await resolveOrderStoreId({
    requestedStoreId: options.storeId,
    currentUser: options.currentUser,
  });

  if ((options.cartType || null) === CART_TYPES.PRE_ORDER) {
    assertPreorderRuntimeEnabled(runtimeConfig);
  }

  const items = await buildItems(itemsInput, {
    cartType: options.cartType || null,
    storeId: resolvedStoreId,
    runtimeConfig,
    existingOrderItems: options.existingOrderItems,
  });
  const { subtotal } = sumAmounts(items);
  const voucherCode = normalizeVoucherCode(options.voucherCode || null);
  const requestedPaymentMethod = normalizeCheckoutPaymentMethod(
    options.paymentMethod,
    PAYMENT_METHODS.SEPAY,
  );
  const shippingCollectionTiming = resolveOrderShippingCollectionTiming(items);
  const normalizedShippingMethod = toTrimmedString(
    options.shippingMethod || "standard",
    "standard",
  ).toLowerCase();
  const normalizedShippingAddress = options.shippingAddress
    ? sanitizeShippingAddress(options.shippingAddress)
    : null;

  let discountValue = manualDiscount;
  let promotion = null;
  let appliedVoucherCode = null;
  let shippingQuote = {
    shippingFee: manualShippingFee,
    shippingMethod: normalizedShippingMethod,
    shippingOptions: null,
    shippingSource: "manual",
    packageMetrics: null,
    originStore: null,
  };

  if (voucherCode) {
    const resolvedPromotion = await promotionService.resolvePromotion({
      voucherCode,
      subtotal,
      cartType: options.cartType || null,
      items,
      paymentMethod: requestedPaymentMethod,
      excludeOrderId: options.orderId || "",
      throwOnInvalid: true,
    });

    discountValue = resolvedPromotion.discountAmount;
    promotion = promotionService.toPromotionMeta(
      resolvedPromotion.promotion,
      resolvedPromotion.usageSummary,
    );
    appliedVoucherCode = resolvedPromotion.voucherCode;
  }

  discountValue = Math.min(
    subtotal,
    normalizeNonNegativeNumber(discountValue, "discountAmount"),
  );

  const canCalculateDynamicShipping =
    normalizedShippingAddress?.districtId &&
    normalizedShippingAddress?.wardCode &&
    normalizedShippingMethod;

  if (canCalculateDynamicShipping && canUseGhn(runtimeConfig)) {
    try {
      shippingQuote = await shippingQuoteService.quoteShipping({
        items,
        shippingAddress: normalizedShippingAddress,
        shippingMethod: normalizedShippingMethod,
        subtotal,
        storeId: resolvedStoreId || null,
      });
      shippingQuote.shippingSource = "ghn";
    } catch (error) {
      if (runtimeConfig?.shipping?.allowEstimatedShippingFee === false) {
        throw new AppError(
          error?.message || "Shipping carrier integration is currently unavailable.",
          503,
          "SHIPPING_UNAVAILABLE",
        );
      }
    }
  } else if (
    canCalculateDynamicShipping &&
    !canUseGhn(runtimeConfig) &&
    runtimeConfig?.shipping?.allowEstimatedShippingFee === false
  ) {
    throw new AppError(
      "Shipping carrier integration is currently unavailable.",
      503,
      "SHIPPING_UNAVAILABLE",
    );
  }

  const shippingFeeValue = normalizeNonNegativeNumber(
    shippingQuote.shippingFee,
    "shippingFee",
  );
  const shippingFeeMode = normalizeShippingFeeMode(
    shippingQuote.shippingSource === "ghn" ? "exact" : "estimated",
    "estimated",
  );
  const discounted = applyDiscountToItems(items, discountValue);
  const {
    payNowTotal: discountedProductPayNowTotal,
    payLaterTotal: discountedProductPayLaterTotal,
  } = sumAmounts(discounted.items);
  const orderType = inferOrderType(discounted.items);
  const preOrderCodAllowed = canUsePreOrderCod(discounted.items, runtimeConfig);
  const allowedPaymentMethods = getAllowedCheckoutPaymentMethods(
    orderType,
    runtimeConfig,
    { preOrderCodAllowed },
  );
  const { shippingPayNow, shippingPayLater } = resolveShippingLegTotals(
    shippingFeeValue,
    shippingCollectionTiming,
  );
  const total = subtotal - discounted.discountAmount + shippingFeeValue;
  let effectiveItems = discounted.items;
  let effectiveShippingCollectionTiming = shippingCollectionTiming;
  let payNowTotal = Math.max(
    0,
    discountedProductPayNowTotal + shippingPayNow,
  );
  let payLaterTotal = Math.max(
    0,
    discountedProductPayLaterTotal + shippingPayLater,
  );
  let payNowMethod = payNowTotal > 0 ? PAYMENT_METHODS.SEPAY : null;
  let payLaterMethod =
    payLaterTotal > 0 && requestedPaymentMethod === PAYMENT_METHODS.SEPAY
      ? PAYMENT_METHODS.SEPAY
      : payLaterTotal > 0
        ? PAYMENT_METHODS.COD
        : null;
  let paymentMethod = payNowMethod || payLaterMethod || requestedPaymentMethod;

  if (requestedPaymentMethod === PAYMENT_METHODS.COD) {
    assertCodRuntimeEnabled(runtimeConfig);

    if (orderType === ORDER_TYPES.PRE_ORDER) {
      if (!preOrderCodAllowed) {
        throw new AppError(
          "COD is not available for this pre-order configuration in V1.",
          400,
        );
      }

      effectiveShippingCollectionTiming = "upfront";
      payNowTotal = Math.max(
        0,
        discountedProductPayNowTotal + shippingFeeValue,
      );
      payLaterTotal = Math.max(0, discountedProductPayLaterTotal);
      if (payNowTotal <= 0) {
        throw new AppError(
          "Pre-order COD requires a positive upfront SePay deposit.",
          400,
        );
      }

      payNowMethod = PAYMENT_METHODS.SEPAY;
      payLaterMethod = payLaterTotal > 0 ? PAYMENT_METHODS.COD : null;
      paymentMethod = PAYMENT_METHODS.SEPAY;
    } else if (orderType === ORDER_TYPES.PRESCRIPTION) {
      throw new AppError(
        "COD is not available for prescription orders in V1.",
        400,
      );
    } else {
      effectiveItems = forceItemsToCod(discounted.items);
      effectiveShippingCollectionTiming = "on_delivery";
      payNowTotal = 0;
      payLaterTotal = Math.max(0, total);
      payNowMethod = null;
      payLaterMethod = payLaterTotal > 0 ? PAYMENT_METHODS.COD : null;
      paymentMethod = PAYMENT_METHODS.COD;
    }
  }

  return {
    items: stripItemShippingMeta(effectiveItems),
    storeId: resolvedStoreId || null,
    subtotal,
    shippingFee: shippingFeeValue,
    shippingMethod: shippingQuote.shippingMethod || normalizedShippingMethod,
    shippingOptions: shippingQuote.shippingOptions,
    shippingSource: shippingQuote.shippingSource,
    shippingPackage: shippingQuote.packageMetrics,
    shippingOrigin: shippingQuote.originStore,
    shippingFeeMode,
    shippingCollectionTiming: effectiveShippingCollectionTiming,
    discountAmount: discounted.discountAmount,
    total,
    orderType,
    allowedPaymentMethods,
    payNow: payNowTotal,
    payLater: payLaterTotal,
    payNowTotal,
    payLaterTotal,
    paymentMethod,
    payNowMethod,
    payLaterMethod,
    voucherCode: appliedVoucherCode,
    promotion,
  };
}

async function createOrder({
  userId,
  itemsInput,
  shippingFee = 0,
  discountAmount = 0,
  shippingMethod = "standard",
  shippingAddress,
  note,
  cartType = null,
  paymentMethod = PAYMENT_METHODS.SEPAY,
  voucherCode = null,
  storeId = null,
}) {
  if (!userId) {
    throw new AppError("Unauthorized", 401);
  }

  const user = await User.findById(userId).select("_id addresses role storeAccess");
  if (!user) {
    throw new AppError("User not found", 404);
  }

  const resolvedShippingAddress = ensureShippingAddress(
    shippingAddress || pickDefaultAddressFromUser(user),
  );

  const quoteResult = await quote(itemsInput, shippingFee, discountAmount, {
    cartType,
    paymentMethod,
    voucherCode,
    shippingMethod,
    shippingAddress: resolvedShippingAddress,
    storeId,
    currentUser: user,
  });
  const selectedPaymentMethod = normalizeCheckoutPaymentMethod(
    quoteResult.paymentMethod,
    PAYMENT_METHODS.SEPAY,
  );
  const paymentCode = generatePaymentCode();
  const orderType = quoteResult.orderType || inferOrderType(quoteResult.items);
  const paidAt =
    selectedPaymentMethod === PAYMENT_METHODS.COD || quoteResult.payNowTotal > 0
      ? null
      : new Date();
  const confirmationDeadlineHours = 12;
  const editWindowEndsAt = paidAt
    ? addHours(paidAt, confirmationDeadlineHours)
    : null;
  const paymentExpiresAt = resolveOrderPaymentExpiresAt(
    {
      paymentMethod: selectedPaymentMethod,
      payNowTotal: quoteResult.payNowTotal,
      paidAmount: 0,
    },
    {
      preserveExisting: false,
      referenceTime: new Date(),
    },
  );

  const order = await Order.create({
    userId,
    storeId: quoteResult.storeId || null,
    items: quoteResult.items,
    subtotal: quoteResult.subtotal,
    shippingFee: quoteResult.shippingFee,
    discountAmount: quoteResult.discountAmount,
    total: quoteResult.total,
    payNowTotal: quoteResult.payNowTotal,
    payLaterTotal: quoteResult.payLaterTotal,
    payLaterMethod: quoteResult.payLaterMethod || null,
    paymentMethod: selectedPaymentMethod,
    paymentStatus:
      selectedPaymentMethod === PAYMENT_METHODS.COD
        ? "pending"
        : quoteResult.payNowTotal > 0
          ? "pending"
          : "paid",
    paidAmount:
      selectedPaymentMethod === PAYMENT_METHODS.COD
        ? 0
        : quoteResult.payNowTotal > 0
          ? 0
          : quoteResult.payNowTotal,
    paymentExpiresAt: paymentExpiresAt || undefined,
    paidAt: paidAt || undefined,
    editWindowEndsAt: editWindowEndsAt || undefined,
    confirmationDeadlineHours,
    shippingMethod: quoteResult.shippingMethod || shippingMethod,
    shippingCollectionTiming: quoteResult.shippingCollectionTiming || "upfront",
    shippingFeeMode: quoteResult.shippingFeeMode || "estimated",
    shippingAddress: resolvedShippingAddress,
    voucherCode: quoteResult.voucherCode || undefined,
    promotionApplied: buildOrderPromotionSnapshot(quoteResult),
    note,
    paymentCode,
    orderType,
    opsStage: ORDER_OPS_STAGE.NONE,
    opsStageUpdatedAt: new Date(),
  });

  let inventoryCommitted = false;
  try {
    inventoryCommitted = await commitOrderInventory(order, userId);
    if (inventoryCommitted) {
      await order.save();
    }

    const invoice = await createInvoiceFromOrder(order);
    order.invoiceId = invoice._id;
    await order.save();
    await promotionRedemptionService.syncOrderPromotionRedemption(order);
    return { order, quote: quoteResult, invoice };
  } catch (error) {
    if (inventoryCommitted) {
      await restoreOrderInventory(order, userId);
    }
    await promotionRedemptionService
      .releasePromotionRedemptionsForOrder(order._id, {
        releaseReason: "order_create_failed",
        orderStatus: order?.status,
        paymentStatus: order?.paymentStatus,
        paymentMethod: order?.paymentMethod,
      })
      .catch(() => null);
    await Order.findByIdAndDelete(order._id);
    throw error;
  }
}

async function markPaidBySepay(paymentCode, amount, transactionId, webhookId) {
  const normalizedAmount = Number(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new AppError("Invalid payment amount", 400);
  }

  const order = await Order.findOne({ paymentCode });
  if (!order) throw new AppError("Order not found", 404);

  if (
    webhookId &&
    Array.isArray(order.sepayWebhookIds) &&
    order.sepayWebhookIds.includes(String(webhookId))
  ) {
    await promotionRedemptionService.syncOrderPromotionRedemption(order);
    return Order.findById(order._id).populate(ORDER_POPULATE);
  }

  if (transactionId && order.sepayTransactionId === transactionId) {
    await promotionRedemptionService.syncOrderPromotionRedemption(order);
    return Order.findById(order._id).populate(ORDER_POPULATE);
  }

  if (toTrimmedString(order.status, "").toLowerCase() === ORDER_STATUS.CANCELLED) {
    return applyLateSepayPaymentToCancelledOrder(
      order,
      normalizedAmount,
      transactionId,
      webhookId,
      order.paymentExpiresAt
        ? ORDER_PAYMENT_TIMEOUT_LATE_PAYMENT_REASON
        : ORDER_CANCELLED_LATE_PAYMENT_REASON,
    );
  }

  if (isOrderPaymentExpired(order)) {
    applyIncomingSepayPayment(order, normalizedAmount, transactionId, webhookId);
    const invoice = await ensureOrderInvoice(order);
    syncInvoiceByOrderState(invoice, order, transactionId);
    await Promise.all([order.save(), invoice.save()]);

    return cancelOrder(
      order._id,
      getOrderTimeoutCustomerContext(order),
      {
        reason: ORDER_PAYMENT_TIMEOUT_LATE_PAYMENT_REASON,
      },
      {
        preservePaymentExpiry: true,
      },
    );
  }

  applyIncomingSepayPayment(order, normalizedAmount, transactionId, webhookId);

  const invoice = await ensureOrderInvoice(order);
  syncInvoiceByOrderState(invoice, order, transactionId);

  await Promise.all([order.save(), invoice.save()]);
  await promotionRedemptionService.syncOrderPromotionRedemption(order);
  return Order.findById(order._id).populate(ORDER_POPULATE);
}

async function getOrderById(id, currentUser) {
  const order = await Order.findById(id).populate(ORDER_POPULATE);
  if (!order) throw new AppError("Order not found", 404);

  const isOwner =
    currentUser && String(order.userId) === String(currentUser.id);
  if (!isOwner && !isStaff(currentUser)) {
    throw new AppError("Forbidden", 403);
  }

  if (!isOwner) {
    assertBusinessUserCanAccessOrder(order, currentUser);
  }

  return expireOrderForPaymentTimeout(order);
}

async function updateOrderItems(id, currentUser, payload = {}) {
  let order = await Order.findById(id);
  if (!order) throw new AppError("Order not found", 404);

  const userId = getUserId(currentUser);
  const isOwner = currentUser && String(order.userId) === String(userId);
  const staff = isStaff(currentUser);
  if (!isOwner && !staff) {
    throw new AppError("Forbidden", 403);
  }

  if (!isOwner) {
    assertBusinessUserCanAccessOrder(order, currentUser);
  }

  if (isOrderPaymentExpired(order)) {
    await expireOrderForPaymentTimeout(order);
    order = await Order.findById(id);
  }

  if (!staff) {
    assertCustomerCanEditOrder(order);
  }

  if (hasCommittedInventory(order)) {
    throw new AppError(
      "Order items cannot be edited after inventory has been committed",
      400,
    );
  }

  const itemsInput = Array.isArray(payload.items) ? payload.items : [];
  if (itemsInput.length === 0) {
    throw new AppError("items is required", 400);
  }

  const shippingFee =
    payload.shippingFee ?? payload.shipping_fee ?? order.shippingFee ?? 0;
  const discountAmount =
    payload.discountAmount ??
    payload.discount_amount ??
    order.discountAmount ??
    0;
  const voucherCode = normalizeVoucherCode(
    payload.voucherCode ?? payload.voucher_code ?? order.voucherCode ?? null,
  );
  const nextShippingMethod =
    payload.shippingMethod ||
    payload.shipping_method ||
    order.shippingMethod ||
    "standard";
  const nextShippingAddress =
    payload.shippingAddress ||
    payload.shipping_address ||
    order.shippingAddress ||
    null;
  const cartType =
    order.orderType === ORDER_TYPES.PRE_ORDER
      ? CART_TYPES.PRE_ORDER
      : CART_TYPES.READY_STOCK;
  const quoteResult = await quote(itemsInput, shippingFee, discountAmount, {
    cartType,
    paymentMethod: getRequestedCheckoutPaymentMethodForOrder(order),
    voucherCode,
    shippingMethod: nextShippingMethod,
    shippingAddress: nextShippingAddress,
    orderId: order._id,
    existingOrderItems: order.items,
    storeId: order.storeId || null,
    currentUser,
  });
  const nextOrderType = inferOrderType(quoteResult.items);
  const resolvedNextOrderType = quoteResult.orderType || nextOrderType;
  if (resolvedNextOrderType !== order.orderType) {
    throw new AppError(
      "Order type mismatch. Pre-order and ready-stock items must stay separated",
      400,
    );
  }

  applyQuoteResultToOrder(order, quoteResult);
  if (payload.shippingMethod || payload.shipping_method) {
    order.shippingMethod = quoteResult.shippingMethod || nextShippingMethod;
  }
  if (payload.shippingAddress || payload.shipping_address) {
    order.shippingAddress = ensureShippingAddress(
      payload.shippingAddress || payload.shipping_address,
    );
  }
  if (payload.note !== undefined) {
    order.note = toTrimmedString(payload.note, "");
  }

  const paidAmount = Number(order.paidAmount || 0);
  if (paidAmount <= 0) {
    order.paymentStatus =
      normalizeCheckoutPaymentMethod(order.paymentMethod) === PAYMENT_METHODS.COD
        ? "pending"
        : quoteResult.payNowTotal > 0
          ? "pending"
          : "paid";
    if (order.paymentStatus === "paid" && !order.paidAt) {
      order.paidAt = new Date();
      order.editWindowEndsAt = addHours(
        order.paidAt,
        Number(order.confirmationDeadlineHours || 12),
      );
    } else if (order.paymentStatus === "pending") {
      order.paidAt = undefined;
      order.editWindowEndsAt = undefined;
    }
  } else {
    if (paidAmount >= Number(order.payNowTotal || 0)) {
      order.paymentStatus = "paid";
      if (!order.paidAt) {
        order.paidAt = new Date();
      }
      if (!order.editWindowEndsAt) {
        order.editWindowEndsAt = addHours(
          order.paidAt,
          Number(order.confirmationDeadlineHours || 12),
        );
      }

      const refundableAmount = Math.max(
        0,
        paidAmount - Number(order.payNowTotal || 0),
      );
      if (refundableAmount > 0) {
        const owner = await User.findById(order.userId).select("refundAccount");
        const account = normalizeRefundBankAccount(owner?.refundAccount);
        const previousRefundStatus = order.refund?.status || "none";
        order.refund = buildRefundRequestState(
          order,
          currentUser,
          {
            reason:
              "Order updated after payment - overpaid amount requires refund",
          },
          {
            defaultAmount: refundableAmount,
            requestedBreakdown: buildRefundBreakdown({
              itemAmount: refundableAmount,
              shippingFeeAmount: 0,
              returnShippingFeeAmount: 0,
            }),
            bankAccount: account || order.refund?.bankAccount || undefined,
            responsibility: "system",
          },
        );
        appendRefundHistory(
          order,
          buildRefundHistoryEntry({
            action: "create_request",
            fromStatus: previousRefundStatus,
            toStatus: order.refund?.status || "requested",
            currentUser,
            note: "Auto-created refund request for overpaid amount.",
            meta: {
              amount: refundableAmount,
              source: "order_update_overpaid",
            },
          }),
        );
      }
    } else {
      order.paymentStatus = "partial";
    }
  }
  syncOrderPaymentExpiry(order, { preserveExisting: true });

  if (!staff) {
    order.lastCustomerEditAt = new Date();
    order.customerEditCount = Number(order.customerEditCount || 0) + 1;
  }

  const invoice = await ensureOrderInvoice(order);
  syncInvoiceByOrderState(invoice, order);

  await Promise.all([order.save(), invoice.save()]);
  await promotionRedemptionService.syncOrderPromotionRedemption(order, {
    releaseReason: "order_updated",
  });
  return Order.findById(order._id).populate(ORDER_POPULATE);
}

async function patchOrderItem(id, itemId, currentUser, payload = {}) {
  let order = await Order.findById(id);
  if (!order) throw new AppError("Order not found", 404);

  const userId = getUserId(currentUser);
  const isOwner = currentUser && String(order.userId) === String(userId);
  const staff = isStaff(currentUser);
  if (!isOwner && !staff) {
    throw new AppError("Forbidden", 403);
  }

  if (!isOwner) {
    assertBusinessUserCanAccessOrder(order, currentUser);
  }

  if (isOrderPaymentExpired(order)) {
    await expireOrderForPaymentTimeout(order);
    order = await Order.findById(id);
  }

  if (!staff) {
    assertCustomerCanEditOrder(order);
  }

  if (hasCommittedInventory(order)) {
    throw new AppError(
      "Order items cannot be edited after inventory has been committed",
      400,
    );
  }

  const existingItems = mapOrderItemsToInput(order.items);
  const targetIndex = (Array.isArray(order.items) ? order.items : []).findIndex(
    (item) => String(item?._id) === String(itemId),
  );

  if (targetIndex < 0) {
    throw new AppError("Order item not found", 404);
  }

  const currentItem = existingItems[targetIndex];
  const nextItem = {
    ...currentItem,
  };

  const nextProductId = payload.productId || payload.product_id;
  if (nextProductId) {
    nextItem.productId = nextProductId;
  }

  if (payload.variantId !== undefined || payload.variant_id !== undefined) {
    nextItem.variantId = payload.variantId ?? payload.variant_id ?? null;
  }

  if (payload.quantity !== undefined) {
    nextItem.quantity = payload.quantity;
  }

  if (payload.customization !== undefined) {
    if (payload.customization && typeof payload.customization === "object") {
      nextItem.customization = mergeCustomization(
        currentItem.customization || {},
        payload.customization,
      );
    } else {
      nextItem.customization = currentItem.customization || {};
    }
  }

  if (payload.note !== undefined) {
    nextItem.customization = {
      ...(nextItem.customization || {}),
      note: toTrimmedString(payload.note, ""),
    };
  }

  existingItems[targetIndex] = nextItem;

  const shippingFee = order.shippingFee ?? 0;
  const discountAmount = order.discountAmount ?? 0;
  const voucherCode = normalizeVoucherCode(order.voucherCode || null);
  const cartType =
    order.orderType === ORDER_TYPES.PRE_ORDER
      ? CART_TYPES.PRE_ORDER
      : CART_TYPES.READY_STOCK;

  const quoteResult = await quote(existingItems, shippingFee, discountAmount, {
    cartType,
    paymentMethod: getRequestedCheckoutPaymentMethodForOrder(order),
    voucherCode,
    shippingMethod: order.shippingMethod || "standard",
    shippingAddress: order.shippingAddress || null,
    orderId: order._id,
    existingOrderItems: order.items,
    storeId: order.storeId || null,
    currentUser,
  });

  const nextOrderType = inferOrderType(quoteResult.items);
  const resolvedNextOrderType = quoteResult.orderType || nextOrderType;
  if (resolvedNextOrderType !== order.orderType) {
    throw new AppError(
      "Order type mismatch. Pre-order and ready-stock items must stay separated",
      400,
    );
  }

  applyQuoteResultToOrder(order, quoteResult);

  const paidAmount = Number(order.paidAmount || 0);
  if (paidAmount <= 0) {
    order.paymentStatus =
      normalizeCheckoutPaymentMethod(order.paymentMethod) === PAYMENT_METHODS.COD
        ? "pending"
        : quoteResult.payNowTotal > 0
          ? "pending"
          : "paid";
    if (order.paymentStatus === "paid" && !order.paidAt) {
      order.paidAt = new Date();
      order.editWindowEndsAt = addHours(
        order.paidAt,
        Number(order.confirmationDeadlineHours || 12),
      );
    } else if (order.paymentStatus === "pending") {
      order.paidAt = undefined;
      order.editWindowEndsAt = undefined;
    }
  } else if (paidAmount >= Number(order.payNowTotal || 0)) {
    order.paymentStatus = "paid";
    if (!order.paidAt) {
      order.paidAt = new Date();
    }
    if (!order.editWindowEndsAt) {
      order.editWindowEndsAt = addHours(
        order.paidAt,
        Number(order.confirmationDeadlineHours || 12),
      );
    }
  } else {
    order.paymentStatus = "partial";
  }
  syncOrderPaymentExpiry(order, { preserveExisting: true });

  if (!staff) {
    order.lastCustomerEditAt = new Date();
    order.customerEditCount = Number(order.customerEditCount || 0) + 1;
  }

  const invoice = await ensureOrderInvoice(order);
  syncInvoiceByOrderState(invoice, order);

  await Promise.all([order.save(), invoice.save()]);
  await promotionRedemptionService.syncOrderPromotionRedemption(order, {
    releaseReason: "order_updated",
  });

  const updatedOrder = await Order.findById(order._id).populate(ORDER_POPULATE);
  const updatedItems = Array.isArray(updatedOrder?.items)
    ? updatedOrder.items
    : [];
  const updatedItem = updatedItems[targetIndex] || null;

  return {
    order: updatedOrder,
    updatedItem,
    updatedItemIndex: targetIndex,
  };
}

function buildRefundRequestState(order, currentUser, payload = {}, defaults = {}) {
  const userId = getUserId(currentUser) || order.userId;
  const reason =
    toTrimmedString(payload.reasonDetail || payload.reason, "") ||
    toTrimmedString(defaults.reason, "");
  if (!reason) {
    throw new AppError("reason is required", 400);
  }

  const requestedBreakdown =
    defaults.requestedBreakdown ||
    resolveRequestedRefundBreakdown(
      order,
      payload,
      defaults.defaultAmount ?? Number(order.paidAmount || 0),
    );
  assertRefundBreakdownAmountBounds(order, requestedBreakdown, "requestedBreakdown");
  const responsibility =
    normalizeRefundResponsibility(payload.responsibility) ??
    normalizeRefundResponsibility(defaults.responsibility) ??
    (Number(requestedBreakdown.shippingFeeAmount || 0) > 0 ? "mixed" : undefined);
  assertRefundBreakdownEligibility(responsibility, requestedBreakdown);

  const requestedByUserId = userId || order.userId;
  const channels = normalizeContactChannels(
    payload.contactChannels ||
      payload.contact_channels ||
      defaults.contactChannels ||
      [],
  );
  const bankAccount = normalizeRefundBankAccount(
    payload.bankAccount || payload.bank_account || defaults.bankAccount,
  );
  const evidence =
    normalizeUrlList(payload.evidence, "evidence") ??
    normalizeUrlList(defaults.evidence, "defaults.evidence") ??
    (Array.isArray(order?.refund?.evidence) ? [...order.refund.evidence] : []);
  const requiresReturn =
    normalizeOptionalBoolean(payload.requiresReturn, "requiresReturn") ??
    normalizeOptionalBoolean(payload.requires_return, "requires_return") ??
    defaults.requiresReturn ??
    false;
  const routing = getRefundRoutingState("requested", {
    ...order,
    refund: { ...(order.refund || {}), requiresReturn },
  });

  return {
    ...(order.refund || {}),
    status: "requested",
    reason,
    requestedAt: new Date(),
    requestedBy: requestedByUserId,
    amount: requestedBreakdown.total,
    responsibility,
    requiresReturn,
    requestedBreakdown,
    approvedBreakdown: buildRefundBreakdown(),
    bankAccount: bankAccount || undefined,
    contactChannels: channels.length > 0 ? channels : ["email"],
    contactNote: toTrimmedString(payload.note || defaults.note, ""),
    contactAt: undefined,
    currentOwnerRole: routing.currentOwnerRole,
    currentOwnerUserId: routing.currentOwnerUserId,
    nextActionCode: routing.nextActionCode,
    approvedAt: undefined,
    approvedBy: undefined,
    escalatedAt: undefined,
    escalatedBy: undefined,
    escalateReason: "",
    decisionNote: "",
    inspectionStatus: requiresReturn ? "pending" : "not_required",
    inspectionNote: "",
    inspectionAt: undefined,
    inspectedBy: undefined,
    returnShipmentCode: "",
    returnCarrier: "",
    returnReceivedAt: undefined,
    processedAt: undefined,
    processedBy: undefined,
    transactionRef: "",
    payoutProofUrl: "",
    evidence,
    rejectReason: "",
    history: Array.isArray(order?.refund?.history) ? [...order.refund.history] : [],
  };
}

async function notifyCustomerRefundUpdate(order, title, message, refundStatus) {
  if (!order?.userId) return;

  await appendUserNotification(order.userId, {
    type: "refund",
    title,
    message,
    data: {
      orderId: order._id,
      orderCode: order.paymentCode || String(order._id),
      refundStatus: refundStatus || order?.refund?.status || "none",
      currentOwnerRole: order?.refund?.currentOwnerRole || "none",
      nextActionCode: order?.refund?.nextActionCode || "",
      requiresReturn: Boolean(order?.refund?.requiresReturn),
    },
  });
}

async function createRefundRequest(id, currentUser, payload = {}) {
  const order = await Order.findById(id);
  if (!order) throw new AppError("Order not found", 404);
  const runtimeConfig = await getEffectiveSystemConfig();
  assertRefundWorkflowRuntimeEnabled(runtimeConfig);

  const userId = getUserId(currentUser);
  const owner = currentUser && String(order.userId) === String(userId);
  const businessUser = isStaff(currentUser);
  if (!owner && !businessUser) {
    throw new AppError("Forbidden", 403);
  }

  if (!owner) {
    assertBusinessUserCanAccessOrder(order, currentUser);
  }

  if (
    order.refund &&
    order.refund.status &&
    !["none", "completed", "rejected"].includes(order.refund.status)
  ) {
    throw new AppError("This order already has an active refund request", 400);
  }

  const paidAmount = Number(order.paidAmount || 0);
  if (paidAmount <= 0) {
    throw new AppError("This order has no refundable paid amount", 400);
  }

  if (
    owner &&
    ![
      ORDER_STATUS.PENDING,
      ORDER_STATUS.CONFIRMED,
      ORDER_STATUS.PROCESSING,
      ORDER_STATUS.CANCELLED,
      ORDER_STATUS.DELIVERED,
      ORDER_STATUS.RETURNED,
    ].includes(order.status)
  ) {
    throw new AppError(
      "Refund request is only available for paid pending, confirmed, processing, cancelled, delivered, or returned orders",
      400,
    );
  }

  const requestedBankAccount = normalizeRefundBankAccount(
    payload.bankAccount || payload.bank_account,
    {
      required: true,
      fieldName: "bankAccount",
    },
  );
  const baseBreakdown = splitPaidAmountIntoRefundBreakdown(order, paidAmount, true);

  const previousRefundStatus = order.refund?.status || "none";

  order.refund = buildRefundRequestState(order, currentUser, payload, {
    requestedBreakdown: baseBreakdown,
    bankAccount: requestedBankAccount,
    note: payload.note,
    requiresReturn: false,
  });
  appendRefundHistory(
    order,
    buildRefundHistoryEntry({
      action: "create_request",
      fromStatus: previousRefundStatus,
      toStatus: order.refund?.status || "requested",
      currentUser,
      note: toTrimmedString(payload.note || payload.reason, ""),
      meta: {
        amount: Number(order.refund?.amount || 0),
        reason: order.refund?.reason || "",
        source: owner ? "customer" : "staff",
      },
      isOwner: owner,
    }),
  );
  await order.save();

  publishStatusChange({
    domain: "order",
    entityId: order._id,
    statusField: "refund.status",
    previousStatus: previousRefundStatus,
    nextStatus: order.refund?.status || "none",
    currentUser,
    recipientUserIds: [order.userId],
    meta: {
      paymentCode: order.paymentCode,
      amount: Number(order.refund?.amount || 0),
    },
  });

  await notifyCustomerRefundUpdate(
    order,
    "Yeu cau hoan tien da duoc tao",
    `Don #${order._id} da tao yeu cau hoan tien`,
    order.refund?.status || "none",
  );

  return Order.findById(order._id).populate(ORDER_POPULATE);
}

async function cancelOrder(id, currentUser, payload = {}, options = {}) {
  const order = await Order.findById(id);
  if (!order) throw new AppError("Order not found", 404);

  const userId = getUserId(currentUser);
  const previousOrderStatus = order.status;
  const previousOpsStage = order.opsStage;
  const previousPaymentStatus = order.paymentStatus;
  const previousRefundStatus = order.refund?.status || "none";
  const owner = currentUser && String(order.userId) === String(userId);
  const staff = isStaff(currentUser);
  if (!owner && !staff) {
    throw new AppError("Forbidden", 403);
  }

  if (!owner) {
    assertBusinessUserCanAccessOrder(order, currentUser);
  }

  if (order.status === ORDER_STATUS.CANCELLED) {
    throw new AppError("Order already cancelled", 400);
  }

  if (
    [
      ORDER_STATUS.SHIPPED,
      ORDER_STATUS.DELIVERED,
      ORDER_STATUS.RETURNED,
    ].includes(order.status)
  ) {
    throw new AppError("Order cannot be cancelled at this stage", 400);
  }

  order.status = ORDER_STATUS.CANCELLED;
  syncOrderWithOpsStage(order, ORDER_OPS_STAGE.CANCELLED);
  if (options.preservePaymentExpiry !== true) {
    order.paymentExpiresAt = undefined;
  }
  await restoreOrderInventory(order, userId);

  const paidAmount = Number(order.paidAmount || 0);
  const paidReceived = paidAmount > 0;
  const invoice = await ensureOrderInvoice(order);
  const previousInvoiceStatus = invoice.status;
  const explicitCancelResponsibility = normalizeRefundResponsibility(
    payload.responsibility,
  );

  if (paidReceived) {
    const runtimeConfig = await getEffectiveSystemConfig();
    assertRefundWorkflowRuntimeEnabled(runtimeConfig);
    const previousRefundStatus = order.refund?.status || "none";
    const reason =
      toTrimmedString(payload.reason, "") || "Order cancelled by customer";
    const channels = normalizeContactChannels(
      payload.contactChannels || payload.contact_channels || ["email"],
    );
    const ownerUser = await User.findById(order.userId).select("refundAccount");
    const fromPayload = normalizeRefundBankAccount(
      payload.bankAccount || payload.bank_account,
    );
    const bankAccount =
      fromPayload ||
      normalizeRefundBankAccount(ownerUser?.refundAccount) ||
      normalizeRefundBankAccount(order.refund?.bankAccount);
    const autoRefundResponsibility =
      explicitCancelResponsibility || (owner ? "customer" : undefined);
    const includeShippingFeeInAutoRefund =
      autoRefundResponsibility === undefined
        ? !owner
        : ["system", "carrier", "mixed"].includes(autoRefundResponsibility);
    order.refund = buildRefundRequestState(
      order,
      currentUser,
      {
        reason,
      },
      {
        requestedBreakdown: splitPaidAmountIntoRefundBreakdown(
          order,
          paidAmount,
          includeShippingFeeInAutoRefund,
        ),
        bankAccount: bankAccount || undefined,
        contactChannels: channels.length > 0 ? channels : ["email"],
        responsibility: autoRefundResponsibility,
        requiresReturn: false,
      },
    );
    appendRefundHistory(
      order,
      buildRefundHistoryEntry({
        action: "create_request",
        fromStatus: previousRefundStatus,
        toStatus: order.refund?.status || "requested",
        currentUser,
        note: reason,
        meta: {
          amount: Number(order.refund?.amount || 0),
          source: "cancel_order",
        },
      }),
    );
  } else {
    order.paymentStatus = "failed";
    invoice.status = "void";
    invoice.amountDue = 0;
  }

  syncInvoiceByOrderState(invoice, order);
  await Promise.all([order.save(), invoice.save()]);
  await promotionRedemptionService.syncOrderPromotionRedemption(order, {
    releaseReason: "order_cancelled",
    responsibility: explicitCancelResponsibility,
    responsibilityExplicit: explicitCancelResponsibility !== undefined,
  });

  publishStatusChange({
    domain: "order",
    entityId: order._id,
    previousStatus: previousOrderStatus,
    nextStatus: order.status,
    currentUser,
    recipientUserIds: [order.userId],
    meta: {
      paymentCode: order.paymentCode,
      orderType: order.orderType,
    },
  });
  publishOpsStageChange(order, previousOpsStage, currentUser);
  publishStatusChange({
    domain: "order",
    entityId: order._id,
    statusField: "paymentStatus",
    previousStatus: previousPaymentStatus,
    nextStatus: order.paymentStatus,
    currentUser,
    recipientUserIds: [order.userId],
    meta: {
      paymentCode: order.paymentCode,
      orderType: order.orderType,
    },
  });
  publishStatusChange({
    domain: "order",
    entityId: order._id,
    statusField: "refund.status",
    previousStatus: previousRefundStatus,
    nextStatus: order.refund?.status || "none",
    currentUser,
    recipientUserIds: [order.userId],
    meta: {
      paymentCode: order.paymentCode,
      amount: Number(order.refund?.amount || 0),
    },
  });
  publishStatusChange({
    domain: "invoice",
    entityId: invoice._id,
    previousStatus: previousInvoiceStatus,
    nextStatus: invoice.status,
    currentUser,
    recipientUserIds: [order.userId],
    meta: {
      orderId: order._id,
      invoiceCode: invoice.invoiceCode,
    },
  });

  await notifyCustomerOrderStatusChange(order, previousOrderStatus);
  await notifyCustomerOpsStageChange(order, previousOpsStage);

  return Order.findById(order._id).populate(ORDER_POPULATE);
}

async function updateRefundStatus(id, currentUser, payload = {}) {
  const order = await Order.findById(id);
  if (!order) throw new AppError("Order not found", 404);
  const runtimeConfig = await getEffectiveSystemConfig();
  assertRefundWorkflowRuntimeEnabled(runtimeConfig);
  const actorUserId = getUserId(currentUser);
  const isOwner =
    currentUser && String(order.userId) === String(actorUserId);
  const previousRefundStatus = order.refund?.status || "none";
  const previousPaymentStatus = order.paymentStatus;
  const previousOpsStage = order.opsStage;

  if (!order.refund || !order.refund.status || order.refund.status === "none") {
    throw new AppError("This order has no active refund request", 400);
  }

  const requestedAction =
    normalizeRefundAction(payload.action) ||
    mapLegacyRefundStatusToAction(
      currentUser,
      normalizeRefundStatus(payload.status),
    );
  if (!requestedAction) {
    throw new AppError("Invalid refund action", 400);
  }

  if (
    !isStaff(currentUser) &&
    !(isOwner && requestedAction === REFUND_ACTIONS.CUSTOMER_SUBMIT_INFO)
  ) {
    throw new AppError("Forbidden", 403);
  }

  if (!isOwner) {
    assertBusinessUserCanAccessOrder(order, currentUser);
  }

  assertRefundActionPermission(currentUser, requestedAction, { isOwner });
  assertRefundActionTransition(
    previousRefundStatus,
    requestedAction,
    Boolean(order.refund?.requiresReturn),
  );

  const nextStatus = getRefundActionTargetStatus(requestedAction);
  const decisionNote = toTrimmedString(
    payload.decisionNote || payload.decision_note || payload.note,
    "",
  );
  const inspectionNote = toTrimmedString(
    payload.inspectionNote ||
      payload.inspection_note ||
      payload.returnInspectionNote ||
      payload.return_inspection_note,
    "",
  );
  const returnShipmentCode = toTrimmedString(
    payload.returnShipmentCode || payload.return_shipment_code,
    "",
  );
  const returnCarrier = toTrimmedString(
    payload.returnCarrier || payload.return_carrier,
    "",
  ).toLowerCase();
  const payoutProofUrl = normalizeOptionalUrl(
    payload.payoutProofUrl || payload.payout_proof_url,
    "payoutProofUrl",
  );
  const responsibility = normalizeRefundResponsibility(payload.responsibility);
  if (responsibility !== undefined) {
    order.refund.responsibility = responsibility;
  }

  const requiresReturn =
    normalizeOptionalBoolean(payload.requiresReturn, "requiresReturn") ??
    normalizeOptionalBoolean(payload.requires_return, "requires_return");
  if (requiresReturn !== undefined) {
    order.refund.requiresReturn = requiresReturn;
    order.refund.inspectionStatus = requiresReturn ? "pending" : "not_required";
    if (!requiresReturn) {
      order.refund.inspectionNote = "";
      order.refund.inspectionAt = undefined;
      order.refund.inspectedBy = undefined;
      order.refund.returnShipmentCode = "";
      order.refund.returnCarrier = "";
      order.refund.returnReceivedAt = undefined;
    }
  }

  if (payload.contactNote !== undefined) {
    order.refund.contactNote = toTrimmedString(payload.contactNote, "");
    order.refund.contactAt = new Date();
  }
  const channels = normalizeContactChannels(
    payload.contactChannels || payload.contact_channels || [],
  );
  if (channels.length > 0) {
    order.refund.contactChannels = channels;
  }

  const workflowSettings =
    requestedAction === REFUND_ACTIONS.APPROVE ||
    requestedAction === REFUND_ACTIONS.COMPLETE
      ? await getRefundWorkflowSettings()
      : DEFAULT_REFUND_WORKFLOW_SETTINGS;
  let historyNote = decisionNote;
  let historyMeta = {
    amount: Number(order.refund?.amount || 0),
  };

  switch (requestedAction) {
    case REFUND_ACTIONS.CUSTOMER_SUBMIT_INFO: {
      const requestedBreakdown = resolveCustomerRequestedRefundBreakdown(
        order,
        payload,
      );
      assertRefundBreakdownAmountBounds(
        order,
        requestedBreakdown,
        "requestedBreakdown",
      );
      const effectiveResponsibility =
        order.refund.responsibility ||
        (Number(requestedBreakdown.shippingFeeAmount || 0) > 0
          ? "mixed"
          : undefined);
      assertRefundBreakdownEligibility(
        effectiveResponsibility,
        requestedBreakdown,
      );

      const nextReason = toTrimmedString(
        payload.reasonDetail || payload.reason,
        order.refund.reason || "",
      );
      const bankAccount = normalizeRefundBankAccount(
        payload.bankAccount || payload.bank_account,
        {
          required: true,
          fieldName: "bankAccount",
        },
      );
      const evidence = normalizeUrlList(payload.evidence, "evidence");
      const customerNote = toTrimmedString(
        payload.contactNote || payload.note || payload.decisionNote,
        "",
      );

      if (nextReason) {
        order.refund.reason = nextReason;
      }
      order.refund.requestedBreakdown = requestedBreakdown;
      order.refund.amount = requestedBreakdown.total;
      if (effectiveResponsibility !== undefined) {
        order.refund.responsibility = effectiveResponsibility;
      }
      if (bankAccount) {
        order.refund.bankAccount = bankAccount;
      }
      if (evidence !== undefined) {
        order.refund.evidence = evidence;
      }
      if (customerNote) {
        const previousContactNote = toTrimmedString(order.refund.contactNote, "");
        order.refund.contactNote = previousContactNote
          ? `${previousContactNote}\n\nCustomer update: ${customerNote}`
          : customerNote;
        order.refund.contactAt = new Date();
      }
      order.refund.rejectReason = "";
      order.refund.inspectionStatus = order.refund.requiresReturn
        ? "pending"
        : "not_required";
      historyNote = customerNote || nextReason;
      historyMeta = {
        amount: requestedBreakdown.total,
        requestedBreakdown,
      };
      break;
    }
    case REFUND_ACTIONS.REQUEST_CUSTOMER_INFO:
      if (decisionNote) {
        order.refund.contactNote = decisionNote;
        order.refund.contactAt = new Date();
      }
      historyNote = decisionNote;
      break;
    case REFUND_ACTIONS.ESCALATE: {
      const escalateReason = toTrimmedString(payload.escalateReason, "") || decisionNote;
      if (!escalateReason) {
        throw new AppError("escalateReason is required when escalating refund", 400);
      }
      order.refund.escalateReason = escalateReason;
      order.refund.escalatedAt = new Date();
      order.refund.escalatedBy = actorUserId;
      order.refund.decisionNote = decisionNote;
      historyNote = escalateReason;
      historyMeta = {
        amount: Number(order.refund?.amount || 0),
        escalateReason,
      };
      break;
    }
    case REFUND_ACTIONS.APPROVE:
    case REFUND_ACTIONS.MANAGER_APPROVE: {
      const approvedBreakdown = resolveApprovedRefundBreakdown(order, payload);
      assertRefundBreakdownAmountBounds(order, approvedBreakdown, "approvedBreakdown");
      assertRefundBreakdownNotAboveRequested(
        order?.refund?.requestedBreakdown,
        approvedBreakdown,
        "approvedBreakdown",
      );
      const effectiveResponsibility =
        responsibility || order.refund.responsibility || "customer";
      assertRefundBreakdownEligibility(
        effectiveResponsibility,
        approvedBreakdown,
      );
      order.refund.responsibility = effectiveResponsibility;
      order.refund.approvedBreakdown = approvedBreakdown;
      order.refund.amount = approvedBreakdown.total;
      if (requestedAction === REFUND_ACTIONS.APPROVE) {
        const managerApprovalReasons = getRefundManagerApprovalReasons(
          order,
          {
            ...order.refund,
            approvedBreakdown,
            requiresReturn: Boolean(order.refund.requiresReturn),
          },
          workflowSettings,
        );
        if (managerApprovalReasons.length > 0) {
          throw new AppError(
            `Manager approval required: ${managerApprovalReasons.join("; ")}`,
            400,
          );
        }
      }
      order.refund.approvedAt = new Date();
      order.refund.approvedBy = actorUserId;
      order.refund.decisionNote = decisionNote;
      order.refund.rejectReason = "";
      order.refund.inspectionStatus = order.refund.requiresReturn
        ? "pending"
        : "not_required";
      historyNote = decisionNote;
      historyMeta = {
        amount: approvedBreakdown.total,
        approvedBreakdown,
        responsibility: effectiveResponsibility,
        requiresReturn: Boolean(order.refund.requiresReturn),
      };
      break;
    }
    case REFUND_ACTIONS.REJECT:
    case REFUND_ACTIONS.MANAGER_REJECT: {
      const rejectReason = toTrimmedString(payload.rejectReason, "");
      if (!rejectReason) {
        throw new AppError(
          "rejectReason is required when refund is rejected",
          400,
        );
      }
      order.refund.rejectReason = rejectReason;
      order.refund.decisionNote = decisionNote;
      historyNote = rejectReason;
      historyMeta = {
        amount: Number(order.refund?.amount || 0),
        rejectReason,
      };
      break;
    }
    case REFUND_ACTIONS.MARK_RETURN_PENDING:
      order.refund.requiresReturn = true;
      order.refund.inspectionStatus = "pending";
      syncOrderWithOpsStage(order, ORDER_OPS_STAGE.RETURN_PENDING);
      historyNote = decisionNote || "Return verification assigned for return inspection.";
      break;
    case REFUND_ACTIONS.CONFIRM_RETURN_RECEIVED:
      order.refund.inspectionStatus = "passed";
      order.refund.inspectionNote = inspectionNote || decisionNote;
      order.refund.inspectionAt = new Date();
      order.refund.inspectedBy = actorUserId;
      order.refund.returnReceivedAt = new Date();
      if (returnShipmentCode) {
        order.refund.returnShipmentCode = returnShipmentCode;
      }
      if (returnCarrier) {
        order.refund.returnCarrier = returnCarrier;
      }
      syncOrderWithOpsStage(order, ORDER_OPS_STAGE.RETURNED);
      await maybeRestoreReadyStockInventory(order, actorUserId);
      historyNote = inspectionNote || decisionNote || "Return item received and passed inspection.";
      historyMeta = {
        amount: Number(order.refund?.amount || 0),
        inspectionStatus: "passed",
        returnShipmentCode: order.refund.returnShipmentCode || "",
        returnCarrier: order.refund.returnCarrier || "",
      };
      break;
    case REFUND_ACTIONS.INSPECTION_FAILED: {
      const failedInspectionNote = inspectionNote || decisionNote;
      if (!failedInspectionNote) {
        throw new AppError(
          "inspectionNote is required when return inspection fails",
          400,
        );
      }
      order.refund.inspectionStatus = "failed";
      order.refund.inspectionNote = failedInspectionNote;
      order.refund.inspectionAt = new Date();
      order.refund.inspectedBy = actorUserId;
      if (returnShipmentCode) {
        order.refund.returnShipmentCode = returnShipmentCode;
      }
      if (returnCarrier) {
        order.refund.returnCarrier = returnCarrier;
      }
      syncOrderWithOpsStage(order, ORDER_OPS_STAGE.EXCEPTION_HOLD);
      historyNote = failedInspectionNote;
      historyMeta = {
        amount: Number(order.refund?.amount || 0),
        inspectionStatus: "failed",
        returnShipmentCode: order.refund.returnShipmentCode || "",
        returnCarrier: order.refund.returnCarrier || "",
      };
      break;
    }
    case REFUND_ACTIONS.START_PROCESSING:
      order.refund.bankAccount = requireRefundPayoutBankAccount(order);
      order.refund.processedBy = actorUserId;
      order.refund.decisionNote = decisionNote;
      historyNote = decisionNote || "Sales started payout processing.";
      break;
    case REFUND_ACTIONS.COMPLETE: {
      order.refund.bankAccount = requireRefundPayoutBankAccount(order);
      const transactionRef = toTrimmedString(payload.transactionRef, "");
      if (!transactionRef) {
        throw new AppError("transactionRef is required when completing payout", 400);
      }
      if (workflowSettings.requirePayoutProof && !payoutProofUrl) {
        throw new AppError("payoutProofUrl is required by payout policy", 400);
      }
      order.refund.processedBy = actorUserId;
      order.refund.processedAt = new Date();
      order.refund.transactionRef = transactionRef;
      if (payoutProofUrl !== undefined) {
        order.refund.payoutProofUrl = payoutProofUrl;
      }
      order.refund.decisionNote = decisionNote;
      if (shouldMarkOrderAsFullyRefunded(order, order.refund)) {
        order.paymentStatus = "refunded";
      }
      historyNote = decisionNote || transactionRef;
      historyMeta = {
        amount: Number(order.refund?.amount || 0),
        transactionRef,
        payoutProofUrl: order.refund.payoutProofUrl || "",
      };
      break;
    }
    case REFUND_ACTIONS.SEND_BACK_TO_STAFF:
      order.refund.decisionNote = decisionNote;
      historyNote = decisionNote || "Manager sent case back to staff.";
      break;
    default:
      break;
  }

  order.refund.status = nextStatus;
  applyRefundRoutingState(order, nextStatus);
  appendRefundHistory(
    order,
    buildRefundHistoryEntry({
      action: requestedAction,
      fromStatus: previousRefundStatus,
      toStatus: nextStatus,
      currentUser,
      note: historyNote,
      meta: historyMeta,
      isOwner,
    }),
  );

  const invoice = await ensureOrderInvoice(order);
  const previousInvoiceStatus = invoice.status;
  syncInvoiceByOrderState(invoice, order);

  await Promise.all([order.save(), invoice.save()]);
  if (requestedAction === REFUND_ACTIONS.COMPLETE) {
    await promotionRedemptionService.syncOrderPromotionRedemption(order, {
      releaseReason: "refund_completed",
      responsibility,
      responsibilityExplicit: responsibility !== undefined,
    });
  }

  publishStatusChange({
    domain: "order",
    entityId: order._id,
    statusField: "refund.status",
    previousStatus: previousRefundStatus,
    nextStatus: order.refund?.status || "none",
    currentUser,
    recipientUserIds: [order.userId],
    meta: {
      paymentCode: order.paymentCode,
      amount: Number(order.refund?.amount || 0),
    },
  });
  publishOpsStageChange(order, previousOpsStage, currentUser);
  publishStatusChange({
    domain: "order",
    entityId: order._id,
    statusField: "paymentStatus",
    previousStatus: previousPaymentStatus,
    nextStatus: order.paymentStatus,
    currentUser,
    recipientUserIds: [order.userId],
    meta: {
      paymentCode: order.paymentCode,
    },
  });
  publishStatusChange({
    domain: "invoice",
    entityId: invoice._id,
    previousStatus: previousInvoiceStatus,
    nextStatus: invoice.status,
    currentUser,
    recipientUserIds: [order.userId],
    meta: {
      orderId: order._id,
      invoiceCode: invoice.invoiceCode,
    },
  });

  await notifyCustomerOpsStageChange(order, previousOpsStage);
  await notifyCustomerRefundUpdate(
    order,
    "Cap nhat hoan tien don hang",
    `Trang thai hoan tien #${order._id} da chuyen sang "${nextStatus}"`,
    nextStatus,
  );

  return Order.findById(order._id).populate(ORDER_POPULATE);
}

async function overrideRefund(id, currentUser, payload = {}) {
  if (!isManager(currentUser)) {
    throw new AppError("Forbidden", 403);
  }
  const runtimeConfig = await getEffectiveSystemConfig();
  assertRefundWorkflowRuntimeEnabled(runtimeConfig);

  const order = await Order.findById(id);
  if (!order) throw new AppError("Order not found", 404);
  assertBusinessUserCanAccessOrder(order, currentUser);
  if (!order.refund || !order.refund.status || order.refund.status === "none") {
    throw new AppError("This order has no active refund request", 400);
  }

  const action = toTrimmedString(payload.action, "").toLowerCase();
  const reason = toTrimmedString(payload.reason, "");
  if (!REFUND_OVERRIDE_ACTIONS.has(action)) {
    throw new AppError("Invalid override action", 400);
  }
  if (!reason) {
    throw new AppError("reason is required for override", 400);
  }

  const previousRefundStatus = order.refund.status || "none";
  const previousOwnerRole = order.refund.currentOwnerRole || "none";
  const previousOpsStage = order.opsStage;
  const invoice = await ensureOrderInvoice(order);
  const previousInvoiceStatus = invoice.status;

  let nextStatus = previousRefundStatus;
  let notifyCustomer = false;

  switch (action) {
    case "reassign_sales":
      if (["completed", "rejected"].includes(previousRefundStatus)) {
        throw new AppError("Closed refunds cannot be reassigned to sales", 400);
      }
      order.refund.currentOwnerRole = "sales";
      order.refund.currentOwnerUserId = null;
      order.refund.nextActionCode = REFUND_ACTIONS.START_REVIEW;
      break;
    case "reassign_manager":
      if (["completed", "rejected"].includes(previousRefundStatus)) {
        throw new AppError("Closed refunds cannot be reassigned to manager", 400);
      }
      order.refund.currentOwnerRole = "manager";
      order.refund.currentOwnerUserId = null;
      order.refund.nextActionCode = REFUND_ACTIONS.MANAGER_APPROVE;
      break;
    case "reassign_operations":
      if (!["return_pending"].includes(previousRefundStatus)) {
        throw new AppError(
          "Operations can only be assigned while waiting for return inspection",
          400,
        );
      }
      order.refund.currentOwnerRole = "operations";
      order.refund.currentOwnerUserId = null;
      order.refund.nextActionCode = getRefundRoutingState(previousRefundStatus, order).nextActionCode;
      break;
    case "reset_reviewing":
      if (previousRefundStatus === "completed") {
        throw new AppError("Completed refund cannot be reset to reviewing", 400);
      }
      nextStatus = "reviewing";
      order.refund.status = nextStatus;
      order.refund.rejectReason = "";
      order.refund.decisionNote = reason;
      applyRefundRoutingState(order, nextStatus);
      break;
    case "retry_customer_notification":
      notifyCustomer = true;
      break;
    default:
      break;
  }

  appendRefundHistory(
    order,
    buildRefundHistoryEntry({
      action: `manager_${action}`,
      fromStatus: previousRefundStatus,
      toStatus: nextStatus,
      currentUser,
      note: reason,
      meta: {
        previousOwnerRole,
        nextOwnerRole: order.refund.currentOwnerRole || "none",
      },
    }),
  );

  syncInvoiceByOrderState(invoice, order);
  await Promise.all([order.save(), invoice.save()]);

  if (nextStatus !== previousRefundStatus) {
    publishStatusChange({
      domain: "order",
      entityId: order._id,
      statusField: "refund.status",
      previousStatus: previousRefundStatus,
      nextStatus,
      currentUser,
      recipientUserIds: [order.userId],
      meta: {
        paymentCode: order.paymentCode,
        overrideAction: action,
      },
    });
    publishOpsStageChange(order, previousOpsStage, currentUser);
    publishStatusChange({
      domain: "invoice",
      entityId: invoice._id,
      previousStatus: previousInvoiceStatus,
      nextStatus: invoice.status,
      currentUser,
      recipientUserIds: [order.userId],
      meta: {
        orderId: order._id,
        invoiceCode: invoice.invoiceCode,
      },
    });
  }

  if (notifyCustomer || nextStatus !== previousRefundStatus) {
    await notifyCustomerRefundUpdate(
      order,
      notifyCustomer ? "Refund update resent" : "Refund override applied",
      notifyCustomer
        ? `Please review the latest refund update for order #${order._id}`
        : `Refund case #${order._id} has been moved to "${order.refund.status}"`,
      order.refund.status || nextStatus,
    );
  }

  return Order.findById(order._id).populate(ORDER_POPULATE);
}

async function updateOrderStatus(id, currentUser, status) {
  if (!isStaff(currentUser)) {
    throw new AppError("Forbidden", 403);
  }

  const normalizedStatus = toTrimmedString(status, "").toLowerCase();
  if (!Object.values(ORDER_STATUS).includes(normalizedStatus)) {
    throw new AppError("Invalid order status", 400);
  }

  assertOrderStatusPermission(currentUser, normalizedStatus);

  let order = await Order.findById(id);
  if (!order) throw new AppError("Order not found", 404);
  assertBusinessUserCanAccessOrder(order, currentUser);
  if (isOrderPaymentExpired(order)) {
    await expireOrderForPaymentTimeout(order);
    order = await Order.findById(id);
  }
  const previousOrderStatus = order.status;
  const previousOpsStage = order.opsStage;

  if (normalizedStatus === ORDER_STATUS.CONFIRMED) {
    assertOrderCanBeConfirmed(order, currentUser);
  }

  order.status = normalizedStatus;
  if (normalizedStatus === ORDER_STATUS.CONFIRMED) {
    order.confirmedAt = new Date();
    order.confirmedBy = getUserId(currentUser);
    syncOrderWithOpsStage(order, getInitialOpsStage(order.orderType));
    const opsExecution = touchOpsExecution(order);
    opsExecution.salesApprovedAt = order.confirmedAt;
    opsExecution.salesApprovedBy = toDisplayName(currentUser, "Sales/Support");
    opsExecution.approvalState = "none";
    opsExecution.managerReviewRequestedAt = undefined;
    opsExecution.managerReviewRequestedBy = "";
    opsExecution.managerReviewReason = "";
  } else {
    syncOpsStageWithOrder(order);
  }

  syncOpsExecutionForStage(order, currentUser, order.opsStage);
  await commitOrderInventory(order, getUserId(currentUser));

  await order.save();
  await promotionRedemptionService.syncOrderPromotionRedemption(order, {
    releaseReason:
      normalizedStatus === ORDER_STATUS.CANCELLED ? "order_cancelled" : "",
  });
  publishStatusChange({
    domain: "order",
    entityId: order._id,
    previousStatus: previousOrderStatus,
    nextStatus: order.status,
    currentUser,
    recipientUserIds: [order.userId],
    meta: {
      paymentCode: order.paymentCode,
      orderType: order.orderType,
    },
  });
  publishOpsStageChange(order, previousOpsStage, currentUser);
  await notifyCustomerOrderStatusChange(order, previousOrderStatus);
  await notifyCustomerOpsStageChange(order, previousOpsStage);
  return Order.findById(order._id).populate(ORDER_POPULATE);
}

async function updateOrderOpsStage(id, currentUser, stage) {
  if (!isOperation(currentUser)) {
    throw new AppError("Forbidden", 403);
  }

  const normalizedStage = normalizeOpsStage(stage, "");
  if (!normalizedStage || normalizedStage === ORDER_OPS_STAGE.CANCELLED) {
    throw new AppError("Invalid ops stage", 400);
  }

  const order = await Order.findById(id);
  if (!order) throw new AppError("Order not found", 404);
  assertBusinessUserCanAccessOrder(order, currentUser);

  if (order.status === ORDER_STATUS.PENDING) {
    throw new AppError("Order must be confirmed before updating ops stage", 400);
  }

  if (!isOpsStageAllowedForOrderType(order.orderType, normalizedStage)) {
    throw new AppError("Ops stage is not valid for this order type", 400);
  }

  if (
    SHIPMENT_BOUND_OPS_STAGES.has(normalizedStage) &&
    !String(order?.shipment?.orderCode || "").trim()
  ) {
    throw new AppError(
      "Shipment must exist before using shipment-bound ops stages",
      400,
    );
  }

  const previousOrderStatus = order.status;
  let previousOpsStage = order.opsStage;
  let currentStage = normalizeOpsStage(previousOpsStage);

  if (currentStage === ORDER_OPS_STAGE.NONE && order.status !== ORDER_STATUS.PENDING) {
    syncOpsStageWithOrder(order);
    currentStage = normalizeOpsStage(order.opsStage);
  }

  if (!canTransitionOpsStage(order.orderType, currentStage, normalizedStage)) {
    throw new AppError(
      `Cannot move ops stage from ${currentStage} to ${normalizedStage}`,
      400,
    );
  }

  syncOrderWithOpsStage(order, normalizedStage);
  syncOpsExecutionForStage(order, currentUser, normalizedStage);

  if (
    normalizedStage === ORDER_OPS_STAGE.CLOSED &&
    currentStage === ORDER_OPS_STAGE.RETURNED
  ) {
    await maybeRestoreReadyStockInventory(order, getUserId(currentUser));
  }

  if (!order.confirmedAt && order.status !== ORDER_STATUS.PENDING) {
    order.confirmedAt = new Date();
  }
  if (!order.confirmedBy && order.status !== ORDER_STATUS.PENDING) {
    order.confirmedBy = getUserId(currentUser) || order.confirmedBy;
  }

  await commitOrderInventory(order, getUserId(currentUser));
  await order.save();

  publishOpsStageChange(order, previousOpsStage, currentUser);
  if (order.status !== previousOrderStatus) {
    publishStatusChange({
      domain: "order",
      entityId: order._id,
      previousStatus: previousOrderStatus,
      nextStatus: order.status,
      currentUser,
      recipientUserIds: [order.userId],
      meta: {
        paymentCode: order.paymentCode,
        orderType: order.orderType,
        opsStage: order.opsStage,
      },
    });
  }

  await notifyCustomerOrderStatusChange(order, previousOrderStatus);
  await notifyCustomerOpsStageChange(order, previousOpsStage);

  return Order.findById(order._id).populate(ORDER_POPULATE);
}

async function updateOrderOpsExecution(id, currentUser, payload) {
  const order = await Order.findById(id);
  if (!order) throw new AppError("Order not found", 404);
  assertBusinessUserCanAccessOrder(order, currentUser);

  const patch = normalizeOpsExecutionPatch(payload);
  if (Object.keys(patch).length === 0) {
    throw new AppError("No ops execution fields to update", 400);
  }

  const allowedApprovalRoutingFields = new Set([
    "approvalState",
    "managerReviewRequestedAt",
    "managerReviewRequestedBy",
    "managerReviewReason",
  ]);
  const allowedPrescriptionFollowUpFields = new Set([
    "prescriptionFollowUpStatus",
    "prescriptionFollowUpNote",
    "prescriptionFollowUpUpdatedAt",
    "prescriptionFollowUpUpdatedBy",
  ]);
  const patchKeys = Object.keys(patch);
  const staffOnlyApprovalRouting =
    isStaffRole(currentUser) &&
    patchKeys.every((key) => allowedApprovalRoutingFields.has(key));
  const staffOnlyPrescriptionFollowUp =
    isStaffRole(currentUser) &&
    patchKeys.every((key) => allowedPrescriptionFollowUpFields.has(key));
  const managerOnlyApprovalRouting =
    isManager(currentUser) &&
    patchKeys.every((key) => allowedApprovalRoutingFields.has(key));

  if (
    staffOnlyApprovalRouting &&
    patch.approvalState !== undefined &&
    patch.approvalState !== "manager_review_requested"
  ) {
    throw new AppError("Staff can only request manager review", 403);
  }

  if (
    managerOnlyApprovalRouting &&
    patch.approvalState !== undefined &&
    !["manager_review_requested", "sent_back_to_sale", "none"].includes(
      patch.approvalState,
    )
  ) {
    throw new AppError("Invalid manager approval routing state", 400);
  }

  if (
    !isOperation(currentUser) &&
    !managerOnlyApprovalRouting &&
    !staffOnlyApprovalRouting &&
    !staffOnlyPrescriptionFollowUp
  ) {
    throw new AppError("Forbidden", 403);
  }

  if (
    patchKeys.some((key) => allowedPrescriptionFollowUpFields.has(key)) &&
    (patch.prescriptionFollowUpStatus !== undefined ||
      patch.prescriptionFollowUpNote !== undefined)
  ) {
    if (patch.prescriptionFollowUpUpdatedAt === undefined) {
      patch.prescriptionFollowUpUpdatedAt = new Date();
    }
    if (patch.prescriptionFollowUpUpdatedBy === undefined) {
      patch.prescriptionFollowUpUpdatedBy = toDisplayName(currentUser, "Sale");
    }
  }

  const previousUpdatedAt = order?.opsExecution?.lastUpdatedAt || null;
  applyOpsExecutionPatch(order, patch);

  await order.save();

  publishStatusChange({
    domain: "order",
    entityId: order._id,
    statusField: "opsExecution.lastUpdatedAt",
    previousStatus: previousUpdatedAt
      ? new Date(previousUpdatedAt).toISOString()
      : "",
    nextStatus: order?.opsExecution?.lastUpdatedAt
      ? new Date(order.opsExecution.lastUpdatedAt).toISOString()
      : "",
    currentUser,
    recipientUserIds: [order.userId],
    meta: {
      paymentCode: order.paymentCode,
      orderType: order.orderType,
      opsStage: order.opsStage,
    },
  });

  return Order.findById(order._id).populate(ORDER_POPULATE);
}

async function listOrders(currentUser, options = {}) {
  if (!currentUser) {
    throw new AppError("Unauthorized", 401);
  }

  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 10));
  const skip = (page - 1) * limit;
  const query = {};
  const actorStoreIds = getAccessibleStoreIds(currentUser);

  if (isStaff(currentUser)) {
    if (options.userId) {
      query.userId = options.userId;
    }
  } else {
    query.userId = currentUser.id;
  }

  if (options.status) {
    query.status = toTrimmedString(options.status).toLowerCase();
  }

  if (options.paymentStatus) {
    query.paymentStatus = toTrimmedString(options.paymentStatus).toLowerCase();
  }

  if (options.opsStage) {
    const normalizedOpsStage = normalizeOpsStage(options.opsStage, "");
    if (normalizedOpsStage) {
      query.opsStage = normalizedOpsStage;
    }
  }

  if (options.refundStatus) {
    query["refund.status"] = toTrimmedString(
      options.refundStatus,
    ).toLowerCase();
  }

  if (Array.isArray(actorStoreIds)) {
    query.storeId = { $in: actorStoreIds };
  }

  if (options.storeId) {
    const normalizedStoreId = toTrimmedString(options.storeId, "");
    if (normalizedStoreId) {
      if (Array.isArray(actorStoreIds) && !actorStoreIds.includes(normalizedStoreId)) {
        query.storeId = { $in: [] };
      } else {
        query.storeId = normalizedStoreId;
      }
    }
  }

  let orders = [];
  let total = 0;

  const loadOrders = async () => {
    const [nextOrders, nextTotal] = await Promise.all([
      Order.find(query)
        .populate(ORDER_POPULATE)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(query),
    ]);

    orders = nextOrders;
    total = nextTotal;
  };

  await loadOrders();

  if (orders.some((order) => isOrderPaymentExpired(order))) {
    for (const order of orders) {
      await expireOrderForPaymentTimeout(order);
    }
    await loadOrders();
  }

  return {
    orders,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

module.exports = {
  quote,
  createOrder,
  markPaidBySepay,
  getCurrentSepayAmountDue,
  hasOutstandingSepayBalance,
  getOrderById,
  updateOrderItems,
  patchOrderItem,
  cancelOrder,
  createRefundRequest,
  updateRefundStatus,
  overrideRefund,
  updateOrderStatus,
  updateOrderOpsStage,
  updateOrderOpsExecution,
  listOrders,
  CART_TYPES,
  __test: {
    inferOrderType,
    canUsePreOrderCod,
    getAllowedCheckoutPaymentMethods,
    getCurrentSepayAmountDue,
    hasOutstandingSepayBalance,
    resolveOrderPaymentExpiresAt,
    isOrderPaymentExpired,
  },
};
