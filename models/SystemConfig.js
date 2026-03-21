const mongoose = require("mongoose");

const { Schema } = mongoose;

const BooleanFlagSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
  },
  { _id: false },
);

const SystemConfigSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: "default",
      trim: true,
    },
    featureFlags: {
      preorderEnabled: { type: Boolean, default: true },
      splitPaymentEnabled: { type: Boolean, default: true },
      refundWorkflowEnabled: { type: Boolean, default: true },
      managerPolicyEditorEnabled: { type: Boolean, default: true },
    },
    payments: {
      payNowGateway: {
        type: String,
        enum: ["sepay"],
        default: "sepay",
      },
      codEnabled: { type: Boolean, default: true },
      supportedPayNowMethods: {
        type: [String],
        default: ["sepay"],
      },
    },
    shipping: {
      defaultCarrier: {
        type: String,
        enum: ["ghn"],
        default: "ghn",
      },
      ghnEnabled: { type: Boolean, default: true },
      allowEstimatedShippingFee: { type: Boolean, default: true },
    },
    notifications: {
      emailEnabled: { type: Boolean, default: true },
      pushEnabled: { type: Boolean, default: true },
      smsEnabled: { type: Boolean, default: false },
    },
    refunds: {
      staffApprovalLimit: { type: Number, min: 0, default: 300000 },
      requiresManagerForReturn: { type: Boolean, default: true },
      requiresManagerForShippingRefund: { type: Boolean, default: true },
      requirePayoutProof: { type: Boolean, default: false },
    },
    integrations: {
      sepay: { type: BooleanFlagSchema, default: () => ({ enabled: true }) },
      ghn: { type: BooleanFlagSchema, default: () => ({ enabled: true }) },
    },
    maintenanceMode: { type: Boolean, default: false },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = {
  SystemConfig: mongoose.model("SystemConfig", SystemConfigSchema),
};
