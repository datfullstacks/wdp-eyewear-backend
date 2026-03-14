const AppError = require("../errors/AppError");
const {
  ghnClient,
  GHN_SHOP_ID,
  buildGhnHeaders,
  isGhnConfigured,
} = require("../config/ghn");

const GHN_ENDPOINTS = {
  CREATE_STORE: "/shiip/public-api/v2/shop/register",
  GET_STORES: "/shiip/public-api/v2/shop/all",
  GET_PROVINCES: "/shiip/public-api/master-data/province",
  GET_DISTRICTS: "/shiip/public-api/master-data/district",
  GET_WARDS: "/shiip/public-api/master-data/ward",
  GET_STATIONS: "/shiip/public-api/v2/station/get",
  GET_AVAILABLE_SERVICES:
    "/shiip/public-api/v2/shipping-order/available-services",
  CALCULATE_FEE: "/shiip/public-api/v2/shipping-order/fee",
  CALCULATE_LEADTIME: "/shiip/public-api/v2/shipping-order/leadtime",
  GET_PICK_SHIFTS: "/shiip/public-api/v2/shift/date",
  PREVIEW_ORDER: "/shiip/public-api/v2/shipping-order/preview",
  CREATE_ORDER: "/shiip/public-api/v2/shipping-order/create",
  GET_ORDER_INFO: "/shiip/public-api/v2/shipping-order/detail",
  GET_ORDER_INFO_BY_CLIENT_CODE:
    "/shiip/public-api/v2/shipping-order/detail-by-client-code",
  GET_ORDER_FEE_INFO: "/shiip/public-api/v2/shipping-order/soc",
  UPDATE_ORDER: "/shiip/public-api/v2/shipping-order/update",
  UPDATE_ORDER_COD: "/shiip/public-api/v2/shipping-order/updateCOD",
  GENERATE_PRINT_TOKEN: "/shiip/public-api/v2/a5/gen-token",
  CANCEL_ORDERS: "/shiip/public-api/v2/switch-status/cancel",
  RETURN_ORDERS: "/shiip/public-api/v2/switch-status/return",
  DELIVERY_AGAIN: "/shiip/public-api/v2/switch-status/storing",
};

function toTrimmedString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function pickFirst(obj, keys = []) {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj?.[key] !== null && obj?.[key] !== "") {
      return obj[key];
    }
  }
  return undefined;
}

function ensureConfigured({ requireShopId = false } = {}) {
  if (isGhnConfigured({ requireShopId })) return;

  const missing = ["GHN_TOKEN"];
  if (requireShopId) {
    missing.push("GHN_SHOP_ID");
  }

  throw new AppError(
    `GHN integration is not configured. Missing ${missing.join(", ")}`,
    503,
  );
}

function resolveShopId(payload = {}, explicitShopId = null) {
  return toTrimmedString(
    explicitShopId ?? pickFirst(payload, ["shopId", "shop_id"]) ?? GHN_SHOP_ID,
  );
}

function normalizeShopIdValue(value) {
  const number = Number(value);
  if (Number.isInteger(number) && number > 0) {
    return number;
  }

  return toTrimmedString(value);
}

function withOptionalShopId(
  payload = {},
  shopId = null,
  bodyField = "shop_id",
) {
  const resolvedShopId = resolveShopId(payload, shopId);
  if (!resolvedShopId) return { ...payload };

  return {
    ...payload,
    [bodyField]: payload?.[bodyField] ?? normalizeShopIdValue(resolvedShopId),
  };
}

function toOrderCodesPayload(orderCodes) {
  const list = Array.isArray(orderCodes)
    ? orderCodes.map((code) => toTrimmedString(code)).filter(Boolean)
    : [toTrimmedString(orderCodes)].filter(Boolean);

  if (list.length === 0) {
    throw new AppError("orderCodes is required", 400);
  }

  return { order_codes: list };
}

function createUpstreamError(message, statusCode, upstream = {}) {
  const error = new AppError(message, statusCode);
  error.upstream = upstream;
  return error;
}

