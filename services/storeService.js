const Store = require('../models/Store');
const Product = require('../models/Product');
const User = require('../models/User');
const Order = require('../models/Order');
const AppError = require('../errors/AppError');
const ghnService = require('./ghnService');

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toTrimmedString(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function normalizePositiveInteger(value, fallback = null) {
  const number = Number(value);
  if (Number.isInteger(number) && number > 0) {
    return number;
  }
  return fallback;
}

function buildAddressSummary(payload = {}) {
  return [
    toTrimmedString(payload.addressLine1),
    toTrimmedString(payload.ward),
    toTrimmedString(payload.district),
    toTrimmedString(payload.city),
  ]
    .filter(Boolean)
    .join(', ');
}

class StoreService {
  normalizeGhnPayload(ghnInput = {}, payload = {}, previousGhn = {}) {
    const shopId = normalizePositiveInteger(ghnInput?.shopId ?? previousGhn?.shopId);
    const clientId = normalizePositiveInteger(
      ghnInput?.clientId ?? previousGhn?.clientId,
    );
    const provinceId = normalizePositiveInteger(
      ghnInput?.provinceId ?? previousGhn?.provinceId,
    );
    const districtId = normalizePositiveInteger(
      ghnInput?.districtId ?? previousGhn?.districtId,
    );
    const wardCode = toTrimmedString(ghnInput?.wardCode ?? previousGhn?.wardCode);
    const normalized = {
      shopId,
      clientId,
      provinceId,
      provinceName: toTrimmedString(
        ghnInput?.provinceName ?? previousGhn?.provinceName ?? payload?.city,
      ),
      districtId,
      districtName: toTrimmedString(
        ghnInput?.districtName ?? previousGhn?.districtName ?? payload?.district,
      ),
      wardCode,
      wardName: toTrimmedString(
        ghnInput?.wardName ?? previousGhn?.wardName ?? payload?.ward,
      ),
      address: toTrimmedString(
        ghnInput?.address ?? previousGhn?.address ?? payload?.addressLine1,
      ),
      syncedAt: previousGhn?.syncedAt || null,
      lastSyncError: toTrimmedString(previousGhn?.lastSyncError),
    };

    const hasConfiguredField = Boolean(
      normalized.shopId ||
        normalized.clientId ||
        normalized.provinceId ||
        normalized.districtId ||
        normalized.wardCode ||
        normalized.address,
    );

    return hasConfiguredField
      ? normalized
      : {
          shopId: null,
          clientId: null,
          provinceId: null,
          provinceName: '',
          districtId: null,
          districtName: '',
          wardCode: '',
          wardName: '',
          address: '',
          syncedAt: null,
          lastSyncError: '',
        };
  }

  assertGhnReady(ghnPayload = {}) {
    if (!normalizePositiveInteger(ghnPayload?.districtId)) {
      throw new AppError('GHN districtId is required', 400);
    }
    if (!toTrimmedString(ghnPayload?.wardCode)) {
      throw new AppError('GHN wardCode is required', 400);
    }
    if (!toTrimmedString(ghnPayload?.address)) {
      throw new AppError('GHN address is required', 400);
    }
  }

  async syncStoreToGhn(storeLike = {}, ghnPayload = {}) {
    this.assertGhnReady(ghnPayload);

    const name = toTrimmedString(storeLike?.name);
    const phone = toTrimmedString(storeLike?.phone);
    const address = toTrimmedString(ghnPayload?.address);

    if (!name) {
      throw new AppError('Store name is required before creating GHN store', 400);
    }
    if (!phone) {
      throw new AppError('Store phone is required before creating GHN store', 400);
    }

    const response = await ghnService.createStore({
      district_id: ghnPayload.districtId,
      ward_code: ghnPayload.wardCode,
      name,
      phone,
      address,
    });

    return {
      ...ghnPayload,
      shopId: normalizePositiveInteger(
        response?.data?.shop_id ?? response?.data?.shopId ?? ghnPayload.shopId,
      ),
      clientId: normalizePositiveInteger(
        response?.data?.client_id ?? response?.data?.clientId ?? ghnPayload.clientId,
      ),
      syncedAt: new Date(),
      lastSyncError: '',
    };
  }

  async prepareStorePayload(payload = {}, existingStore = null) {
    const base = existingStore
      ? {
          name: existingStore.name,
          code: existingStore.code,
          status: existingStore.status,
          type: existingStore.type,
          phone: existingStore.phone,
          email: existingStore.email,
          addressLine1: existingStore.addressLine1,
          ward: existingStore.ward,
          district: existingStore.district,
          city: existingStore.city,
          openingHours: existingStore.openingHours,
          note: existingStore.note,
          supportsTryOn: existingStore.supportsTryOn,
          supportsPickup: existingStore.supportsPickup,
          isDefault: existingStore.isDefault,
          sortOrder: existingStore.sortOrder,
        }
      : {};
    const merged = {
      ...base,
      ...payload,
    };
    const normalizedPayload = {
      ...merged,
      name: toTrimmedString(merged.name),
      code: toTrimmedString(merged.code).toUpperCase(),
      phone: toTrimmedString(merged.phone),
      email: toTrimmedString(merged.email).toLowerCase(),
      addressLine1: toTrimmedString(merged.addressLine1),
      ward: toTrimmedString(merged.ward),
      district: toTrimmedString(merged.district),
      city: toTrimmedString(merged.city),
      openingHours: toTrimmedString(merged.openingHours),
      note: toTrimmedString(merged.note),
      supportsTryOn: Boolean(merged.supportsTryOn),
      supportsPickup: merged.supportsPickup !== false,
      isDefault: Boolean(merged.isDefault),
      sortOrder: Math.max(0, Number(merged.sortOrder) || 0),
    };

    const shouldSyncToGhn = Boolean(payload?.ghn?.autoCreate);
    let ghnPayload = this.normalizeGhnPayload(
      payload?.ghn,
      normalizedPayload,
      existingStore?.ghn,
    );

    if (!ghnPayload.address) {
      ghnPayload.address = normalizedPayload.addressLine1 || buildAddressSummary(normalizedPayload);
    }

    if (shouldSyncToGhn) {
      ghnPayload = await this.syncStoreToGhn(
        existingStore ? { ...existingStore.toObject(), ...normalizedPayload } : normalizedPayload,
        ghnPayload,
      );
    }

    return {
      ...normalizedPayload,
      ghn: ghnPayload,
    };
  }

  async listStores({ page = 1, limit = 100, search = '', status = 'active' } = {}) {
    const resolvedPage = Math.max(1, Number(page) || 1);
    const resolvedLimit = Math.min(200, Math.max(1, Number(limit) || 100));
    const skip = (resolvedPage - 1) * resolvedLimit;
    const query = {};

    const normalizedStatus = String(status || 'active').trim().toLowerCase();
    if (normalizedStatus === 'active' || normalizedStatus === 'inactive') {
      query.status = normalizedStatus;
    }

    const normalizedSearch = String(search || '').trim();
    if (normalizedSearch) {
      const regex = new RegExp(escapeRegex(normalizedSearch), 'i');
      query.$or = [
        { name: regex },
        { code: regex },
        { city: regex },
        { district: regex },
      ];
    }

    const [stores, total] = await Promise.all([
      Store.find(query)
        .sort({ isDefault: -1, sortOrder: 1, name: 1 })
        .skip(skip)
        .limit(resolvedLimit),
      Store.countDocuments(query),
    ]);

    return {
      stores,
      pagination: {
        page: resolvedPage,
        limit: resolvedLimit,
        total,
        totalPages: Math.ceil(total / resolvedLimit),
      },
    };
  }

  async getStoreById(id) {
    const store = await Store.findById(id);
    if (!store) throw new AppError('Store not found', 404);
    return store;
  }

  async createStore(payload) {
    const preparedPayload = await this.prepareStorePayload(payload);
    const store = await Store.create(preparedPayload);
    if (store.isDefault) {
      await Store.updateMany({ _id: { $ne: store._id } }, { $set: { isDefault: false } });
    }
    return store;
  }

  async updateStore(id, payload) {
    const store = await Store.findById(id);
    if (!store) throw new AppError('Store not found', 404);

    const preparedPayload = await this.prepareStorePayload(payload, store);
    store.set(preparedPayload);
    await store.save();

    if (store.isDefault) {
      await Store.updateMany({ _id: { $ne: store._id } }, { $set: { isDefault: false } });
    }

    return store;
  }

  async deleteStore(id) {
    const store = await Store.findById(id);
    if (!store) throw new AppError('Store not found', 404);

    const [hasProducts, hasUsers, hasOrders] = await Promise.all([
      Product.exists({
        $or: [
          { 'storeScope.primaryStoreId': store._id },
          { 'storeScope.storeIds': store._id },
        ],
      }),
      User.exists({
        $or: [
          { 'storeAccess.primaryStoreId': store._id },
          { 'storeAccess.storeIds': store._id },
        ],
      }),
      Order.exists({ storeId: store._id }),
    ]);

    if (hasProducts) {
      throw new AppError(
        'Cannot delete store because it is still assigned to one or more products',
        400
      );
    }

    if (hasUsers) {
      throw new AppError(
        'Cannot delete store because it is still assigned to one or more users',
        400
      );
    }

    if (hasOrders) {
      throw new AppError(
        'Cannot delete store because it is still referenced by one or more orders',
        400
      );
    }

    await store.deleteOne();
  }
}

module.exports = new StoreService();
