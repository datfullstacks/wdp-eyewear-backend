const Product = require('../models/Product');
const Order = require('../models/Order');
const Store = require('../models/Store');
const AppError = require('../errors/AppError');
const {
  TRY_ON_STATUS,
  PRODUCT_TYPES,
  PRODUCT_STATUS,
  ORDER_TYPES,
} = require('../constants');
const { publishStatusChange } = require('../helpers/statusEvents');
const { findSingleStoreId } = require('../helpers/singleStore');

const TRY_ON_STATUS_VALUES = new Set(Object.values(TRY_ON_STATUS));
const OPERATION_ROLE_ALLOWED_TRY_ON_STATUSES = new Set([
  TRY_ON_STATUS.DRAFT,
  TRY_ON_STATUS.PENDING_REVIEW
]);
const MANAGER_ROLE_ALLOWED_TRY_ON_STATUSES = new Set([
  TRY_ON_STATUS.DRAFT,
  TRY_ON_STATUS.PENDING_REVIEW,
  TRY_ON_STATUS.APPROVED,
  TRY_ON_STATUS.PUBLISHED,
  TRY_ON_STATUS.REJECTED,
  TRY_ON_STATUS.ARCHIVED
]);
const OPERATION_EDITABLE_TRY_ON_STATUSES = new Set([
  TRY_ON_STATUS.DRAFT,
  TRY_ON_STATUS.REJECTED
]);

const TRY_ON_TRANSITIONS = {
  [TRY_ON_STATUS.DRAFT]: [TRY_ON_STATUS.DRAFT, TRY_ON_STATUS.PENDING_REVIEW, TRY_ON_STATUS.ARCHIVED],
  [TRY_ON_STATUS.PENDING_REVIEW]: [
    TRY_ON_STATUS.PENDING_REVIEW,
    TRY_ON_STATUS.APPROVED,
    TRY_ON_STATUS.REJECTED,
    TRY_ON_STATUS.ARCHIVED
  ],
  [TRY_ON_STATUS.APPROVED]: [
    TRY_ON_STATUS.APPROVED,
    TRY_ON_STATUS.PUBLISHED,
    TRY_ON_STATUS.REJECTED,
    TRY_ON_STATUS.ARCHIVED
  ],
  [TRY_ON_STATUS.REJECTED]: [
    TRY_ON_STATUS.REJECTED,
    TRY_ON_STATUS.DRAFT,
    TRY_ON_STATUS.PENDING_REVIEW,
    TRY_ON_STATUS.ARCHIVED
  ],
  [TRY_ON_STATUS.PUBLISHED]: [TRY_ON_STATUS.PUBLISHED, TRY_ON_STATUS.ARCHIVED],
  [TRY_ON_STATUS.ARCHIVED]: [TRY_ON_STATUS.ARCHIVED]
};

const OPERATION_TRY_ON_TRANSITIONS = {
  [TRY_ON_STATUS.DRAFT]: [TRY_ON_STATUS.DRAFT, TRY_ON_STATUS.PENDING_REVIEW],
  [TRY_ON_STATUS.PENDING_REVIEW]: [TRY_ON_STATUS.PENDING_REVIEW, TRY_ON_STATUS.DRAFT],
  [TRY_ON_STATUS.REJECTED]: [
    TRY_ON_STATUS.REJECTED,
    TRY_ON_STATUS.DRAFT,
    TRY_ON_STATUS.PENDING_REVIEW
  ]
};

const canTransitionTryOnStatus = (map, fromStatus, toStatus) => {
  const allowed = map[fromStatus];
  return Array.isArray(allowed) && allowed.includes(toStatus);
};

const slugify = (value = '') =>
  value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const isPlainObject = (value) =>
  Object.prototype.toString.call(value) === '[object Object]';

const deepClone = (value) => {
  if (value === undefined) return {};
  return JSON.parse(JSON.stringify(value));
};

