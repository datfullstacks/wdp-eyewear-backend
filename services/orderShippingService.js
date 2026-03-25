const Order = require("../models/Order");
const Product = require("../models/Product");
const AppError = require("../errors/AppError");
const { ORDER_OPS_STAGE, ORDER_STATUS, PAYMENT_METHODS } = require("../constants");
const {
  ROLE,
  GHN_ACTION,
  canAccessGhnAction,
  getAllowedGhnActions,
  getGhnRoleMatrix,
  getRole,
  getUserId,
} = require("../helpers/roles");
const {
  normalizeOpsStage,
  syncOpsStageWithOrder,
  syncOrderWithOpsStage,
} = require("../helpers/orderOpsStage");
const {
  commitOrderInventory,
  restoreOrderInventory,
} = require("../helpers/orderInventory");
const { publishStatusChange } = require("../helpers/statusEvents");
const {
  getEffectiveSystemConfig,
  canUseGhn,
} = require("../helpers/systemConfig");
const ghnService = require("./ghnService");
const shippingQuoteService = require("./shippingQuoteService");
const { appendUserNotification } = require("../helpers/userNotification");
const { GHN_USE_TEST } = require("../config/ghn");

const ORDER_POPULATE = {
  path: "invoiceId",
  select: "invoiceCode status total paidAmount amountDue issuedAt paidAt",
};

const GHN_SHIPMENT_CREATED_STATUSES = new Set(["ready_to_pick"]);
const GHN_HANDOVER_STATUSES = new Set([
  "picking",
  "money_collect_picking",
  "picked",
  "storing",
]);
const GHN_LAST_MILE_STATUSES = new Set([
  "transporting",
  "sorting",
  "delivering",
  "money_collect_delivering",
]);
const GHN_TRANSIT_STATUSES = new Set([
  ...GHN_HANDOVER_STATUSES,
  ...GHN_LAST_MILE_STATUSES,
]);
const GHN_DELIVERED_STATUSES = new Set(["delivered"]);
const GHN_DELIVERY_FAILED_STATUSES = new Set(["delivery_fail"]);
const GHN_WAITING_REDELIVERY_STATUSES = new Set(["waiting_to_return"]);
const GHN_RETURN_PENDING_STATUSES = new Set(["return"]);
const GHN_RETURN_IN_TRANSIT_STATUSES = new Set([
  "return_transporting",
  "return_sorting",
  "returning",
]);
const GHN_RETURN_FLOW_STATUSES = new Set([
  ...GHN_RETURN_PENDING_STATUSES,
  ...GHN_RETURN_IN_TRANSIT_STATUSES,
]);
const GHN_RETURNED_STATUSES = new Set(["returned"]);
const GHN_EXCEPTION_STATUSES = new Set([
  "return_fail",
  "damage",
  "lost",
  "exception",
]);
const GHN_CANCELLED_STATUSES = new Set(["cancel", "cancelled"]);
const GHN_TEST_WEBHOOK_STATUSES = new Set([
  "ready_to_pick",
  "picking",
  "transporting",
  "delivered",
  "returned",
]);

const metadataCache = {
  provinces: null,
  districts: null,
  wardsByDistrict: new Map(),
};

async function assertShippingRuntimeAvailable() {
  const systemConfig = await getEffectiveSystemConfig();
  if (canUseGhn(systemConfig)) {
    return systemConfig;
  }

  throw new AppError(
    "Shipping carrier integration is currently unavailable.",
    503,
    "SHIPPING_UNAVAILABLE",
  );
}

function toTrimmedString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function ensureOpsExecution(order) {
  if (!order.opsExecution || typeof order.opsExecution !== "object") {
    order.opsExecution = {};
  }
  return order.opsExecution;
}

function normalizeNumber(value, fallback = null) {
  const number = Number(value);
  if (Number.isFinite(number)) {
    return number;
  }

  return fallback;
}

function normalizePositiveInteger(value, fallback = null) {
  const number = Number(value);
  if (Number.isInteger(number) && number > 0) {
    return number;
  }

  return fallback;
}

function normalizeStatus(value, fallback = "") {
  const normalized = toTrimmedString(value, fallback).toLowerCase();
  return normalized || fallback;
}

function normalizePhoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeGhnPhone(value) {
  const digits = normalizePhoneDigits(value);
  if (/^84[35789]\d{8}$/.test(digits)) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

function isValidGhnPhone(value) {
  const normalized = normalizeGhnPhone(value);
  return /^0[35789]\d{8}$/.test(normalized);
}

function assertValidGhnPhone(value, fieldLabel) {
  if (!isValidGhnPhone(value)) {
    throw new AppError(
      `${fieldLabel} phone number is not valid for GHN. Use a valid Vietnam mobile number such as 09xxxxxxxx or 03xxxxxxxx.`,
      400,
    );
  }
}

function getOrderNotificationCode(order) {
  return toTrimmedString(order?.paymentCode || order?._id, "");
}

function buildShippingNotificationData(order, extra = {}) {
  return {
    orderId: String(order?._id || ""),
    orderCode: getOrderNotificationCode(order),
    orderStatus: normalizeStatus(order?.status, ""),
    opsStage: normalizeOpsStage(order?.opsStage, ""),
    trackingCode: toTrimmedString(
      order?.shipment?.orderCode || order?.shipment?.trackingCode,
      "",
    ),
    shippingStatus: normalizeStatus(order?.shipment?.latestStatus, ""),
    shippingState: normalizeStatus(order?.shipment?.state, ""),
    ...extra,
  };
}

function getShippingNotificationPayload(order, action, previousShipmentStatus) {
  const currentStatus = normalizeStatus(order?.shipment?.latestStatus, "");
  const currentOpsStage = normalizeOpsStage(order?.opsStage, "");
  const trackingCode = toTrimmedString(
    order?.shipment?.orderCode || order?.shipment?.trackingCode,
  );
  const code = getOrderNotificationCode(order);

  if (
    action === GHN_ACTION.CREATE_SHIPMENT &&
    previousShipmentStatus === "created" &&
    currentStatus === "ready_to_pick"
  ) {
    return null;
  }

  if (
    action === GHN_ACTION.CREATE_SHIPMENT ||
    currentStatus === "created" ||
    currentStatus === "ready_to_pick" ||
    currentOpsStage === ORDER_OPS_STAGE.SHIPMENT_CREATED
  ) {
    return {
      title: "Don hang da duoc tao van don",
      message: `Don ${code} da duoc tao van don GHN. Ma van don: ${trackingCode || "-"}.`,
    };
  }

  if (GHN_HANDOVER_STATUSES.has(currentStatus)) {
    return {
      title: "Don hang da ban giao cho GHN",
      message: `Don ${code} da duoc ban giao cho GHN. Ma van don: ${trackingCode || "-"}.`,
    };
  }

  if (GHN_LAST_MILE_STATUSES.has(currentStatus)) {
    return {
      title: "Don hang dang duoc van chuyen",
      message: `Don ${code} dang duoc GHN van chuyen. Ma van don: ${trackingCode || "-"}.`,
    };
  }

  if (GHN_DELIVERED_STATUSES.has(currentStatus)) {
    return {
      title: "Don hang da giao thanh cong",
      message: `Don ${code} da giao thanh cong. Ma van don: ${trackingCode || "-"}.`,
    };
  }

  if (GHN_DELIVERY_FAILED_STATUSES.has(currentStatus)) {
    return {
      title: "GHN giao hang chua thanh cong",
      message: `Don ${code} giao hang chua thanh cong. Ma van don: ${trackingCode || "-"}.`,
    };
  }

  if (GHN_WAITING_REDELIVERY_STATUSES.has(currentStatus)) {
    return {
      title: "Don hang dang cho giao lai",
      message: `Don ${code} dang cho xu ly giao lai. Ma van don: ${trackingCode || "-"}.`,
    };
  }

  if (
    GHN_RETURN_PENDING_STATUSES.has(currentStatus) ||
    GHN_RETURN_IN_TRANSIT_STATUSES.has(currentStatus)
  ) {
    return {
      title: "Don hang dang hoan ve",
      message: `Don ${code} dang trong qua trinh hoan hang. Ma van don: ${trackingCode || "-"}.`,
    };
  }

  if (GHN_RETURNED_STATUSES.has(currentStatus)) {
    return {
      title: "Don hang da hoan hang",
      message: `Don ${code} da hoan hang thanh cong. Ma van don: ${trackingCode || "-"}.`,
    };
  }

  if (
    GHN_EXCEPTION_STATUSES.has(currentStatus) ||
    GHN_CANCELLED_STATUSES.has(currentStatus) ||
    currentOpsStage === ORDER_OPS_STAGE.EXCEPTION_HOLD
  ) {
    return {
      title: "Don hang gap su co giao van",
      message: `Don ${code} dang gap su co giao van. Ma van don: ${trackingCode || "-"}.`,
    };
  }

  return null;
}

async function notifyCustomerShipmentChange(
  order,
  { previousShipmentStatus = "", previousOrderStatus = "", previousOpsStage = "", action = "" } = {},
) {
  if (!order?.userId) return;

  const currentShipmentStatus = normalizeStatus(order?.shipment?.latestStatus, "");
  const currentOrderStatus = normalizeStatus(order?.status, "");
  const currentOpsStage = normalizeOpsStage(order?.opsStage, "");

  if (
    currentShipmentStatus === normalizeStatus(previousShipmentStatus, "") &&
    currentOrderStatus === normalizeStatus(previousOrderStatus, "") &&
    currentOpsStage === normalizeOpsStage(previousOpsStage, "")
  ) {
    return;
  }

  const payload = getShippingNotificationPayload(order, action, normalizeStatus(previousShipmentStatus, ""));
  if (!payload) return;

  await appendUserNotification(order.userId, {
    type: "shipping",
    ...payload,
    data: buildShippingNotificationData(order, {
      action,
    }),
  });
}

function pickFirst(raw = {}, keys = []) {
  for (const key of keys) {
    if (raw?.[key] !== undefined && raw?.[key] !== null && raw?.[key] !== "") {
      return raw[key];
    }
  }

  return undefined;
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function unwrapWebhookPayload(payload = {}) {
  if (!isRecord(payload)) {
    return {};
  }

  if (isRecord(payload.data)) {
    return payload.data;
  }

  if (isRecord(payload.Data)) {
    return payload.Data;
  }

  return payload;
}

function isOrderOwner(order, currentUser) {
  const actorId = getUserId(currentUser);
  if (!actorId || !order?.userId) return false;
  return String(order.userId) === String(actorId);
}

function canReadShipment(order, currentUser) {
  if (isOrderOwner(order, currentUser)) {
    return true;
  }

  return canAccessGhnAction(currentUser, GHN_ACTION.VIEW_TRACKING);
}

function assertCanReadShipment(order, currentUser) {
  if (!canReadShipment(order, currentUser)) {
    throw new AppError("Forbidden", 403);
  }
}

function assertCanManageShipmentAction(currentUser, action) {
  if (!canAccessGhnAction(currentUser, action)) {
    throw new AppError("Forbidden", 403);
  }
}

function buildProductShippingMeta(product) {
  const dimensions = product?.specs?.dimensions || {};
  const frameWidthMm = normalizePositiveInteger(dimensions.frameWidthMm, 120);
  const templeLengthMm = normalizePositiveInteger(
    dimensions.templeLengthMm,
    140,
  );
  const lensHeightMm = normalizePositiveInteger(dimensions.lensHeightMm, 45);

  return {
    weightGram: normalizePositiveInteger(
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

async function hydrateOrderItemsForShipping(items = []) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const productIds = [
    ...new Set(
      normalizedItems
        .map((item) => toTrimmedString(item?.productId))
        .filter(Boolean),
    ),
  ];

  const products = await Product.find({ _id: { $in: productIds } })
    .select("_id specs")
    .lean();
  const productMap = new Map(
    products.map((product) => [String(product._id), product]),
  );

  return normalizedItems.map((item) => {
    const product = productMap.get(String(item?.productId));
    return {
      ...(item?.toObject ? item.toObject() : item),
      shippingMeta: buildProductShippingMeta(product || {}),
    };
  });
}

async function loadProvinces() {
  if (Array.isArray(metadataCache.provinces)) {
    return metadataCache.provinces;
  }

  const payload = await ghnService.getProvinces();
  metadataCache.provinces = Array.isArray(payload?.data) ? payload.data : [];
  return metadataCache.provinces;
}

async function loadDistricts() {
  if (Array.isArray(metadataCache.districts)) {
    return metadataCache.districts;
  }

  const payload = await ghnService.getDistricts();
  metadataCache.districts = Array.isArray(payload?.data) ? payload.data : [];
  return metadataCache.districts;
}

async function loadWards(districtId) {
  const cacheKey = String(districtId || "");
  if (metadataCache.wardsByDistrict.has(cacheKey)) {
    return metadataCache.wardsByDistrict.get(cacheKey);
  }

  const payload = await ghnService.getWards({ districtId });
  const wards = Array.isArray(payload?.data) ? payload.data : [];
  metadataCache.wardsByDistrict.set(cacheKey, wards);
  return wards;
}

async function resolveOriginLocationNames(originStore = {}) {
  const districtId = normalizePositiveInteger(originStore?.districtId);
  const wardCode = toTrimmedString(originStore?.wardCode);
  if (!districtId || !wardCode) {
    throw new AppError(
      "GHN origin store is missing district or ward information",
      503,
    );
  }

  const districts = await loadDistricts();
  const district = districts.find((item) => {
    const id = normalizePositiveInteger(
      pickFirst(item, ["DistrictID", "district_id", "districtId"]),
    );
    return id === districtId;
  });

  if (!district) {
    throw new AppError("Cannot resolve GHN store district name", 503);
  }

  const provinceId = normalizePositiveInteger(
    pickFirst(district, ["ProvinceID", "province_id", "provinceId"]),
  );
  const provinces = await loadProvinces();
  const province = provinces.find((item) => {
    const id = normalizePositiveInteger(
      pickFirst(item, ["ProvinceID", "province_id", "provinceId"]),
    );
    return id === provinceId;
  });

  const wards = await loadWards(districtId);
  const ward = wards.find((item) => {
    const code = toTrimmedString(
      pickFirst(item, ["WardCode", "ward_code", "wardCode"]),
    );
    return code === wardCode;
  });

  return {
    wardName: toTrimmedString(
      pickFirst(ward, ["WardName", "ward_name", "name"]),
    ),
    districtName: toTrimmedString(
      pickFirst(district, ["DistrictName", "district_name", "name"]),
    ),
    provinceName: toTrimmedString(
      pickFirst(province, ["ProvinceName", "province_name", "name"]),
      originStore.province || "",
    ),
  };
}

function buildClientOrderCode(order) {
  const seed = toTrimmedString(order?.paymentCode || order?._id, "");
  const normalized = seed.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 42);
  return `ORD-${normalized}`.slice(0, 50);
}

function buildRecipientAddress(address = {}) {
  return [address.line1, address.line2]
    .map((value) => toTrimmedString(value))
    .filter(Boolean)
    .join(", ");
}

function buildShipmentContent(order) {
  const itemNames = (Array.isArray(order?.items) ? order.items : [])
    .map((item) => toTrimmedString(item?.name))
    .filter(Boolean);

  if (!itemNames.length) {
    return `Order ${toTrimmedString(order?.paymentCode || order?._id)}`.slice(
      0,
      2000,
    );
  }

  return itemNames.join(", ").slice(0, 2000);
}

function buildGhnItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    name: toTrimmedString(item?.name, "Eyewear item"),
    code: toTrimmedString(item?.variantId || item?.productId || item?._id),
    quantity: normalizePositiveInteger(item?.quantity, 1),
    price: Math.max(0, Math.round(normalizeNumber(item?.unitPrice, 0) || 0)),
    length: normalizePositiveInteger(item?.shippingMeta?.lengthCm, 18),
    width: normalizePositiveInteger(item?.shippingMeta?.widthCm, 12),
    height: normalizePositiveInteger(item?.shippingMeta?.heightCm, 6),
    weight: normalizePositiveInteger(item?.shippingMeta?.weightGram, 300),
  }));
}

