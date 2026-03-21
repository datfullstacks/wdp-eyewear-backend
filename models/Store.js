const mongoose = require('mongoose');

const { Schema } = mongoose;

const ghnStoreSchema = new Schema(
  {
    shopId: { type: Number, min: 1, default: null },
    clientId: { type: Number, min: 1, default: null },
    provinceId: { type: Number, min: 1, default: null },
    provinceName: { type: String, trim: true, default: "" },
    districtId: { type: Number, min: 1, default: null },
    districtName: { type: String, trim: true, default: "" },
    wardCode: { type: String, trim: true, default: "" },
    wardName: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
    syncedAt: { type: Date, default: null },
    lastSyncError: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const storeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    type: {
      type: String,
      enum: ['flagship', 'branch', 'kiosk', 'warehouse'],
      default: 'branch',
    },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    addressLine1: { type: String, trim: true, default: '' },
    ward: { type: String, trim: true, default: '' },
    district: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    openingHours: { type: String, trim: true, default: '' },
    note: { type: String, trim: true, default: '' },
    supportsTryOn: { type: Boolean, default: false },
    supportsPickup: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0, min: 0 },
    ghn: { type: ghnStoreSchema, default: () => ({}) },
  },
  { timestamps: true }
);

storeSchema.index({ status: 1, sortOrder: 1, name: 1 });
storeSchema.index({ name: 'text', code: 'text', city: 'text', district: 'text' });

storeSchema.pre('validate', function preValidate() {
  if (this.code) {
    this.code = String(this.code).trim().toUpperCase();
  }
});

module.exports = mongoose.model('Store', storeSchema);