const deepMerge = (baseValue, patchValue) => {
  if (Array.isArray(patchValue)) return [...patchValue];
  if (!isPlainObject(baseValue) || !isPlainObject(patchValue)) return patchValue;

  const merged = { ...baseValue };
  for (const key of Object.keys(patchValue)) {
    const nextPatchValue = patchValue[key];
    const previousValue = merged[key];

    if (isPlainObject(nextPatchValue) && isPlainObject(previousValue)) {
      merged[key] = deepMerge(previousValue, nextPatchValue);
    } else if (Array.isArray(nextPatchValue)) {
      merged[key] = [...nextPatchValue];
    } else {
      merged[key] = nextPatchValue;
    }
  }
  return merged;
};

const PRODUCT_STORE_POPULATE = [
  {
    path: 'storeScope.primaryStoreId',
    select:
      'name code type status phone email addressLine1 ward district city openingHours supportsTryOn supportsPickup isDefault',
  },
  {
    path: 'storeScope.storeIds',
    select:
      'name code type status phone email addressLine1 ward district city openingHours supportsTryOn supportsPickup isDefault',
  },
];

const normalizeTryOnStatus = (status, fallback = TRY_ON_STATUS.DRAFT) => {
  const normalized = String(status || '')
    .trim()
    .toLowerCase();
  return TRY_ON_STATUS_VALUES.has(normalized) ? normalized : fallback;
};

const collect3dFormats = (assets = []) => {
  const formats = new Set();
  for (const asset of assets) {
    if (!asset || asset.assetType !== '3d') continue;
    const format = String(asset.format || '')
      .trim()
      .toLowerCase();
    if (format) formats.add(format);
  }
  return formats;
};

const hasGlbLikeFormat = (formats = new Set()) => formats.has('glb') || formats.has('gltf');
const isUsdzAsset = (asset) =>
  asset &&
  asset.assetType === '3d' &&
  String(asset.format || '')
    .trim()
    .toLowerCase() === 'usdz';

const managedTryOnAuditFields = [
  'submittedBy',
  'submittedAt',
  'approvedBy',
  'approvedAt',
  'rejectedBy',
  'rejectedAt',
  'publishedBy',
  'publishedAt'
];

class ProductService {
  normalizeWorkflowFamily(value, fallback = ORDER_TYPES.READY_STOCK) {
    const normalized = String(value || '').trim().toLowerCase();
    return Object.values(ORDER_TYPES).includes(normalized) ? normalized : fallback;
  }

  async resolveBundleWorkflowFamily(product, seenIds = new Set()) {
    const bundleItems = Array.isArray(product?.specs?.bundle?.items)
      ? product.specs.bundle.items
      : [];
    if (bundleItems.length === 0) {
      throw new AppError('Bundle must include at least one bundled product', 400);
    }

    const currentProductId = String(product?._id || '').trim();
    const nextSeenIds = new Set(seenIds);
    if (currentProductId) {
      nextSeenIds.add(currentProductId);
    }

    const productIds = [
      ...new Set(
        bundleItems
          .map((item) => String(item?.productId || '').trim())
          .filter(Boolean)
      ),
    ];
    const componentProducts = await Product.find({
      _id: { $in: productIds },
    }).select('_id name type status preOrder specs.bundle');
    const componentMap = new Map(
      componentProducts.map((component) => [String(component._id), component])
    );
    const families = new Set();

    for (const bundleItem of bundleItems) {
      const componentId = String(bundleItem?.productId || '').trim();
      if (!componentId) {
        throw new AppError('Bundle item productId is required', 400);
      }
      if (nextSeenIds.has(componentId)) {
        throw new AppError('Nested bundle recursion is not allowed', 400);
      }

      const component = componentMap.get(componentId);
      if (!component) {
        throw new AppError('Bundle references an unknown product', 400);
      }
      if (component.status !== PRODUCT_STATUS.ACTIVE) {
        throw new AppError(
          `Bundle cannot include inactive product "${component.name}"`,
          400
        );
      }

      families.add(await this.resolveWorkflowFamilyForProduct(component, nextSeenIds));
    }

    if (families.size !== 1) {
      throw new AppError('Bundle mixed workflow is not supported in V1', 400);
    }

    const family = this.normalizeWorkflowFamily([...families][0]);
    const bundleIsPreOrder = Boolean(product?.preOrder?.enabled);
    if (bundleIsPreOrder && family !== ORDER_TYPES.PRE_ORDER) {
      throw new AppError('Pre-order bundle can only include pre-order products', 400);
    }
    if (!bundleIsPreOrder && family === ORDER_TYPES.PRE_ORDER) {
      throw new AppError('Bundle containing pre-order products must also be pre-order', 400);
    }
    if (bundleIsPreOrder && family === ORDER_TYPES.PRESCRIPTION) {
      throw new AppError('Prescription bundle cannot be combined with pre-order in V1', 400);
    }

    return bundleIsPreOrder ? ORDER_TYPES.PRE_ORDER : family;
  }

