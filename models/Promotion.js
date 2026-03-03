const mongoose = require('mongoose');

const { Schema } = mongoose;

const PROMOTION_TYPES = ['percent', 'fixed'];
const CART_TYPES = ['ready_stock', 'pre_order'];

const PromotionSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true
    },
    name: { type: String, default: '' },
    description: { type: String, default: '' },
    type: {
      type: String,
      enum: PROMOTION_TYPES,
      required: true
    },
    value: {
      type: Number,
      required: true,
      min: 0
    },
    maxDiscount: {
      type: Number,
      min: 0,
      default: 0
    },
    minOrderValue: {
      type: Number,
      min: 0,
      default: 0
    },
    active: {
      type: Boolean,
      default: true
    },
    startsAt: { type: Date },
    endsAt: { type: Date },
    cartType: {
      type: String,
      enum: [...CART_TYPES, 'all'],
      default: 'all'
    },
    usageLimit: {
      type: Number,
      min: 0,
      default: 0
    },
    usedCount: {
      type: Number,
      min: 0,
      default: 0
    }
  },
  { timestamps: true }
);

PromotionSchema.index({ active: 1, startsAt: 1, endsAt: 1 });

module.exports = {
  Promotion: mongoose.model('Promotion', PromotionSchema),
  PROMOTION_TYPES,
  PROMOTION_CART_TYPES: CART_TYPES
};
