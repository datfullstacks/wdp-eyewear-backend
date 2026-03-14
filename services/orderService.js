const Product = require("../models/Product");
const Order = require("../models/Order");
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
} = require("../constants");
const { generatePaymentCode } = require("../helpers/paymentCode");
const {
  isBusinessUser,
  isStaff: isStaffRole,
  isOperation,
  isManager,
  isAdmin,
  getUserId,
} = require("../helpers/roles");
const { publishStatusChange } = require("../helpers/statusEvents");
const { appendUserNotification } = require("../helpers/userNotification");
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
const promotionService = require("./promotionService");
const shippingQuoteService = require("./shippingQuoteService");

const PRESCRIPTION_MODES = new Set(["none", "manual", "upload"]);
const REFUND_STATUSES = new Set([
  "none",
  "requested",
  "processing",
  "completed",
  "rejected",
]);
const CART_TYPES = {
  READY_STOCK: "ready_stock",
  PRE_ORDER: "pre_order",
};
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

const ORDER_POPULATE = {
  path: "invoiceId",
  select: "invoiceCode status total paidAmount amountDue issuedAt paidAt",
};

function isStaff(user) {
  return isBusinessUser(user);
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

function addHours(dateValue, hours = 12) {
  const date = new Date(dateValue || Date.now());
  const next = new Date(date.getTime());
  next.setHours(next.getHours() + Number(hours || 0));
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

function normalizeOptionalEnum(value, allowedSet, fieldName) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const normalized = toTrimmedString(value).toLowerCase();
  if (!allowedSet.has(normalized)) {
    throw new AppError(`${fieldName} is invalid`, 400);
  }
  return normalized;
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

  if (isAdmin(currentUser) || isManager(currentUser)) {
    return;
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

function assertOrderCanBeConfirmed(order) {
  if (!order) {
    throw new AppError("Order not found", 404);
  }

  if (
    String(order.paymentStatus || "")
      .trim()
      .toLowerCase() !== PAYMENT_STATUS.PAID
  ) {
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

function assertRefundStatusPermission(currentUser, nextStatus) {
  if (isAdmin(currentUser) || isManager(currentUser)) {
    return;
  }

  if (isOperation(currentUser) && nextStatus === "processing") {
    return;
  }

  throw new AppError("Forbidden", 403);
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

function buildProductShippingMeta(product) {
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
  };
}

function stripItemShippingMeta(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (!item || typeof item !== "object") return item;
    const { shippingMeta, ...rest } = item;
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
  const payNow = Math.round(lineTotal * (depositPercent / 100));
  const payLater = lineTotal - payNow;
  return { lineTotal, payNow, payLater };
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

async function buildItems(itemsInput, options = {}) {
  if (!Array.isArray(itemsInput) || itemsInput.length === 0) {
    throw new AppError("items is required", 400);
  }

  const itemDocs = [];

  for (const input of itemsInput) {
    const productId = input?.productId || input?.product_id;
    if (!productId) {
      throw new AppError("productId is required", 400);
    }

    const quantity = normalizePositiveInteger(input.quantity, "quantity");
    const product = await Product.findById(productId).select(
      "_id name type status pricing preOrder inventory variants specs",
    );
    if (!product) {
      throw new AppError("Product not found", 404);
    }

    if (product.status !== PRODUCT_STATUS.ACTIVE) {
      throw new AppError(
        `Product "${product.name}" is not available for sale`,
        400,
      );
    }

    const variant = pickVariant(product, input.variantId || input.variant_id);
    const unitPrice = pickPrice(product, variant);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new AppError(`Product "${product.name}" price is missing`, 400);
    }

    const isPreOrder = Boolean(product.preOrder?.enabled);
    assertCartTypeCompatibility(options.cartType, isPreOrder, product.name);

    if (isPreOrder) {
      assertPreOrderWindow(product);
      const maxQty = Number(product.preOrder?.maxQuantityPerOrder || 0);
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
      ? Number(product.preOrder?.depositPercent ?? 100)
      : 100;
    const { lineTotal, payNow, payLater } = calcPaySplit(
      unitPrice,
      quantity,
      depositPercent,
    );
    const customization = normalizeCustomization(input, { variant });

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
      customization,
      shippingMeta: buildProductShippingMeta(product),
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
    productId: item.productId,
    variantId: item.variantId || null,
    quantity: item.quantity,
    customization: item.customization || {},
  }));
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
  const hasPreOrder = items.some((item) => item.preOrder);
  const hasReadyStock = items.some((item) => !item.preOrder);

  if (hasPreOrder && hasReadyStock) {
    throw new AppError(
      "Pre-order items and ready-stock items must be checked out separately",
      400,
    );
  }

  return hasPreOrder ? ORDER_TYPES.PRE_ORDER : ORDER_TYPES.READY_STOCK;
}

function getOrderEditWindowEndsAt(order) {
  if (order?.editWindowEndsAt) return new Date(order.editWindowEndsAt);
  if (order?.paidAt) {
    const hours = Number(order?.confirmationDeadlineHours || 12);
    return addHours(order.paidAt, hours);
  }
  return null;
}

function normalizeRefundBankAccount(bankAccount) {
  if (!bankAccount || typeof bankAccount !== "object") return null;
  const accountNumber = toTrimmedString(bankAccount.accountNumber);
  const bankName = toTrimmedString(bankAccount.bankName);
  const accountHolder = toTrimmedString(bankAccount.accountHolder);
  if (!accountNumber || !bankName || !accountHolder) return null;

  return {
    bankName,
    accountNumber,
    accountHolder,
    note: toTrimmedString(bankAccount.note, ""),
  };
}

function syncInvoiceByOrderState(invoice, order, transactionId) {
  const paidAmount = Number(order.paidAmount || 0);
  const expectedPayNow = Number(order.payNowTotal || 0);
  const amountDue = Math.max(0, expectedPayNow - paidAmount);

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
  const expectedPayNow = Number(order.payNowTotal || 0);
  const amountDue = Math.max(0, expectedPayNow - paidAmount);
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
  const manualShippingFee = normalizeNonNegativeNumber(
    shippingFee,
    "shippingFee",
  );
  const manualDiscount = normalizeNonNegativeNumber(
    discountAmount,
    "discountAmount",
  );

  const items = await buildItems(itemsInput, {
    cartType: options.cartType || null,
  });
  const { subtotal, payNowTotal, payLaterTotal } = sumAmounts(items);
  const voucherCode = normalizeVoucherCode(options.voucherCode || null);
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
      throwOnInvalid: true,
    });

    discountValue = resolvedPromotion.discountAmount;
    promotion = promotionService.toPromotionMeta(resolvedPromotion.promotion);
    appliedVoucherCode = resolvedPromotion.voucherCode;
  }

  const canCalculateDynamicShipping =
    normalizedShippingAddress?.districtId &&
    normalizedShippingAddress?.wardCode &&
    normalizedShippingMethod;

  if (canCalculateDynamicShipping) {
    shippingQuote = await shippingQuoteService.quoteShipping({
      items,
      shippingAddress: normalizedShippingAddress,
      shippingMethod: normalizedShippingMethod,
      subtotal,
    });
    shippingQuote.shippingSource = "ghn";
  }

  const shippingFeeValue = normalizeNonNegativeNumber(
    shippingQuote.shippingFee,
    "shippingFee",
  );
  const total = subtotal - discountValue + shippingFeeValue;
  const payNow = Math.max(0, payNowTotal - discountValue + shippingFeeValue);
  const payLater = Math.max(0, total - payNow);

  return {
    items: stripItemShippingMeta(items),
    subtotal,
    shippingFee: shippingFeeValue,
    shippingMethod: shippingQuote.shippingMethod || normalizedShippingMethod,
    shippingOptions: shippingQuote.shippingOptions,
    shippingSource: shippingQuote.shippingSource,
    shippingPackage: shippingQuote.packageMetrics,
    shippingOrigin: shippingQuote.originStore,
    discountAmount: discountValue,
    total,
    payNow,
    payLater,
    payNowTotal,
    payLaterTotal,
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
  voucherCode = null,
}) {
  if (!userId) {
    throw new AppError("Unauthorized", 401);
  }

  const user = await User.findById(userId).select("_id addresses");
  if (!user) {
    throw new AppError("User not found", 404);
  }

  const resolvedShippingAddress = ensureShippingAddress(
    shippingAddress || pickDefaultAddressFromUser(user),
  );

  const quoteResult = await quote(itemsInput, shippingFee, discountAmount, {
    cartType,
    voucherCode,
    shippingMethod,
    shippingAddress: resolvedShippingAddress,
  });
  const paymentCode = generatePaymentCode();
  const orderType = inferOrderType(quoteResult.items);
  const paidAt = quoteResult.payNow > 0 ? null : new Date();
  const confirmationDeadlineHours = 12;
  const editWindowEndsAt = paidAt
    ? addHours(paidAt, confirmationDeadlineHours)
    : null;

  const order = await Order.create({
    userId,
    items: quoteResult.items,
    subtotal: quoteResult.subtotal,
    shippingFee: quoteResult.shippingFee,
    discountAmount: quoteResult.discountAmount,
    total: quoteResult.total,
    payNowTotal: quoteResult.payNow,
    payLaterTotal: quoteResult.payLater,
    paymentMethod: PAYMENT_METHODS.SEPAY,
    paymentStatus: quoteResult.payNow > 0 ? "pending" : "paid",
    paidAmount: quoteResult.payNow > 0 ? 0 : quoteResult.payNow,
    paidAt: paidAt || undefined,
    editWindowEndsAt: editWindowEndsAt || undefined,
    confirmationDeadlineHours,
    shippingMethod: quoteResult.shippingMethod || shippingMethod,
    shippingAddress: resolvedShippingAddress,
    voucherCode: quoteResult.voucherCode || undefined,
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
    return { order, quote: quoteResult, invoice };
  } catch (error) {
    if (inventoryCommitted) {
      await restoreOrderInventory(order, userId);
    }
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
    return Order.findById(order._id).populate(ORDER_POPULATE);
  }

  if (transactionId && order.sepayTransactionId === transactionId) {
    return Order.findById(order._id).populate(ORDER_POPULATE);
  }

  order.paidAmount = Number(order.paidAmount || 0) + normalizedAmount;
  const paidEnough =
    Number(order.paidAmount || 0) >= Number(order.payNowTotal || 0);
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

  const invoice = await ensureOrderInvoice(order);
  syncInvoiceByOrderState(invoice, order, transactionId);

  await Promise.all([order.save(), invoice.save()]);
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

  return order;
}

async function updateOrderItems(id, currentUser, payload = {}) {
  const order = await Order.findById(id);
  if (!order) throw new AppError("Order not found", 404);

  const userId = getUserId(currentUser);
  const isOwner = currentUser && String(order.userId) === String(userId);
  const staff = isStaff(currentUser);
  if (!isOwner && !staff) {
    throw new AppError("Forbidden", 403);
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
    voucherCode,
    shippingMethod: nextShippingMethod,
    shippingAddress: nextShippingAddress,
  });
  const nextOrderType = inferOrderType(quoteResult.items);
  if (nextOrderType !== order.orderType) {
    throw new AppError(
      "Order type mismatch. Pre-order and ready-stock items must stay separated",
      400,
    );
  }

  order.items = quoteResult.items;
  order.subtotal = quoteResult.subtotal;
  order.shippingFee = quoteResult.shippingFee;
  order.discountAmount = quoteResult.discountAmount;
  order.total = quoteResult.total;
  order.payNowTotal = quoteResult.payNow;
  order.payLaterTotal = quoteResult.payLater;
  order.voucherCode = quoteResult.voucherCode || "";
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
    order.paymentStatus = quoteResult.payNow > 0 ? "pending" : "paid";
    if (order.paymentStatus === "paid" && !order.paidAt) {
      order.paidAt = new Date();
      order.editWindowEndsAt = addHours(
        order.paidAt,
        Number(order.confirmationDeadlineHours || 12),
      );
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
        order.refund = {
          ...(order.refund || {}),
          status: "requested",
          reason:
            "Order updated after payment - overpaid amount requires refund",
          requestedAt: new Date(),
          requestedBy: userId || order.userId,
          amount: refundableAmount,
          bankAccount: account || order.refund?.bankAccount || undefined,
        };
      }
    } else {
      order.paymentStatus = "partial";
    }
  }

  if (!staff) {
    order.lastCustomerEditAt = new Date();
    order.customerEditCount = Number(order.customerEditCount || 0) + 1;
  }

  const invoice = await ensureOrderInvoice(order);
  syncInvoiceByOrderState(invoice, order);

  await Promise.all([order.save(), invoice.save()]);
  return Order.findById(order._id).populate(ORDER_POPULATE);
}