  async resolveWorkflowFamilyForProduct(product, seenIds = new Set()) {
    const type = String(product?.type || '').trim().toLowerCase();
    if ([PRODUCT_TYPES.SERVICE, PRODUCT_TYPES.GIFT_CARD].includes(type)) {
      throw new AppError(`Bundle cannot include product type "${type}" in V1`, 400);
    }
    if (type === PRODUCT_TYPES.BUNDLE) {
      return this.resolveBundleWorkflowFamily(product, seenIds);
    }
    if (type === PRODUCT_TYPES.LENS) {
      if (Boolean(product?.preOrder?.enabled)) {
        throw new AppError('Lens bundle items cannot be pre-order in V1', 400);
      }
      return ORDER_TYPES.PRESCRIPTION;
    }
    return Boolean(product?.preOrder?.enabled)
      ? ORDER_TYPES.PRE_ORDER
      : ORDER_TYPES.READY_STOCK;
  }

  async assertBundleWorkflowCompatibility(payload) {
    if (String(payload?.type || '').trim().toLowerCase() !== PRODUCT_TYPES.BUNDLE) {
      return;
    }

    await this.resolveBundleWorkflowFamily(payload, new Set());
  }

  stripLegacyUsdzAssets(payload) {
    if (!isPlainObject(payload?.media)) return;

    const removedAssetIds = new Set();

    if (Array.isArray(payload.media.assets)) {
      payload.media.assets = payload.media.assets
        .filter((asset) => {
          const shouldKeep = !isUsdzAsset(asset);
          if (!shouldKeep && asset?._id) {
            removedAssetIds.add(String(asset._id));
          }
          return shouldKeep;
        })
        .map((asset) => {
          if (!isPlainObject(asset)) return asset;
          const normalizedAsset = { ...asset };
          if (isPlainObject(normalizedAsset.ar) && 'usdzUrl' in normalizedAsset.ar) {
            delete normalizedAsset.ar.usdzUrl;
          }
          if ('ar.usdzUrl' in normalizedAsset) {
            delete normalizedAsset['ar.usdzUrl'];
          }
          return normalizedAsset;
        });
    }

    if (!isPlainObject(payload.media.tryOn)) return;

    if ('usdzUrl' in payload.media.tryOn) {
      delete payload.media.tryOn.usdzUrl;
    }

    if (Array.isArray(payload.media.tryOn.assetIds) && removedAssetIds.size > 0) {
      payload.media.tryOn.assetIds = payload.media.tryOn.assetIds.filter(
        (assetId) => !removedAssetIds.has(String(assetId))
      );
    }
  }

  async normalizeStoreScope(storeScopeInput = {}) {
    const singleStoreId = await findSingleStoreId();
    const note = isPlainObject(storeScopeInput)
      ? String(storeScopeInput.note || '').trim()
      : '';
    return {
      mode: 'selected',
      primaryStoreId: singleStoreId,
      storeIds: [singleStoreId],
      note,
    };
  }

  async applyNormalizedStoreScope(payload) {
    if (!isPlainObject(payload.storeScope)) return;
    payload.storeScope = await this.normalizeStoreScope(payload.storeScope);
  }