function unwrapResponsePayload(response) {
  return response?.data ?? null;
}

function validateGhnPayload(payload, fallbackMessage) {
  const code = Number(payload?.code);
  if (Number.isFinite(code) && code !== 200) {
    throw createUpstreamError(
      payload?.message || fallbackMessage || "GHN request failed",
      502,
      {
        code,
        message: payload?.message || null,
        data: payload?.data ?? null,
      },
    );
  }

  return payload;
}

function mapAxiosError(error, fallbackMessage) {
  if (error instanceof AppError) return error;

  if (error?.response) {
    const payload = error.response.data || {};
    const upstreamStatus = Number(error.response.status) || 502;
    const appStatus =
      upstreamStatus === 401 || upstreamStatus === 403 ? 502 : upstreamStatus;
    const appMessage =
      upstreamStatus === 401 || upstreamStatus === 403
        ? `GHN authentication failed: ${payload?.message || "upstream credentials were rejected"}`
        : payload?.message || fallbackMessage || "GHN request failed";

    return createUpstreamError(appMessage, appStatus, {
      httpStatus: upstreamStatus,
      code: payload?.code ?? null,
      message: payload?.message ?? null,
      data: payload?.data ?? null,
    });
  }

  if (error?.request) {
    return createUpstreamError(
      fallbackMessage || "GHN request timeout or network failure",
      503,
      {
        network: true,
      },
    );
  }

  return createUpstreamError(
    error?.message || fallbackMessage || "GHN request failed",
    500,
  );
}

async function requestGhn({
  method,
  path,
  params,
  data,
  token = null,
  shopId = null,
  requireShopId = false,
  headers = {},
  timeout = null,
  errorMessage = "GHN request failed",
}) {
  ensureConfigured({ requireShopId });

  const resolvedShopId = requireShopId
    ? resolveShopId(data || params || {}, shopId)
    : toTrimmedString(shopId);
  if (requireShopId && !resolvedShopId) {
    throw new AppError("GHN_SHOP_ID is required for this operation", 503);
  }

  try {
    const response = await ghnClient.request({
      method,
      url: path,
      params,
      data,
      timeout: timeout || undefined,
      headers: buildGhnHeaders({
        token,
        shopId: resolvedShopId || null,
        extraHeaders: headers,
      }),
    });

    return validateGhnPayload(unwrapResponsePayload(response), errorMessage);
  } catch (error) {
    throw mapAxiosError(error, errorMessage);
  }
}

async function createStore(payload = {}, options = {}) {
  return requestGhn({
    method: "POST",
    path: GHN_ENDPOINTS.CREATE_STORE,
    data: payload,
    token: options.token,
    errorMessage: "Failed to create GHN store",
  });
}

async function getStores(filters = {}, options = {}) {
  return requestGhn({
    method: "POST",
    path: GHN_ENDPOINTS.GET_STORES,
    data: filters,
    token: options.token,
    errorMessage: "Failed to load GHN stores",
  });
}

async function getProvinces(options = {}) {
  return requestGhn({
    method: "GET",
    path: GHN_ENDPOINTS.GET_PROVINCES,
    token: options.token,
    errorMessage: "Failed to load GHN provinces",
  });
}

async function getDistricts(filters = {}, options = {}) {
  const provinceId = pickFirst(filters, ["provinceId", "province_id"]);
  const params = provinceId ? { province_id: provinceId } : undefined;

  return requestGhn({
    method: "GET",
    path: GHN_ENDPOINTS.GET_DISTRICTS,
    params,
    token: options.token,
    errorMessage: "Failed to load GHN districts",
  });
}

async function getWards(filters = {}, options = {}) {
  const districtId = pickFirst(filters, ["districtId", "district_id"]);
  if (!districtId) {
    throw new AppError("districtId is required", 400);
  }

  return requestGhn({
    method: "POST",
    path: GHN_ENDPOINTS.GET_WARDS,
    data: {
      district_id: districtId,
    },
    token: options.token,
    errorMessage: "Failed to load GHN wards",
  });
}

