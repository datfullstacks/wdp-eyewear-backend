const mongoose = require("mongoose");
const {
  PAYMENT_METHODS,
  ORDER_OPS_STAGE,
  ORDER_STATUS,
  ORDER_TYPES,
} = require("../constants");
const SHIPPING_COLLECTION_TIMING_VALUES = ["upfront", "on_delivery"];

function normalizeShippingCollectionTiming(value) {
  if (value === undefined || value === null || value === "") return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "with_balance") return "on_delivery";
  return SHIPPING_COLLECTION_TIMING_VALUES.includes(normalized) ? normalized : value;
}

const PrescriptionEyeSchema = new mongoose.Schema(
  {
    sphere: { type: String, default: "0" },
    cyl: { type: String, default: "0" },
    axis: { type: String, default: "0" },
    add: { type: String, default: "0" },
  },
  { _id: false },
);

const PrescriptionSchema = new mongoose.Schema(
  {
    mode: { type: String, enum: ["none", "manual", "upload"], default: "none" },
    isMyopic: { type: Boolean, default: false },
    rightEye: { type: PrescriptionEyeSchema, default: () => ({}) },
    leftEye: { type: PrescriptionEyeSchema, default: () => ({}) },
    pd: { type: String, default: "0" },
    note: { type: String, default: "" },
    attachmentUrls: { type: [String], default: [] },
  },
  { _id: false },
);

const ItemCustomizationSchema = new mongoose.Schema(
  {
    selectedColor: { type: String, default: "" },
    selectedSize: { type: String, default: "" },
    photochromic: { type: Boolean, default: false },
    prescription: { type: PrescriptionSchema, default: () => ({}) },
    orderMadeFromPrescriptionImage: { type: Boolean, default: false },
    combineWith: {
      productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
      variantId: { type: mongoose.Schema.Types.ObjectId },
      note: { type: String, default: "" },
    },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const ItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    variantId: { type: mongoose.Schema.Types.ObjectId },
    name: { type: String, required: true },
    type: { type: String },
    variantOptions: {
      color: String,
      size: String,
    },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
    depositPercent: { type: Number, min: 0, max: 100, default: 100 },
    payNow: { type: Number, required: true, min: 0 },
    payLater: { type: Number, required: true, min: 0 },
    preOrder: { type: Boolean, default: false },
    customization: { type: ItemCustomizationSchema, default: () => ({}) },
  },
  { timestamps: false },
);

const ShippingAddressSchema = new mongoose.Schema(
  {
    fullName: String,
    phone: String,
    email: String,
    line1: String,
    line2: String,
    ward: String,
    wardCode: String,
    district: String,
    districtId: Number,
    province: String,
    provinceId: Number,
    country: { type: String, default: "VN" },
    note: String,
  },
  { _id: false },
);

const ShipmentSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ["ghn"], default: "ghn" },
    state: {
      type: String,
      enum: [
        "none",
        "created",
        "in_transit",
        "delivered",
        "returning",
        "returned",
        "cancelled",
        "failed",
      ],
      default: "none",
    },
    orderCode: { type: String, default: "" },
    clientOrderCode: { type: String, default: "" },
    shopId: { type: Number, min: 1 },
    serviceId: { type: Number, min: 0 },
    serviceTypeId: { type: Number, min: 0 },
    serviceName: { type: String, default: "" },
    latestStatus: { type: String, default: "" },
    latestFailCode: { type: String, default: "" },
    latestFailReason: { type: String, default: "" },
    labelToken: { type: String, default: "" },
    leadtime: { type: Date },
    shippingFee: { type: Number, min: 0, default: 0 },
    codAmount: { type: Number, min: 0, default: 0 },
    trackingCode: { type: String, default: "" },
    trackingUrl: { type: String, default: "" },
    lastAction: { type: String, default: "" },
    lastActionAt: { type: Date },
    lastSyncedAt: { type: Date },
    createdAt: { type: Date },
    updatedAt: { type: Date },
    latestSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const OpsChecklistSchema = new mongoose.Schema(
  {
    skuQuantityChecked: { type: Boolean, default: false },
    productConditionChecked: { type: Boolean, default: false },
    addressChecked: { type: Boolean, default: false },
    packageReady: { type: Boolean, default: false },
  },
  { _id: false },
);

