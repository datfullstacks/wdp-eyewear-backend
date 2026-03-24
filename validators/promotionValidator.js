const { body } = require("express-validator");
const {
  PROMOTION_TYPES,
  PROMOTION_CART_TYPES,
  PROMOTION_PAYMENT_SCOPES,
} = require("../models/Promotion");

exports.validatePromotionRules = [
  body("voucherCode")
    .notEmpty()
    .withMessage("voucherCode is required")
    .isString()
    .withMessage("voucherCode must be string"),
  body("items").isArray({ min: 1 }).withMessage("items is required"),
  body(["items.*.productId", "items.*.product_id"])
    .notEmpty()
    .withMessage("productId is required"),
  body("items.*.quantity")
    .custom((value) => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= 1;
    })
    .withMessage("quantity must be integer >= 1"),
  body(["items.*.variantId", "items.*.variant_id"])
    .optional({ nullable: true })
    .isString()
    .withMessage("variantId must be string"),
  body(["shippingFee", "shipping_fee"])
    .optional()
    .isFloat({ min: 0 })
    .withMessage("shippingFee must be non-negative"),
  body(["shippingMethod", "shipping_method"])
    .optional()
    .isIn(["standard", "express"])
    .withMessage("shippingMethod must be standard or express"),
  body(["shippingAddress", "shipping_address"]).optional().isObject(),
  body([
    "shippingAddress.wardCode",
    "shipping_address.wardCode",
    "shippingAddress.ward_code",
    "shipping_address.ward_code",
  ])
    .optional()
    .isString(),
  body([
    "shippingAddress.districtId",
    "shipping_address.districtId",
    "shippingAddress.district_id",
    "shipping_address.district_id",
  ])
    .optional()
    .isInt({ min: 1 }),
  body([
    "shippingAddress.provinceId",
    "shipping_address.provinceId",
    "shippingAddress.province_id",
    "shipping_address.province_id",
  ])
    .optional()
    .isInt({ min: 1 }),
  body(["cartType", "cart_type"])
    .optional()
    .isIn(["ready_stock", "pre_order"])
    .withMessage("cartType must be ready_stock or pre_order"),
  body(["paymentMethod", "payment_method"])
    .optional()
    .isIn(["sepay", "cod"])
    .withMessage("paymentMethod must be sepay or cod"),
];

const basePromotionRules = [
  body("code")
    .optional({ nullable: false })
    .isString()
    .trim()
    .notEmpty()
    .withMessage("code is required"),
  body("name")
    .optional({ nullable: false })
    .isString()
    .trim()
    .notEmpty()
    .withMessage("name is required"),
  body("description").optional().isString(),
  body("type")
    .optional({ nullable: false })
    .custom((value) => {
      const normalized = String(value || "").trim().toLowerCase();
      return PROMOTION_TYPES.includes(normalized) || normalized === "percentage";
    })
    .withMessage("type must be percent, percentage, or fixed"),
  body("value")
    .optional({ nullable: false })
    .isFloat({ min: 0 })
    .withMessage("value must be non-negative"),
  body(["minPurchase", "minOrderValue"])
    .optional()
    .isFloat({ min: 0 })
    .withMessage("minPurchase must be non-negative"),
  body("maxDiscount")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("maxDiscount must be non-negative"),
  body(["startDate", "startsAt"])
    .optional({ nullable: true, checkFalsy: true })
    .isISO8601()
    .withMessage("startDate must be a valid date"),
  body(["endDate", "endsAt"])
    .optional({ nullable: true, checkFalsy: true })
    .isISO8601()
    .withMessage("endDate must be a valid date"),
  body("usageLimit")
    .optional()
    .isInt({ min: 0 })
    .withMessage("usageLimit must be non-negative"),
  body("cartType")
    .optional()
    .isIn([...PROMOTION_CART_TYPES, "all"])
    .withMessage("cartType is invalid"),
  body("paymentScope")
    .optional()
    .isIn(PROMOTION_PAYMENT_SCOPES)
    .withMessage("paymentScope is invalid"),
  body("status")
    .optional()
    .isIn(["active", "inactive", "scheduled"])
    .withMessage("status is invalid"),
  body("applicableCategories").optional().isArray(),
];

exports.createPromotionRules = [
  body("code").exists({ checkFalsy: true }),
  body("name").exists({ checkFalsy: true }),
  body("type").exists({ checkFalsy: true }),
  body("value").exists({ checkFalsy: true }),
  ...basePromotionRules,
];

exports.updatePromotionRules = basePromotionRules;
