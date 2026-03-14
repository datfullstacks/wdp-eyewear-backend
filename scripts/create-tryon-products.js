require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const { PRODUCT_TYPES, PRODUCT_STATUS, TRY_ON_STATUS } = require('../constants');
const { supabase, supabaseBucket } = require('../services/supabaseClient');

const LOCAL_GLB_PATH = path.resolve('D:/wdp/3D/effect-1772843546211/assets/glasses.glb');
const STORAGE_ROOT = 'tryon/generated';
const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 365 * 10;

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
    basePrice: 1190000,
    brand: 'WDP',
    shape: 'rectangle',
    variants: [
      { color: 'Black', size: 'M', stock: 18, price: 1190000, imageIndex: 0 },
      { color: 'Brown', size: 'M', stock: 12, price: 1190000, imageIndex: 1 },
      { color: 'Crystal', size: 'L', stock: 8, price: 1240000, imageIndex: 2 },
    ],
  },
  {
    slug: 'wdp-tryon-air-frame',
    name: 'WDP TryOn Air Frame',
    description: 'Lightweight frame seeded for Android try-on flow with variant asset mapping.',
    basePrice: 1390000,
    brand: 'WDP',
    shape: 'round',
    variants: [
      { color: 'Silver', size: 'S', stock: 10, price: 1390000, imageIndex: 3 },
      { color: 'Gunmetal', size: 'M', stock: 11, price: 1390000, imageIndex: 0 },
      { color: 'Gold', size: 'L', stock: 7, price: 1450000, imageIndex: 1 },
    ],
  },
];

const trim = (value) => String(value ?? '').trim();

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
    },
    inventory: {
      track: true,
      threshold: 1,
    },
    preOrder: {
      enabled: false,
      allowCod: true,
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
      },
      frame: {
        material: 'acetate',
        hingeType: 'spring',
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
    },
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
    throw new Error(`Missing local GLB source: ${LOCAL_GLB_PATH}`);
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
