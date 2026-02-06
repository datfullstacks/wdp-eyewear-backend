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
    .optional({ nullable: true }).isString().withMessage('variantId must be string')
];

const shippingRules = [
  body(['shippingFee', 'shipping_fee']).optional().isFloat({ min: 0 }),
  body(['discountAmount', 'discount_amount']).optional().isFloat({ min: 0 }),
  body(['shippingMethod', 'shipping_method']).optional().isIn(['standard', 'express']),
  body(['shippingAddress', 'shipping_address']).optional().isObject(),
  body(['shippingAddress.fullName', 'shipping_address.fullName']).optional().isString(),
  body(['shippingAddress.phone', 'shipping_address.phone']).optional().isString(),
  body(['shippingAddress.line1', 'shipping_address.line1']).optional().isString(),
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
