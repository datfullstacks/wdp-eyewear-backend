const SupportTicket = require('../models/SupportTicket');
const Order = require('../models/Order');
const AppError = require('../errors/AppError');
const { isBusinessUser } = require('../helpers/roles');
const { buildStoreScopedQuery } = require('../helpers/storeAccess');
const { publishStatusChange } = require('../helpers/statusEvents');

function formatCurrencyNumber(value) {
  return Math.round(Number(value || 0));
}

function buildRefundBreakdown(value) {
  return {
    itemAmount: formatCurrencyNumber(value?.itemAmount || 0),
    shippingFeeAmount: formatCurrencyNumber(value?.shippingFeeAmount || 0),
    returnShippingFeeAmount: formatCurrencyNumber(value?.returnShippingFeeAmount || 0),
    total: formatCurrencyNumber(value?.total || 0),
  };
}

function resolveRefundMethod(order, bankInfo) {
  if (bankInfo?.accountNumber || bankInfo?.bankName) {
    return 'bank_transfer';
  }

  switch (String(order?.paymentMethod || '').trim().toLowerCase()) {
    case 'credit_card':
      return 'card';
    case 'cash':
    case 'cod':
      return 'cash';
    case 'e_wallet':
      return 'wallet';
    default:
      return 'bank_transfer';
  }
}

function buildRefundReference(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  return `RF-${(normalized || 'UNKNOWN').slice(-8)}`;
}

function mapRefundCase(order) {
  const requestedBreakdown = buildRefundBreakdown(order?.refund?.requestedBreakdown);
  const approvedBreakdown = buildRefundBreakdown(order?.refund?.approvedBreakdown);
  const bankInfo = order?.refund?.bankAccount || null;
  const amount =
    approvedBreakdown.total ||
    requestedBreakdown.total ||
    formatCurrencyNumber(order?.refund?.amount || 0) ||
    formatCurrencyNumber(order?.paidAmount || 0) ||
    formatCurrencyNumber(order?.total || 0);

  return {
    orderInternalId: String(order?._id || ''),
    id: buildRefundReference(order?.paymentCode || order?._id),
    orderId: String(order?.paymentCode || order?._id || ''),
    customerName: String(order?.shippingAddress?.fullName || '').trim() || 'Customer',
    customerPhone: String(order?.shippingAddress?.phone || '').trim(),
    amount,
    reason: String(order?.refund?.reason || '').trim() || 'Khach yeu cau hoan tien',
    method: resolveRefundMethod(order, bankInfo),
    paymentMethod: String(order?.paymentMethod || '').trim().toLowerCase(),
    status: String(order?.refund?.status || 'none').trim().toLowerCase(),
    createdAt: order?.refund?.requestedAt || order?.createdAt || null,
    processedAt: order?.refund?.processedAt || null,
    bankInfo: bankInfo
      ? {
          bankName: String(bankInfo.bankName || '').trim(),
          accountNumber: String(bankInfo.accountNumber || '').trim(),
          accountHolder: String(bankInfo.accountHolder || '').trim(),
          note: String(bankInfo.note || '').trim(),
        }
      : undefined,
    notes:
      String(order?.refund?.decisionNote || '').trim() ||
      String(order?.refund?.contactNote || '').trim() ||
      String(order?.refund?.rejectReason || '').trim() ||
      String(order?.note || '').trim(),
    responsibility: String(order?.refund?.responsibility || '').trim().toLowerCase() || undefined,
    requiresReturn: Boolean(order?.refund?.requiresReturn),
    requestedBreakdown,
    approvedBreakdown,
    rejectReason: String(order?.refund?.rejectReason || '').trim(),
    decisionNote: String(order?.refund?.decisionNote || '').trim(),
    escalateReason: String(order?.refund?.escalateReason || '').trim(),
    currentOwnerRole: String(order?.refund?.currentOwnerRole || 'none').trim().toLowerCase(),
    currentOwnerUserId: order?.refund?.currentOwnerUserId
      ? String(order.refund.currentOwnerUserId)
      : undefined,
    nextActionCode: String(order?.refund?.nextActionCode || '').trim().toLowerCase(),
    inspectionStatus: String(order?.refund?.inspectionStatus || 'not_required')
      .trim()
      .toLowerCase(),
    inspectionNote: String(order?.refund?.inspectionNote || '').trim(),
    inspectionAt: order?.refund?.inspectionAt || null,
    returnShipmentCode: String(order?.refund?.returnShipmentCode || '').trim(),
    returnCarrier: String(order?.refund?.returnCarrier || '').trim().toLowerCase(),
    returnReceivedAt: order?.refund?.returnReceivedAt || null,
    transactionRef: String(order?.refund?.transactionRef || '').trim(),
    payoutProofUrl: String(order?.refund?.payoutProofUrl || '').trim(),
    evidence: Array.isArray(order?.refund?.evidence)
      ? order.refund.evidence
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      : [],
    history: Array.isArray(order?.refund?.history) ? order.refund.history : [],
  };
}

class SupportService {
  normalizeCreatePayload(payload = {}) {
    const subject = String(payload.subject || '').trim();
    const message = String(payload.message || '').trim();
    const category = String(payload.category || 'general').trim().toLowerCase() || 'general';
    const priority = String(payload.priority || 'normal').trim().toLowerCase() || 'normal';
    const email = String(payload.email || '').trim();
    const orderId = payload.orderId || null;

    if (!subject) throw new AppError('subject is required', 400);
    if (!message) throw new AppError('message is required', 400);

    return { subject, message, category, priority, email, orderId };
  }

