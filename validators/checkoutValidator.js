const { body } = require('express-validator');

const itemRules = [
  body('items').isArray({ min: 1 }).withMessage('items is required'),
  body(['items.*.productId', 'items.*.product_id'])
    .notEmpty().withMessage('productId is required'),
  body(['items.*.quantity'])
    .custom(val => {
      const n = Number(val);
      return Number.isInteger(n) && n >= 1;
    }).withMessage('quantity must be integer >=1'),
  body(['items.*.variantId', 'items.*.variant_id'])
    .optional({ nullable: true }).isString().withMessage('variantId must be string'),
  body('items.*.customization').optional().isObject(),
  body('items.*.customization.selectedColor').optional().isString(),
  body('items.*.customization.selectedSize').optional().isString(),
  body('items.*.customization.photochromic').optional().isBoolean(),
  body('items.*.customization.note').optional().isString().isLength({ max: 500 }),
  body('items.*.customization.combineWith').optional().isObject(),
  body('items.*.customization.combineWith.productId').optional().isMongoId(),
  body('items.*.customization.combineWith.variantId').optional().isString(),
  body('items.*.customization.combineWith.note').optional().isString().isLength({ max: 500 }),
  body('items.*.customization.prescription').optional().isObject(),
  body('items.*.customization.prescription.mode')
    .optional()
    .isIn(['none', 'manual', 'upload']),
  body('items.*.customization.prescription.isMyopic').optional().isBoolean(),
  body('items.*.customization.prescription.attachmentUrls').optional().isArray(),
  body('items.*.customization.prescription.attachmentUrls.*').optional().isURL()
];

const shippingRules = [
  body(['shippingFee', 'shipping_fee']).optional().isFloat({ min: 0 }),
  body(['discountAmount', 'discount_amount']).optional().isFloat({ min: 0 }),
  body(['shippingMethod', 'shipping_method']).optional().isIn(['standard', 'express']),
  body(['shippingAddress', 'shipping_address']).optional().isObject(),
  body(['shippingAddress.fullName', 'shipping_address.fullName']).optional().isString(),
  body(['shippingAddress.phone', 'shipping_address.phone']).optional().isString(),
  body(['shippingAddress.line1', 'shipping_address.line1']).optional().isString(),
  body(['shippingAddress.line2', 'shipping_address.line2']).optional().isString(),
  body(['shippingAddress.ward', 'shipping_address.ward']).optional().isString(),
  body(['shippingAddress.wardCode', 'shipping_address.wardCode', 'shippingAddress.ward_code', 'shipping_address.ward_code']).optional().isString(),
  body(['shippingAddress.district', 'shipping_address.district']).optional().isString(),
  body(['shippingAddress.districtId', 'shipping_address.districtId', 'shippingAddress.district_id', 'shipping_address.district_id']).optional().isInt({ min: 1 }),
  body(['shippingAddress.province', 'shipping_address.province']).optional().isString(),
  body(['shippingAddress.provinceId', 'shipping_address.provinceId', 'shippingAddress.province_id', 'shipping_address.province_id']).optional().isInt({ min: 1 }),
  body(['shippingAddress.country', 'shipping_address.country']).optional().isString(),
  body(['shippingAddress.note', 'shipping_address.note']).optional().isString().isLength({ max: 500 }),
  body(['cartType', 'cart_type'])
    .optional()
    .isIn(['ready_stock', 'pre_order'])
    .withMessage('cartType must be ready_stock or pre_order'),
  body(['voucherCode', 'voucher_code'])
    .optional()
    .isString()
    .isLength({ min: 1, max: 64 })
    .withMessage('voucherCode must be a non-empty string'),
  body('note').optional().isString().isLength({ max: 500 })
];

exports.checkoutQuoteRules = [
  ...itemRules,
  ...shippingRules
];

exports.checkoutRules = [
  ...itemRules,
  ...shippingRules
];
