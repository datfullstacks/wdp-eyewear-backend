const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/response');
const orderService = require('../services/orderService');
const { PAYMENT_METHODS } = require('../constants');
const {
  SEPAY_BANK_ACCOUNT_ID,
  SEPAY_BANK_ACCOUNT_NUMBER,
  SEPAY_BANK_NAME,
  SEPAY_BANK_ACCOUNT_NAME
} = require('../config/sepay');

const buildSepayQrUrl = ({ accountNumber, bankName, amount, description }) => {
  if (!accountNumber || !bankName) return null;

  const params = [
    `acc=${encodeURIComponent(accountNumber)}`,
    `bank=${encodeURIComponent(bankName)}`
  ];

  if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) {
    params.push(`amount=${Math.round(amount)}`);
  }

  if (description) {
    params.push(`des=${encodeURIComponent(description)}`);
  }

  return `https://qr.sepay.vn/img?${params.join('&')}`;
};

const buildOrderPayment = (order) => {
  const method = String(order?.paymentMethod || '').toLowerCase();
  if (!method) return null;

  const paymentCode = order?.paymentCode || null;
  const amount = Number(order?.payNowTotal || 0);
  const basePayload = {
    method,
    status: order?.paymentStatus || null,
    amount,
    currency: 'VND',
    paymentCode,
    content: paymentCode,
    createdAt: order?.createdAt || null,
    paidAt: order?.paidAt || null
  };

  if (method !== PAYMENT_METHODS.SEPAY) {
    return basePayload;
  }

  const bankAccountNumber = SEPAY_BANK_ACCOUNT_NUMBER || SEPAY_BANK_ACCOUNT_ID || null;
  const bankName = SEPAY_BANK_NAME || null;
  const description = paymentCode ? `Nhap dung noi dung: ${paymentCode}` : null;

  return {
    ...basePayload,
    bankAccountId: SEPAY_BANK_ACCOUNT_ID || null,
    bankAccountNumber,
    bankName,
    bankAccountName: SEPAY_BANK_ACCOUNT_NAME || null,
    description,
    instruction: 'Chuyen khoan SePay va giu nguyen noi dung de he thong tu dong xac nhan',
    qrUrl: buildSepayQrUrl({
      accountNumber: bankAccountNumber,
      bankName,
      amount,
      description: paymentCode
    })
  };
};

exports.listOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, paymentStatus, refundStatus, userId } = req.query;
  const result = await orderService.listOrders(req.user, {
    page,
    limit,
    status,
    paymentStatus,
    refundStatus,
    userId
  });

  ApiResponse.paginate(
    res,
    result.orders,
    result.pagination,
    'Orders retrieved successfully'
  );
});

exports.listMyOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, paymentStatus, refundStatus } = req.query;
  const result = await orderService.listOrders(req.user, {
    page,
    limit,
    status,
    paymentStatus,
    refundStatus
  });

  ApiResponse.paginate(
    res,
    result.orders,
    result.pagination,
    'My orders retrieved successfully'
  );
});

exports.getOrder = asyncHandler(async (req, res) => {
  const order = await orderService.getOrderById(req.params.id, req.user);
  const orderPayload = order?.toObject ? order.toObject() : order;
  ApiResponse.success(res, {
    ...orderPayload,
    payment: buildOrderPayment(orderPayload)
  });
});

exports.cancelOrder = asyncHandler(async (req, res) => {
  const order = await orderService.cancelOrder(req.params.id, req.user, req.body);
  ApiResponse.success(res, order, 'Order cancelled');
});

exports.updateOrderItems = asyncHandler(async (req, res) => {
  const order = await orderService.updateOrderItems(req.params.id, req.user, req.body);
  ApiResponse.success(res, order, 'Order items updated');
});

exports.patchOrderItem = asyncHandler(async (req, res) => {
  const result = await orderService.patchOrderItem(
    req.params.id,
    req.params.itemId,
    req.user,
    req.body
  );

  ApiResponse.success(
    res,
    {
      order: result.order,
      updatedItem: result.updatedItem,
      updatedItemIndex: result.updatedItemIndex
    },
    'Order item updated'
  );
});

exports.updateRefundStatus = asyncHandler(async (req, res) => {
  const order = await orderService.updateRefundStatus(req.params.id, req.user, req.body);
  ApiResponse.success(res, order, 'Order refund status updated');
});

exports.updateOrderStatus = asyncHandler(async (req, res) => {
  const order = await orderService.updateOrderStatus(req.params.id, req.user, req.body.status);
  ApiResponse.success(res, order, 'Order status updated');
});
