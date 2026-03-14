const asyncHandler = require("../helpers/asyncHandler");
const ApiResponse = require("../helpers/response");
const orderService = require("../services/orderService");
const orderShippingService = require("../services/orderShippingService");
const { PAYMENT_METHODS } = require("../constants");
const {
  SEPAY_BANK_ACCOUNT_ID,
  SEPAY_BANK_ACCOUNT_NUMBER,
  SEPAY_BANK_NAME,
  SEPAY_BANK_ACCOUNT_NAME,
} = require("../config/sepay");
const { GHN_WEBHOOK_SECRET } = require("../config/ghn");

const GHN_WEBHOOK_LOG_PREFIX = "[GHN_WEBHOOK]";

const buildSepayQrUrl = ({ accountNumber, bankName, amount, description }) => {
  if (!accountNumber || !bankName) return null;

  const params = [
    `acc=${encodeURIComponent(accountNumber)}`,
    `bank=${encodeURIComponent(bankName)}`,
  ];

  if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
    params.push(`amount=${Math.round(amount)}`);
  }

  if (description) {
    params.push(`des=${encodeURIComponent(description)}`);
  }

  return `https://qr.sepay.vn/img?${params.join("&")}`;
};

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || "unknown";
}

function verifyGhnWebhook(req) {
  if (!GHN_WEBHOOK_SECRET) return true;

  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const authToken =
    typeof authHeader === "string"
      ? authHeader.replace(/^apikey\s+/i, "").replace(/^bearer\s+/i, "").trim()
      : "";

  const token =
    req.headers["x-ghn-signature"] ||
    req.headers["x-api-key"] ||
    req.headers["x-webhook-secret"] ||
    authToken;

  return token === GHN_WEBHOOK_SECRET;
}

const buildOrderPayment = (order) => {
  const method = String(order?.paymentMethod || "").toLowerCase();
  if (!method) return null;

  const paymentCode = order?.paymentCode || null;
  const amount = Number(order?.payNowTotal || 0);
  const basePayload = {
    method,
    status: order?.paymentStatus || null,
    amount,
    currency: "VND",
    paymentCode,
    content: paymentCode,
    createdAt: order?.createdAt || null,
    paidAt: order?.paidAt || null,
  };

  if (method !== PAYMENT_METHODS.SEPAY) {
    return basePayload;
  }

  const bankAccountNumber =
    SEPAY_BANK_ACCOUNT_NUMBER || SEPAY_BANK_ACCOUNT_ID || null;
  const bankName = SEPAY_BANK_NAME || null;
  const description = paymentCode ? `Nhap dung noi dung: ${paymentCode}` : null;

  return {
    ...basePayload,
    bankAccountId: SEPAY_BANK_ACCOUNT_ID || null,
    bankAccountNumber,
    bankName,
    bankAccountName: SEPAY_BANK_ACCOUNT_NAME || null,
    description,
    instruction:
      "Chuyen khoan SePay va giu nguyen noi dung de he thong tu dong xac nhan",
    qrUrl: buildSepayQrUrl({
      accountNumber: bankAccountNumber,
      bankName,
      amount,
      description: paymentCode,
    }),
  };
};

exports.listOrders = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    status,
    paymentStatus,
    opsStage,
    refundStatus,
    userId,
  } = req.query;
  const result = await orderService.listOrders(req.user, {
    page,
    limit,
    status,
    paymentStatus,
    opsStage,
    refundStatus,
    userId,
  });

  ApiResponse.paginate(
    res,
    result.orders,
    result.pagination,
    "Orders retrieved successfully",
  );
});

exports.listMyOrders = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    status,
    paymentStatus,
    opsStage,
    refundStatus,
  } = req.query;
  const result = await orderService.listOrders(req.user, {
    page,
    limit,
    status,
    paymentStatus,
    opsStage,
    refundStatus,
  });

  ApiResponse.paginate(
    res,
    result.orders,
    result.pagination,
    "My orders retrieved successfully",
  );
});

exports.getOrder = asyncHandler(async (req, res) => {
  const order = await orderService.getOrderById(req.params.id, req.user);
  const orderPayload = order?.toObject ? order.toObject() : order;
  ApiResponse.success(res, {
    ...orderPayload,
    payment: buildOrderPayment(orderPayload),
  });
});

exports.cancelOrder = asyncHandler(async (req, res) => {
  const order = await orderService.cancelOrder(
    req.params.id,
    req.user,
    req.body,
  );
  ApiResponse.success(res, order, "Order cancelled");
});

exports.updateOrderItems = asyncHandler(async (req, res) => {
  const order = await orderService.updateOrderItems(
    req.params.id,
    req.user,
    req.body,
  );
  ApiResponse.success(res, order, "Order items updated");
});

