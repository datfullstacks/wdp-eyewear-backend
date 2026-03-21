require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const { PRODUCT_TYPES, PRODUCT_STATUS, TRY_ON_STATUS } = require('../constants');
const { supabase, supabaseBucket } = require('../services/supabaseClient');

const LOCAL_GLB_PATH_CANDIDATES = [
  process.env.TRYON_SOURCE_GLB,
  'D:/wdp/3D/effect-1772843546211/assets/glasses.glb',
  'D:/wdp/3D/effect-1772848523106/assets/scene.glb',
]
  .filter(Boolean)
  .map((candidate) => path.resolve(candidate));
const LOCAL_GLB_PATH =
  LOCAL_GLB_PATH_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ||
  LOCAL_GLB_PATH_CANDIDATES[0];
const STORAGE_ROOT = 'tryon/generated';
const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 365 * 10;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const IMAGE_OBJECTS = [
  'uploads/photobooth-1772789460272.jpg',
  'uploads/youth-casual-ba-1772814828638.png',
  'uploads/youth-casual-bonn-1772789465406.png',
  'uploads/z7582418254251-6c3357cfa43c0e7261d18f12b2148f48-1772821480829.jpg',
];

const PRODUCTS = [
  {
    slug: 'wdp-tryon-urban-frame',
    name: 'WDP TryOn Urban Frame',
    description: 'Android Banuba try-on test frame with per-variant GLB assets.',
    basePrice: 175000,
    brand: 'WDP',
    shape: 'rectangle',
    weightGram: 22,
    collections: ['core-frames', 'studio-select'],
    keywords: ['wdp', 'frame', 'rectangle', 'ready-stock'],
    variants: [
      { color: 'Black', size: 'M', stock: 18, price: 175000, imageIndex: 0 },
      { color: 'Brown', size: 'M', stock: 12, price: 180000, imageIndex: 1 },
      { color: 'Crystal', size: 'L', stock: 8, price: 185000, imageIndex: 2 },
    ],
  },
  {
    slug: 'wdp-tryon-air-frame',
    name: 'WDP TryOn Air Frame',
    description: 'Lightweight frame seeded for Android try-on flow with variant asset mapping.',
    basePrice: 185000,
    brand: 'WDP',
    shape: 'round',
    weightGram: 20,
    collections: ['core-frames', 'studio-select'],
    keywords: ['wdp', 'frame', 'round', 'ready-stock'],
    variants: [
      { color: 'Silver', size: 'S', stock: 10, price: 185000, imageIndex: 3 },
      { color: 'Gunmetal', size: 'M', stock: 11, price: 190000, imageIndex: 0 },
      { color: 'Gold', size: 'L', stock: 7, price: 195000, imageIndex: 1 },
    ],
  },
  {
    slug: 'wdp-preorder-metro-hex-frame',
    name: 'WDP Preorder Metro Hex Frame',
    description: 'Hexagonal preorder frame with split-payment config for customer preorder journeys.',
    basePrice: 195000,
    brand: 'WDP',
    shape: 'hexagon',
    weightGram: 24,
    collections: ['preorder', 'launch-drop'],
    keywords: ['wdp', 'frame', 'hexagon', 'preorder'],
    preOrder: {
      enabled: true,
      allowCod: true,
      depositPercent: 30,
      maxQuantityPerOrder: 2,
      shippingCollectionTiming: 'with_balance',
      startAtOffsetDays: -2,
      endAtOffsetDays: 30,
      shipFromOffsetDays: 10,
      shipToOffsetDays: 24,
      note: 'Preorder dot 30%, phi ship thu cung dot thanh toan con lai.',
    },
    variants: [
      { color: 'Obsidian', size: 'M', stock: 0, price: 195000, imageIndex: 2 },
      { color: 'Champagne', size: 'L', stock: 0, price: 200000, imageIndex: 3 },
      { color: 'Rose Gold', size: 'M', stock: 0, price: 200000, imageIndex: 1 },
    ],
  },
  {
    slug: 'wdp-preorder-aero-rimless-frame',
    name: 'WDP Preorder Aero Rimless Frame',
    description: 'Rimless preorder frame seeded with upfront shipping collection for launch campaigns.',
    basePrice: 145000,
    brand: 'WDP',
    shape: 'oval',
    weightGram: 18,
    collections: ['preorder', 'launch-drop'],
    keywords: ['wdp', 'frame', 'oval', 'preorder'],
    preOrder: {
      enabled: true,
      allowCod: true,
      depositPercent: 40,
      maxQuantityPerOrder: 1,
      shippingCollectionTiming: 'upfront',
      startAtOffsetDays: -1,
      endAtOffsetDays: 21,
      shipFromOffsetDays: 7,
      shipToOffsetDays: 18,
      note: 'Preorder dot 40%, phi ship thu ngay trong dot dat hang.',
    },
    variants: [
      { color: 'Titanium', size: 'M', stock: 0, price: 145000, imageIndex: 0 },
      { color: 'Matte Navy', size: 'L', stock: 0, price: 150000, imageIndex: 2 },
      { color: 'Smoke Gray', size: 'M', stock: 0, price: 155000, imageIndex: 3 },
    ],
  },
  {
    slug: 'wdp-preorder-celeste-cat-eye',
    name: 'WDP Preorder Celeste Cat Eye',
    description: 'Cat-eye preorder frame with shipping collected on delivery for COD remainder flows.',
    basePrice: 155000,
    brand: 'WDP',
    shape: 'cat_eye',
    weightGram: 23,
    collections: ['preorder', 'launch-drop'],
    keywords: ['wdp', 'frame', 'cat-eye', 'preorder'],
    preOrder: {
      enabled: true,
      allowCod: true,
      depositPercent: 35,
      maxQuantityPerOrder: 2,
      shippingCollectionTiming: 'on_delivery',
      startAtOffsetDays: -3,
      endAtOffsetDays: 35,
      shipFromOffsetDays: 14,
      shipToOffsetDays: 28,
      note: 'Preorder dot 35%, phi ship thu khi giao hang va thu phan COD con lai.',
    },
    variants: [
      { color: 'Cherry Wine', size: 'S', stock: 0, price: 155000, imageIndex: 1 },
      { color: 'Moon Beige', size: 'M', stock: 0, price: 160000, imageIndex: 0 },
      { color: 'Gloss Black', size: 'M', stock: 0, price: 165000, imageIndex: 2 },
    ],
  },
];