  async createTicket(currentUser, payload = {}) {
    if (!currentUser) throw new AppError('Unauthorized', 401);
    const data = this.normalizeCreatePayload(payload);

    const ticket = await SupportTicket.create({
      userId: currentUser.id,
      email: data.email || currentUser.email || '',
      subject: data.subject,
      category: data.category,
      priority: data.priority,
      orderId: data.orderId,
      messages: [
        {
          sender: 'user',
          message: data.message
        }
      ],
      lastMessageAt: new Date()
    });

    return ticket;
  }

  async listTickets(currentUser, options = {}) {
    if (!currentUser) throw new AppError('Unauthorized', 401);

    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 10));
    const skip = (page - 1) * limit;
    const query = {};

    const isStaff = isBusinessUser(currentUser);
    if (isStaff && options.userId) {
      query.userId = options.userId;
    } else if (!isStaff) {
      query.userId = currentUser.id;
    }

    if (options.status) {
      query.status = String(options.status).trim().toLowerCase();
    }

    const [tickets, total] = await Promise.all([
      SupportTicket.find(query).sort({ lastMessageAt: -1, createdAt: -1 }).skip(skip).limit(limit),
      SupportTicket.countDocuments(query)
    ]);

    return {
      tickets,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async getTicketById(id, currentUser) {
    if (!currentUser) throw new AppError('Unauthorized', 401);

    const ticket = await SupportTicket.findById(id);
    if (!ticket) throw new AppError('Support ticket not found', 404);

    const isOwner = String(ticket.userId) === String(currentUser.id);
    const isStaff = isBusinessUser(currentUser);
    if (!isOwner && !isStaff) {
      throw new AppError('Forbidden', 403);
    }

    return ticket;
  }

  async addReply(id, currentUser, payload = {}) {
    const ticket = await this.getTicketById(id, currentUser);
    const message = String(payload.message || '').trim();
    if (!message) throw new AppError('message is required', 400);

    const isStaff = isBusinessUser(currentUser);
    const previousStatus = ticket.status;
    ticket.messages.push({
      sender: isStaff ? 'staff' : 'user',
      message
    });

    if (ticket.status === 'closed') {
      ticket.status = 'in_progress';
    } else if (isStaff && ticket.status === 'open') {
      ticket.status = 'in_progress';
    }

    ticket.lastMessageAt = new Date();
    await ticket.save();

    publishStatusChange({
      domain: 'support',
      entityId: ticket._id,
      previousStatus,
      nextStatus: ticket.status,
      currentUser,
      recipientUserIds: [ticket.userId],
      meta: {
        category: ticket.category,
        priority: ticket.priority,
      },
    });

    return ticket;
  }

  async updateStatus(id, currentUser, status) {
    const isStaff = isBusinessUser(currentUser);
    if (!isStaff) throw new AppError('Forbidden', 403);

    const normalized = String(status || '').trim().toLowerCase();
    if (!['open', 'in_progress', 'resolved', 'closed'].includes(normalized)) {
      throw new AppError('Invalid status', 400);
    }

    const ticket = await SupportTicket.findById(id);
    if (!ticket) throw new AppError('Support ticket not found', 404);
    const previousStatus = ticket.status;

    ticket.status = normalized;
    await ticket.save();

    publishStatusChange({
      domain: 'support',
      entityId: ticket._id,
      previousStatus,
      nextStatus: ticket.status,
      currentUser,
      recipientUserIds: [ticket.userId],
      meta: {
        category: ticket.category,
        priority: ticket.priority,
      },
    });

    return ticket;
  }

  async listRefundCases(currentUser, options = {}) {
    if (!currentUser) throw new AppError('Unauthorized', 401);
    if (!isBusinessUser(currentUser) && currentUser.role !== 'admin') {
      throw new AppError('Forbidden', 403);
    }

    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
    const skip = (page - 1) * limit;
    const status = String(options.status || '').trim().toLowerCase();
    const ownerRole = String(options.ownerRole || options.owner_role || '')
      .trim()
      .toLowerCase();
    const search = String(options.q || options.search || '').trim().toLowerCase();

    const query = {
      'refund.status': { $nin: [null, 'none'] },
      ...buildStoreScopedQuery(currentUser, 'storeId'),
    };

    if (status) {
      query['refund.status'] = status;
    }

    if (ownerRole) {
      query['refund.currentOwnerRole'] = ownerRole;
    }

    if (search) {
      query.$or = [
        { paymentCode: { $regex: search, $options: 'i' } },
        { 'shippingAddress.fullName': { $regex: search, $options: 'i' } },
        { 'shippingAddress.phone': { $regex: search, $options: 'i' } },
        { 'refund.reason': { $regex: search, $options: 'i' } },
        { 'refund.status': { $regex: search, $options: 'i' } },
        { 'refund.currentOwnerRole': { $regex: search, $options: 'i' } },
        { 'refund.nextActionCode': { $regex: search, $options: 'i' } },
      ];
    }

    const [orders, total] = await Promise.all([
      Order.find(query)
        .select(
          '_id paymentCode paymentMethod total paidAmount note createdAt shippingAddress refund',
        )
        .sort({ 'refund.requestedAt': -1, updatedAt: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(query),
    ]);

    const rows = orders.map(mapRefundCase);

    return {
      cases: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

module.exports = new SupportService();
