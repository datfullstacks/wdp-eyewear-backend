const mongoose = require('mongoose');

const { Schema } = mongoose;

const PREORDER_BATCH_STATUSES = ['pending', 'in_transit', 'partial', 'completed', 'delayed'];

const PreorderBatchItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    sku: { type: String, default: '' },
    productName: { type: String, required: true },
    variantLabel: { type: String, default: '' },
    orderedQty: { type: Number, required: true, min: 1 },
    receivedQty: { type: Number, default: 0, min: 0 },
    pendingQty: { type: Number, required: true, min: 0 }
  },
  { _id: true, timestamps: false }
);

const PreorderReceiptItemSchema = new Schema(
  {
    batchItemId: { type: Schema.Types.ObjectId, required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    quantity: { type: Number, required: true, min: 1 }
  },
  { _id: false, timestamps: false }
);

const PreorderReceiptSchema = new Schema(
  {
    receivedAt: { type: Date, default: Date.now },
    items: {
      type: [PreorderReceiptItemSchema],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'Receipt items are required'
      }
    },
    totalReceived: { type: Number, required: true, min: 1 },
    note: { type: String, default: '' },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { _id: true, timestamps: false }
);

const PreorderBatchSchema = new Schema(
  {
    batchCode: { type: String, required: true, unique: true, trim: true, uppercase: true },
    supplier: { type: String, required: true, trim: true },
    orderDate: { type: Date, required: true },
    expectedDate: { type: Date },
    status: {
      type: String,
      enum: PREORDER_BATCH_STATUSES,
      default: 'pending'
    },
    items: {
      type: [PreorderBatchItemSchema],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'items is required'
      }
    },
    totalItems: { type: Number, required: true, min: 1 },
    receivedItems: { type: Number, default: 0, min: 0 },
    receipts: { type: [PreorderReceiptSchema], default: [] },
    note: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

PreorderBatchSchema.index({ status: 1, createdAt: -1 });
PreorderBatchSchema.index({ supplier: 1, createdAt: -1 });
PreorderBatchSchema.index({ expectedDate: 1 });

module.exports = {
  PREORDER_BATCH_STATUSES,
  PreorderBatch: mongoose.model('PreorderBatch', PreorderBatchSchema)
};