const OpsItemStateSchema = new mongoose.Schema(
  {
    picked: { type: Boolean, default: false },
    warehouseLocation: { type: String, default: "" },
    issueType: {
      type: String,
      enum: [
        "out_of_stock",
        "wrong_sku",
        "damaged_item",
        "address_issue",
        "shipping_label_error",
        "other",
        "",
        null,
      ],
      default: null,
    },
    issueNote: { type: String, default: "" },
    internalNote: { type: String, default: "" },
  },
  { _id: false },
);

const OpsExecutionSchema = new mongoose.Schema(
  {
    lastUpdatedAt: { type: Date },
    assignee: { type: String, default: "" },
    salesApprovedAt: { type: Date },
    salesApprovedBy: { type: String, default: "" },
    salesHandoffNote: { type: String, default: "" },
    approvalState: {
      type: String,
      enum: ["none", "manager_review_requested", "sent_back_to_sale"],
      default: "none",
    },
    managerReviewRequestedAt: { type: Date },
    managerReviewRequestedBy: { type: String, default: "" },
    managerReviewReason: { type: String, default: "" },
    prescriptionFollowUpStatus: {
      type: String,
      enum: [
        "none",
        "needs_review",
        "needs_customer_contact",
        "waiting_customer_response",
        "customer_responded",
      ],
      default: "none",
    },
    prescriptionFollowUpNote: { type: String, default: "" },
    prescriptionFollowUpUpdatedAt: { type: Date },
    prescriptionFollowUpUpdatedBy: { type: String, default: "" },
    internalNote: { type: String, default: "" },
    holdReason: {
      type: String,
      enum: ["payment", "address", "stock", "manual", "other", "", null],
      default: null,
    },
    holdNote: { type: String, default: "" },
    paymentFailed: { type: Boolean, default: false },
    checklist: { type: OpsChecklistSchema, default: () => ({}) },
    carrierId: { type: String, default: "" },
    trackingCode: { type: String, default: "" },
    issueType: {
      type: String,
      enum: [
        "out_of_stock",
        "wrong_sku",
        "damaged_item",
        "address_issue",
        "shipping_label_error",
        "other",
        "",
        null,
      ],
      default: null,
    },
    issueNote: { type: String, default: "" },
    itemStates: {
      type: Map,
      of: OpsItemStateSchema,
      default: () => new Map(),
    },
  },
  { _id: false },
);

const InventoryCommitSchema = new mongoose.Schema(
  {
    committedAt: { type: Date },
    committedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    restoredAt: { type: Date },
    restoredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    lastAction: {
      type: String,
      enum: ["none", "deducted", "restored"],
      default: "none",
    },
  },
  { _id: false },
);