function resolveCodAmount(order) {
  const payLaterMethod = normalizeStatus(order?.payLaterMethod);
  const payLaterTotal = Math.max(
    0,
    Math.round(normalizeNumber(order?.payLaterTotal, 0) || 0),
  );

  if (payLaterMethod && payLaterMethod !== PAYMENT_METHODS.COD) {
    return 0;
  }

  return payLaterTotal;
}

function resolvePaymentTypeId(codAmount) {
  const envValue = normalizePositiveInteger(process.env.GHN_PAYMENT_TYPE_ID);
  if (envValue) {
    return envValue;
  }

  return codAmount > 0 ? 2 : 1;
}

function buildShippingResponse(order, currentUser) {
  const shipment = order?.shipment?.toObject
    ? order.shipment.toObject()
    : order?.shipment || {};
  const matrix = getGhnRoleMatrix();
  const allowedActions = new Set(getAllowedGhnActions(currentUser));
  const currentRole = getRole(currentUser) || null;
  const shippingState = normalizeStatus(shipment?.state, "none");
  const hasShipment = Boolean(toTrimmedString(shipment?.orderCode));
  const canRead = canReadShipment(order, currentUser);
  const testStatusOptions =
    GHN_USE_TEST && hasShipment
      ? getAllowedNextTestStatuses(shipment?.latestStatus || shipment?.state)
      : [];

  const availability = {
    [GHN_ACTION.VIEW_TRACKING]: canRead,
    [GHN_ACTION.CREATE_SHIPMENT]:
      allowedActions.has(GHN_ACTION.CREATE_SHIPMENT) &&
      [ORDER_STATUS.CONFIRMED, ORDER_STATUS.PROCESSING].includes(
        order?.status,
      ) &&
      (!hasShipment || ["cancelled", "none"].includes(shippingState)),
    [GHN_ACTION.SYNC_SHIPMENT]:
      allowedActions.has(GHN_ACTION.SYNC_SHIPMENT) && hasShipment,
    [GHN_ACTION.UPDATE_TEST_STATUS]:
      GHN_USE_TEST &&
      allowedActions.has(GHN_ACTION.UPDATE_TEST_STATUS) &&
      hasShipment &&
      testStatusOptions.length > 0,
    [GHN_ACTION.PRINT_LABEL]:
      allowedActions.has(GHN_ACTION.PRINT_LABEL) && hasShipment,
    [GHN_ACTION.CANCEL_SHIPMENT]:
      allowedActions.has(GHN_ACTION.CANCEL_SHIPMENT) &&
      hasShipment &&
      !["cancelled", "delivered", "returned"].includes(shippingState),
    [GHN_ACTION.RETURN_SHIPMENT]:
      allowedActions.has(GHN_ACTION.RETURN_SHIPMENT) &&
      hasShipment &&
      !["cancelled", "returned"].includes(shippingState),
    [GHN_ACTION.DELIVERY_AGAIN]:
      allowedActions.has(GHN_ACTION.DELIVERY_AGAIN) &&
      hasShipment &&
      !["cancelled", "returned"].includes(shippingState),
  };

  return {
    orderId: order?._id,
    orderStatus: order?.status || null,
    opsStage: order?.opsStage || null,
    shippingMethod: order?.shippingMethod || null,
    shipment,
    currentRole,
    permissions: availability,
    roleMatrix: matrix,
    testMode: GHN_USE_TEST,
    testStatusOptions,
  };
}

