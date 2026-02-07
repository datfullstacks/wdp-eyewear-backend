const SupportTicket = require('../models/SupportTicket');
const AppError = require('../errors/AppError');

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

    const isStaff = ['admin', 'manager', 'operations', 'sales'].includes(currentUser.role);
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
    const isStaff = ['admin', 'manager', 'operations', 'sales'].includes(currentUser.role);
    if (!isOwner && !isStaff) {
      throw new AppError('Forbidden', 403);
    }

    return ticket;
  }

  async addReply(id, currentUser, payload = {}) {
    const ticket = await this.getTicketById(id, currentUser);
    const message = String(payload.message || '').trim();
    if (!message) throw new AppError('message is required', 400);

    const isStaff = ['admin', 'manager', 'operations', 'sales'].includes(currentUser.role);
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
    return ticket;
  }

  async updateStatus(id, currentUser, status) {
    const isStaff = ['admin', 'manager', 'operations', 'sales'].includes(currentUser?.role);
    if (!isStaff) throw new AppError('Forbidden', 403);

    const normalized = String(status || '').trim().toLowerCase();
    if (!['open', 'in_progress', 'resolved', 'closed'].includes(normalized)) {
      throw new AppError('Invalid status', 400);
    }

    const ticket = await SupportTicket.findById(id);
    if (!ticket) throw new AppError('Support ticket not found', 404);

    ticket.status = normalized;
    await ticket.save();
    return ticket;
  }
}

module.exports = new SupportService();