  enforceOperationManagedInventoryOnCreate(payload) {
    if (!Array.isArray(payload?.variants)) return;

    payload.variants = payload.variants.map((variant) => {
      if (!isPlainObject(variant)) return variant;
      return {
        ...variant,
        stock: 0,
      };
    });
  }

  enforceOperationManagedInventoryOnUpdate(payload, existingProduct) {
    if (!Array.isArray(payload?.variants)) return;

    const existingStockById = new Map(
      (Array.isArray(existingProduct?.variants) ? existingProduct.variants : [])
        .filter((variant) => variant?._id)
        .map((variant) => {
          const stock = Number(variant?.stock);
          return [
            String(variant._id),
            Number.isFinite(stock) && stock >= 0 ? stock : 0,
          ];
        })
    );

    payload.variants = payload.variants.map((variant) => {
      if (!isPlainObject(variant)) return variant;

      const variantId = String(variant._id || '').trim();
      const stock = variantId && existingStockById.has(variantId)
        ? existingStockById.get(variantId)
        : 0;

      return {
        ...variant,
        stock,
      };
    });
  }

  getRole(currentUser) {
    return String(currentUser?.role || '')
      .trim()
      .toLowerCase();
  }

  getUserId(currentUser) {
    return currentUser?.id || currentUser?._id || null;
  }

  ensureMutableTryOnPayload(payload) {
    if (!isPlainObject(payload.media)) {
      payload.media = {};
    }
    if (!isPlainObject(payload.media.tryOn)) {
      payload.media.tryOn = {};
    }
    return payload.media.tryOn;
  }

  stripManagedTryOnAuditFields(tryOnPayload = {}) {
    for (const field of managedTryOnAuditFields) {
      delete tryOnPayload[field];
    }
  }

  assertTryOnUpdatePermission({
    role,
    currentStatus,
    nextStatus,
    hasTryOnPayload,
    hasAssetPayload
  }) {
    if (!hasTryOnPayload && !hasAssetPayload) return;
    if (!role) throw new AppError('Forbidden', 403);

    if (role === 'operations') {
      const canEditAssetsWhenReturningToDraft =
        hasTryOnPayload &&
        currentStatus === TRY_ON_STATUS.PENDING_REVIEW &&
        nextStatus === TRY_ON_STATUS.DRAFT;

      if (
        hasAssetPayload &&
        !OPERATION_EDITABLE_TRY_ON_STATUSES.has(currentStatus) &&
        !canEditAssetsWhenReturningToDraft
      ) {
        throw new AppError(
          'operations role cannot modify try-on assets outside draft/rejected state',
          403
        );
      }

      if (!hasTryOnPayload) return;

      if (!OPERATION_ROLE_ALLOWED_TRY_ON_STATUSES.has(nextStatus)) {
        throw new AppError(
          `operations role cannot set media.tryOn.status to "${nextStatus}"`,
          403
        );
      }

      if (!canTransitionTryOnStatus(OPERATION_TRY_ON_TRANSITIONS, currentStatus, nextStatus)) {
        throw new AppError(
          `Invalid try-on status transition for operations: ${currentStatus} -> ${nextStatus}`,
          400
        );
      }
      return;
    }

    if (role === 'manager') {
      if (!hasTryOnPayload) return;

      if (!MANAGER_ROLE_ALLOWED_TRY_ON_STATUSES.has(nextStatus)) {
        throw new AppError(
          `manager role cannot set media.tryOn.status to "${nextStatus}"`,
          403
        );
      }

      if (!canTransitionTryOnStatus(TRY_ON_TRANSITIONS, currentStatus, nextStatus)) {
        throw new AppError(`Invalid try-on status transition: ${currentStatus} -> ${nextStatus}`, 400);
      }
      return;
    }

    throw new AppError('Forbidden', 403);
  }

