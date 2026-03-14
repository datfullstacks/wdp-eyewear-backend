require('dotenv').config();

const mongoose = require('mongoose');
const Product = require('../models/Product');
const productService = require('../services/productService');

const trim = (value) => String(value || '').trim();
const hasValue = (value) => trim(value).length > 0;
const isHttpUrl = (value) => /^https?:\/\//i.test(trim(value));
const clone = (value) => JSON.parse(JSON.stringify(value || {}));

const summarizeTryOn = (tryOn = {}) => ({
  enabled: tryOn.enabled,
  arUrl: tryOn.arUrl,
  glbUrl: tryOn.glbUrl,
  launchUrl: tryOn.launchUrl,
  effect: tryOn.effect,
  effectPath: tryOn.effectPath,
  resourcePaths: Array.isArray(tryOn.resourcePaths) ? [...tryOn.resourcePaths] : [],
  rotation: tryOn.rotation,
  scale: tryOn.scale,
  translation: tryOn.translation,
  prefab: tryOn.prefab || {},
  assetIds: Array.isArray(tryOn.assetIds) ? tryOn.assetIds.map(String) : [],
  status: tryOn.status,
  rejectReason: tryOn.rejectReason,
});

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);

  const result = {
    unsetLegacyUsdzUrl: 0,
    inspectedProducts: 0,
    updatedProducts: 0,
    effectPathFromEffect: 0,
    effectPathFromLegacyArUrl: 0,
    launchUrlFromArUrl: 0,
    launchUrlFromGlbUrl: 0,
    normalizedResourcePaths: 0,
    liftedPrefabTransforms: 0,
    changedSlugs: [],
  };

  const unsetResult = await Product.updateMany(
    { 'media.tryOn.usdzUrl': { $exists: true } },
    { $unset: { 'media.tryOn.usdzUrl': 1 } }
  );
  result.unsetLegacyUsdzUrl = unsetResult.modifiedCount || 0;

  const products = await Product.find({ 'media.tryOn': { $exists: true } })
    .select('_id slug media.tryOn')
    .lean();

  for (const product of products) {
    result.inspectedProducts += 1;

    const before = summarizeTryOn(product?.media?.tryOn || {});
    const after = clone(product?.media?.tryOn || {});

    productService.normalizeTryOnPayload(after);

    if (
      !hasValue(before.effectPath) &&
      hasValue(after.effectPath) &&
      hasValue(before.effect) &&
      trim(after.effectPath) === trim(before.effect)
    ) {
      result.effectPathFromEffect += 1;
    }

    if (
      !hasValue(before.effectPath) &&
      hasValue(after.effectPath) &&
      hasValue(before.arUrl) &&
      !isHttpUrl(before.arUrl) &&
      trim(after.effectPath) === trim(before.arUrl)
    ) {
      result.effectPathFromLegacyArUrl += 1;
    }

    if (
      !hasValue(before.launchUrl) &&
      hasValue(after.launchUrl) &&
      hasValue(before.arUrl) &&
      isHttpUrl(before.arUrl) &&
      trim(after.launchUrl) === trim(before.arUrl)
    ) {
      result.launchUrlFromArUrl += 1;
    }

    if (
      !hasValue(before.launchUrl) &&
      hasValue(after.launchUrl) &&
      hasValue(before.glbUrl) &&
      trim(after.launchUrl) === trim(before.glbUrl)
    ) {
      result.launchUrlFromGlbUrl += 1;
    }

    if (JSON.stringify(before.resourcePaths) !== JSON.stringify(after.resourcePaths || [])) {
      result.normalizedResourcePaths += 1;
    }

    if (
      (!hasValue(before.rotation) && hasValue(after.rotation)) ||
      (!hasValue(before.scale) && hasValue(after.scale)) ||
      (!hasValue(before.translation) && hasValue(after.translation))
    ) {
      const beforePrefab = before.prefab || {};
      const lifted =
        (!hasValue(before.rotation) && hasValue(beforePrefab.rotation) && trim(after.rotation) === trim(beforePrefab.rotation)) ||
        (!hasValue(before.scale) && hasValue(beforePrefab.scale) && trim(after.scale) === trim(beforePrefab.scale)) ||
        (!hasValue(before.translation) && hasValue(beforePrefab.translation) && trim(after.translation) === trim(beforePrefab.translation));
      if (lifted) {
        result.liftedPrefabTransforms += 1;
      }
    }

    const normalizedAfter = summarizeTryOn(after);
    if (JSON.stringify(before) === JSON.stringify(normalizedAfter)) {
      continue;
    }

    await Product.updateOne(
      { _id: product._id },
      { $set: { 'media.tryOn': after } }
    );

    result.updatedProducts += 1;
    result.changedSlugs.push(product.slug);
  }

  console.log(JSON.stringify(result, null, 2));
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
