const mongoose = require('mongoose');

const SupportMessageSchema = new mongoose.Schema(
  {
    sender: {
      type: String,
      enum: ['user', 'staff'],
      required: true
    },
    message: {
      type: String,
      required: true,
      trim: true
    }
  },
  { _id: true, timestamps: true }
);

const SupportTicketSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    email: {
      type: String,
      default: ''
    },
    subject: {
      type: String,
      required: true,
      trim: true
    },
    category: {
      type: String,
      default: 'general'
    },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'resolved', 'closed'],
      default: 'open'
    },
    priority: {
      type: String,
      enum: ['low', 'normal', 'high'],
      default: 'normal'
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null
    },
    messages: {
      type: [SupportMessageSchema],
      default: []
    },
    lastMessageAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

SupportTicketSchema.index({ userId: 1, createdAt: -1 });
SupportTicketSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('SupportTicket', SupportTicketSchema);