const trim = (value) => String(value ?? '').trim();

function addDays(offsetDays, now = Date.now()) {
  return new Date(now + Number(offsetDays || 0) * DAY_IN_MS);
}

function buildPreOrderConfig(definition) {
  if (!definition?.preOrder?.enabled) {
    return {
      enabled: false,
      allowCod: true,
    };
  }

  const config = definition.preOrder || {};

  return {
    enabled: true,
    allowCod: Boolean(config.allowCod ?? true),
    depositPercent: Number.isFinite(Number(config.depositPercent))
      ? Number(config.depositPercent)
      : undefined,
    maxQuantityPerOrder: Number.isFinite(Number(config.maxQuantityPerOrder))
      ? Number(config.maxQuantityPerOrder)
      : undefined,
    startAt: addDays(config.startAtOffsetDays ?? -1),
    endAt: addDays(config.endAtOffsetDays ?? 30),
    shipFrom: addDays(config.shipFromOffsetDays ?? 7),
    shipTo: addDays(config.shipToOffsetDays ?? 21),
    shippingCollectionTiming: trim(config.shippingCollectionTiming) || 'upfront',
    note: trim(config.note),
  };
}

function buildSeo(definition) {
  const keywords = Array.from(
    new Set(
      [
        definition.brand,
        definition.shape,
        definition.preOrder?.enabled ? 'preorder' : 'ready-stock',
        ...(Array.isArray(definition.keywords) ? definition.keywords : []),
      ]
        .map((value) => trim(value).toLowerCase())
        .filter(Boolean)
    )
  );

  return {
    modelCode: trim(definition.slug).toUpperCase().replace(/[^A-Z0-9]+/g, '-'),
    collections: Array.isArray(definition.collections) ? definition.collections : ['studio-select'],
    season: 'all_season',
    seasons: ['all_season'],
    keywords,
    countryOfOrigin: 'Vietnam',
  };
}