async function patchOrderItem(id, itemId, currentUser, payload = {}) {
  const order = await Order.findById(id);
  if (!order) throw new AppError("Order not found", 404);

  const userId = getUserId(currentUser);
  const isOwner = currentUser && String(order.userId) === String(userId);
  const staff = isStaff(currentUser);
  if (!isOwner && !staff) {
    throw new AppError("Forbidden", 403);
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
    voucherCode,
    shippingMethod: order.shippingMethod || "standard",
    shippingAddress: order.shippingAddress || null,
  });

  const nextOrderType = inferOrderType(quoteResult.items);
  if (nextOrderType !== order.orderType) {
    throw new AppError(
      "Order type mismatch. Pre-order and ready-stock items must stay separated",
      400,
    );
  }

  order.items = quoteResult.items;
  order.subtotal = quoteResult.subtotal;
  order.shippingFee = quoteResult.shippingFee;
  order.discountAmount = quoteResult.discountAmount;
  order.total = quoteResult.total;
  order.payNowTotal = quoteResult.payNow;
  order.payLaterTotal = quoteResult.payLater;
  order.voucherCode = quoteResult.voucherCode || "";

  const paidAmount = Number(order.paidAmount || 0);
  if (paidAmount <= 0) {
    order.paymentStatus = quoteResult.payNow > 0 ? "pending" : "paid";
    if (order.paymentStatus === "paid" && !order.paidAt) {
      order.paidAt = new Date();
      order.editWindowEndsAt = addHours(
        order.paidAt,
        Number(order.confirmationDeadlineHours || 12),
      );
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

  if (!staff) {
    order.lastCustomerEditAt = new Date();
    order.customerEditCount = Number(order.customerEditCount || 0) + 1;
  }

  const invoice = await ensureOrderInvoice(order);
  syncInvoiceByOrderState(invoice, order);

  await Promise.all([order.save(), invoice.save()]);

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

async function cancelOrder(id, currentUser, payload = {}) {
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
  await restoreOrderInventory(order, userId);

  const paidAmount = Number(order.paidAmount || 0);
  const paidReceived = paidAmount > 0;
  const invoice = await ensureOrderInvoice(order);
  const previousInvoiceStatus = invoice.status;

  if (paidReceived) {
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

    order.refund = {
      ...(order.refund || {}),
      status: "requested",
      reason,
      requestedAt: new Date(),
      requestedBy: userId || order.userId,
      amount: paidAmount,
      bankAccount: bankAccount || undefined,
      contactChannels: channels.length > 0 ? channels : ["email"],
    };
  } else {
    order.paymentStatus = "failed";
    invoice.status = "void";
    invoice.amountDue = 0;
  }

  syncInvoiceByOrderState(invoice, order);
  await Promise.all([order.save(), invoice.save()]);

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
  if (!isStaff(currentUser)) {
    throw new AppError("Forbidden", 403);
  }

  const order = await Order.findById(id);
  if (!order) throw new AppError("Order not found", 404);
  const previousRefundStatus = order.refund?.status || "none";
  const previousPaymentStatus = order.paymentStatus;

  const nextStatus = normalizeRefundStatus(payload.status);
  if (!nextStatus || nextStatus === "none") {
    throw new AppError("Invalid refund status", 400);
  }

  assertRefundStatusPermission(currentUser, nextStatus);

  if (order.status !== ORDER_STATUS.CANCELLED) {
    throw new AppError(
      "Refund status can only be updated for cancelled orders",
      400,
    );
  }

  if (!order.refund || !order.refund.status || order.refund.status === "none") {
    throw new AppError("This order has no active refund request", 400);
  }

  order.refund.status = nextStatus;
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

  if (nextStatus === "processing") {
    order.refund.processedBy = getUserId(currentUser);
  }

  if (nextStatus === "completed") {
    order.refund.processedBy = getUserId(currentUser);
    order.refund.processedAt = new Date();
    order.paymentStatus = "refunded";
  }

  if (nextStatus === "rejected") {
    const rejectReason = toTrimmedString(payload.rejectReason, "");
    if (!rejectReason) {
      throw new AppError(
        "rejectReason is required when refund is rejected",
        400,
      );
    }
    order.refund.rejectReason = rejectReason;
    order.refund.processedBy = getUserId(currentUser);
    order.refund.processedAt = new Date();
  }

  const invoice = await ensureOrderInvoice(order);
  const previousInvoiceStatus = invoice.status;
  syncInvoiceByOrderState(invoice, order);

  await Promise.all([order.save(), invoice.save()]);

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

  await appendUserNotification(order.userId, {
    title: "Cap nhat hoan tien don hang",
    message: `Trang thai hoan tien #${order._id} da chuyen sang "${nextStatus}"`,
    data: {
      orderId: order._id,
      refundStatus: nextStatus,
    },
  });

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

  const order = await Order.findById(id);
  if (!order) throw new AppError("Order not found", 404);
  const previousOrderStatus = order.status;
  const previousOpsStage = order.opsStage;

  if (normalizedStatus === ORDER_STATUS.CONFIRMED) {
    assertOrderCanBeConfirmed(order);
  }

  order.status = normalizedStatus;
  if (normalizedStatus === ORDER_STATUS.CONFIRMED) {
    order.confirmedAt = new Date();
    order.confirmedBy = getUserId(currentUser);
    syncOrderWithOpsStage(order, getInitialOpsStage(order.orderType));
    const opsExecution = touchOpsExecution(order);
    opsExecution.salesApprovedAt = order.confirmedAt;
    opsExecution.salesApprovedBy = toDisplayName(currentUser, "Sales/Support");
  } else {
    syncOpsStageWithOrder(order);
  }

  syncOpsExecutionForStage(order, currentUser, order.opsStage);
  await commitOrderInventory(order, getUserId(currentUser));

  await order.save();
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
  if (!isOperation(currentUser) && !isManager(currentUser)) {
    throw new AppError("Forbidden", 403);
  }

  const normalizedStage = normalizeOpsStage(stage, "");
  if (!normalizedStage || normalizedStage === ORDER_OPS_STAGE.CANCELLED) {
    throw new AppError("Invalid ops stage", 400);
  }

  const order = await Order.findById(id);
  if (!order) throw new AppError("Order not found", 404);

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
  if (!isOperation(currentUser) && !isManager(currentUser)) {
    throw new AppError("Forbidden", 403);
  }

  const order = await Order.findById(id);
  if (!order) throw new AppError("Order not found", 404);

  const patch = normalizeOpsExecutionPatch(payload);
  if (Object.keys(patch).length === 0) {
    throw new AppError("No ops execution fields to update", 400);
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

  const [orders, total] = await Promise.all([
    Order.find(query)
      .populate(ORDER_POPULATE)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Order.countDocuments(query),
  ]);

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
  getOrderById,
  updateOrderItems,
  patchOrderItem,
  cancelOrder,
  updateRefundStatus,
  updateOrderStatus,
  updateOrderOpsStage,
  updateOrderOpsExecution,
  listOrders,
  CART_TYPES,
};
