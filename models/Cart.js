const mongoose = require('mongoose');

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

const CartItemCustomizationSchema = new mongoose.Schema({
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

const CartItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId },
  quantity: { type: Number, min: 1, required: true },
  preOrder: { type: Boolean, default: false },
  customization: { type: CartItemCustomizationSchema, default: () => ({}) }
}, { timestamps: false });

const CartSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  cartType: { type: String, enum: ['ready_stock', 'pre_order'], required: true },
  items: { type: [CartItemSchema], default: [] }
}, { timestamps: true });

CartSchema.index({ userId: 1, cartType: 1 }, { unique: true });

module.exports = mongoose.model('Cart', CartSchema);
