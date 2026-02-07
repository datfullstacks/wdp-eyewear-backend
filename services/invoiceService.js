const Invoice = require('../models/Invoice');
const AppError = require('../errors/AppError');

const STAFF_ROLES = new Set(['admin', 'manager', 'operations', 'sales']);

function isStaff(user) {
  return Boolean(user && STAFF_ROLES.has(user.role));
}

async function getInvoiceById(invoiceId, currentUser) {
  const invoice = await Invoice.findById(invoiceId)
    .populate({ path: 'orderId', select: 'status paymentStatus paymentCode createdAt' })
    .populate({ path: 'userId', select: 'name email role' });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  const isOwner = currentUser && String(invoice.userId?._id || invoice.userId) === String(currentUser.id);
  if (!isOwner && !isStaff(currentUser)) {
    throw new AppError('Forbidden', 403);
  }

  return invoice;
}

async function getInvoiceByOrderId(orderId, currentUser) {
  const invoice = await Invoice.findOne({ orderId })
    .populate({ path: 'orderId', select: 'status paymentStatus paymentCode createdAt' })
    .populate({ path: 'userId', select: 'name email role' });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  const isOwner = currentUser && String(invoice.userId?._id || invoice.userId) === String(currentUser.id);
  if (!isOwner && !isStaff(currentUser)) {
    throw new AppError('Forbidden', 403);
  }

  return invoice;
}

async function listInvoices(currentUser, options = {}) {
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

  if (options.orderId) {
    query.orderId = options.orderId;
  }

  const [invoices, total] = await Promise.all([
    Invoice.find(query)
      .populate({ path: 'orderId', select: 'status paymentStatus paymentCode createdAt' })
      .populate({ path: 'userId', select: 'name email role' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Invoice.countDocuments(query)
  ]);

  return {
    invoices,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

module.exports = {
  listInvoices,
  getInvoiceById,
  getInvoiceByOrderId
};