async function getStorageUrl(objectPath) {
  const { data, error } = await supabase.storage
    .from(supabaseBucket)
    .createSignedUrl(objectPath, SIGNED_URL_EXPIRES_IN_SECONDS);

  if (error) {
    throw new Error(`Signed URL failed for ${objectPath}: ${error.message}`);
  }

  return trim(data?.signedUrl);
}

async function uploadGlbForVariant({ productSlug, color, size }) {
  const safeColor = trim(color).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const safeSize = trim(size).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const objectPath = `${STORAGE_ROOT}/${productSlug}/${safeColor}-${safeSize}.glb`;
  const fileBuffer = fs.readFileSync(LOCAL_GLB_PATH);

  const { error } = await supabase.storage
    .from(supabaseBucket)
    .upload(objectPath, fileBuffer, {
      upsert: true,
      cacheControl: '31536000',
      contentType: 'model/gltf-binary',
    });

  if (error) {
    throw new Error(`Supabase upload failed for ${objectPath}: ${error.message}`);
  }

  return {
    objectPath,
    storageUrl: await getStorageUrl(objectPath),
  };
}

async function buildImageAssetSource(imageIndex) {
  const objectPath = IMAGE_OBJECTS[imageIndex % IMAGE_OBJECTS.length];
  return {
    objectPath,
    storageUrl: await getStorageUrl(objectPath),
  };
}

function createImageAsset({ url, objectPath, alt, order }) {
  return {
    _id: new mongoose.Types.ObjectId(),
    assetType: '2d',
    role: order === 1 ? 'hero' : 'gallery',
    url,
    alt,
    mime: /\.png$/i.test(objectPath) ? 'image/png' : 'image/jpeg',
    width: 1200,
    height: 800,
    order,
  };
}

function createGlbAsset({ url, posterUrl, alt, order }) {
  return {
    _id: new mongoose.Types.ObjectId(),
    assetType: '3d',
    role: 'try_on',
    url,
    alt,
    mime: 'model/gltf-binary',
    format: 'glb',
    posterUrl,
    order,
    ar: {
      glbUrl: url,
    },
  };
}

