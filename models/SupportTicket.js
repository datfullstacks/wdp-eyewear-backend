const mongoose = require('mongoose');

const SUPPORT_TICKET_CATEGORIES = [
  'general',
  'order',
  'prescription',
  'shipping',
  'refund',
  'return',
  'warranty',
];
const GENERAL_SUPPORT_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const WARRANTY_SUPPORT_STATUSES = [
  'requested',
  'under_review',
  'approved',
  'rejected',
  'in_service',
  'completed',
];
const SUPPORT_TICKET_STATUSES = [
  ...GENERAL_SUPPORT_STATUSES,
  ...WARRANTY_SUPPORT_STATUSES,
];
const SUPPORT_TICKET_OWNER_ROLES = [
  'none',
  'customer',
  'sales',
  'operations',
  'manager',
];

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

const WarrantyMetadataSchema = new mongoose.Schema(
  {
    orderItemId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
    },
    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    itemName: {
      type: String,
      default: '',
    },
    warrantyMonths: {
      type: Number,
      min: 0,
      default: 0,
    },
    referenceDate: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    eligibility: {
      type: String,
      enum: ['eligible', 'expired', 'not_covered'],
      default: 'not_covered',
    },
    decisionNote: {
      type: String,
      default: '',
    },
    serviceNote: {
      type: String,
      default: '',
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false, timestamps: false }
);

const SupportRoutingHistorySchema = new mongoose.Schema(
  {
    fromOwnerRole: {
      type: String,
      enum: SUPPORT_TICKET_OWNER_ROLES,
      default: 'none',
    },
    toOwnerRole: {
      type: String,
      enum: SUPPORT_TICKET_OWNER_ROLES,
      default: 'none',
    },
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    note: {
      type: String,
      default: '',
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true, timestamps: false }
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
      enum: SUPPORT_TICKET_CATEGORIES,
      default: 'general'
    },
    status: {
      type: String,
      enum: SUPPORT_TICKET_STATUSES,
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
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      default: null
    },
    warranty: {
      type: WarrantyMetadataSchema,
      default: null,
    },
    currentOwnerRole: {
      type: String,
      enum: SUPPORT_TICKET_OWNER_ROLES,
      default: 'none',
    },
    currentOwnerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    nextActionCode: {
      type: String,
      default: '',
      trim: true,
    },
    routingHistory: {
      type: [SupportRoutingHistorySchema],
      default: [],
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
SupportTicketSchema.index({ category: 1, status: 1, createdAt: -1 });
SupportTicketSchema.index({ storeId: 1, createdAt: -1 });

module.exports = {
  SupportTicket: mongoose.model('SupportTicket', SupportTicketSchema),
  SUPPORT_TICKET_CATEGORIES,
  GENERAL_SUPPORT_STATUSES,
  WARRANTY_SUPPORT_STATUSES,
  SUPPORT_TICKET_STATUSES,
  SUPPORT_TICKET_OWNER_ROLES,
};
