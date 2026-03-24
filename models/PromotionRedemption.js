const mongoose = require("mongoose");

const { Schema } = mongoose;

const REDEMPTION_STATES = ["reserved", "consumed", "released"];
const RESPONSIBILITIES = ["customer", "system", "carrier", "mixed"];
const PAYMENT_METHODS = ["", "sepay", "cod"];

const PromotionRedemptionSchema = new Schema(
  {
    promotionId: {
      type: Schema.Types.ObjectId,
      ref: "Promotion",
      required: true,
      index: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    state: {
      type: String,
      enum: REDEMPTION_STATES,
      default: "reserved",
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      default: "",
    },
    orderStatus: {
      type: String,
      default: "",
    },
    paymentStatus: {
      type: String,
      default: "",
    },
    releaseReason: {
      type: String,
      default: "",
    },
    responsibility: {
      type: String,
      enum: [...RESPONSIBILITIES, ""],
      default: "",
    },
    reservedAt: {
      type: Date,
      default: Date.now,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
    releasedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

PromotionRedemptionSchema.index(
  { promotionId: 1, orderId: 1 },
  { unique: true, name: "promotion_order_unique" },
);

module.exports = {
  PromotionRedemption: mongoose.model(
    "PromotionRedemption",
    PromotionRedemptionSchema,
  ),
  PROMOTION_REDEMPTION_STATES: REDEMPTION_STATES,
};