async function loadOrder(id) {
  const order = await Order.findById(id).populate(ORDER_POPULATE);
  if (!order) {
    throw new AppError("Order not found", 404);
  }

  return order;
}

async function loadOrderByShipmentReference({ orderCode, clientOrderCode }) {
  const conditions = [];
  const normalizedOrderCode = toTrimmedString(orderCode);
  const normalizedClientOrderCode = toTrimmedString(clientOrderCode);

  if (normalizedOrderCode) {
    conditions.push({ "shipment.orderCode": normalizedOrderCode });
  }

  if (normalizedClientOrderCode) {
    conditions.push({ "shipment.clientOrderCode": normalizedClientOrderCode });
  }

  if (!conditions.length) {
    return null;
  }

  return Order.findOne({ $or: conditions }).populate(ORDER_POPULATE);
}

function assertShipmentCanBeCreated(order) {
  if (!order?.shippingAddress) {
    throw new AppError("Order is missing shipping address", 400);
  }

  for (const field of ["fullName", "phone", "line1"]) {
    if (!toTrimmedString(order?.shippingAddress?.[field])) {
      throw new AppError(`Order shipping address is missing ${field}`, 400);
    }
  }

  if (
    !normalizePositiveInteger(order?.shippingAddress?.districtId) ||
    !toTrimmedString(order?.shippingAddress?.wardCode)
  ) {
    throw new AppError(
      "Order shipping address must include districtId and wardCode",
      400,
    );
  }

  assertValidGhnPhone(
    order?.shippingAddress?.phone,
    "Order shipping address",
  );

  if (
    [
      ORDER_STATUS.PENDING,
      ORDER_STATUS.CANCELLED,
      ORDER_STATUS.DELIVERED,
      ORDER_STATUS.RETURNED,
    ].includes(order.status)
  ) {
    throw new AppError("Order is not eligible for shipment creation", 400);
  }

  if (
    String(order?.orderType || "").trim().toLowerCase() === "ready_stock" &&
    normalizeOpsStage(order?.opsStage) !== ORDER_OPS_STAGE.READY_TO_SHIP
  ) {
    throw new AppError(
      "Ready-stock order must be packed and ready_to_ship before shipment creation",
      400,
    );
  }

  const orderCode = toTrimmedString(order?.shipment?.orderCode);
  const shipmentState = normalizeStatus(order?.shipment?.state, "none");
  if (orderCode && !["none", "cancelled"].includes(shipmentState)) {
    throw new AppError("GHN shipment already exists for this order", 409);
  }
}

function assertShipmentExists(order) {
  if (!toTrimmedString(order?.shipment?.orderCode)) {
    throw new AppError("Order does not have a GHN shipment yet", 400);
  }
}

function getAllowedNextTestStatuses(currentStatus) {
  const normalized = normalizeStatus(currentStatus, "");

  if (!normalized || normalized === "created") {
    return ["ready_to_pick"];
  }

  if (normalized === "ready_to_pick") {
    return ["picking", "returned"];
  }

  if (normalized === "picking") {
    return ["transporting", "returned"];
  }

  if (normalized === "transporting") {
    return ["delivered", "returned"];
  }

  return [];
}

function mapShipmentStateFromStatus(status) {
  const normalized = normalizeStatus(status, "");
  if (!normalized) return "created";
  if (GHN_DELIVERED_STATUSES.has(normalized)) return "delivered";
  if (GHN_RETURNED_STATUSES.has(normalized)) return "returned";
  if (GHN_RETURN_FLOW_STATUSES.has(normalized)) return "returning";
  if (GHN_CANCELLED_STATUSES.has(normalized)) return "cancelled";
  if (
    GHN_DELIVERY_FAILED_STATUSES.has(normalized) ||
    GHN_WAITING_REDELIVERY_STATUSES.has(normalized) ||
    GHN_EXCEPTION_STATUSES.has(normalized)
  ) {
    return "failed";
  }
  if (GHN_SHIPMENT_CREATED_STATUSES.has(normalized)) return "created";
  if (GHN_TRANSIT_STATUSES.has(normalized)) return "in_transit";
  return "created";
}

function mapLocalOrderStatusFromShipment(currentOrderStatus, shipmentStatus) {
  const normalized = normalizeStatus(shipmentStatus, "");
  if (!normalized) return null;

  if (GHN_DELIVERED_STATUSES.has(normalized)) {
    return ORDER_STATUS.DELIVERED;
  }

  if (GHN_RETURNED_STATUSES.has(normalized)) {
    return ORDER_STATUS.RETURNED;
  }

  if (
    GHN_SHIPMENT_CREATED_STATUSES.has(normalized) &&
    currentOrderStatus === ORDER_STATUS.CONFIRMED
  ) {
    return ORDER_STATUS.PROCESSING;
  }

  if (
    GHN_TRANSIT_STATUSES.has(normalized) ||
    GHN_DELIVERY_FAILED_STATUSES.has(normalized) ||
    GHN_WAITING_REDELIVERY_STATUSES.has(normalized) ||
    GHN_RETURN_FLOW_STATUSES.has(normalized) ||
    GHN_EXCEPTION_STATUSES.has(normalized)
  ) {
    if (
      [ORDER_STATUS.CONFIRMED, ORDER_STATUS.PROCESSING].includes(
        currentOrderStatus,
      )
    ) {
      return ORDER_STATUS.SHIPPED;
    }
  }

  return null;
}