  assertTryOnReadyForPublish(productSnapshot) {
    const tryOn = productSnapshot?.media?.tryOn || {};
    if (!tryOn.enabled) {
      throw new AppError('media.tryOn.enabled must be true before publishing try-on', 400);
    }

    const assets = Array.isArray(productSnapshot?.media?.assets)
      ? productSnapshot.media.assets
      : [];
    const formats = collect3dFormats(assets);
    if (!hasGlbLikeFormat(formats)) {
      throw new AppError(
        'media.assets must include at least one GLB/GLTF 3d asset before publishing try-on',
        400
      );
    }

    const tryOnAssetIds = Array.isArray(tryOn.assetIds) ? tryOn.assetIds : [];
    if (tryOnAssetIds.length === 0) {
      throw new AppError('media.tryOn.assetIds is required before publishing try-on', 400);
    }

    const normalizedTryOnAssetIds = [
      ...new Set(
        tryOnAssetIds
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      )
    ];
    const knownAssetIds = new Set(assets.map((asset) => String(asset?._id || '').trim()).filter(Boolean));
    const invalidAssetIds = normalizedTryOnAssetIds.filter((id) => !knownAssetIds.has(id));
    if (invalidAssetIds.length > 0) {
      throw new AppError('media.tryOn.assetIds contains id(s) not found in media.assets', 400);
    }

    const tryOnAssets = assets.filter((asset) =>
      normalizedTryOnAssetIds.includes(String(asset?._id || '').trim())
    );
    if (tryOnAssets.length === 0) {
      throw new AppError('Try-on assets are missing. Check media.tryOn.assetIds mapping', 400);
    }

    const tryOnFormats = collect3dFormats(tryOnAssets);
    if (!hasGlbLikeFormat(tryOnFormats)) {
      throw new AppError(
        'Try-on assetIds must include at least one GLB/GLTF 3d asset before publishing',
        400
      );
    }
  }

  applyTryOnAuditMetadata(payload, currentUser, nextStatus, statusChanged) {
    if (!statusChanged) return;

    const userId = this.getUserId(currentUser);
    if (!userId) return;

    const tryOnPayload = this.ensureMutableTryOnPayload(payload);
    const now = new Date();

    if (nextStatus === TRY_ON_STATUS.PENDING_REVIEW) {
      tryOnPayload.submittedBy = userId;
      tryOnPayload.submittedAt = now;
      tryOnPayload.approvedBy = null;
      tryOnPayload.approvedAt = null;
      tryOnPayload.rejectedBy = null;
      tryOnPayload.rejectedAt = null;
      tryOnPayload.rejectReason = '';
      tryOnPayload.publishedBy = null;
      tryOnPayload.publishedAt = null;
    }

    if (nextStatus === TRY_ON_STATUS.APPROVED) {
      tryOnPayload.approvedBy = userId;
      tryOnPayload.approvedAt = now;
      tryOnPayload.rejectedBy = null;
      tryOnPayload.rejectedAt = null;
      tryOnPayload.rejectReason = '';
    }

    if (nextStatus === TRY_ON_STATUS.REJECTED) {
      tryOnPayload.rejectedBy = userId;
      tryOnPayload.rejectedAt = now;
      tryOnPayload.publishedBy = null;
      tryOnPayload.publishedAt = null;
    }

    if (nextStatus === TRY_ON_STATUS.PUBLISHED) {
      tryOnPayload.publishedBy = userId;
      tryOnPayload.publishedAt = now;
    }
  }

  enforceTryOnRulesOnCreate(payload, currentUser) {
    const tryOnPayload = payload?.media?.tryOn;
    if (!isPlainObject(tryOnPayload)) return;

    this.stripManagedTryOnAuditFields(tryOnPayload);

    const role = this.getRole(currentUser);
    const hasAssetPayload = Array.isArray(payload?.media?.assets);
    const nextStatus = normalizeTryOnStatus(
      tryOnPayload.status,
      TRY_ON_STATUS.DRAFT
    );
    tryOnPayload.status = nextStatus;

    this.assertTryOnUpdatePermission({
      role,
      currentStatus: TRY_ON_STATUS.DRAFT,
      nextStatus,
      hasTryOnPayload: true,
      hasAssetPayload
    });

    if (
      nextStatus === TRY_ON_STATUS.REJECTED &&
      !String(tryOnPayload.rejectReason || '').trim()
    ) {
      throw new AppError(
        'media.tryOn.rejectReason is required when media.tryOn.status is rejected',
        400
      );
    }

    if (nextStatus === TRY_ON_STATUS.PUBLISHED) {
      this.assertTryOnReadyForPublish(payload);
    }

    this.applyTryOnAuditMetadata(payload, currentUser, nextStatus, true);
  }

