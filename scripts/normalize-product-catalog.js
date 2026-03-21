require('dotenv').config();

const mongoose = require('mongoose');
const Product = require('../models/Product');
const { PRODUCT_TYPES, PRODUCT_STATUS } = require('../constants');

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MIN_PRICE = 25000;
const MAX_PRICE = 200000;

const PRICE_LADDER_BY_TYPE = {
  [PRODUCT_TYPES.ACCESSORY]: [25000, 45000, 65000, 85000],
  [PRODUCT_TYPES.CONTACT_LENS]: [95000],
  [PRODUCT_TYPES.LENS]: [110000, 125000, 135000],
  [PRODUCT_TYPES.FRAME]: [145000, 155000, 165000, 175000, 185000, 195000],
  [PRODUCT_TYPES.SUNGLASSES]: [180000, 190000],
  [PRODUCT_TYPES.SERVICE]: [120000],
  [PRODUCT_TYPES.BUNDLE]: [190000],
  [PRODUCT_TYPES.GIFT_CARD]: [200000],
  [PRODUCT_TYPES.OTHER]: [55000],
};

const TAX_RATE_BY_TYPE = {
  [PRODUCT_TYPES.ACCESSORY]: 5,
  [PRODUCT_TYPES.CONTACT_LENS]: 5,
  [PRODUCT_TYPES.LENS]: 5,
  [PRODUCT_TYPES.FRAME]: 8,
  [PRODUCT_TYPES.SUNGLASSES]: 8,
  [PRODUCT_TYPES.SERVICE]: 0,
  [PRODUCT_TYPES.BUNDLE]: 8,
  [PRODUCT_TYPES.GIFT_CARD]: 0,
  [PRODUCT_TYPES.OTHER]: 5,
};

const DEFAULT_COLLECTIONS_BY_TYPE = {
  [PRODUCT_TYPES.ACCESSORY]: ['everyday-care', 'store-essentials'],
  [PRODUCT_TYPES.CONTACT_LENS]: ['vision-care', 'daily-wear'],
  [PRODUCT_TYPES.LENS]: ['vision-care', 'optical-upgrade'],
  [PRODUCT_TYPES.FRAME]: ['core-frames', 'studio-select'],
  [PRODUCT_TYPES.SUNGLASSES]: ['sunwear', 'outdoor-edit'],
  [PRODUCT_TYPES.SERVICE]: ['store-services'],
  [PRODUCT_TYPES.BUNDLE]: ['combos', 'best-value'],
  [PRODUCT_TYPES.GIFT_CARD]: ['gifting'],
  [PRODUCT_TYPES.OTHER]: ['general-merch'],
};

const DEFAULT_WAREHOUSE_BY_TYPE = {
  [PRODUCT_TYPES.ACCESSORY]: 'HCM-ACC-01',
  [PRODUCT_TYPES.CONTACT_LENS]: 'HCM-CL-01',
  [PRODUCT_TYPES.LENS]: 'HCM-LENS-01',
  [PRODUCT_TYPES.FRAME]: 'HCM-FRAME-01',
  [PRODUCT_TYPES.SUNGLASSES]: 'HCM-SUN-01',
  [PRODUCT_TYPES.SERVICE]: 'ONLINE-SVC',
  [PRODUCT_TYPES.BUNDLE]: 'HCM-BUNDLE-01',
  [PRODUCT_TYPES.GIFT_CARD]: 'ONLINE-GC',
  [PRODUCT_TYPES.OTHER]: 'HCM-MISC-01',
};

const INVENTORY_TRACK_BY_TYPE = {
  [PRODUCT_TYPES.SERVICE]: false,
  [PRODUCT_TYPES.GIFT_CARD]: false,
  [PRODUCT_TYPES.OTHER]: false,
};

function roundMoney(value) {
  const rounded = Math.round(Number(value || 0) / 5000) * 5000;
  return Math.max(MIN_PRICE, Math.min(MAX_PRICE, rounded));
}