function mapOpsStageFromShipmentStatus(shipmentStatus, currentOpsStage) {
  const normalized = normalizeStatus(shipmentStatus, "");
  if (!normalized) {
    return normalizeOpsStage(
      currentOpsStage,
      ORDER_OPS_STAGE.SHIPMENT_CREATED,
    );
  }

  if (GHN_DELIVERED_STATUSES.has(normalized)) {
    return ORDER_OPS_STAGE.DELIVERED;
  }

  if (GHN_RETURNED_STATUSES.has(normalized)) {
    return ORDER_OPS_STAGE.RETURNED;
  }

  if (GHN_RETURN_IN_TRANSIT_STATUSES.has(normalized)) {
    return ORDER_OPS_STAGE.RETURN_IN_TRANSIT;
  }

  if (GHN_RETURN_PENDING_STATUSES.has(normalized)) {
    return ORDER_OPS_STAGE.RETURN_PENDING;
  }

  if (GHN_WAITING_REDELIVERY_STATUSES.has(normalized)) {
    return ORDER_OPS_STAGE.WAITING_REDELIVERY;
  }

  if (GHN_DELIVERY_FAILED_STATUSES.has(normalized)) {
    return ORDER_OPS_STAGE.DELIVERY_FAILED;
  }

  if (GHN_LAST_MILE_STATUSES.has(normalized)) {
    return ORDER_OPS_STAGE.IN_TRANSIT;
  }

  if (GHN_SHIPMENT_CREATED_STATUSES.has(normalized)) {
    return ORDER_OPS_STAGE.SHIPMENT_CREATED;
  }

  if (GHN_HANDOVER_STATUSES.has(normalized)) {
    return ORDER_OPS_STAGE.HANDOVER_TO_CARRIER;
  }

  if (
    GHN_EXCEPTION_STATUSES.has(normalized) ||
    GHN_CANCELLED_STATUSES.has(normalized)
  ) {
    return ORDER_OPS_STAGE.EXCEPTION_HOLD;
  }

  return ORDER_OPS_STAGE.SHIPMENT_CREATED;
}

function buildShipmentPatchFromSnapshot(snapshot = {}, fallback = {}) {
  const orderCode = toTrimmedString(
    pickFirst(snapshot, ["order_code", "orderCode"]),
    toTrimmedString(fallback.orderCode),
  );
  const latestStatus = normalizeStatus(
    pickFirst(snapshot, ["status", "Status"]),
    normalizeStatus(fallback.latestStatus, ""),
  );
  const leadtimeValue = pickFirst(snapshot, [
    "leadtime",
    "lead_time",
    "leadTime",
  ]);
  const leadtime = leadtimeValue
    ? new Date(leadtimeValue)
    : fallback.leadtime || null;
  const failCode = toTrimmedString(
    pickFirst(snapshot, ["fail_code", "failCode"]),
    toTrimmedString(fallback.latestFailCode),
  );
  const failReason = toTrimmedString(
    pickFirst(snapshot, [
      "reason",
      "fail_reason",
      "reason_code_message",
      "message",
    ]),
    toTrimmedString(fallback.latestFailReason),
  );

  return {
    provider: "ghn",
    state: mapShipmentStateFromStatus(latestStatus || fallback.latestStatus),
    orderCode,
    clientOrderCode: toTrimmedString(
      pickFirst(snapshot, ["client_order_code", "clientOrderCode"]),
      toTrimmedString(fallback.clientOrderCode),
    ),
    serviceId: normalizePositiveInteger(
      pickFirst(snapshot, ["service_id", "serviceId"]),
      normalizePositiveInteger(fallback.serviceId),
    ),
    serviceTypeId: normalizePositiveInteger(
      pickFirst(snapshot, ["service_type_id", "serviceTypeId"]),
      normalizePositiveInteger(fallback.serviceTypeId),
    ),
    serviceName: toTrimmedString(
      pickFirst(snapshot, ["service_name", "serviceName"]),
      toTrimmedString(fallback.serviceName),
    ),
    latestStatus,
    latestFailCode: failCode,
    latestFailReason: failReason,
    labelToken: toTrimmedString(fallback.labelToken),
    leadtime:
      leadtime instanceof Date && !Number.isNaN(leadtime.getTime())
        ? leadtime
        : null,
    shippingFee: Math.max(
      0,
      Math.round(
        normalizeNumber(
          pickFirst(snapshot, ["total_fee", "totalFee"]),
          normalizeNumber(fallback.shippingFee, 0),
        ) || 0,
      ),
    ),
    codAmount: Math.max(
      0,
      Math.round(
        normalizeNumber(
          pickFirst(snapshot, ["cod_amount", "codAmount"]),
          normalizeNumber(fallback.codAmount, 0),
        ) || 0,
      ),
    ),
    trackingCode: orderCode,
    trackingUrl: toTrimmedString(fallback.trackingUrl),
    latestSnapshot: snapshot,
    lastSyncedAt: new Date(),
    updatedAt: new Date(),
  };
}