  enforceTryOnRulesOnUpdate(payload, existingProduct, mergedSnapshot, currentUser) {
    const hasTryOnPayload = isPlainObject(payload?.media?.tryOn);
    const hasAssetPayload = Array.isArray(payload?.media?.assets);
    if (!hasTryOnPayload && !hasAssetPayload) return;

    const currentStatus = normalizeTryOnStatus(
      existingProduct?.media?.tryOn?.status,
      TRY_ON_STATUS.DRAFT
    );
    let nextStatus = normalizeTryOnStatus(
      mergedSnapshot?.media?.tryOn?.status,
      currentStatus
    );

    if (hasTryOnPayload) {
      this.stripManagedTryOnAuditFields(payload.media.tryOn);
      const explicitStatus = payload.media.tryOn.status;
      if (explicitStatus !== undefined) {
        nextStatus = normalizeTryOnStatus(explicitStatus, currentStatus);
      }
      payload.media.tryOn.status = nextStatus;
    }

    const role = this.getRole(currentUser);
    const statusChanged = currentStatus !== nextStatus;
    this.assertTryOnUpdatePermission({
      role,
      currentStatus,
      nextStatus,
      hasTryOnPayload,
      hasAssetPayload
    });

    if (
      nextStatus === TRY_ON_STATUS.REJECTED &&
      !String(mergedSnapshot?.media?.tryOn?.rejectReason || '').trim()
    ) {
      throw new AppError(
        'media.tryOn.rejectReason is required when media.tryOn.status is rejected',
        400
      );
    }

    if (nextStatus === TRY_ON_STATUS.PUBLISHED) {
      this.assertTryOnReadyForPublish(mergedSnapshot);
    }

    this.applyTryOnAuditMetadata(payload, currentUser, nextStatus, statusChanged);
  }

  // Create
  async createProduct(productData, currentUser = null) {
    const payload = deepClone(productData);
    if (!payload.slug) {
      payload.slug = slugify(payload.name);
    }

    await this.applyNormalizedStoreScope(payload);
    await this.assertBundleWorkflowCompatibility(payload);
    this.stripLegacyUsdzAssets(payload);
    this.enforceOperationManagedInventoryOnCreate(payload);
    this.enforceTryOnRulesOnCreate(payload, currentUser);

    const product = await Product.create(payload);
    return Product.findById(product._id).populate(PRODUCT_STORE_POPULATE);
  }

