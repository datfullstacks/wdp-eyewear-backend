const AppError = require('../errors/AppError');
const ghnService = require('./ghnService');

const CACHE_TTL_MS = Math.max(
  60_000,
  Number(process.env.GHN_LOCATION_CACHE_TTL_MS || 24 * 60 * 60 * 1000)
);

const cache = new Map();

function normalizePositiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return number;
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key, value) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
  return value;
}

async function remember(key, loader) {
  const cached = getCached(key);
  if (cached) return cached;
  const value = await loader();
  return setCached(key, value);
}

function toArray(payload) {
  return Array.isArray(payload?.data) ? payload.data : [];
}

function mapProvince(raw = {}) {
  return {
    id: Number(raw.ProvinceID || 0),
    name: String(raw.ProvinceName || '').trim(),
    code: String(raw.Code || '').trim(),
    canUpdateCod: Boolean(raw.CanUpdateCOD),
    status: raw.Status ?? null
  };
}

function mapDistrict(raw = {}) {
  return {
    id: Number(raw.DistrictID || 0),
    provinceId: Number(raw.ProvinceID || 0),
    name: String(raw.DistrictName || '').trim(),
    code: String(raw.Code || '').trim(),
    type: String(raw.Type || '').trim(),
    supportType: Number(raw.SupportType ?? 0),
    canUpdateCod: Boolean(raw.CanUpdateCOD),
    status: raw.Status ?? null
  };
}

function mapWard(raw = {}) {
  return {
    code: String(raw.WardCode || '').trim(),
    districtId: Number(raw.DistrictID || 0),
    name: String(raw.WardName || '').trim(),
    supportType: Number(raw.SupportType ?? 0),
    canUpdateCod: Boolean(raw.CanUpdateCOD),
    status: raw.Status ?? null
  };
}

class LocationService {
  async getProvinces() {
    return remember('ghn:provinces', async () => {
      const payload = await ghnService.getProvinces();
      return toArray(payload)
        .map(mapProvince)
        .filter((item) => item.id > 0 && item.name);
    });
  }

  async getDistricts(provinceIdInput) {
    const provinceId = normalizePositiveInteger(provinceIdInput, 'provinceId');
    return remember(`ghn:districts:${provinceId}`, async () => {
      const payload = await ghnService.getDistricts({ provinceId });
      return toArray(payload)
        .map(mapDistrict)
        .filter((item) => item.id > 0 && item.provinceId === provinceId && item.name);
    });
  }

  async getWards(districtIdInput) {
    const districtId = normalizePositiveInteger(districtIdInput, 'districtId');
    return remember(`ghn:wards:${districtId}`, async () => {
      const payload = await ghnService.getWards({ districtId });
      return toArray(payload)
        .map(mapWard)
        .filter((item) => item.code && item.districtId === districtId && item.name);
    });
  }
}

module.exports = new LocationService();