async function persistShipmentUpdate(
  order,
  patch,
  currentUser,
  { action = "", syncOrderStatus = false } = {},
) {
  const previousShipmentStatus = normalizeStatus(
    order?.shipment?.latestStatus,
    "none",
  );
  const previousShipmentState = normalizeStatus(order?.shipment?.state, "none");
  const previousOrderStatus = normalizeStatus(order?.status, "");
  const previousOpsStage = normalizeOpsStage(order?.opsStage);

  order.shipment = {
    ...(order?.shipment?.toObject
      ? order.shipment.toObject()
      : order.shipment || {}),
    ...patch,
    lastAction: action || toTrimmedString(order?.shipment?.lastAction),
    lastActionAt: new Date(),
    updatedAt: patch.updatedAt || new Date(),
    createdAt: order?.shipment?.createdAt || patch.createdAt || new Date(),
  };

  if (syncOrderStatus) {
    const nextOrderStatus = mapLocalOrderStatusFromShipment(
      order.status,
      order.shipment.latestStatus,
    );
    if (nextOrderStatus && nextOrderStatus !== order.status) {
      order.status = nextOrderStatus;
    }
  }

  const nextOpsStage = mapOpsStageFromShipmentStatus(
    order.shipment.latestStatus || order.shipment.state,
    order.opsStage,
  );
  if (nextOpsStage === ORDER_OPS_STAGE.DELIVERED) {
    syncOrderWithOpsStage(order, nextOpsStage);
  } else if (nextOpsStage) {
    order.opsStage = nextOpsStage;
    order.opsStageUpdatedAt = new Date();
    syncOpsStageWithOrder(order);
  }

  const opsExecution = ensureOpsExecution(order);
  opsExecution.lastUpdatedAt = new Date();
  opsExecution.carrierId = toTrimmedString(order?.shipment?.provider).toLowerCase();
  opsExecution.trackingCode = toTrimmedString(
    order?.shipment?.orderCode || order?.shipment?.trackingCode,
  );

  await commitOrderInventory(order, getUserId(currentUser));
  await order.save();

  publishStatusChange({
    domain: "shipping",
    entityId: order._id,
    statusField: "shipment.latestStatus",
    previousStatus: previousShipmentStatus,
    nextStatus: order.shipment.latestStatus || order.shipment.state,
    currentUser,
    recipientUserIds: [order.userId],
    meta: {
      orderId: order._id,
      orderCode: order.shipment.orderCode,
      shipmentState: order.shipment.state,
    },
  });

  publishStatusChange({
    domain: "shipping",
    entityId: order._id,
    statusField: "shipment.state",
    previousStatus: previousShipmentState,
    nextStatus: order.shipment.state,
    currentUser,
    recipientUserIds: [order.userId],
    meta: {
      orderId: order._id,
      orderCode: order.shipment.orderCode,
    },
  });

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
        shipmentStatus: order.shipment.latestStatus,
      },
    });
  }

  if (normalizeOpsStage(order.opsStage) !== previousOpsStage) {
    publishStatusChange({
      domain: "order",
      entityId: order._id,
      statusField: "opsStage",
      previousStatus: previousOpsStage,
      nextStatus: normalizeOpsStage(order.opsStage),
      currentUser,
      recipientUserIds: [order.userId],
      meta: {
        orderId: order._id,
        orderCode: order.shipment.orderCode,
        shipmentStatus: order.shipment.latestStatus,
      },
    });
  }

  await notifyCustomerShipmentChange(order, {
    previousShipmentStatus,
    previousOrderStatus,
    previousOpsStage,
    action,
  });

  return Order.findById(order._id).populate(ORDER_POPULATE);
}

async function syncShipmentSnapshot(
  order,
  currentUser,
  action = GHN_ACTION.SYNC_SHIPMENT,
) {
  await assertShippingRuntimeAvailable();
  assertShipmentExists(order);

  let detailPayload;
  const orderCode = toTrimmedString(order.shipment?.orderCode);
  const clientOrderCode = toTrimmedString(order.shipment?.clientOrderCode);

  if (orderCode) {
    detailPayload = await ghnService.getOrderInfo(orderCode);
  } else if (clientOrderCode) {
    detailPayload =
      await ghnService.getOrderInfoByClientOrderCode(clientOrderCode);
  } else {
    throw new AppError(
      "Order does not have enough GHN references to sync shipment",
      400,
    );
  }

  const snapshot = detailPayload?.data || {};
  const patch = buildShipmentPatchFromSnapshot(snapshot, order.shipment || {});
  return persistShipmentUpdate(order, patch, currentUser, {
    action,
    syncOrderStatus: true,
  });
}

async function getOrderShipping(orderId, currentUser) {
  const order = await loadOrder(orderId);
  assertCanReadShipment(order, currentUser);
  return buildShippingResponse(order, currentUser);
}