  // Get All with Filter, Sort, Pagination
  async getAllProducts(page = 1, limit = 10, filters = {}, sort = '-createdAt') {
    const skip = (page - 1) * limit;
    const queryObj = {};

    // Filtering
    if (filters.search) {
      queryObj.$text = { $search: filters.search };
    }
    if (filters.type) queryObj.type = filters.type;
    if (filters.brand) queryObj.brand = filters.brand;
    if (filters.status) queryObj.status = filters.status;
    if (filters.compatibleWith) {
      queryObj['compatibility.productIds'] = filters.compatibleWith;
    }
    if (filters.storeId) {
      queryObj.$and = queryObj.$and || [];
      queryObj.$and.push({
        $or: [
          { 'storeScope.mode': { $exists: false } },
          { 'storeScope.mode': 'all' },
          { 'storeScope.storeIds': filters.storeId },
        ],
      });
    }
    if (filters.season) {
      queryObj.$and = queryObj.$and || [];
      queryObj.$and.push({
        $or: [
          { 'seo.season': filters.season },
          { 'seo.season': 'all_season' },
          { 'seo.seasons': filters.season },
          { 'seo.seasons': 'all_season' }
        ]
      });
    }

    // Price Range
    if (filters.minPrice || filters.maxPrice) {
      queryObj['pricing.basePrice'] = {};
      if (filters.minPrice) queryObj['pricing.basePrice'].$gte = Number(filters.minPrice);
      if (filters.maxPrice) queryObj['pricing.basePrice'].$lte = Number(filters.maxPrice);
    }

    const [products, total] = await Promise.all([
      Product.find(queryObj)
        .populate(PRODUCT_STORE_POPULATE)
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Product.countDocuments(queryObj)
    ]);

    return {
      products,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async getCompatibleProducts(productId, options = {}) {
    const product = await Product.findById(productId).select('_id type compatibility.productIds');
    if (!product) throw new AppError('Product not found', 404);

    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 10));
    const skip = (page - 1) * limit;
    const explicitIds = Array.isArray(product?.compatibility?.productIds)
      ? product.compatibility.productIds.map((id) => String(id))
      : [];

    const query = {
      _id: { $ne: product._id },
      status: PRODUCT_STATUS.ACTIVE
    };

    if (explicitIds.length > 0) {
      query._id = { $in: explicitIds };
    } else {
      query.$or = [
        { 'compatibility.productIds': product._id }
      ];
    }

    const requestedType = String(options.type || '').trim().toLowerCase();
    if (requestedType) {
      query.type = requestedType;
    } else if (product.type === PRODUCT_TYPES.LENS) {
      query.type = PRODUCT_TYPES.FRAME;
    } else if (product.type === PRODUCT_TYPES.FRAME) {
      query.type = PRODUCT_TYPES.LENS;
    }

    const [products, total] = await Promise.all([
      Product.find(query).sort({ 'ratingsAverage': -1, createdAt: -1 }).skip(skip).limit(limit),
      Product.countDocuments(query)
    ]);

    return {
      products,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  // Get One by ID
  async getProductById(id) {
    const product = await Product.findById(id).populate(PRODUCT_STORE_POPULATE);
    if (!product) {
      throw new AppError('Product not found', 404);
    }
    return product;
  }

  // Update
  async updateProduct(id, updateData, currentUser = null) {
    const product = await Product.findById(id);
    if (!product) {
      throw new AppError('Product not found', 404);
    }
    const previousProductStatus = product.status;
    const previousTryOnStatus = product?.media?.tryOn?.status || TRY_ON_STATUS.DRAFT;

    const payload = deepClone(updateData);
    if (payload.name && !payload.slug) {
      payload.slug = slugify(payload.name);
    }
    await this.applyNormalizedStoreScope(payload);
    this.stripLegacyUsdzAssets(payload);
    this.enforceOperationManagedInventoryOnUpdate(payload, product);

    const existingSnapshot = product.toObject({ depopulate: true });
    const mergedSnapshot = deepMerge(existingSnapshot, payload);
    await this.assertBundleWorkflowCompatibility(mergedSnapshot);
    this.enforceTryOnRulesOnUpdate(payload, product, mergedSnapshot, currentUser);

    product.set(payload);
    await product.save();

    publishStatusChange({
      domain: 'product',
      entityId: product._id,
      previousStatus: previousProductStatus,
      nextStatus: product.status,
      currentUser,
      meta: {
        name: product.name,
        type: product.type,
      },
    });
    publishStatusChange({
      domain: 'product',
      entityId: product._id,
      statusField: 'media.tryOn.status',
      previousStatus: previousTryOnStatus,
      nextStatus: product?.media?.tryOn?.status || TRY_ON_STATUS.DRAFT,
      currentUser,
      meta: {
        name: product.name,
        type: product.type,
      },
    });

    return Product.findById(product._id).populate(PRODUCT_STORE_POPULATE);
  }

  // Delete (hard delete)
  async deleteProduct(id) {
    const hasOrders = await Order.exists({ 'items.productId': id });
    if (hasOrders) {
      throw new AppError(
        'Product is linked to existing orders and cannot be deleted. Set status to inactive instead.',
        400
      );
    }

    const product = await Product.findByIdAndDelete(id);
    if (!product) {
      throw new AppError('Product not found', 404);
    }
    return null;
  }
}

module.exports = new ProductService();
