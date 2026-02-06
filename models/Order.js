const mongoose = require('mongoose');
const { PAYMENT_METHODS, ORDER_STATUS, ORDER_TYPES } = require('../constants');

const ItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId },
  name: { type: String, required: true },
  type: { type: String },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  lineTotal: { type: Number, required: true, min: 0 },
  depositPercent: { type: Number, min: 0, max: 100, default: 100 },
  payNow: { type: Number, required: true, min: 0 },
  payLater: { type: Number, required: true, min: 0 },
  preOrder: { type: Boolean, default: false }
}, { _id: false });

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
  items: { type: [ItemSchema], required: true },
  subtotal: { type: Number, required: true, min: 0 },
  discountAmount: { type: Number, default: 0, min: 0 },
  shippingFee: { type: Number, default: 0, min: 0 },
  total: { type: Number, required: true, min: 0 },
  payNowTotal: { type: Number, required: true, min: 0 },
  payLaterTotal: { type: Number, required: true, min: 0 },
  paymentMethod: { type: String, enum: Object.values(PAYMENT_METHODS), required: true },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'partial', 'failed'], default: 'pending' },
  shippingMethod: { type: String, enum: ['standard', 'express'], default: 'standard' },
  shippingAddress: ShippingAddressSchema,
  note: String,
  paymentCode: { type: String, index: true },
  sepayTransactionId: String,
  orderType: { type: String, enum: Object.values(ORDER_TYPES), default: ORDER_TYPES.READY_STOCK },
  status: { type: String, enum: Object.values(ORDER_STATUS), default: ORDER_STATUS.PENDING }
}, { timestamps: true });

OrderSchema.index({ paymentCode: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Order', OrderSchema);