async function createShipment(orderId, currentUser) {
  await assertShippingRuntimeAvailable();
  assertCanManageShipmentAction(currentUser, GHN_ACTION.CREATE_SHIPMENT);

  const order = await loadOrder(orderId);
  assertCanReadShipment(order, currentUser);
  assertShipmentCanBeCreated(order);
  const inventoryCommitted = await commitOrderInventory(
    order,
    getUserId(currentUser),
  );

  const hydratedItems = await hydrateOrderItemsForShipping(order.items || []);
  const shippingQuote = await shippingQuoteService.quoteShipping({
    items: hydratedItems,
    shippingAddress: order.shippingAddress,
    shippingMethod: order.shippingMethod || "standard",
    subtotal: order.subtotal || 0,
  });

  const selectedOption =
    shippingQuote.shippingOptions?.[shippingQuote.shippingMethod];
  if (!selectedOption?.available) {
    throw new AppError(
      "Selected shipping method is not available for GHN shipment creation",
      400,
    );
  }

  const originStore = shippingQuote.originStore || {};
  if (
    !toTrimmedString(originStore.name) ||
    !toTrimmedString(originStore.phone) ||
    !toTrimmedString(originStore.address)
  ) {
    throw new AppError(
      "GHN store must include name, phone, and address before creating shipment",
      503,
    );
  }

  assertValidGhnPhone(originStore.phone, "GHN store");

  const recipientPhone = normalizeGhnPhone(order.shippingAddress.phone);
  const originPhone = normalizeGhnPhone(originStore.phone);

  const originNames = await resolveOriginLocationNames(originStore);
  if (
    !originNames.wardName ||
    !originNames.districtName ||
    !originNames.provinceName
  ) {
    throw new AppError("Cannot resolve full GHN store address metadata", 503);
  }

  const codAmount = resolveCodAmount(order);
  const payload = {
    shop_id: originStore.shopId,
    payment_type_id: resolvePaymentTypeId(codAmount),
    required_note: toTrimmedString(
      process.env.GHN_REQUIRED_NOTE,
      "KHONGCHOXEMHANG",
    ),
    from_name: originStore.name,
    from_phone: originPhone,
    from_address: originStore.address,
    from_ward_name: originNames.wardName,
    from_district_name: originNames.districtName,
    from_provice_name: originNames.provinceName,
    return_phone: originPhone,
    return_address: originStore.address,
    return_district_id: originStore.districtId,
    return_ward_code: originStore.wardCode,
    to_name: order.shippingAddress.fullName,
    to_phone: recipientPhone,
    to_address: buildRecipientAddress(order.shippingAddress),
    to_ward_code: order.shippingAddress.wardCode,
    to_district_id: order.shippingAddress.districtId,
    client_order_code: buildClientOrderCode(order),
    cod_amount: codAmount,
    content: buildShipmentContent(order),
    weight: shippingQuote.packageMetrics.weight,
    length: shippingQuote.packageMetrics.length,
    width: shippingQuote.packageMetrics.width,
    height: shippingQuote.packageMetrics.height,
    insurance_value: shippingQuote.packageMetrics.insuranceValue,
    service_id: selectedOption.serviceId || 0,
    service_type_id: selectedOption.serviceTypeId || 2,
    note: toTrimmedString(order.note),
    items: buildGhnItems(hydratedItems),
  };

  let createPayload;
  try {
    createPayload = await ghnService.createOrder(payload, {
      shopId: originStore.shopId,
    });
  } catch (error) {
    if (inventoryCommitted) {
      await restoreOrderInventory(order, getUserId(currentUser));
    }
    throw error;
  }
  const createData = createPayload?.data || {};
  const createdOrderCode = toTrimmedString(
    pickFirst(createData, ["order_code", "OrderCode"]),
  );

  const patch = {
    provider: "ghn",
    state: "created",
    orderCode: createdOrderCode,
    clientOrderCode: payload.client_order_code,
    shopId: normalizePositiveInteger(originStore.shopId),
    serviceId: normalizePositiveInteger(selectedOption.serviceId),
    serviceTypeId: normalizePositiveInteger(selectedOption.serviceTypeId),
    serviceName: toTrimmedString(
      selectedOption.serviceName,
      order.shippingMethod,
    ),
    latestStatus: "created",
    latestFailCode: "",
    latestFailReason: "",
    labelToken: "",
    leadtime: selectedOption.leadtime
      ? new Date(selectedOption.leadtime)
      : null,
    shippingFee: Math.max(
      0,
      Math.round(normalizeNumber(selectedOption.fee, order.shippingFee) || 0),
    ),
    codAmount,
    trackingCode: createdOrderCode,
    trackingUrl: "",
    latestSnapshot: createData,
    lastSyncedAt: null,
    updatedAt: new Date(),
    createdAt: new Date(),
  };

  const updatedOrder = await persistShipmentUpdate(order, patch, currentUser, {
    action: GHN_ACTION.CREATE_SHIPMENT,
    syncOrderStatus: false,
  });

  const previousOrderStatus = updatedOrder.status;
  if (updatedOrder.status === ORDER_STATUS.CONFIRMED) {
    updatedOrder.status = ORDER_STATUS.PROCESSING;
    await updatedOrder.save();
    publishStatusChange({
      domain: "order",
      entityId: updatedOrder._id,
      previousStatus: previousOrderStatus,
      nextStatus: updatedOrder.status,
      currentUser,
      recipientUserIds: [updatedOrder.userId],
      meta: {
        paymentCode: updatedOrder.paymentCode,
        shipmentAction: GHN_ACTION.CREATE_SHIPMENT,
      },
    });
  }

  try {
    const syncedOrder = await syncShipmentSnapshot(
      updatedOrder,
      currentUser,
      GHN_ACTION.CREATE_SHIPMENT,
    );
    return buildShippingResponse(syncedOrder, currentUser);
  } catch (error) {
    const refreshedOrder = await Order.findById(updatedOrder._id).populate(
      ORDER_POPULATE,
    );
    return buildShippingResponse(refreshedOrder, currentUser);
  }
}

async function syncShipment(orderId, currentUser) {
  await assertShippingRuntimeAvailable();
  assertCanManageShipmentAction(currentUser, GHN_ACTION.SYNC_SHIPMENT);

  const order = await loadOrder(orderId);
  assertCanReadShipment(order, currentUser);

  const updatedOrder = await syncShipmentSnapshot(
    order,
    currentUser,
    GHN_ACTION.SYNC_SHIPMENT,
  );
  return buildShippingResponse(updatedOrder, currentUser);
}

async function printShipmentLabel(orderId, currentUser) {
  await assertShippingRuntimeAvailable();
  assertCanManageShipmentAction(currentUser, GHN_ACTION.PRINT_LABEL);

  const order = await loadOrder(orderId);
  assertCanReadShipment(order, currentUser);
  assertShipmentExists(order);

  const response = await ghnService.generatePrintToken(
    order.shipment.orderCode,
  );
  const token = toTrimmedString(
    pickFirst(response?.data || {}, ["token", "Token"]),
    toTrimmedString(order.shipment?.labelToken),
  );

  const updatedOrder = await persistShipmentUpdate(
    order,
    {
      labelToken: token,
      latestSnapshot: response?.data || {},
      updatedAt: new Date(),
    },
    currentUser,
    { action: GHN_ACTION.PRINT_LABEL },
  );

  return buildShippingResponse(updatedOrder, currentUser);
}

async function cancelShipment(orderId, currentUser) {
  await assertShippingRuntimeAvailable();
  assertCanManageShipmentAction(currentUser, GHN_ACTION.CANCEL_SHIPMENT);

  const order = await loadOrder(orderId);
  assertCanReadShipment(order, currentUser);
  assertShipmentExists(order);

  await ghnService.cancelOrders(order.shipment.orderCode, {
    shopId: order.shipment.shopId || undefined,
  });

  let updatedOrder;
  try {
    updatedOrder = await syncShipmentSnapshot(
      order,
      currentUser,
      GHN_ACTION.CANCEL_SHIPMENT,
    );
  } catch (error) {
    updatedOrder = await persistShipmentUpdate(
      order,
      {
        state: "cancelled",
        latestStatus: "cancelled",
        updatedAt: new Date(),
      },
      currentUser,
      { action: GHN_ACTION.CANCEL_SHIPMENT },
    );
  }

  return buildShippingResponse(updatedOrder, currentUser);
}

