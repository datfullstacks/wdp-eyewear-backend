const AppError = require("../errors/AppError");
const { GHN_SHOP_ID } = require("../config/ghn");
const Store = require("../models/Store");
const ghnService = require("./ghnService");

const SUPPORTED_SHIPPING_METHODS = ["standard", "express"];
const STORE_CACHE_TTL_MS = Math.max(
  60_000,
  Number(process.env.GHN_STORE_CACHE_TTL_MS || 60 * 60 * 1000),
);
const DEFAULT_ITEM_WEIGHT_GRAM = Math.max(
  50,
  Number(process.env.GHN_DEFAULT_ITEM_WEIGHT_GRAM || 300),
);
const DEFAULT_PACKAGE_LENGTH_CM = Math.max(
  10,
  Number(process.env.GHN_DEFAULT_PACKAGE_LENGTH_CM || 18),
);
const DEFAULT_PACKAGE_WIDTH_CM = Math.max(
  6,
  Number(process.env.GHN_DEFAULT_PACKAGE_WIDTH_CM || 12),
);
const DEFAULT_PACKAGE_HEIGHT_CM = Math.max(
  2,
  Number(process.env.GHN_DEFAULT_PACKAGE_HEIGHT_CM || 6),
);
const MAX_PACKAGE_WEIGHT_GRAM = 20_000;

const storeCache = {
  value: null,
  expiresAt: 0,
  promise: null,
};

