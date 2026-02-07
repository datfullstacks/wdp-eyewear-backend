const mongoose = require('mongoose');

const InvoiceItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId },
  name: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  lineTotal: { type: Number, required: true, min: 0 }
}, { _id: false });

const InvoiceSchema = new mongoose.Schema({
  invoiceCode: { type: String, required: true, unique: true, trim: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: { type: [InvoiceItemSchema], default: [] },
  subtotal: { type: Number, required: true, min: 0 },
  discountAmount: { type: Number, default: 0, min: 0 },
  shippingFee: { type: Number, default: 0, min: 0 },
  total: { type: Number, required: true, min: 0 },
  paidAmount: { type: Number, default: 0, min: 0 },
  amountDue: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'VND', uppercase: true, trim: true },
  status: {
    type: String,
    enum: ['issued', 'partial', 'paid', 'void'],
    default: 'issued'
  },
  paymentRefs: { type: [String], default: [] },
  notes: { type: String, default: '' },
  issuedAt: { type: Date, default: Date.now },
  paidAt: { type: Date }
}, { timestamps: true });

InvoiceSchema.index({ userId: 1, createdAt: -1 });
InvoiceSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Invoice', InvoiceSchema);
