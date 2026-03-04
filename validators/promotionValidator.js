const { body } = require('express-validator');

exports.validatePromotionRules = [
  body('voucherCode')
    .notEmpty()
    .withMessage('voucherCode is required')
    .isString()
    .withMessage('voucherCode must be string'),
  body('items').isArray({ min: 1 }).withMessage('items is required'),
  body(['items.*.productId', 'items.*.product_id'])
    .notEmpty()
    .withMessage('productId is required'),
  body('items.*.quantity')
    .custom((value) => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= 1;
    })
    .withMessage('quantity must be integer >= 1'),
  body(['items.*.variantId', 'items.*.variant_id'])
    .optional({ nullable: true })
    .isString()
    .withMessage('variantId must be string'),
  body(['shippingFee', 'shipping_fee'])
    .optional()
    .isFloat({ min: 0 })
    .withMessage('shippingFee must be non-negative'),
  body(['shippingMethod', 'shipping_method'])
    .optional()
    .isIn(['standard', 'express'])
    .withMessage('shippingMethod must be standard or express'),
  body(['cartType', 'cart_type'])
    .optional()
    .isIn(['ready_stock', 'pre_order'])
    .withMessage('cartType must be ready_stock or pre_order')
];
