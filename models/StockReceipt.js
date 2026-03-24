const mongoose = require('mongoose');

const { Schema } = mongoose;

const ReceiptItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    sku: { type: String, default: '' },
    productName: { type: String, required: true },
    variantLabel: { type: String, default: '' },
    quantity: { type: Number, required: true, min: 1 },
    unitCost: { type: Number, default: 0, min: 0 },
    lineTotal: { type: Number, default: 0, min: 0 },
    note: { type: String, default: '' }
  },
  { _id: true, timestamps: false }
);

const StockReceiptSchema = new Schema(
  {
    receiptCode: { type: String, required: true, unique: true, trim: true, uppercase: true },
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', default: null },
    supplier: { type: String, required: true, trim: true },
    warehouseLocation: { type: String, default: '', trim: true },
    receivedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['confirmed'], default: 'confirmed' },
    totalQuantity: { type: Number, required: true, min: 1 },
    items: {
      type: [ReceiptItemSchema],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'items is required'
      }
    },
    note: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

StockReceiptSchema.index({ supplier: 1, createdAt: -1 });
StockReceiptSchema.index({ storeId: 1, createdAt: -1 });
StockReceiptSchema.index({ receivedAt: -1 });

module.exports = mongoose.model('StockReceipt', StockReceiptSchema);
