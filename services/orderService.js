const Product = require('../models/Product');
const Order = require('../models/Order');
const AppError = require('../errors/AppError');
const { PAYMENT_METHODS, ORDER_TYPES, ORDER_STATUS } = require('../constants');
const { generatePaymentCode } = require('../helpers/paymentCode');

function pickPrice(product, variantId) {
  if (Array.isArray(product.variants) && variantId) {
    const v = product.variants.find(x => String(x._id) === String(variantId));
    if (v) return v.price ?? product.pricing?.salePrice ?? product.pricing?.basePrice;
  }
  return product.pricing?.salePrice ?? product.pricing?.basePrice;
}

function calcPaySplit(unitPrice, qty, depositPercent) {
  const lineTotal = unitPrice * qty;
  const payNow = Math.round(lineTotal * (depositPercent / 100));
  const payLater = lineTotal - payNow;
  return { lineTotal, payNow, payLater };
}

async function buildItems(itemsInput) {
  const itemDocs = [];
  for (const input of itemsInput) {
    const product = await Product.findById(input.productId);
    if (!product) throw new AppError('Product not found', 404);
    const unitPrice = pickPrice(product, input.variantId);
    if (unitPrice == null) throw new AppError('Product price is missing', 400);
    const depositPercent = product.preOrder?.enabled
      ? (product.preOrder.depositPercent ?? 100)
      : 100;
    const { lineTotal, payNow, payLater } = calcPaySplit(unitPrice, input.quantity, depositPercent);
    itemDocs.push({
      productId: product._id,
      variantId: input.variantId,
      name: product.name,
      type: product.type,
      quantity: input.quantity,
      unitPrice,
      lineTotal,
      depositPercent,
      payNow,
      payLater,
      preOrder: !!product.preOrder?.enabled
    });
  }
  return itemDocs;
}

function sumAmounts(items) {
  const subtotal = items.reduce((acc, i) => acc + i.lineTotal, 0);
  const payNowTotal = items.reduce((acc, i) => acc + i.payNow, 0);
  const payLaterTotal = items.reduce((acc, i) => acc + i.payLater, 0);
  return { subtotal, payNowTotal, payLaterTotal };
}

async function quote(itemsInput, shippingFee = 0, discountAmount = 0) {
  const items = await buildItems(itemsInput);
  const { subtotal, payNowTotal, payLaterTotal } = sumAmounts(items);
  const total = subtotal - discountAmount + shippingFee;
  const payNow = Math.max(0, payNowTotal - discountAmount + shippingFee);
  const payLater = Math.max(0, total - payNow);
  return { items, subtotal, shippingFee, discountAmount, total, payNow, payLater };
}

async function createOrder({ userId, itemsInput, shippingFee = 0, discountAmount = 0, shippingMethod = 'standard', shippingAddress, note }) {
  const quoteResult = await quote(itemsInput, shippingFee, discountAmount);
  const paymentCode = generatePaymentCode();
  const orderType = quoteResult.items.some(i => i.preOrder) ? ORDER_TYPES.PRE_ORDER : ORDER_TYPES.READY_STOCK;

  const order = await Order.create({
    userId,
    items: quoteResult.items,
    subtotal: quoteResult.subtotal,
    shippingFee,
    discountAmount,
    total: quoteResult.total,
    payNowTotal: quoteResult.payNow,
    payLaterTotal: quoteResult.payLater,
    paymentMethod: PAYMENT_METHODS.SEPAY,
    paymentStatus: 'pending',
    shippingMethod,
    shippingAddress,
    note,
    paymentCode,
    orderType
  });

  return { order, quote: quoteResult };
}

async function markPaidBySepay(paymentCode, amount, transactionId, webhookId) {
  const order = await Order.findOne({ paymentCode });
  if (!order) throw new AppError('Order not found', 404);

  if (webhookId && Array.isArray(order.sepayWebhookIds) && order.sepayWebhookIds.includes(String(webhookId))) {
    return order; // idempotent by webhook event id
  }

  if (transactionId && order.sepayTransactionId === transactionId) {
    return order; // idempotent
  }

  const paidEnough = amount >= order.payNowTotal;
  order.paymentStatus = paidEnough ? 'paid' : 'partial';
  order.sepayTransactionId = transactionId;

  if (webhookId) {
    order.sepayWebhookIds = [...new Set([...(order.sepayWebhookIds || []), String(webhookId)])];
  }

  await order.save();
  return order;
}

async function getOrderById(id, currentUser) {
  const order = await Order.findById(id);
  if (!order) throw new AppError('Order not found', 404);
  const isOwner = currentUser && String(order.userId) === String(currentUser.id);
  const isStaff = currentUser && ['admin', 'manager', 'operations'].includes(currentUser.role);
  if (!isOwner && !isStaff) {
    throw new AppError('Forbidden', 403);
  }
  return order;
}

async function cancelOrder(id, currentUser) {
  const order = await Order.findById(id);
  if (!order) throw new AppError('Order not found', 404);

  const isOwner = currentUser && String(order.userId) === String(currentUser.id);
  const isStaff = currentUser && ['admin', 'manager', 'operations'].includes(currentUser.role);
  if (!isOwner && !isStaff) throw new AppError('Forbidden', 403);

  // Không cho hủy khi đã giao hoặc đã hủy trước đó
  if (order.status === ORDER_STATUS.CANCELLED) {
    throw new AppError('Order already cancelled', 400);
  }
  if ([ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED, ORDER_STATUS.RETURNED].includes(order.status)) {
    throw new AppError('Order cannot be cancelled at this stage', 400);
  }
  if (order.paymentStatus === 'paid') {
    throw new AppError('Paid order cannot be cancelled', 400);
  }

  order.status = ORDER_STATUS.CANCELLED;
  order.paymentStatus = 'failed';
  await order.save();
  return order;
}

module.exports = {
  quote,
  createOrder,
  markPaidBySepay,
  getOrderById,
  cancelOrder
};
