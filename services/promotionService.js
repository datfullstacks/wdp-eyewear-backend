const AppError = require('../errors/AppError');
const { Promotion } = require('../models/Promotion');
const promotionRedemptionService = require('./promotionRedemptionService');

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeNonNegativeNumber(value, fallback = 0) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return number;
}

function isApplicableCartType(promotion, cartType) {
  if (!promotion?.cartType || promotion.cartType === 'all') return true;
  if (!cartType) return true;
  return promotion.cartType === cartType;
}

function normalizePaymentMethod(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'sepay' || normalized === 'cod') return normalized;
  return '';
}

function normalizeCategories(categories = []) {
  const normalized = (Array.isArray(categories) ? categories : [categories])
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);

  return normalized.length > 0 ? [...new Set(normalized)] : ['all'];
}

function buildCategorySet(items = []) {
  return new Set(
    (Array.isArray(items) ? items : [])
      .map((item) => String(item?.type || item?.catalogType || '').trim().toLowerCase())
      .filter(Boolean),
  );
}

function assertApplicablePaymentScope(promotion, paymentMethod) {
  const scope = String(promotion?.paymentScope || 'all').trim().toLowerCase() || 'all';
  const normalizedMethod = normalizePaymentMethod(paymentMethod);

  if (!scope || scope === 'all' || !normalizedMethod) {
    return;
  }

  if (scope !== normalizedMethod) {
    const paymentLabel = scope === 'cod' ? 'COD' : 'SePay';
    throw new AppError(`Voucher is only applicable for ${paymentLabel} payments`, 400);
  }
}

function assertApplicableCategories(promotion, items = []) {
  const categories = normalizeCategories(promotion?.applicableCategories);
  if (categories.includes('all')) return;

  const itemCategories = buildCategorySet(items);
  if (itemCategories.size === 0) return;

  const hasInvalidCategory = [...itemCategories].some(
    (category) => !categories.includes(category),
  );

  if (hasInvalidCategory) {
    throw new AppError(
      'Voucher is not applicable for one or more product categories in this order',
      400,
    );
  }
}

function assertPromotionActive(promotion, nowMs, usageSummary) {
  if (!promotion || !promotion.active) {
    throw new AppError('Voucher not found or inactive', 400);
  }

  if (promotion.startsAt) {
    const startMs = new Date(promotion.startsAt).getTime();
    if (Number.isFinite(startMs) && nowMs < startMs) {
      throw new AppError('Voucher has not started yet', 400);
    }
  }

  if (promotion.endsAt) {
    const endMs = new Date(promotion.endsAt).getTime();
    if (Number.isFinite(endMs) && nowMs > endMs) {
      throw new AppError('Voucher has expired', 400);
    }
  }

  const usageLimit = normalizeNonNegativeNumber(promotion.usageLimit, 0);
  const activeUsageCount = normalizeNonNegativeNumber(usageSummary?.activeCount, 0);
  if (usageLimit > 0 && activeUsageCount >= usageLimit) {
    throw new AppError('Voucher usage limit reached', 400);
  }
}

function computeDiscount(promotion, subtotal) {
  const safeSubtotal = normalizeNonNegativeNumber(subtotal, 0);
  if (safeSubtotal <= 0) {
    return 0;
  }

  const type = String(promotion?.type || '').toLowerCase();
  const value = normalizeNonNegativeNumber(promotion?.value, 0);
  const maxDiscount = normalizeNonNegativeNumber(promotion?.maxDiscount, 0);
  let discount = 0;

  if (type === 'percent') {
    discount = Math.round(safeSubtotal * (value / 100));
  } else if (type === 'fixed') {
    discount = Math.round(value);
  }

  if (maxDiscount > 0) {
    discount = Math.min(discount, maxDiscount);
  }

  return Math.max(0, Math.min(discount, safeSubtotal));
}

async function resolvePromotion({
  voucherCode,
  subtotal,
  cartType,
  items = [],
  paymentMethod = '',
  excludeOrderId = '',
  throwOnInvalid = true,
}) {
  const code = normalizeCode(voucherCode);
  if (!code) {
    return {
      voucherCode: null,
      promotion: null,
      discountAmount: 0,
      usageSummary: null,
    };
  }

  const promotion = await Promotion.findOne({ code });
  const nowMs = Date.now();
  const usageSummary = promotion
    ? (await promotionRedemptionService.getPromotionUsageSummaryMap([promotion], {
        excludeOrderId,
      })).get(
        String(promotion._id),
      ) || null
    : null;

  try {
    assertPromotionActive(promotion, nowMs, usageSummary);

    if (!isApplicableCartType(promotion, cartType)) {
      throw new AppError('Voucher is not applicable for this cart type', 400);
    }

    assertApplicablePaymentScope(promotion, paymentMethod);
    assertApplicableCategories(promotion, items);

    const minOrderValue = normalizeNonNegativeNumber(promotion?.minOrderValue, 0);
    const safeSubtotal = normalizeNonNegativeNumber(subtotal, 0);
    if (safeSubtotal < minOrderValue) {
      throw new AppError(`Order subtotal does not meet minimum value ${minOrderValue}`, 400);
    }
  } catch (error) {
    if (throwOnInvalid) throw error;
    return {
      voucherCode: code,
      promotion: promotion || null,
      discountAmount: 0,
      usageSummary,
      invalidReason: error.message || 'Invalid voucher'
    };
  }

  return {
    voucherCode: code,
    promotion,
    discountAmount: computeDiscount(promotion, subtotal),
    usageSummary,
  };
}

function toPromotionMeta(promotion, usageSummary = null) {
  if (!promotion) return null;
  return {
    id: String(promotion._id),
    code: promotion.code,
    name: promotion.name,
    type: promotion.type,
    value: promotion.value,
    maxDiscount: promotion.maxDiscount || 0,
    minOrderValue: promotion.minOrderValue || 0,
    cartType: promotion.cartType || 'all',
    paymentScope: promotion.paymentScope || 'all',
    applicableCategories: normalizeCategories(promotion.applicableCategories),
    reservedCount: Number(usageSummary?.reservedCount || 0),
    usedCount:
      usageSummary?.usedCount !== undefined
        ? Number(usageSummary.usedCount)
        : Number(promotion.usedCount || 0),
    remainingCount:
      usageSummary?.remainingCount !== undefined ? usageSummary.remainingCount : null,
  };
}

module.exports = {
  resolvePromotion,
  toPromotionMeta,
  __private: {
    normalizeCategories,
    buildCategorySet,
    assertApplicablePaymentScope,
    assertApplicableCategories,
  },
};