async function getStations(filters = {}, options = {}) {
  return requestGhn({
    method: "GET",
    path: GHN_ENDPOINTS.GET_STATIONS,
    params: {
      district_id: pickFirst(filters, ["districtId", "district_id"]),
      ward_code: pickFirst(filters, ["wardCode", "ward_code"]),
      offset: pickFirst(filters, ["offset"]),
      limit: pickFirst(filters, ["limit"]),
    },
    token: options.token,
    errorMessage: "Failed to load GHN stations",
  });
}

async function getAvailableServices(payload = {}, options = {}) {
  const body = withOptionalShopId(
    {
      from_district: pickFirst(payload, ["fromDistrict", "from_district"]),
      to_district: pickFirst(payload, ["toDistrict", "to_district"]),
    },
    options.shopId,
  );

  if (!body.from_district || !body.to_district) {
    throw new AppError("fromDistrict and toDistrict are required", 400);
  }

  if (!body.shop_id) {
    throw new AppError("shopId is required", 400);
  }

  return requestGhn({
    method: "POST",
    path: GHN_ENDPOINTS.GET_AVAILABLE_SERVICES,
    data: body,
    token: options.token,
    errorMessage: "Failed to load GHN services",
  });
}

async function calculateFee(payload = {}, options = {}) {
  return requestGhn({
    method: "POST",
    path: GHN_ENDPOINTS.CALCULATE_FEE,
    data: payload,
    token: options.token,
    shopId: options.shopId,
    requireShopId: true,
    errorMessage: "Failed to calculate GHN fee",
  });
}

async function calculateLeadtime(payload = {}, options = {}) {
  return requestGhn({
    method: "POST",
    path: GHN_ENDPOINTS.CALCULATE_LEADTIME,
    data: payload,
    token: options.token,
    shopId: options.shopId,
    requireShopId: true,
    errorMessage: "Failed to calculate GHN leadtime",
  });
}

async function getPickShifts(options = {}) {
  return requestGhn({
    method: "GET",
    path: GHN_ENDPOINTS.GET_PICK_SHIFTS,
    token: options.token,
    errorMessage: "Failed to load GHN pick shifts",
  });
}

async function previewOrder(payload = {}, options = {}) {
  return requestGhn({
    method: "POST",
    path: GHN_ENDPOINTS.PREVIEW_ORDER,
    data: payload,
    token: options.token,
    shopId: options.shopId,
    requireShopId: true,
    errorMessage: "Failed to preview GHN order",
  });
}

async function createOrder(payload = {}, options = {}) {
  return requestGhn({
    method: "POST",
    path: GHN_ENDPOINTS.CREATE_ORDER,
    data: payload,
    token: options.token,
    shopId: options.shopId,
    requireShopId: true,
    errorMessage: "Failed to create GHN order",
  });
}

async function getOrderInfo(orderCode, options = {}) {
  const normalizedOrderCode = toTrimmedString(orderCode);
  if (!normalizedOrderCode) {
    throw new AppError("orderCode is required", 400);
  }

  return requestGhn({
    method: "POST",
    path: GHN_ENDPOINTS.GET_ORDER_INFO,
    data: {
      order_code: normalizedOrderCode,
    },
    token: options.token,
    errorMessage: "Failed to load GHN order detail",
  });
}

async function getOrderInfoByClientOrderCode(clientOrderCode, options = {}) {
  const normalizedClientOrderCode = toTrimmedString(clientOrderCode);
  if (!normalizedClientOrderCode) {
    throw new AppError("clientOrderCode is required", 400);
  }

  return requestGhn({
    method: "POST",
    path: GHN_ENDPOINTS.GET_ORDER_INFO_BY_CLIENT_CODE,
    data: {
      client_order_code: normalizedClientOrderCode,
    },
    token: options.token,
    errorMessage: "Failed to load GHN order detail by client code",
  });
}