function toTrimmedString(value, fallback = "") {
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

function normalizeShippingMethod(method) {
  const normalized = toTrimmedString(method, "standard").toLowerCase();
  return SUPPORTED_SHIPPING_METHODS.includes(normalized)
    ? normalized
    : "standard";
}

function normalizePhoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeGhnPhone(value) {
  const digits = normalizePhoneDigits(value);
  if (/^84[35789]\d{8}$/.test(digits)) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

function isValidGhnPhone(value) {
  return /^0[35789]\d{8}$/.test(normalizeGhnPhone(value));
}

function mapStore(raw = {}) {
  return {
    id: normalizePositiveInteger(raw._id),
    name: toTrimmedString(raw.name),
    phone: toTrimmedString(raw.phone),
    address: toTrimmedString(raw.address_v2 || raw.address),
    wardCode: toTrimmedString(raw.ward_code),
    districtId: normalizePositiveInteger(raw.district_id),
  };
}

async function listStores() {
  if (
    Array.isArray(storeCache.value) &&
    Date.now() < Number(storeCache.expiresAt || 0)
  ) {
    return storeCache.value;
  }

  if (storeCache.promise) {
    return storeCache.promise;
  }

  storeCache.promise = ghnService
    .getStores({ limit: 200 })
    .then((payload) => {
      const stores = Array.isArray(payload?.data?.shops)
        ? payload.data.shops.map(mapStore).filter((store) => store.id)
        : [];
      storeCache.value = stores;
      storeCache.expiresAt = Date.now() + STORE_CACHE_TTL_MS;
      return stores;
    })
    .finally(() => {
      storeCache.promise = null;
    });

  return storeCache.promise;
}

function buildLocalStoreOrigin(raw = {}) {
  return {
    localStoreId: toTrimmedString(raw?._id),
    shopId: normalizePositiveInteger(raw?.ghn?.shopId),
    districtId: normalizePositiveInteger(raw?.ghn?.districtId),
    wardCode: toTrimmedString(raw?.ghn?.wardCode),
    name: toTrimmedString(raw?.name),
    phone: toTrimmedString(raw?.phone),
    address: toTrimmedString(raw?.ghn?.address || raw?.addressLine1),
    wardName: toTrimmedString(raw?.ghn?.wardName || raw?.ward),
    districtName: toTrimmedString(raw?.ghn?.districtName || raw?.district),
    provinceName: toTrimmedString(raw?.ghn?.provinceName || raw?.city),
  };
}

function hasCompleteOriginStore(store = {}) {
  return Boolean(
    normalizePositiveInteger(store?.shopId) &&
      normalizePositiveInteger(store?.districtId) &&
      toTrimmedString(store?.wardCode) &&
      toTrimmedString(store?.name) &&
      isValidGhnPhone(store?.phone) &&
      toTrimmedString(store?.address),
  );
}

async function hydrateOriginStoreFromRemote(originStore = {}) {
  const shopId = normalizePositiveInteger(originStore?.shopId);
  if (!shopId) {
    return originStore;
  }

  const remoteStore = (await listStores()).find((item) => item.id === shopId);
  if (!remoteStore) {
    return originStore;
  }

  return {
    ...originStore,
    districtId: normalizePositiveInteger(originStore?.districtId) || remoteStore.districtId,
    wardCode: toTrimmedString(originStore?.wardCode) || remoteStore.wardCode,
    name: toTrimmedString(originStore?.name) || remoteStore.name,
    phone: isValidGhnPhone(originStore?.phone)
      ? normalizeGhnPhone(originStore?.phone)
      : toTrimmedString(remoteStore.phone),
    address: toTrimmedString(originStore?.address) || remoteStore.address,
  };
}

async function resolveOriginStore({ storeId = null } = {}) {
  const normalizedStoreId = toTrimmedString(storeId);
  if (normalizedStoreId) {
    const localStore = await Store.findById(normalizedStoreId).lean();
    if (!localStore) {
      throw new AppError("Selected store was not found.", 404);
    }
    const localOrigin = await hydrateOriginStoreFromRemote(
      buildLocalStoreOrigin(localStore),
    );
    if (hasCompleteOriginStore(localOrigin)) {
      return localOrigin;
    }
    throw new AppError(
      "Selected store is missing GHN shop, district, ward, phone, or address configuration.",
      503,
    );
  }

  const defaultLocalStore = await Store.findOne({ isDefault: true, status: "active" }).lean();
  const localOrigin = defaultLocalStore
    ? await hydrateOriginStoreFromRemote(buildLocalStoreOrigin(defaultLocalStore))
    : null;
  if (localOrigin && hasCompleteOriginStore(localOrigin)) {
    return localOrigin;
  }

  const stores = await listStores();
  if (!stores.length) {
    throw new AppError(
      "GHN store is not configured. Create a GHN store before calculating shipping fees.",
      503,
    );
  }

  const preferredStoreId = normalizePositiveInteger(GHN_SHOP_ID);
  const store =
    stores.find((item) => item.id === preferredStoreId) || stores[0] || null;

  if (!store?.districtId || !store?.wardCode) {
    throw new AppError(
      "GHN store is missing district or ward information.",
      503,
    );
  }

  return {
    shopId: preferredStoreId || store.id,
    districtId: store.districtId,
    wardCode: store.wardCode,
    name: store.name,
    phone: store.phone,
    address: store.address,
  };
}

function buildItemShippingMeta(item = {}) {
  const meta = item.shippingMeta || {};
  const weightGram =
    normalizePositiveInteger(meta.weightGram) || DEFAULT_ITEM_WEIGHT_GRAM;
  const lengthCm =
    normalizePositiveInteger(meta.lengthCm) || DEFAULT_PACKAGE_LENGTH_CM;
  const widthCm =
    normalizePositiveInteger(meta.widthCm) || DEFAULT_PACKAGE_WIDTH_CM;
  const heightCm =
    normalizePositiveInteger(meta.heightCm) || DEFAULT_PACKAGE_HEIGHT_CM;

  return {
    weightGram,
    lengthCm,
    widthCm,
    heightCm,
  };
}

function buildPackageMetrics(items = [], subtotal = 0) {
  let totalWeight = 0;
  let maxLength = 0;
  let maxWidth = 0;
  let totalHeight = 0;
  let totalQuantity = 0;

  for (const item of Array.isArray(items) ? items : []) {
    const quantity = normalizePositiveInteger(item?.quantity, 1);
    const meta = buildItemShippingMeta(item);

    totalQuantity += quantity;
    totalWeight += meta.weightGram * quantity;
    maxLength = Math.max(maxLength, meta.lengthCm);
    maxWidth = Math.max(maxWidth, meta.widthCm);
    totalHeight += meta.heightCm * quantity;
  }

  const weight = Math.max(
    DEFAULT_ITEM_WEIGHT_GRAM,
    Math.round(totalWeight || DEFAULT_ITEM_WEIGHT_GRAM),
  );
  if (weight > MAX_PACKAGE_WEIGHT_GRAM) {
    throw new AppError(
      "Orders above 20kg are not supported for GHN shipping quotes.",
      400,
    );
  }

  return {
    totalQuantity,
    weight,
    length: Math.max(DEFAULT_PACKAGE_LENGTH_CM, Math.round(maxLength || 0)),
    width: Math.max(DEFAULT_PACKAGE_WIDTH_CM, Math.round(maxWidth || 0)),
    height: Math.max(DEFAULT_PACKAGE_HEIGHT_CM, Math.round(totalHeight || 0)),
    insuranceValue: Math.max(0, Math.round(Number(subtotal || 0))),
  };
}

function normalizeDestination(address = {}) {
  const districtId = normalizePositiveInteger(
    address?.districtId ?? address?.district_id,
  );
  const wardCode = toTrimmedString(address?.wardCode ?? address?.ward_code);

  if (!districtId) {
    throw new AppError(
      "shippingAddress.districtId is required to calculate shipping fee",
      400,
    );
  }

  if (!wardCode) {
    throw new AppError(
      "shippingAddress.wardCode is required to calculate shipping fee",
      400,
    );
  }

  return {
    districtId,
    wardCode,
  };
}

function normalizeService(raw = {}) {
  return {
    serviceId: normalizePositiveInteger(raw.service_id ?? raw.serviceId),
    serviceTypeId: normalizePositiveInteger(
      raw.service_type_id ?? raw.serviceTypeId,
      0,
    ),
    shortName: toTrimmedString(raw.short_name ?? raw.shortName),
  };
}

function pickPreferredService(services = [], shippingMethod = "standard") {
  const rows = (Array.isArray(services) ? services : [])
    .map(normalizeService)
    .filter((row) => row.serviceId);

  if (!rows.length) {
    return null;
  }

  if (shippingMethod === "express") {
    return (
      rows.find(
        (row) =>
          row.serviceTypeId === 1 ||
          row.shortName.toLowerCase().includes("nhanh"),
      ) || null
    );
  }

  return (
    rows.find(
      (row) =>
        row.serviceTypeId === 2 || row.shortName.toLowerCase().includes("chu"),
    ) ||
    rows.find(
      (row) =>
        row.serviceTypeId === 3 || row.shortName.toLowerCase().includes("tiet"),
    ) ||
    rows.find((row) => row.serviceTypeId !== 1) ||
    rows[0]
  );
}

async function buildShippingOption({
  shippingMethod,
  services,
  originStore,
  destination,
  packageMetrics,
}) {
  const service = pickPreferredService(services, shippingMethod);
  if (!service) {
    return {
      available: false,
      message: "No GHN service is available for this shipping method.",
    };
  }

  try {
    const feePayload = {
      service_id: service.serviceId,
      to_district_id: destination.districtId,
      to_ward_code: destination.wardCode,
      weight: packageMetrics.weight,
      length: packageMetrics.length,
      width: packageMetrics.width,
      height: packageMetrics.height,
      insurance_value: packageMetrics.insuranceValue,
    };

    const feeResponse = await ghnService.calculateFee(feePayload, {
      shopId: originStore.shopId,
    });

    let leadtime = null;
    try {
      const leadtimeResponse = await ghnService.calculateLeadtime(
        {
          from_district_id: originStore.districtId,
          to_district_id: destination.districtId,
          to_ward_code: destination.wardCode,
          service_id: service.serviceId,
        },
        {
          shopId: originStore.shopId,
        },
      );

      const unixLeadtime = Number(leadtimeResponse?.data?.leadtime || 0);
      if (Number.isFinite(unixLeadtime) && unixLeadtime > 0) {
        leadtime = new Date(unixLeadtime * 1000).toISOString();
      }
    } catch (error) {
      leadtime = null;
    }

    return {
      available: true,
      fee: Math.max(0, Math.round(Number(feeResponse?.data?.total || 0))),
      serviceId: service.serviceId,
      serviceTypeId: service.serviceTypeId,
      serviceName: service.shortName || shippingMethod,
      leadtime,
    };
  } catch (error) {
    return {
      available: false,
      message: error?.message || "Failed to calculate GHN shipping fee.",
    };
  }
}

async function quoteShipping({
  items = [],
  shippingAddress,
  shippingMethod = "standard",
  subtotal = 0,
  storeId = null,
}) {
  const normalizedMethod = normalizeShippingMethod(shippingMethod);
  const destination = normalizeDestination(shippingAddress);
  const originStore = await resolveOriginStore({ storeId });
  const packageMetrics = buildPackageMetrics(items, subtotal);

  const availableServicesResponse = await ghnService.getAvailableServices(
    {
      fromDistrict: originStore.districtId,
      toDistrict: destination.districtId,
    },
    {
      shopId: originStore.shopId,
    },
  );

  const services = Array.isArray(availableServicesResponse?.data)
    ? availableServicesResponse.data
    : [];

  if (!services.length) {
    throw new AppError(
      "No GHN shipping service is available for the selected address.",
      400,
    );
  }

  const [standard, express] = await Promise.all(
    SUPPORTED_SHIPPING_METHODS.map((method) =>
      buildShippingOption({
        shippingMethod: method,
        services,
        originStore,
        destination,
        packageMetrics,
      }),
    ),
  );

  const shippingOptions = {
    standard,
    express,
  };

  const selectedOption = shippingOptions[normalizedMethod];
  if (!selectedOption?.available) {
    throw new AppError(
      selectedOption?.message ||
        `Shipping method "${normalizedMethod}" is not available for this address.`,
      400,
    );
  }

  return {
    shippingFee: selectedOption.fee,
    shippingMethod: normalizedMethod,
    shippingOptions,
    packageMetrics,
    originStore: {
      localStoreId: originStore.localStoreId || null,
      shopId: originStore.shopId,
      name: originStore.name,
      phone: originStore.phone,
      address: originStore.address,
      districtId: originStore.districtId,
      wardCode: originStore.wardCode,
      wardName: originStore.wardName || "",
      districtName: originStore.districtName || "",
      provinceName: originStore.provinceName || "",
    },
  };
}

module.exports = {
  quoteShipping,
  resolveOriginStore,
  buildPackageMetrics,
  normalizeShippingMethod,
};