async function returnShipment(orderId, currentUser) {
  await assertShippingRuntimeAvailable();
  assertCanManageShipmentAction(currentUser, GHN_ACTION.RETURN_SHIPMENT);

  const order = await loadOrder(orderId);
  assertCanReadShipment(order, currentUser);
  assertShipmentExists(order);

  await ghnService.returnOrders(order.shipment.orderCode, {
    shopId: order.shipment.shopId || undefined,
  });

  let updatedOrder;
  try {
    updatedOrder = await syncShipmentSnapshot(
      order,
      currentUser,
      GHN_ACTION.RETURN_SHIPMENT,
    );
  } catch (error) {
    updatedOrder = await persistShipmentUpdate(
      order,
      {
        state: "returning",
        latestStatus: "return",
        updatedAt: new Date(),
      },
      currentUser,
      { action: GHN_ACTION.RETURN_SHIPMENT },
    );
  }

  return buildShippingResponse(updatedOrder, currentUser);
}

async function requestDeliveryAgain(orderId, currentUser) {
  await assertShippingRuntimeAvailable();
  assertCanManageShipmentAction(currentUser, GHN_ACTION.DELIVERY_AGAIN);

  const order = await loadOrder(orderId);
  assertCanReadShipment(order, currentUser);
  assertShipmentExists(order);

  await ghnService.requestDeliveryAgain(order.shipment.orderCode, {
    shopId: order.shipment.shopId || undefined,
  });

  let updatedOrder;
  try {
    updatedOrder = await syncShipmentSnapshot(
      order,
      currentUser,
      GHN_ACTION.DELIVERY_AGAIN,
    );
  } catch (error) {
    updatedOrder = await persistShipmentUpdate(
      order,
      {
        state: "in_transit",
        latestStatus: "storing",
        updatedAt: new Date(),
      },
      currentUser,
      { action: GHN_ACTION.DELIVERY_AGAIN },
    );
  }

  return buildShippingResponse(updatedOrder, currentUser);
}

async function updateShipmentTestStatus(orderId, currentUser, status) {
  await assertShippingRuntimeAvailable();
  assertCanManageShipmentAction(currentUser, GHN_ACTION.UPDATE_TEST_STATUS);

  if (!GHN_USE_TEST) {
    throw new AppError(
      "Manual GHN test status updates are only available in test mode",
      400,
    );
  }

  const nextStatus = normalizeStatus(status, "");
  if (!GHN_TEST_WEBHOOK_STATUSES.has(nextStatus)) {
    throw new AppError("Unsupported GHN test status", 400);
  }

  const order = await loadOrder(orderId);
  assertCanReadShipment(order, currentUser);
  assertShipmentExists(order);

  const currentStatus = normalizeStatus(order.shipment?.latestStatus, "");
  const allowedNextStatuses = getAllowedNextTestStatuses(
    currentStatus || order.shipment?.state,
  );

  if (nextStatus !== currentStatus && !allowedNextStatuses.includes(nextStatus)) {
    throw new AppError(
      `Only next GHN test statuses are allowed: ${allowedNextStatuses.join(", ") || "none"}`,
      400,
    );
  }

  const snapshot = {
    ...(isRecord(order.shipment?.latestSnapshot)
      ? order.shipment.latestSnapshot
      : {}),
    order_code: order.shipment.orderCode,
    client_order_code: order.shipment.clientOrderCode,
    status: nextStatus,
  };
  const patch = buildShipmentPatchFromSnapshot(snapshot, order.shipment || {});
  const updatedOrder = await persistShipmentUpdate(order, patch, currentUser, {
    action: "ghn_test_status",
    syncOrderStatus: true,
  });

  return buildShippingResponse(updatedOrder, currentUser);
}

async function handleWebhookUpdate(payload, currentUser = null) {
  const snapshot = unwrapWebhookPayload(payload);
  const latestStatus = normalizeStatus(
    pickFirst(snapshot, [
      "status",
      "Status",
      "current_status",
      "CurrentStatus",
    ]),
    "",
  );
  const orderCode = toTrimmedString(
    pickFirst(snapshot, ["order_code", "orderCode", "OrderCode"]),
  );
  const clientOrderCode = toTrimmedString(
    pickFirst(snapshot, [
      "client_order_code",
      "clientOrderCode",
      "ClientOrderCode",
    ]),
  );

  if (!latestStatus) {
    return {
      applied: false,
      message: "Missing GHN status in webhook payload",
      orderCode,
      clientOrderCode,
    };
  }

  const order = await loadOrderByShipmentReference({ orderCode, clientOrderCode });
  if (!order) {
    return {
      applied: false,
      message: "No local order matches GHN webhook payload",
      orderCode,
      clientOrderCode,
      latestStatus,
    };
  }

  const patch = buildShipmentPatchFromSnapshot(snapshot, order.shipment || {});
  if (!patch.orderCode) {
    patch.orderCode = toTrimmedString(order.shipment?.orderCode) || orderCode;
  }
  if (!patch.clientOrderCode) {
    patch.clientOrderCode =
      toTrimmedString(order.shipment?.clientOrderCode) || clientOrderCode;
  }

  const updatedOrder = await persistShipmentUpdate(order, patch, currentUser, {
    action: "ghn_webhook",
    syncOrderStatus: true,
  });

  return {
    applied: true,
    message: "GHN webhook applied",
    orderId: String(updatedOrder._id),
    orderCode: updatedOrder.shipment?.orderCode || orderCode,
    clientOrderCode: updatedOrder.shipment?.clientOrderCode || clientOrderCode,
    shipmentStatus: updatedOrder.shipment?.latestStatus || latestStatus,
    shipmentState: updatedOrder.shipment?.state || null,
    orderStatus: updatedOrder.status || null,
    opsStage: updatedOrder.opsStage || null,
  };
}

module.exports = {
  getOrderShipping,
  createShipment,
  syncShipment,
  printShipmentLabel,
  cancelShipment,
  returnShipment,
  requestDeliveryAgain,
  updateShipmentTestStatus,
  handleWebhookUpdate,
};
