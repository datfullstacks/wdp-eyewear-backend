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

const normalizeInput = (body) => {
  const normalizeNumber = (v, def = 0) => {
    if (v === undefined || v === null || v === '') return def;
    const n = Number(v);
    return Number.isNaN(n) ? def : n;
  };

  const items = Array.isArray(body.items)
    ? body.items.map((item) => ({
        productId: item.productId || item.product_id,
        variantId: item.variantId ?? item.variant_id ?? null,
        quantity: Number(item.quantity || 0)
      }))
    : [];

  return {
    items,
    shippingFee: normalizeNumber(body.shippingFee ?? body.shipping_fee, 0),
    discountAmount: normalizeNumber(body.discountAmount ?? body.discount_amount, 0),
    shippingMethod: body.shippingMethod || body.shipping_method,
    shippingAddress: body.shippingAddress || body.shipping_address,
    note: body.note
  };
};

// GET/POST quote checkout
exports.quote = asyncHandler(async (req, res) => {
  const input = normalizeInput(req.body);
  const result = await orderService.quote(input.items, input.shippingFee, input.discountAmount);
  ApiResponse.success(res, {
    ...result,
    paymentMethod: PAYMENT_METHODS.SEPAY
  });
});

// Create order + return sepay instructions
exports.create = asyncHandler(async (req, res) => {
  const input = normalizeInput(req.body);
  const userId = req.user?.id;

  const { order, quote } = await orderService.createOrder({
    userId,
    itemsInput: input.items,
    shippingFee: input.shippingFee ?? 0,
    discountAmount: input.discountAmount ?? 0,
    shippingMethod: input.shippingMethod || 'standard',
    shippingAddress: input.shippingAddress,
    note: input.note
  });

  const payAmount = quote.payNow;
  const paymentContent = order.paymentCode;
  const bankAccountNumber = SEPAY_BANK_ACCOUNT_NUMBER || SEPAY_BANK_ACCOUNT_ID || null;
  const bankName = SEPAY_BANK_NAME || null;
  const paymentDescription = `Nhap dung noi dung: ${paymentContent}`;
  const paymentInstruction = 'Chuyen khoan SePay va giu nguyen noi dung de he thong tu dong xac nhan';

  const paymentInstructions = {
    method: PAYMENT_METHODS.SEPAY,
    status: 'PENDING_QR',
    amount: payAmount,
    currency: 'VND',
    paymentCode: order.paymentCode,
    content: paymentContent,
    bankAccountId: SEPAY_BANK_ACCOUNT_ID || null,
    bankAccountNumber,
    bankName,
    bankAccountName: SEPAY_BANK_ACCOUNT_NAME || null,
    description: paymentDescription,
    instruction: paymentInstruction,
    qrUrl: buildSepayQrUrl({
      accountNumber: bankAccountNumber,
      bankName,
      amount: payAmount,
      description: paymentContent
    })
  };

  ApiResponse.created(
    res,
    {
      orderId: order._id,
      payment: paymentInstructions,
      breakdown: {
        subtotal: quote.subtotal,
        shippingFee: quote.shippingFee,
        discountAmount: quote.discountAmount,
        total: quote.total,
        payNow: quote.payNow,
        payLater: quote.payLater
      }
    },
    'Checkout created. Proceed with Sepay payment.'
  );
});