const RefundBreakdownSchema = new mongoose.Schema(
  {
    itemAmount: { type: Number, min: 0, default: 0 },
    shippingFeeAmount: { type: Number, min: 0, default: 0 },
    returnShippingFeeAmount: { type: Number, min: 0, default: 0 },
    total: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

const RefundBankAccountSchema = new mongoose.Schema(
  {
    bankCode: { type: String, default: "" },
    bankName: { type: String, default: "" },
    accountNumber: { type: String, default: "" },
    accountHolder: { type: String, default: "" },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const RefundHistoryEntrySchema = new mongoose.Schema(
  {
    action: { type: String, default: "" },
    fromStatus: { type: String, default: "none" },
    toStatus: { type: String, default: "none" },
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    actorRole: { type: String, default: "" },
    actorName: { type: String, default: "" },
    note: { type: String, default: "" },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const PromotionAppliedSchema = new mongoose.Schema(
  {
    promotionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Promotion",
      default: null,
    },
    code: { type: String, default: "" },
    name: { type: String, default: "" },
    type: { type: String, default: "" },
    value: { type: Number, min: 0, default: 0 },
    maxDiscount: { type: Number, min: 0, default: 0 },
    minOrderValue: { type: Number, min: 0, default: 0 },
    cartType: { type: String, default: "all" },
    paymentScope: { type: String, default: "all" },
    applicableCategories: { type: [String], default: [] },
    discountAmountApplied: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

const OrderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store", default: null },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice" },
    items: { type: [ItemSchema], required: true },
    subtotal: { type: Number, required: true, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    shippingFee: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    payNowTotal: { type: Number, required: true, min: 0 },
    payLaterTotal: { type: Number, required: true, min: 0 },
    payLaterMethod: {
      type: String,
      enum: [PAYMENT_METHODS.COD, PAYMENT_METHODS.SEPAY, "", null],
      default: null,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PAYMENT_METHODS),
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "partial", "failed", "refunded"],
      default: "pending",
    },
    paidAmount: { type: Number, default: 0, min: 0 },
    paidAt: { type: Date },
    editWindowEndsAt: { type: Date },
    lastCustomerEditAt: { type: Date },
    customerEditCount: { type: Number, min: 0, default: 0 },
    confirmationDeadlineHours: { type: Number, min: 0, default: 12 },
    shippingMethod: {
      type: String,
      enum: ["standard", "express"],
      default: "standard",
    },
    shippingCollectionTiming: {
      type: String,
      enum: SHIPPING_COLLECTION_TIMING_VALUES,
      default: "upfront",
      set: normalizeShippingCollectionTiming,
    },
    shippingFeeMode: {
      type: String,
      enum: ["exact", "estimated"],
      default: "estimated",
    },
    shippingAddress: ShippingAddressSchema,
    voucherCode: { type: String, trim: true, uppercase: true, default: "" },
    promotionApplied: { type: PromotionAppliedSchema, default: null },
    note: String,
    paymentCode: { type: String },
    sepayTransactionId: String,
    sepayWebhookIds: { type: [String], default: [] },
    orderType: {
      type: String,
      enum: Object.values(ORDER_TYPES),
      default: ORDER_TYPES.READY_STOCK,
    },
    status: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.PENDING,
    },
    opsStage: {
      type: String,
      enum: Object.values(ORDER_OPS_STAGE),
      default: ORDER_OPS_STAGE.NONE,
    },
    opsStageUpdatedAt: { type: Date },
    opsExecution: { type: OpsExecutionSchema, default: () => ({}) },
    inventoryCommit: { type: InventoryCommitSchema, default: () => ({}) },
    shipment: { type: ShipmentSchema, default: () => ({}) },
    confirmedAt: { type: Date },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    refund: {
      status: {
        type: String,
        enum: [
          "none",
          "requested",
          "reviewing",
          "waiting_customer_info",
          "escalated_to_manager",
          "approved",
          "return_pending",
          "return_received",
          "processing",
          "completed",
          "rejected",
        ],
        default: "none",
      },
      reason: { type: String, default: "" },
      requestedAt: { type: Date },
      requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      amount: { type: Number, min: 0, default: 0 },
      responsibility: {
        type: String,
        enum: ["customer", "system", "carrier", "mixed"],
      },
      requiresReturn: { type: Boolean, default: false },
      requestedBreakdown: { type: RefundBreakdownSchema, default: () => ({}) },
      approvedBreakdown: { type: RefundBreakdownSchema, default: () => ({}) },
      bankAccount: { type: RefundBankAccountSchema, default: () => ({}) },
      contactChannels: [{ type: String, enum: ["email", "phone"] }],
      contactNote: { type: String, default: "" },
      contactAt: { type: Date },
      currentOwnerRole: { type: String, default: "none" },
      currentOwnerUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      nextActionCode: { type: String, default: "" },
      approvedAt: { type: Date },
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      escalatedAt: { type: Date },
      escalatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      escalateReason: { type: String, default: "" },
      decisionNote: { type: String, default: "" },
      inspectionStatus: {
        type: String,
        enum: ["not_required", "pending", "passed", "failed"],
        default: "not_required",
      },
      inspectionNote: { type: String, default: "" },
      inspectionAt: { type: Date },
      inspectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      returnShipmentCode: { type: String, default: "" },
      returnCarrier: { type: String, default: "" },
      returnReceivedAt: { type: Date },
      processedAt: { type: Date },
      processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      transactionRef: { type: String, default: "" },
      payoutProofUrl: { type: String, default: "" },
      evidence: { type: [String], default: [] },
      rejectReason: { type: String, default: "" },
      history: { type: [RefundHistoryEntrySchema], default: [] },
    },
  },
  { timestamps: true },
);

OrderSchema.index({ paymentCode: 1 }, { unique: true, sparse: true });
OrderSchema.index({ invoiceId: 1 }, { unique: true, sparse: true });
OrderSchema.index({ "shipment.orderCode": 1 }, { sparse: true });

OrderSchema.pre("validate", function mapLegacyShippingCollectionTiming() {
  if (this.shippingCollectionTiming === "with_balance") {
    this.shippingCollectionTiming = "on_delivery";
  }
});

module.exports = mongoose.model("Order", OrderSchema);
