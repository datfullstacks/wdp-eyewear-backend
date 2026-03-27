const mongoose = require("mongoose");

const { Schema } = mongoose;

const POLICY_CATEGORIES = [
  "warranty",
  "return",
  "refund",
  "shipping",
  "purchase",
  "privacy",
  "terms",
];

const POLICY_STATUSES = ["active", "inactive", "draft"];

const PolicySchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    category: {
      type: String,
      enum: POLICY_CATEGORIES,
      required: true,
    },
    summary: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    effectiveDate: {
      type: Date,
      required: true,
    },
    expiryDate: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: POLICY_STATUSES,
      default: "draft",
    },
    version: {
      type: String,
      required: true,
      trim: true,
      default: "1.0",
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

PolicySchema.index({ category: 1, status: 1, updatedAt: -1 });
PolicySchema.index({ title: "text", summary: "text", content: "text" });

module.exports = {
  Policy: mongoose.model("Policy", PolicySchema),
  POLICY_CATEGORIES,
  POLICY_STATUSES,
};
