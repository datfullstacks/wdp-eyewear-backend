const asyncHandler = require("../helpers/asyncHandler");
const ApiResponse = require("../helpers/response");
const orderService = require("../services/orderService");
const { Promotion } = require("../models/Promotion");

function normalizeStatus(promotion) {
  const now = Date.now();
  if (!promotion.active) return "inactive";
  if (promotion.startsAt && new Date(promotion.startsAt).getTime() > now) {
    return "scheduled";
  }
  if (promotion.endsAt && new Date(promotion.endsAt).getTime() < now) {
    return "expired";
  }
  return "active";
}

function toPromotionPayload(promotion) {
  return {
    id: String(promotion._id),
    code: promotion.code,
    name: promotion.name || "",
    description: promotion.description || "",
    type: promotion.type,
    value: Number(promotion.value || 0),
    minPurchase: Number(promotion.minOrderValue || 0),
    maxDiscount: Number(promotion.maxDiscount || 0),
    startDate: promotion.startsAt,
    endDate: promotion.endsAt,
    usageLimit: Number(promotion.usageLimit || 0),
    usageCount: Number(promotion.usedCount || 0),
    applicableCategories: Array.isArray(promotion.applicableCategories)
      ? promotion.applicableCategories
      : ["all"],
    cartType: promotion.cartType || "all",
    status: normalizeStatus(promotion),
    active: Boolean(promotion.active),
    createdAt: promotion.createdAt,
    updatedAt: promotion.updatedAt,
  };
}

function buildPromotionListFilters(query = {}) {
  const filters = {};
  const search = String(query.search || "").trim();
  const type = String(query.type || "").trim().toLowerCase();
  const status = String(query.status || "").trim().toLowerCase();
  const cartType = String(query.cartType || "").trim().toLowerCase();
  const now = new Date();

  if (search) {
    filters.$or = [
      { code: { $regex: search, $options: "i" } },
      { name: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  if (type && type !== "all") {
    filters.type = type;
  }

  if (cartType && cartType !== "all") {
    filters.cartType = cartType;
  }

  if (status === "inactive") {
    filters.active = false;
  } else if (status === "active") {
    filters.active = true;
    filters.$and = [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
    ];
  } else if (status === "scheduled") {
    filters.active = true;
    filters.startsAt = { $gt: now };
  } else if (status === "expired") {
    filters.endsAt = { $lt: now };
  }

  return filters;
}

function normalizePromotionInput(body = {}) {
  const parseNumber = (value, fallback = 0) => {
    if (value === undefined || value === null || value === "") return fallback;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? fallback : parsed;
  };

  const explicitStatus = String(body.status || "").trim().toLowerCase();
  const active =
    explicitStatus === "inactive"
      ? false
      : body.active === undefined
        ? true
        : Boolean(body.active);

  const categories = Array.isArray(body.applicableCategories)
    ? body.applicableCategories
        .map((item) => String(item || "").trim().toLowerCase())
        .filter(Boolean)
    : ["all"];

  return {
    code: String(body.code || "").trim().toUpperCase(),
    name: String(body.name || "").trim(),
    description: String(body.description || "").trim(),
    type:
      String(body.type || "").trim().toLowerCase() === "percentage"
        ? "percent"
        : String(body.type || "").trim().toLowerCase(),
    value: parseNumber(body.value, 0),
    minOrderValue: parseNumber(body.minPurchase ?? body.minOrderValue, 0),
    maxDiscount: parseNumber(body.maxDiscount, 0),
    active,
    startsAt: body.startDate || body.startsAt || null,
    endsAt: body.endDate || body.endsAt || null,
    cartType: String(body.cartType || "all").trim().toLowerCase() || "all",
    usageLimit: parseNumber(body.usageLimit, 0),
    applicableCategories: categories.length > 0 ? categories : ["all"],
  };
}

const normalizeInput = (body) => {
  const normalizeNumber = (v, def = 0) => {
    if (v === undefined || v === null || v === "") return def;
    const n = Number(v);
    return Number.isNaN(n) ? def : n;
  };

  const items = Array.isArray(body.items)
    ? body.items.map((item) => ({
        productId: item.productId || item.product_id,
        variantId: item.variantId ?? item.variant_id ?? null,
        quantity: Number(item.quantity || 0),
        customization: item.customization,
      }))
    : [];

  return {
    voucherCode: body.voucherCode || body.voucher_code,
    items,
    shippingFee: normalizeNumber(body.shippingFee ?? body.shipping_fee, 0),
    shippingMethod: body.shippingMethod || body.shipping_method,
    shippingAddress: body.shippingAddress || body.shipping_address,
    cartType: body.cartType || body.cart_type,
  };
};

exports.listPromotions = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
  const filters = buildPromotionListFilters(req.query);
  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    Promotion.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Promotion.countDocuments(filters),
  ]);

  ApiResponse.paginate(
    res,
    rows.map(toPromotionPayload),
    { page, limit, total },
    "Promotions retrieved successfully",
  );
});

exports.createPromotion = asyncHandler(async (req, res) => {
  const payload = normalizePromotionInput(req.body);
  const promotion = await Promotion.create(payload);
  ApiResponse.created(
    res,
    toPromotionPayload(promotion),
    "Promotion created successfully",
  );
});

exports.getPromotionById = asyncHandler(async (req, res) => {
  const promotion = await Promotion.findById(req.params.id);
  if (!promotion) {
    return ApiResponse.notFound(res, "Promotion not found");
  }

  ApiResponse.success(res, toPromotionPayload(promotion));
});

exports.updatePromotion = asyncHandler(async (req, res) => {
  const payload = normalizePromotionInput(req.body);
  const promotion = await Promotion.findByIdAndUpdate(req.params.id, payload, {
    new: true,
    runValidators: true,
  });

  if (!promotion) {
    return ApiResponse.notFound(res, "Promotion not found");
  }

  ApiResponse.success(
    res,
    toPromotionPayload(promotion),
    "Promotion updated successfully",
  );
});

exports.deletePromotion = asyncHandler(async (req, res) => {
  const promotion = await Promotion.findByIdAndDelete(req.params.id);
  if (!promotion) {
    return ApiResponse.notFound(res, "Promotion not found");
  }

  ApiResponse.success(res, null, "Promotion deleted successfully");
});

exports.validateVoucher = asyncHandler(async (req, res) => {
  const input = normalizeInput(req.body);

  const quote = await orderService.quote(input.items, input.shippingFee, 0, {
    cartType: input.cartType,
    voucherCode: input.voucherCode,
    shippingMethod: input.shippingMethod,
    shippingAddress: input.shippingAddress,
  });

  ApiResponse.success(res, {
    valid: true,
    voucher: quote.promotion || null,
    breakdown: {
      subtotal: quote.subtotal,
      shippingFee: quote.shippingFee,
      discountAmount: quote.discountAmount,
      total: quote.total,
      payNow: quote.payNow,
      payLater: quote.payLater,
      payNowMethod: quote.payNowMethod,
      payLaterMethod: quote.payLaterMethod,
      shippingFeeMode: quote.shippingFeeMode,
      shippingCollectionTiming: quote.shippingCollectionTiming,
    },
  });
});
