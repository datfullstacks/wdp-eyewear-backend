const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/response');
const orderService = require('../services/orderService');
const promotionService = require('../services/promotionService');

const normalizeInput = (body) => {
  const normalizeNumber = (v, def = 0) => {
    if (v === undefined || v === null || v === '') return def;
    const n = Number(v);
    return Number.isNaN(n) ? def : n;
  };

  const items = Array.isArray(body.items)
    ? body.items.map((item) => ({
        productId: item.productId || item.product_id,
        variantId: item.variantId ?? item.variant_id ?? null,
        quantity: Number(item.quantity || 0),
        customization: item.customization
      }))
    : [];

  return {
    voucherCode: body.voucherCode || body.voucher_code,
    items,
    shippingFee: normalizeNumber(body.shippingFee ?? body.shipping_fee, 0),
    shippingMethod: body.shippingMethod || body.shipping_method,
    cartType: body.cartType || body.cart_type
  };
};

exports.validateVoucher = asyncHandler(async (req, res) => {
  const input = normalizeInput(req.body);

  const quote = await orderService.quote(input.items, input.shippingFee, 0, {
    cartType: input.cartType
  });

  const resolved = await promotionService.resolvePromotion({
    voucherCode: input.voucherCode,
    subtotal: quote.subtotal,
    cartType: input.cartType,
    throwOnInvalid: true
  });

  const discountAmount = resolved.discountAmount;
  const total = Math.max(0, quote.subtotal - discountAmount + quote.shippingFee);
  const payNow = Math.max(0, quote.payNowTotal - discountAmount + quote.shippingFee);
  const payLater = Math.max(0, total - payNow);

  ApiResponse.success(res, {
    valid: true,
    voucher: promotionService.toPromotionMeta(resolved.promotion),
    breakdown: {
      subtotal: quote.subtotal,
      shippingFee: quote.shippingFee,
      discountAmount,
      total,
      payNow,
      payLater
    }
  });
});
