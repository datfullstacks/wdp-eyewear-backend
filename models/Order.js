const mongoose = require('mongoose');
const { PAYMENT_METHODS, ORDER_STATUS, ORDER_TYPES } = require('../constants');

const PrescriptionEyeSchema = new mongoose.Schema({
  sphere: { type: String, default: '0' },
  cyl: { type: String, default: '0' },
  axis: { type: String, default: '0' },
  add: { type: String, default: '0' }
}, { _id: false });

const PrescriptionSchema = new mongoose.Schema({
  mode: { type: String, enum: ['none', 'manual', 'upload'], default: 'none' },
  isMyopic: { type: Boolean, default: false },
  rightEye: { type: PrescriptionEyeSchema, default: () => ({}) },
  leftEye: { type: PrescriptionEyeSchema, default: () => ({}) },
  pd: { type: String, default: '0' },
  note: { type: String, default: '' },
  attachmentUrls: { type: [String], default: [] }
}, { _id: false });

const ItemCustomizationSchema = new mongoose.Schema({
  selectedColor: { type: String, default: '' },
  selectedSize: { type: String, default: '' },
  photochromic: { type: Boolean, default: false },
  prescription: { type: PrescriptionSchema, default: () => ({}) },
  orderMadeFromPrescriptionImage: { type: Boolean, default: false },
  combineWith: {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    variantId: { type: mongoose.Schema.Types.ObjectId },
    note: { type: String, default: '' }
  },
  note: { type: String, default: '' }
}, { _id: false });

const ItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId },
  name: { type: String, required: true },
  type: { type: String },
  variantOptions: {
    color: String,
    size: String
  },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  lineTotal: { type: Number, required: true, min: 0 },
  depositPercent: { type: Number, min: 0, max: 100, default: 100 },
  payNow: { type: Number, required: true, min: 0 },
  payLater: { type: Number, required: true, min: 0 },
  preOrder: { type: Boolean, default: false },
  customization: { type: ItemCustomizationSchema, default: () => ({}) }
}, { timestamps: false });

const ShippingAddressSchema = new mongoose.Schema({
  fullName: String,
  phone: String,
  email: String,
  line1: String,
  line2: String,
  ward: String,
  district: String,
  province: String,
  country: { type: String, default: 'VN' },
  note: String
}, { _id: false });

const OrderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
  items: { type: [ItemSchema], required: true },
  subtotal: { type: Number, required: true, min: 0 },
  discountAmount: { type: Number, default: 0, min: 0 },
  shippingFee: { type: Number, default: 0, min: 0 },
  total: { type: Number, required: true, min: 0 },
  payNowTotal: { type: Number, required: true, min: 0 },
  payLaterTotal: { type: Number, required: true, min: 0 },
  paymentMethod: { type: String, enum: Object.values(PAYMENT_METHODS), required: true },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'partial', 'failed', 'refunded'], default: 'pending' },
  paidAmount: { type: Number, default: 0, min: 0 },
  paidAt: { type: Date },
  editWindowEndsAt: { type: Date },
  lastCustomerEditAt: { type: Date },
  customerEditCount: { type: Number, min: 0, default: 0 },
  confirmationDeadlineHours: { type: Number, min: 0, default: 12 },
  shippingMethod: { type: String, enum: ['standard', 'express'], default: 'standard' },
  shippingAddress: ShippingAddressSchema,
  voucherCode: { type: String, trim: true, uppercase: true, default: '' },
  note: String,
  paymentCode: { type: String },
  sepayTransactionId: String,
  sepayWebhookIds: { type: [String], default: [] },
  orderType: { type: String, enum: Object.values(ORDER_TYPES), default: ORDER_TYPES.READY_STOCK },
  status: { type: String, enum: Object.values(ORDER_STATUS), default: ORDER_STATUS.PENDING },
  confirmedAt: { type: Date },
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  refund: {
    status: {
      type: String,
      enum: ['none', 'requested', 'processing', 'completed', 'rejected'],
      default: 'none'
    },
    reason: { type: String, default: '' },
    requestedAt: { type: Date },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    amount: { type: Number, min: 0, default: 0 },
    bankAccount: {
      bankName: String,
      accountNumber: String,
      accountHolder: String,
      note: String
    },
    contactChannels: [{ type: String, enum: ['email', 'phone'] }],
    contactNote: { type: String, default: '' },
    contactAt: { type: Date },
    processedAt: { type: Date },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectReason: { type: String, default: '' }
  }
}, { timestamps: true });

OrderSchema.index({ paymentCode: 1 }, { unique: true, sparse: true });
OrderSchema.index({ invoiceId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Order', OrderSchema);