exports.patchOrderItem = asyncHandler(async (req, res) => {
  const result = await orderService.patchOrderItem(
    req.params.id,
    req.params.itemId,
    req.user,
    req.body,
  );

  ApiResponse.success(
    res,
    {
      order: result.order,
      updatedItem: result.updatedItem,
      updatedItemIndex: result.updatedItemIndex,
    },
    "Order item updated",
  );
});

exports.updateRefundStatus = asyncHandler(async (req, res) => {
  const order = await orderService.updateRefundStatus(
    req.params.id,
    req.user,
    req.body,
  );
  ApiResponse.success(res, order, "Order refund status updated");
});

exports.updateOrderStatus = asyncHandler(async (req, res) => {
  const order = await orderService.updateOrderStatus(
    req.params.id,
    req.user,
    req.body.status,
  );
  ApiResponse.success(res, order, "Order status updated");
});

exports.updateOrderOpsStage = asyncHandler(async (req, res) => {
  const order = await orderService.updateOrderOpsStage(
    req.params.id,
    req.user,
    req.body.opsStage || req.body.ops_stage,
  );
  ApiResponse.success(res, order, "Order ops stage updated");
});

exports.updateOrderOpsExecution = asyncHandler(async (req, res) => {
  const order = await orderService.updateOrderOpsExecution(
    req.params.id,
    req.user,
    req.body,
  );
  ApiResponse.success(res, order, "Order ops execution updated");
});

exports.getOrderShipping = asyncHandler(async (req, res) => {
  const result = await orderShippingService.getOrderShipping(
    req.params.id,
    req.user,
  );
  ApiResponse.success(res, result, "Order shipping retrieved");
});

exports.createOrderShipment = asyncHandler(async (req, res) => {
  const result = await orderShippingService.createShipment(
    req.params.id,
    req.user,
  );
  ApiResponse.success(res, result, "GHN shipment created");
});

exports.syncOrderShipment = asyncHandler(async (req, res) => {
  const result = await orderShippingService.syncShipment(
    req.params.id,
    req.user,
  );
  ApiResponse.success(res, result, "GHN shipment synced");
});

exports.updateOrderShipmentTestStatus = asyncHandler(async (req, res) => {
  const result = await orderShippingService.updateShipmentTestStatus(
    req.params.id,
    req.user,
    req.body.status,
  );
  ApiResponse.success(res, result, "GHN test shipment status updated");
});

exports.printOrderShipmentLabel = asyncHandler(async (req, res) => {
  const result = await orderShippingService.printShipmentLabel(
    req.params.id,
    req.user,
  );
  ApiResponse.success(res, result, "GHN label token generated");
});

exports.cancelOrderShipment = asyncHandler(async (req, res) => {
  const result = await orderShippingService.cancelShipment(
    req.params.id,
    req.user,
  );
  ApiResponse.success(res, result, "GHN shipment cancelled");
});

exports.returnOrderShipment = asyncHandler(async (req, res) => {
  const result = await orderShippingService.returnShipment(
    req.params.id,
    req.user,
  );
  ApiResponse.success(res, result, "GHN shipment moved to return flow");
});

exports.requestOrderShipmentDeliveryAgain = asyncHandler(async (req, res) => {
  const result = await orderShippingService.requestDeliveryAgain(
    req.params.id,
    req.user,
  );
  ApiResponse.success(res, result, "GHN shipment delivery-again requested");
});

exports.ghnShippingWebhook = async (req, res) => {
  const startedAt = Date.now();
  const payload = req.body || {};

  if (!verifyGhnWebhook(req)) {
    console.warn(`${GHN_WEBHOOK_LOG_PREFIX} invalid signature`, {
      ip: getClientIp(req),
      userAgent: req.headers["user-agent"] || "unknown",
    });
    return res.status(401).json({ success: false, message: "Invalid signature" });
  }

  try {
    const result = await orderShippingService.handleWebhookUpdate(payload);
    console.log(`${GHN_WEBHOOK_LOG_PREFIX} processed`, {
      applied: result.applied,
      orderId: result.orderId || null,
      orderCode: result.orderCode || null,
      clientOrderCode: result.clientOrderCode || null,
      shipmentStatus: result.shipmentStatus || null,
      orderStatus: result.orderStatus || null,
      opsStage: result.opsStage || null,
      ip: getClientIp(req),
      elapsedMs: Date.now() - startedAt,
    });

    return res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error(`${GHN_WEBHOOK_LOG_PREFIX} failed`, {
      error: error.message,
      ip: getClientIp(req),
      elapsedMs: Date.now() - startedAt,
    });
    return res.status(200).json({
      success: false,
      message: error.message,
    });
  }
};
