const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const Invoice = require('../models/Invoice');
const AppError = require('../errors/AppError');
const { PAYMENT_METHODS, ORDER_TYPES, ORDER_STATUS, PRODUCT_STATUS } = require('../constants');
const { generatePaymentCode } = require('../helpers/paymentCode');

const STAFF_ROLES = new Set(['admin', 'manager', 'operations', 'sales']);
const ORDER_POPULATE = {
  path: 'invoiceId',
  select: 'invoiceCode status total paidAmount amountDue issuedAt paidAt'
};

function isStaff(user) {
  return Boolean(user && STAFF_ROLES.has(user.role));
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
  const seed = String(paymentCode || orderId || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = (seed || String(orderId || '')).slice(-8).padStart(8, '0');
  return `INV-${datePart}-${suffix}`;
}

function sanitizeShippingAddress(address = {}) {
  if (!address || typeof address !== 'object') {
    return null;
  }

  const fields = [
    'fullName',
    'phone',
    'email',
    'line1',
    'line2',
    'ward',
    'district',
    'province',
    'country',
    'note'
  ];

  const payload = {};
  for (const field of fields) {
    if (address[field] === undefined || address[field] === null) continue;
    payload[field] = String(address[field]).trim();
  }

  if (!payload.country) payload.country = 'VN';
  return payload;
}

function pickDefaultAddressFromUser(user) {
  const addresses = Array.isArray(user?.addresses) ? user.addresses : [];
  if (addresses.length === 0) return null;

  const defaultAddress = addresses.find((addr) => addr && addr.isDefault) || addresses[0];
  if (!defaultAddress) return null;

  return sanitizeShippingAddress(defaultAddress);
}

function ensureShippingAddress(shippingAddress) {
  const normalized = sanitizeShippingAddress(shippingAddress);
  if (!normalized) {
    throw new AppError('shippingAddress is required', 400);
  }

  const requiredFields = ['fullName', 'phone', 'line1', 'district', 'province'];
  for (const field of requiredFields) {
    if (!normalized[field]) {
      throw new AppError(`shippingAddress.${field} is required`, 400);
    }
  }

  return normalized;
}

function pickVariant(product, variantId) {
  if (!variantId) return null;
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const variant = variants.find((item) => String(item._id) === String(variantId));
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

function sumVariantStock(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return variants.reduce((total, variant) => total + Number(variant?.stock || 0), 0);
}

function calcPaySplit(unitPrice, quantity, depositPercent) {
  const lineTotal = unitPrice * quantity;
  const payNow = Math.round(lineTotal * (depositPercent / 100));
  const payLater = lineTotal - payNow;
  return { lineTotal, payNow, payLater };
}

async function buildItems(itemsInput) {
  if (!Array.isArray(itemsInput) || itemsInput.length === 0) {
    throw new AppError('items is required', 400);
  }

  const itemDocs = [];

  for (const input of itemsInput) {
    const productId = input?.productId || input?.product_id;
    if (!productId) {
      throw new AppError('productId is required', 400);
    }

    const quantity = normalizePositiveInteger(input.quantity, 'quantity');
    const product = await Product.findById(productId).select(
      '_id name type status pricing preOrder variants'
    );
    if (!product) {
      throw new AppError('Product not found', 404);
    }

    if (product.status !== PRODUCT_STATUS.ACTIVE) {
      throw new AppError(`Product "${product.name}" is not available for sale`, 400);
    }

    const variant = pickVariant(product, input.variantId);
    const unitPrice = pickPrice(product, variant);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new AppError(`Product "${product.name}" price is missing`, 400);
    }

    const isPreOrder = Boolean(product.preOrder?.enabled);
    if (!isPreOrder) {
      const availableStock = variant ? Number(variant.stock || 0) : sumVariantStock(product);
      if (availableStock < quantity) {
        throw new AppError(`Insufficient stock for "${product.name}"`, 400);
      }
    }

    const depositPercent = isPreOrder ? Number(product.preOrder?.depositPercent ?? 100) : 100;
    const { lineTotal, payNow, payLater } = calcPaySplit(unitPrice, quantity, depositPercent);

    itemDocs.push({
      productId: product._id,
      variantId: variant ? variant._id : (input.variantId || null),
      name: product.name,
      type: product.type,
      quantity,
      unitPrice,
      lineTotal,
      depositPercent,
      payNow,
      payLater,
      preOrder: isPreOrder
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

function mapInvoiceItemsFromOrder(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.map((item) => ({
    productId: item.productId,
    variantId: item.variantId || null,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    lineTotal: item.lineTotal
  }));
}

async function createInvoiceFromOrder(order) {
  const paidAmount = Number(order.paidAmount || 0);
  const expectedPayNow = Number(order.payNowTotal || 0);
  const amountDue = Math.max(0, expectedPayNow - paidAmount);
  const status = amountDue <= 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'issued';

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
    currency: 'VND',
    status,
    issuedAt: order.createdAt || new Date(),
    paidAt: status === 'paid' ? (order.paidAt || new Date()) : undefined,
    notes: order.note || ''
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

function syncInvoiceByOrderState(invoice, order, transactionId) {
  const paidAmount = Number(order.paidAmount || 0);
  const expectedPayNow = Number(order.payNowTotal || 0);
  const amountDue = Math.max(0, expectedPayNow - paidAmount);

  invoice.paidAmount = paidAmount;
  invoice.amountDue = amountDue;
  invoice.status = amountDue <= 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'issued';
  if (invoice.status === 'paid' && !invoice.paidAt) {
    invoice.paidAt = order.paidAt || new Date();
  }
  if (transactionId) {
    invoice.paymentRefs = [...new Set([...(invoice.paymentRefs || []), String(transactionId)])];
  }
}

async function quote(itemsInput, shippingFee = 0, discountAmount = 0) {
  const shippingFeeValue = normalizeNonNegativeNumber(shippingFee, 'shippingFee');
  const discountValue = normalizeNonNegativeNumber(discountAmount, 'discountAmount');

  const items = await buildItems(itemsInput);
  const { subtotal, payNowTotal, payLaterTotal } = sumAmounts(items);
  const total = subtotal - discountValue + shippingFeeValue;
  const payNow = Math.max(0, payNowTotal - discountValue + shippingFeeValue);
  const payLater = Math.max(0, total - payNow);

  return {
    items,
    subtotal,
    shippingFee: shippingFeeValue,
    discountAmount: discountValue,
    total,
    payNow,
    payLater,
    payNowTotal,
    payLaterTotal
  };
}

async function createOrder({
  userId,
  itemsInput,
  shippingFee = 0,
  discountAmount = 0,
  shippingMethod = 'standard',
  shippingAddress,
  note
}) {
  if (!userId) {
    throw new AppError('Unauthorized', 401);
  }

  const user = await User.findById(userId).select('_id addresses');
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const resolvedShippingAddress = ensureShippingAddress(
    shippingAddress || pickDefaultAddressFromUser(user)
  );

  const quoteResult = await quote(itemsInput, shippingFee, discountAmount);
  const paymentCode = generatePaymentCode();
  const orderType = quoteResult.items.some((item) => item.preOrder)
    ? ORDER_TYPES.PRE_ORDER
    : ORDER_TYPES.READY_STOCK;

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
    paymentStatus: quoteResult.payNow > 0 ? 'pending' : 'paid',
    paidAmount: quoteResult.payNow > 0 ? 0 : quoteResult.payNow,
    paidAt: quoteResult.payNow > 0 ? undefined : new Date(),
    shippingMethod,
    shippingAddress: resolvedShippingAddress,
    note,
    paymentCode,
    orderType
  });

  try {
    const invoice = await createInvoiceFromOrder(order);
    order.invoiceId = invoice._id;
    await order.save();
    return { order, quote: quoteResult, invoice };
  } catch (error) {
    await Order.findByIdAndDelete(order._id);
    throw error;
  }
}

async function markPaidBySepay(paymentCode, amount, transactionId, webhookId) {
  const normalizedAmount = Number(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new AppError('Invalid payment amount', 400);
  }

  const order = await Order.findOne({ paymentCode });
  if (!order) throw new AppError('Order not found', 404);

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
  const paidEnough = Number(order.paidAmount || 0) >= Number(order.payNowTotal || 0);
  order.paymentStatus = paidEnough ? 'paid' : 'partial';
  if (paidEnough && !order.paidAt) {
    order.paidAt = new Date();
  }
  if (paidEnough && order.status === ORDER_STATUS.PENDING) {
    order.status = ORDER_STATUS.CONFIRMED;
  }

  if (transactionId) {
    order.sepayTransactionId = String(transactionId);
  }

  if (webhookId) {
    order.sepayWebhookIds = [
      ...new Set([...(order.sepayWebhookIds || []), String(webhookId)])
    ];
  }

  const invoice = await ensureOrderInvoice(order);
  syncInvoiceByOrderState(invoice, order, transactionId);

  await Promise.all([order.save(), invoice.save()]);
  return Order.findById(order._id).populate(ORDER_POPULATE);
}

async function getOrderById(id, currentUser) {
  const order = await Order.findById(id).populate(ORDER_POPULATE);
  if (!order) throw new AppError('Order not found', 404);

  const isOwner = currentUser && String(order.userId) === String(currentUser.id);
  if (!isOwner && !isStaff(currentUser)) {
    throw new AppError('Forbidden', 403);
  }

  return order;
}

async function cancelOrder(id, currentUser) {
  const order = await Order.findById(id);
  if (!order) throw new AppError('Order not found', 404);

  const isOwner = currentUser && String(order.userId) === String(currentUser.id);
  if (!isOwner && !isStaff(currentUser)) {
    throw new AppError('Forbidden', 403);
  }

  if (order.status === ORDER_STATUS.CANCELLED) {
    throw new AppError('Order already cancelled', 400);
  }

  if (
    [ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED, ORDER_STATUS.RETURNED].includes(order.status)
  ) {
    throw new AppError('Order cannot be cancelled at this stage', 400);
  }

  if (order.paymentStatus === 'paid' || Number(order.paidAmount || 0) > 0) {
    throw new AppError('Order with received payment cannot be cancelled', 400);
  }

  order.status = ORDER_STATUS.CANCELLED;
  order.paymentStatus = 'failed';

  const invoice = await ensureOrderInvoice(order);
  invoice.status = 'void';
  invoice.amountDue = 0;

  await Promise.all([order.save(), invoice.save()]);
  return Order.findById(order._id).populate(ORDER_POPULATE);
}

async function listOrders(currentUser, options = {}) {
  if (!currentUser) {
    throw new AppError('Unauthorized', 401);
  }

  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 10));
  const skip = (page - 1) * limit;
  const query = {};

  if (isStaff(currentUser) && options.userId) {
    query.userId = options.userId;
  } else {
    query.userId = currentUser.id;
  }

  if (options.status) {
    query.status = String(options.status).trim().toLowerCase();
  }

  if (options.paymentStatus) {
    query.paymentStatus = String(options.paymentStatus).trim().toLowerCase();
  }

  const [orders, total] = await Promise.all([
    Order.find(query).populate(ORDER_POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(query)
  ]);

  return {
    orders,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

module.exports = {
  quote,
  createOrder,
  markPaidBySepay,
  getOrderById,
  cancelOrder,
  listOrders
};
