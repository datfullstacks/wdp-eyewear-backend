const AppError = require('../errors/AppError');
const { Promotion } = require('../models/Promotion');

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

function assertPromotionActive(promotion, nowMs) {
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
  if (usageLimit > 0 && normalizeNonNegativeNumber(promotion.usedCount, 0) >= usageLimit) {
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

async function resolvePromotion({ voucherCode, subtotal, cartType, throwOnInvalid = true }) {
  const code = normalizeCode(voucherCode);
  if (!code) {
    return {
      voucherCode: null,
      promotion: null,
      discountAmount: 0
    };
  }

  const promotion = await Promotion.findOne({ code });
  const nowMs = Date.now();

  try {
    assertPromotionActive(promotion, nowMs);

    if (!isApplicableCartType(promotion, cartType)) {
      throw new AppError('Voucher is not applicable for this cart type', 400);
    }

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
      invalidReason: error.message || 'Invalid voucher'
    };
  }

  return {
    voucherCode: code,
    promotion,
    discountAmount: computeDiscount(promotion, subtotal)
  };
}

function toPromotionMeta(promotion) {
  if (!promotion) return null;
  return {
    code: promotion.code,
    name: promotion.name,
    type: promotion.type,
    value: promotion.value,
    maxDiscount: promotion.maxDiscount || 0,
    minOrderValue: promotion.minOrderValue || 0,
    cartType: promotion.cartType || 'all'
  };
}

module.exports = {
  resolvePromotion,
  toPromotionMeta
};
