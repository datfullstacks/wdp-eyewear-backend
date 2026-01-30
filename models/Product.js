const mongoose = require('mongoose');
const { PRODUCT_TYPES, PRODUCT_STATUS } = require('../constants');

const { Schema } = mongoose;

const mediaAssetSchema = new Schema({
  assetType: { type: String, enum: ['2d', '3d'], required: true },
  role: { type: String, enum: ['hero', 'gallery', 'thumbnail', 'lifestyle', 'try_on', 'viewer'], required: true },
  url: { type: String, required: true },
  alt: String,
  mime: String,
  width: Number,
  height: Number,
  order: Number,
  format: { type: String, enum: ['glb', 'gltf', 'usdz'], required: function () { return this.assetType === '3d'; } },
  posterUrl: { type: String, required: function () { return this.assetType === '3d'; } },
  ar: {
    glbUrl: String,
    usdzUrl: String
  },
  viewer: {
    background: { type: String, enum: ['transparent', 'white', 'black'] },
    initialCamera: { type: Schema.Types.Mixed }
  }
}, { _id: true, timestamps: false });

const variantSchema = new Schema({
  sku: { type: String, trim: true },
  barcode: String,
  options: {
    color: String,
    size: String
  },
  price: { type: Number, min: 0 },
  stock: { type: Number, min: 0, default: 0 },
  warehouseLocation: String,
  assetIds: [{ type: Schema.Types.ObjectId }]
}, { timestamps: false });

const specsSchema = new Schema({
  common: {
    shape: String,
    gender: { type: String, enum: ['men', 'women', 'unisex', 'kids'] },
    weightGram: Number,
    standards: [String]
  },
  frame: {
    material: String,
    hingeType: { type: String, enum: ['standard', 'spring'] },
    nosePads: Boolean,
    rimType: String,
    rxReady: Boolean
  },
  dimensions: {
    fit: { type: String, enum: ['narrow', 'medium', 'wide'] },
    frameWidthMm: Number,
    bridgeMm: Number,
    templeLengthMm: Number,
    lensWidthMm: Number,
    lensHeightMm: Number
  },
  lens: {
    uvProtection: String,
    polarized: Boolean,
    photochromic: Boolean,
    blueLightFilter: Boolean,
    category: Number,
    vltPercent: Number,
    tintColor: String,
    tintPercent: Number,
    coatings: [String],
    lensType: String,
    material: String,
    index: Number,
    features: [String],
    prescriptionRange: {
      sphMin: Number,
      sphMax: Number,
      cylMin: Number,
      cylMax: Number,
      axisMin: Number,
      axisMax: Number,
      addMin: Number,
      addMax: Number
    },
    diameterMm: Number,
    thicknessOptionsMm: [Number]
  },
  contactLens: {
    replacementCycle: String,
    baseCurveMm: Number,
    diameterMm: Number,
    waterContentPercent: Number,
    material: String,
    powerRange: {
      sphMin: Number,
      sphMax: Number,
      cylMin: Number,
      cylMax: Number,
      axisMin: Number,
      axisMax: Number
    },
    packSize: Number
  },
  accessory: {
    category: String,
    material: String,
    dimensions: String,
    compatibleWith: [String]
  },
  service: {
    durationMinutes: Number,
    bookingRequired: Boolean,
    serviceScope: String,
    includedItems: [String]
  },
  bundle: {
    items: [{
      productId: { type: Schema.Types.ObjectId, ref: 'Product' },
      variantId: { type: Schema.Types.ObjectId },
      quantity: { type: Number, min: 1 }
    }],
    bundlePricing: { type: String, enum: ['fixed_price', 'discount_percent', 'discount_amount'] }
  },
  giftCard: {
    value: Number,
    expiryDays: Number,
    deliveryMethod: { type: String, enum: ['email', 'physical'] }
  }
}, { _id: false, timestamps: false });

const productSchema = new Schema({
  type: { type: String, enum: Object.values(PRODUCT_TYPES), required: true },
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, lowercase: true, unique: true },
  description: String,
  brand: { type: String, required: true, trim: true },
  status: { type: String, enum: Object.values(PRODUCT_STATUS), default: PRODUCT_STATUS.DRAFT },

  pricing: {
    currency: { type: String, required: true, uppercase: true },
    msrp: { type: Number, min: 0 },
    basePrice: { type: Number, required: true, min: 0 },
    salePrice: {
      type: Number,
      min: 0,
      validate: {
        validator: function (val) {
          if (val == null) return true;
          const base = this.pricing?.basePrice;
          return !base || val <= base;
        },
        message: 'Sale price cannot exceed basePrice'
      }
    },
    discountPercent: { type: Number, min: 0, max: 100 },
    taxRate: { type: Number, min: 0, max: 100 }
  },

  inventory: {
    track: { type: Boolean, required: true, default: true },
    threshold: { type: Number, min: 0 }
  },

  fulfillment: {
    supplier: String,
    leadTime: String,
    returnWindowDays: Number,
    warrantyMonths: Number,
    warehouseDefaultLocation: String
  },

  seo: {
    modelCode: String,
    collections: [String],
    season: String,
    keywords: [String],
    countryOfOrigin: String
  },

  media: {
    primaryAssetId: String,
    assets: { type: [mediaAssetSchema], default: [] },
    tryOn: {
      enabled: Boolean,
      arUrl: String,
      assetIds: [Schema.Types.ObjectId]
    }
  },

  variants: { type: [variantSchema], default: [] },
  specs: specsSchema,
  servicesIncluded: [String],
  bundleIds: [Schema.Types.ObjectId],

  ratingsAverage: {
    type: Number,
    default: 4.5,
    min: 1,
    max: 5,
    set: val => Math.round(val * 10) / 10
  },
  ratingsQuantity: { type: Number, default: 0 }
}, {
  timestamps: true
});

productSchema.index({ name: 'text', description: 'text', brand: 'text' });
productSchema.index({ 'pricing.basePrice': 1, ratingsAverage: -1 });

const slugify = (value = '') => value
  .toString()
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

productSchema.pre('validate', function (next) {
  if (!this.slug && this.name) {
    this.slug = slugify(this.name);
  }
  next();
});

module.exports = mongoose.model('Product', productSchema);