function toText(value) {
  return String(value ?? '').trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniq(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function upperToken(value) {
  return toText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'STD';
}

function addDays(offsetDays) {
  return new Date(Date.now() + Number(offsetDays || 0) * DAY_IN_MS);
}

function hashString(value) {
  let hash = 0;
  const text = toText(value);
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function buildBarcode(slug, variantIndex) {
  const digits = String(hashString(`${slug}-${variantIndex}`)).padStart(10, '0').slice(0, 10);
  return `893${digits}`;
}

function normalizeShape(product) {
  const existingShape = toText(product?.specs?.common?.shape).toLowerCase();
  if (existingShape) return existingShape;

  const slug = toText(product?.slug).toLowerCase();
  const name = toText(product?.name).toLowerCase();
  if (slug.includes('cat-eye') || name.includes('cat eye')) return 'cat_eye';
  if (slug.includes('wayfarer')) return 'wayfarer';
  if (slug.includes('hex')) return 'hexagon';
  if (slug.includes('rimless')) return 'oval';
  if (slug.includes('round')) return 'round';
  return 'rectangle';
}

function buildDescription(product) {
  const preorderLabel = product?.preOrder?.enabled ? 'preorder ' : '';
  const typeLabel = toText(product?.type).replace(/_/g, ' ');
  const brand = toText(product?.brand) || 'WDP';
  return `${brand} ${preorderLabel}${typeLabel} optimized for demo catalog pricing and complete product attributes.`;
}

function inferAccessoryCategory(product) {
  const existing = toText(product?.specs?.accessory?.category);
  if (existing) return existing;

  const slug = toText(product?.slug).toLowerCase();
  const name = toText(product?.name).toLowerCase();
  if (slug.includes('solution') || name.includes('solution')) return 'care_solution';
  if (slug.includes('case')) return 'case';
  if (slug.includes('clean')) return 'cleaning_kit';
  if (slug.includes('cloth')) return 'cloth';
  if (slug.includes('strap')) return 'strap';
  return 'replacement_part';
}

function takePriceForType(type, cursors) {
  const ladder = PRICE_LADDER_BY_TYPE[type] || PRICE_LADDER_BY_TYPE[PRODUCT_TYPES.OTHER];
  const currentIndex = cursors[type] || 0;
  cursors[type] = currentIndex + 1;
  return ladder[currentIndex % ladder.length];
}

function buildPricing(type, basePrice) {
  return {
    currency: 'VND',
    basePrice,
    salePrice: null,
    discountPercent: 0,
    taxRate: TAX_RATE_BY_TYPE[type] ?? 5,
  };
}

function buildInventory(product) {
  const track =
    INVENTORY_TRACK_BY_TYPE[product.type] != null
      ? INVENTORY_TRACK_BY_TYPE[product.type]
      : true;
  return {
    track,
    threshold: track ? Number(product?.inventory?.threshold ?? 5) || 5 : 0,
  };
}

function buildFulfillment(product) {
  const isPreOrder = Boolean(product?.preOrder?.enabled);
  const type = product?.type;
  return {
    supplier: toText(product?.fulfillment?.supplier) || toText(product?.brand) || 'WDP',
    leadTime: isPreOrder ? '10-21 days' : type === PRODUCT_TYPES.SERVICE ? 'same day' : '2-4 days',
    returnWindowDays:
      type === PRODUCT_TYPES.GIFT_CARD ? 0 : type === PRODUCT_TYPES.CONTACT_LENS ? 7 : 30,
    warrantyMonths:
      type === PRODUCT_TYPES.FRAME || type === PRODUCT_TYPES.SUNGLASSES
        ? 12
        : type === PRODUCT_TYPES.LENS || type === PRODUCT_TYPES.ACCESSORY
          ? 6
          : 0,
    warehouseDefaultLocation:
      toText(product?.fulfillment?.warehouseDefaultLocation) ||
      DEFAULT_WAREHOUSE_BY_TYPE[type] ||
      'HCM-MAIN-01',
  };
}

function buildSeo(product) {
  const collections = uniq([
    ...toArray(product?.seo?.collections),
    ...(DEFAULT_COLLECTIONS_BY_TYPE[product.type] || []),
  ]);
  const keywords = uniq([
    toText(product?.brand).toLowerCase(),
    toText(product?.type).toLowerCase(),
    normalizeShape(product),
    product?.preOrder?.enabled ? 'preorder' : 'ready-stock',
    ...toArray(product?.seo?.keywords).map((value) => toText(value).toLowerCase()),
  ]);

  return {
    modelCode: toText(product?.seo?.modelCode) || upperToken(product.slug),
    collections,
    season: toText(product?.seo?.season) || 'all_season',
    seasons: uniq([...(toArray(product?.seo?.seasons)), 'all_season']),
    keywords,
    countryOfOrigin: toText(product?.seo?.countryOfOrigin) || 'Vietnam',
  };
}

function buildPreOrder(product) {
  const existing = product?.preOrder || {};
  if (!existing.enabled) {
    return {
      enabled: false,
      allowCod: Boolean(existing.allowCod ?? true),
      shippingCollectionTiming: 'upfront',
      note: '',
    };
  }

  const depositPercent =
    Number.isFinite(Number(existing.depositPercent)) && Number(existing.depositPercent) >= 0
      ? Number(existing.depositPercent)
      : 30;

  return {
    enabled: true,
    startAt: existing.startAt || addDays(-2),
    endAt: existing.endAt || addDays(21),
    shipFrom: existing.shipFrom || addDays(10),
    shipTo: existing.shipTo || addDays(24),
    depositPercent,
    maxQuantityPerOrder:
      Number.isFinite(Number(existing.maxQuantityPerOrder)) && Number(existing.maxQuantityPerOrder) > 0
        ? Number(existing.maxQuantityPerOrder)
        : 2,
    allowCod: Boolean(existing.allowCod ?? true),
    shippingCollectionTiming: toText(existing.shippingCollectionTiming) || 'with_balance',
    note:
      toText(existing.note) ||
      `Preorder dot ${depositPercent}%, phan con lai thu bang COD theo cau hinh.`,
  };
}

function buildCompatibility(product, refs) {
  switch (product.type) {
    case PRODUCT_TYPES.FRAME:
    case PRODUCT_TYPES.SUNGLASSES:
      return {
        productIds: uniq([refs.firstLensId, refs.caseId]).filter(Boolean),
        notes: 'Compatible with lens upgrades and core accessories.',
      };
    case PRODUCT_TYPES.LENS:
      return {
        productIds: uniq([refs.firstFrameId]).filter(Boolean),
        notes: 'Lens can be paired with frame products in the demo catalog.',
      };
    case PRODUCT_TYPES.CONTACT_LENS:
      return {
        productIds: uniq([refs.solutionId]).filter(Boolean),
        notes: 'Recommended to pair with care solution products.',
      };
    case PRODUCT_TYPES.ACCESSORY: {
      const category = inferAccessoryCategory(product);
      const targetIds =
        category === 'care_solution'
          ? [refs.contactLensId]
          : [refs.firstFrameId, refs.sunglassesId];
      return {
        productIds: uniq(targetIds).filter(Boolean),
        notes: 'Accessory mapping for demo product relationships.',
      };
    }
    case PRODUCT_TYPES.BUNDLE:
      return {
        productIds: uniq([refs.firstFrameId, refs.firstLensId]).filter(Boolean),
        notes: 'Bundle references active frame and lens products from the same catalog.',
      };
    default:
      return {
        productIds: [],
        notes: '',
      };
  }
}

function buildServicesIncluded(product) {
  switch (product.type) {
    case PRODUCT_TYPES.FRAME:
    case PRODUCT_TYPES.SUNGLASSES:
      return ['Dieu chinh gong mien phi', 'Ve sinh kinh tai cua hang'];
    case PRODUCT_TYPES.LENS:
      return ['Tu van do can va chiet suat'];
    case PRODUCT_TYPES.CONTACT_LENS:
      return ['Huong dan bao quan va deo thu'];
    case PRODUCT_TYPES.SERVICE:
      return ['Dat lich truoc', 'Xac nhan qua SMS'];
    default:
      return [];
  }
}

function buildPresetCombo(product, refs) {
  if (product.type !== PRODUCT_TYPES.BUNDLE || !refs.firstFrameId || !refs.firstLensId) {
    return {
      enabled: false,
      defaultNonPrescription: true,
    };
  }

  return {
    enabled: true,
    frameProductId: refs.firstFrameId,
    lensProductId: refs.firstLensId,
    defaultNonPrescription: true,
  };
}

function buildSpecs(product, refs, basePrice) {
  const shape = normalizeShape(product);
  const accessoryCategory = inferAccessoryCategory(product);

  const specs = {
    common: {
      shape,
      gender: toText(product?.specs?.common?.gender) || 'unisex',
      weightGram:
        Number(product?.specs?.common?.weightGram) ||
        (product.type === PRODUCT_TYPES.ACCESSORY ? 12 : product.type === PRODUCT_TYPES.SERVICE ? 0 : 24),
      standards: uniq([
        ...toArray(product?.specs?.common?.standards),
        product.type === PRODUCT_TYPES.SUNGLASSES ? 'ANSI Z80.3' : 'ISO 12870',
      ]),
    },
    frame: {
      material:
        toText(product?.specs?.frame?.material) ||
        (toText(product?.name).toLowerCase().includes('rimless') ? 'titanium' : 'acetate'),
      hingeType: toText(product?.specs?.frame?.hingeType) || 'spring',
      nosePads:
        product?.specs?.frame?.nosePads != null
          ? Boolean(product.specs.frame.nosePads)
          : product.type !== PRODUCT_TYPES.ACCESSORY,
      rimType: toText(product?.specs?.frame?.rimType) || 'full',
      rxReady:
        product?.specs?.frame?.rxReady != null
          ? Boolean(product.specs.frame.rxReady)
          : product.type !== PRODUCT_TYPES.SUNGLASSES,
    },
    dimensions: {
      fit: toText(product?.specs?.dimensions?.fit) || 'medium',
      frameWidthMm: Number(product?.specs?.dimensions?.frameWidthMm) || 138,
      bridgeMm: Number(product?.specs?.dimensions?.bridgeMm) || 18,
      templeLengthMm: Number(product?.specs?.dimensions?.templeLengthMm) || 145,
      lensWidthMm: Number(product?.specs?.dimensions?.lensWidthMm) || 52,
      lensHeightMm: Number(product?.specs?.dimensions?.lensHeightMm) || 40,
    },
    lens: {
      uvProtection: toText(product?.specs?.lens?.uvProtection) || 'UV400',
      polarized:
        product?.specs?.lens?.polarized != null
          ? Boolean(product.specs.lens.polarized)
          : product.type === PRODUCT_TYPES.SUNGLASSES,
      photochromic: Boolean(product?.specs?.lens?.photochromic ?? false),
      blueLightFilter:
        product?.specs?.lens?.blueLightFilter != null
          ? Boolean(product.specs.lens.blueLightFilter)
          : product.type === PRODUCT_TYPES.LENS,
      category: Number(product?.specs?.lens?.category) || 3,
      vltPercent: Number(product?.specs?.lens?.vltPercent) || 15,
      tintColor: toText(product?.specs?.lens?.tintColor) || 'smoke',
      tintPercent: Number(product?.specs?.lens?.tintPercent) || 80,
      coatings: uniq([
        ...toArray(product?.specs?.lens?.coatings),
        'anti-scratch',
        'oleophobic',
      ]),
      lensType: toText(product?.specs?.lens?.lensType) || 'single_vision',
      material: toText(product?.specs?.lens?.material) || 'polycarbonate',
      index: Number(product?.specs?.lens?.index) || 1.56,
      features: uniq([
        ...toArray(product?.specs?.lens?.features),
        product.type === PRODUCT_TYPES.LENS ? 'blue-light-filter' : 'impact-resistant',
      ]),
      prescriptionRange: {
        sphMin: Number(product?.specs?.lens?.prescriptionRange?.sphMin) || -8,
        sphMax: Number(product?.specs?.lens?.prescriptionRange?.sphMax) || 4,
        cylMin: Number(product?.specs?.lens?.prescriptionRange?.cylMin) || -2,
        cylMax: Number(product?.specs?.lens?.prescriptionRange?.cylMax) || 0,
        axisMin: Number(product?.specs?.lens?.prescriptionRange?.axisMin) || 0,
        axisMax: Number(product?.specs?.lens?.prescriptionRange?.axisMax) || 180,
        addMin: Number(product?.specs?.lens?.prescriptionRange?.addMin) || 0,
        addMax: Number(product?.specs?.lens?.prescriptionRange?.addMax) || 3,
      },
      diameterMm: Number(product?.specs?.lens?.diameterMm) || 70,
      thicknessOptionsMm: uniq([
        ...toArray(product?.specs?.lens?.thicknessOptionsMm),
        1.5,
        1.6,
      ]),
    },
    contactLens: {
      replacementCycle: toText(product?.specs?.contactLens?.replacementCycle) || 'daily',
      baseCurveMm: Number(product?.specs?.contactLens?.baseCurveMm) || 8.6,
      diameterMm: Number(product?.specs?.contactLens?.diameterMm) || 14.2,
      waterContentPercent: Number(product?.specs?.contactLens?.waterContentPercent) || 58,
      material: toText(product?.specs?.contactLens?.material) || 'silicone hydrogel',
      powerRange: {
        sphMin: Number(product?.specs?.contactLens?.powerRange?.sphMin) || -10,
        sphMax: Number(product?.specs?.contactLens?.powerRange?.sphMax) || 6,
        cylMin: Number(product?.specs?.contactLens?.powerRange?.cylMin) || -2.25,
        cylMax: Number(product?.specs?.contactLens?.powerRange?.cylMax) || 0,
        axisMin: Number(product?.specs?.contactLens?.powerRange?.axisMin) || 0,
        axisMax: Number(product?.specs?.contactLens?.powerRange?.axisMax) || 180,
      },
      packSize: Number(product?.specs?.contactLens?.packSize) || 30,
    },
    accessory: {
      category: accessoryCategory,
      material: toText(product?.specs?.accessory?.material) || 'composite',
      dimensions: toText(product?.specs?.accessory?.dimensions) || 'standard',
      compatibleWith:
        toArray(product?.specs?.accessory?.compatibleWith).length > 0
          ? uniq(toArray(product.specs.accessory.compatibleWith))
          : accessoryCategory === 'care_solution'
            ? ['contact_lens']
            : ['frame', 'sunglasses'],
    },
    service: {
      durationMinutes: Number(product?.specs?.service?.durationMinutes) || 20,
      bookingRequired:
        product?.specs?.service?.bookingRequired != null
          ? Boolean(product.specs.service.bookingRequired)
          : true,
      serviceScope:
        toText(product?.specs?.service?.serviceScope) || 'Consultation, fitting and store support',
      includedItems: uniq([
        ...toArray(product?.specs?.service?.includedItems),
        'Store consultation',
      ]),
    },
    bundle: {
      items:
        product.type === PRODUCT_TYPES.BUNDLE
          ? [
              refs.firstFrameId
                ? {
                    productId: refs.firstFrameId,
                    quantity: 1,
                  }
                : null,
              refs.firstLensId
                ? {
                    productId: refs.firstLensId,
                    quantity: 1,
                  }
                : null,
            ].filter(Boolean)
          : [],
      bundlePricing: 'fixed_price',
    },
    giftCard: {
      value: product.type === PRODUCT_TYPES.GIFT_CARD ? basePrice : MIN_PRICE,
      expiryDays: Number(product?.specs?.giftCard?.expiryDays) || 365,
      deliveryMethod: toText(product?.specs?.giftCard?.deliveryMethod) || 'email',
    },
  };

  if (product.type === PRODUCT_TYPES.SERVICE) {
    specs.common.weightGram = 0;
  }

  return specs;
}

function buildVariants(product, finalPrice) {
  const existingVariants =
    Array.isArray(product.variants) && product.variants.length > 0
      ? product.variants
      : [
          {
            options: {
              color: product.type === PRODUCT_TYPES.CONTACT_LENS ? 'Clear' : 'Default',
              size: 'STD',
            },
            stock: product?.preOrder?.enabled ? 0 : 20,
            assetIds: [],
          },
        ];

  return existingVariants.map((variant, index) => {
    const size = toText(variant?.options?.size) || 'STD';
    const color = toText(variant?.options?.color) || (product.type === PRODUCT_TYPES.CONTACT_LENS ? 'Clear' : 'Default');
    return {
      _id: variant?._id,
      sku: `${upperToken(product.slug)}-${upperToken(color)}-${upperToken(size)}`,
      barcode: buildBarcode(product.slug, index),
      options: {
        color,
        size,
      },
      price: roundMoney(finalPrice + index * 5000),
      stock: product?.preOrder?.enabled ? 0 : Number(variant?.stock ?? 20) || 20,
      warehouseLocation:
        toText(variant?.warehouseLocation) ||
        DEFAULT_WAREHOUSE_BY_TYPE[product.type] ||
        'HCM-MAIN-01',
      assetIds: toArray(variant?.assetIds),
    };
  });
}

function getCatalogRefs(products) {
  const findByType = (type) => products.find((product) => product.type === type);
  const findBySlug = (slug) => products.find((product) => product.slug === slug);

  return {
    firstFrameId: findByType(PRODUCT_TYPES.FRAME)?._id,
    firstLensId: findByType(PRODUCT_TYPES.LENS)?._id,
    contactLensId: findByType(PRODUCT_TYPES.CONTACT_LENS)?._id,
    sunglassesId: findByType(PRODUCT_TYPES.SUNGLASSES)?._id,
    caseId: findBySlug('hardcase-box')?._id,
    solutionId: findBySlug('solution-care-360ml')?._id,
  };
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const products = await Product.find({}).sort({ createdAt: 1 });
  const refs = getCatalogRefs(products);
  const cursors = {};
  const summary = [];

  for (const product of products) {
    const basePrice = takePriceForType(product.type, cursors);
    const pricing = buildPricing(product.type, basePrice);
    const finalPrice = pricing.salePrice || pricing.basePrice;

    product.description = buildDescription(product);
    product.brand = toText(product.brand) || 'WDP';
    product.status = PRODUCT_STATUS.ACTIVE;
    product.pricing = pricing;
    product.inventory = buildInventory(product);
    product.preOrder = buildPreOrder(product);
    product.fulfillment = buildFulfillment(product);
    product.seo = buildSeo(product);
    product.compatibility = buildCompatibility(product, refs);
    product.servicesIncluded = buildServicesIncluded(product);
    product.presetCombo = buildPresetCombo(product, refs);
    product.specs = buildSpecs(product, refs, basePrice);
    product.variants = buildVariants(product, finalPrice);
    product.ratingsAverage = 4.6;
    product.ratingsQuantity = 12;

    await product.save();

    summary.push({
      slug: product.slug,
      type: product.type,
      price: product.pricing.basePrice,
      preOrderEnabled: Boolean(product.preOrder?.enabled),
      variantCount: Array.isArray(product.variants) ? product.variants.length : 0,
    });
  }

  console.log(
    JSON.stringify(
      {
        count: summary.length,
        minPrice: Math.min(...summary.map((item) => item.price)),
        maxPrice: Math.max(...summary.map((item) => item.price)),
        products: summary,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