async function getOrderFeeInfo(orderCode, options = {}) {
  const normalizedOrderCode = toTrimmedString(orderCode);
  if (!normalizedOrderCode) {
    throw new AppError("orderCode is required", 400);
  }

  return requestGhn({
    method: "POST",
    path: GHN_ENDPOINTS.GET_ORDER_FEE_INFO,
    data: {
      order_code: normalizedOrderCode,
    },
    token: options.token,
    shopId: options.shopId,
    requireShopId: true,
    errorMessage: "Failed to load GHN order fee detail",
  });
}

async function updateOrder(payload = {}, options = {}) {
  if (!toTrimmedString(payload?.order_code || payload?.orderCode)) {
    throw new AppError("orderCode is required", 400);
  }

  const normalizedPayload = {
    ...payload,
    order_code: payload.order_code || payload.orderCode,
  };

  return requestGhn({
    method: "POST",
    path: GHN_ENDPOINTS.UPDATE_ORDER,
    data: normalizedPayload,
    token: options.token,
    shopId: options.shopId,
    requireShopId: true,
    errorMessage: "Failed to update GHN order",
  });
}

async function updateOrderCod(payload = {}, options = {}) {
  const orderCode = toTrimmedString(payload?.order_code || payload?.orderCode);
  const codAmount = payload?.cod_amount ?? payload?.codAmount;

  if (!orderCode) {
    throw new AppError("orderCode is required", 400);
  }

  if (!Number.isFinite(Number(codAmount)) || Number(codAmount) < 0) {
    throw new AppError("codAmount must be a non-negative number", 400);
  }

  return requestGhn({
    method: "POST",
    path: GHN_ENDPOINTS.UPDATE_ORDER_COD,
    data: {
      order_code: orderCode,
      cod_amount: Number(codAmount),
    },
    token: options.token,
    errorMessage: "Failed to update GHN COD",
  });
}

async function generatePrintToken(orderCodes, options = {}) {
  return requestGhn({
    method: "POST",
    path: GHN_ENDPOINTS.GENERATE_PRINT_TOKEN,
    data: toOrderCodesPayload(orderCodes),
    token: options.token,
    errorMessage: "Failed to generate GHN print token",
  });
}

async function cancelOrders(orderCodes, options = {}) {
  return requestGhn({
    method: "POST",
    path: GHN_ENDPOINTS.CANCEL_ORDERS,
    data: toOrderCodesPayload(orderCodes),
    token: options.token,
    shopId: options.shopId,
    requireShopId: true,
    errorMessage: "Failed to cancel GHN order",
  });
}

async function returnOrders(orderCodes, options = {}) {
  return requestGhn({
    method: "POST",
    path: GHN_ENDPOINTS.RETURN_ORDERS,
    data: toOrderCodesPayload(orderCodes),
    token: options.token,
    shopId: options.shopId,
    requireShopId: true,
    errorMessage: "Failed to move GHN order to return flow",
  });
}

async function requestDeliveryAgain(orderCodes, options = {}) {
  return requestGhn({
    method: "POST",
    path: GHN_ENDPOINTS.DELIVERY_AGAIN,
    data: toOrderCodesPayload(orderCodes),
    token: options.token,
    shopId: options.shopId,
    requireShopId: true,
    errorMessage: "Failed to request GHN delivery again",
  });
}

function getIntegrationSummary() {
  return {
    configured: isGhnConfigured(),
    configuredWithShop: isGhnConfigured({ requireShopId: true }),
    defaultShopId: GHN_SHOP_ID || null,
    endpoints: GHN_ENDPOINTS,
  };
}

module.exports = {
  GHN_ENDPOINTS,
  getIntegrationSummary,
  getProvinces,
  getDistricts,
  getWards,
  getStations,
  createStore,
  getStores,
  getAvailableServices,
  calculateFee,
  calculateLeadtime,
  getPickShifts,
  previewOrder,
  createOrder,
  getOrderInfo,
  getOrderInfoByClientOrderCode,
  getOrderFeeInfo,
  updateOrder,
  updateOrderCod,
  generatePrintToken,
  cancelOrders,
  returnOrders,
  requestDeliveryAgain,
};