async function buildProductPayload({ definition, uploadedVariants }) {
  const assets = [];
  const variants = [];
  const tryOnAssetIds = [];

  for (let index = 0; index < uploadedVariants.length; index += 1) {
    const variantDef = uploadedVariants[index];
    const hero = await buildImageAssetSource(variantDef.imageIndex);
    const imageAsset = createImageAsset({
      url: hero.storageUrl,
      objectPath: hero.objectPath,
      alt: `${definition.name} ${variantDef.color} ${variantDef.size}`,
      order: index + 1,
    });
    const glbAsset = createGlbAsset({
      url: variantDef.glbStorageUrl,
      posterUrl: hero.storageUrl,
      alt: `${definition.name} ${variantDef.color} ${variantDef.size} GLB`,
      order: index + 1,
    });

    assets.push(imageAsset, glbAsset);
    tryOnAssetIds.push(glbAsset._id);

    variants.push({
      _id: new mongoose.Types.ObjectId(),
      sku: `${definition.slug}-${trim(variantDef.color).toUpperCase()}-${trim(variantDef.size).toUpperCase()}`,
      options: {
        color: variantDef.color,
        size: variantDef.size,
      },
      price: variantDef.price,
      stock: variantDef.stock,
      assetIds: [imageAsset._id, glbAsset._id],
    });
  }

  return {
    type: PRODUCT_TYPES.FRAME,
    name: definition.name,
    slug: definition.slug,
    description: definition.description,
    brand: definition.brand,
    status: PRODUCT_STATUS.ACTIVE,
    pricing: {
      currency: 'VND',
      basePrice: definition.basePrice,
      salePrice: null,
      discountPercent: 0,
      taxRate: 8,
    },
    inventory: {
      track: true,
      threshold: 1,
    },
    preOrder: buildPreOrderConfig(definition),
    fulfillment: {
      supplier: definition.brand,
      leadTime: definition.preOrder?.enabled ? '10-21 days' : '2-4 days',
      returnWindowDays: 30,
      warrantyMonths: 12,
      warehouseDefaultLocation: 'HCM-FRAME-01',
    },
    seo: buildSeo(definition),
    compatibility: {
      productIds: [],
      notes: 'Compatible with lens upgrades and core accessories.',
    },
    media: {
      primaryAssetId: String(assets[0]?._id || ''),
      assets,
      tryOn: {
        enabled: true,
        status: TRY_ON_STATUS.PUBLISHED,
        assetIds: tryOnAssetIds,
        scene: 'effect kxCzj4fp37QDJFrsHN_4b',
        prefab: {
          rotation: '270 0 0',
          scale: '0.019 0.019 0.01',
          translation: '0 0 0',
          gravity: '0 0 0',
          cut: 'head',
          usePhysics: false,
          colliders: [],
        },
      },
    },
    variants,
    specs: {
      common: {
        shape: definition.shape,
        gender: 'unisex',
        weightGram: Number(definition.weightGram) || 22,
        standards: ['ISO 12870'],
      },
      frame: {
        material: 'acetate',
        hingeType: 'spring',
        nosePads: true,
        rimType: 'full',
        rxReady: true,
      },
      dimensions: {
        fit: 'medium',
        bridgeMm: 18,
        templeLengthMm: 145,
        lensWidthMm: 52,
        lensHeightMm: 40,
      },
      lens: {
        uvProtection: 'UV400',
        polarized: false,
        photochromic: false,
        blueLightFilter: false,
        category: 3,
        vltPercent: 15,
        tintColor: 'smoke',
        tintPercent: 80,
        coatings: ['anti-scratch', 'oleophobic'],
        lensType: 'single_vision',
        material: 'polycarbonate',
        index: 1.56,
        features: ['impact-resistant'],
        prescriptionRange: {
          sphMin: -8,
          sphMax: 4,
          cylMin: -2,
          cylMax: 0,
          axisMin: 0,
          axisMax: 180,
          addMin: 0,
          addMax: 3,
        },
        diameterMm: 70,
        thicknessOptionsMm: [1.5, 1.6],
      },
      accessory: {
        compatibleWith: ['frame', 'sunglasses'],
      },
      service: {
        includedItems: ['Store consultation'],
      },
      bundle: {
        items: [],
      },
    },
    servicesIncluded: ['Dieu chinh gong mien phi', 'Ve sinh kinh tai cua hang'],
    ratingsAverage: 4.6,
    ratingsQuantity: 12,
  };
}

async function upsertProduct(payload) {
  const existing = await Product.findOne({ slug: payload.slug });
  if (!existing) {
    const created = await Product.create(payload);
    return { product: created, action: 'created' };
  }

  const replacement = {
    ...payload,
    _id: existing._id,
    createdAt: existing.createdAt,
  };
  const updated = await Product.findOneAndReplace(
    { _id: existing._id },
    replacement,
    {
      new: true,
      runValidators: true,
    }
  );
  return { product: updated, action: 'updated' };
}

async function main() {
  if (!supabase) {
    throw new Error('Supabase admin client is unavailable. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  if (!fs.existsSync(LOCAL_GLB_PATH)) {
    throw new Error(
      `Missing local GLB source. Checked: ${LOCAL_GLB_PATH_CANDIDATES.join(', ')}`
    );
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const summary = [];

  for (const definition of PRODUCTS) {
    const uploadedVariants = [];
    for (const variant of definition.variants) {
      const upload = await uploadGlbForVariant({
        productSlug: definition.slug,
        color: variant.color,
        size: variant.size,
      });
      uploadedVariants.push({
        ...variant,
        glbObjectPath: upload.objectPath,
        glbStorageUrl: upload.storageUrl,
      });
    }

    const payload = await buildProductPayload({
      definition,
      uploadedVariants,
    });
    const { product, action } = await upsertProduct(payload);

    summary.push({
      action,
      productId: String(product._id),
      slug: product.slug,
      variants: product.variants.length,
      preOrderEnabled: Boolean(product.preOrder?.enabled),
      depositPercent: product.preOrder?.depositPercent ?? null,
      shippingCollectionTiming: product.preOrder?.shippingCollectionTiming ?? null,
      tryOnStatus: product.media?.tryOn?.status,
      tryOnEnabled: product.media?.tryOn?.enabled,
      glbUrls: uploadedVariants.map((variant) => variant.glbStorageUrl),
    });
  }

  console.log(JSON.stringify({ count: summary.length, products: summary }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
