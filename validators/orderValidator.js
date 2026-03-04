const { body, param } = require('express-validator');
const { ORDER_STATUS } = require('../constants');

const itemBaseRules = [
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
    .isIn(['none', 'manual', 'upload'])
    .withMessage('prescription mode must be one of: none, manual, upload'),
  body('items.*.customization.prescription.isMyopic').optional().isBoolean(),
  body('items.*.customization.prescription.rightEye').optional().isObject(),
  body('items.*.customization.prescription.leftEye').optional().isObject(),
  body('items.*.customization.prescription.pd').optional().isString(),
  body('items.*.customization.prescription.note').optional().isString().isLength({ max: 500 }),
  body('items.*.customization.prescription.attachmentUrls').optional().isArray(),
  body('items.*.customization.prescription.attachmentUrls.*').optional().isURL()
];

exports.updateOrderItemsRules = [
  ...itemBaseRules,
  body(['shippingFee', 'shipping_fee']).optional().isFloat({ min: 0 }),
  body(['discountAmount', 'discount_amount']).optional().isFloat({ min: 0 }),
  body(['voucherCode', 'voucher_code']).optional().isString().isLength({ min: 1, max: 64 }),
  body(['shippingMethod', 'shipping_method']).optional().isIn(['standard', 'express']),
  body(['shippingAddress', 'shipping_address']).optional().isObject(),
  body('note').optional().isString().isLength({ max: 500 })
];

exports.patchOrderItemRules = [
  param('itemId')
    .isMongoId()
    .withMessage('Invalid itemId format'),
  body(['productId', 'product_id']).optional().isMongoId(),
  body(['variantId', 'variant_id']).optional({ nullable: true }).isString(),
  body('quantity')
    .optional()
    .custom((value) => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= 1;
    })
    .withMessage('quantity must be integer >= 1'),
  body('customization').optional().isObject(),
  body('customization.selectedColor').optional().isString(),
  body('customization.selectedSize').optional().isString(),
  body('customization.photochromic').optional().isBoolean(),
  body('customization.note').optional().isString().isLength({ max: 500 }),
  body('customization.combineWith').optional().isObject(),
  body('customization.combineWith.productId').optional().isMongoId(),
  body('customization.combineWith.variantId').optional().isString(),
  body('customization.combineWith.note').optional().isString().isLength({ max: 500 }),
  body('customization.prescription').optional().isObject(),
  body('customization.prescription.mode')
    .optional()
    .isIn(['none', 'manual', 'upload'])
    .withMessage('prescription mode must be one of: none, manual, upload'),
  body('customization.prescription.isMyopic').optional().isBoolean(),
  body('customization.prescription.rightEye').optional().isObject(),
  body('customization.prescription.leftEye').optional().isObject(),
  body('customization.prescription.pd').optional().isString(),
  body('customization.prescription.note').optional().isString().isLength({ max: 500 }),
  body('customization.prescription.attachmentUrls').optional().isArray(),
  body('customization.prescription.attachmentUrls.*').optional().isURL(),
  body('note').optional().isString().isLength({ max: 500 })
];

exports.cancelOrderRules = [
  body('reason').optional().isString().isLength({ max: 500 }),
  body(['contactChannels', 'contact_channels']).optional().isArray(),
  body(['contactChannels.*', 'contact_channels.*'])
    .optional()
    .isIn(['email', 'phone']),
  body(['bankAccount', 'bank_account']).optional().isObject(),
  body(['bankAccount.bankName', 'bank_account.bankName']).optional().isString(),
  body(['bankAccount.accountNumber', 'bank_account.accountNumber']).optional().isString(),
  body(['bankAccount.accountHolder', 'bank_account.accountHolder']).optional().isString(),
  body(['bankAccount.note', 'bank_account.note']).optional().isString().isLength({ max: 500 })
];

exports.updateRefundStatusRules = [
  body('status')
    .notEmpty()
    .isIn(['requested', 'processing', 'completed', 'rejected'])
    .withMessage('status must be one of: requested, processing, completed, rejected'),
  body('contactNote').optional().isString().isLength({ max: 500 }),
  body(['contactChannels', 'contact_channels']).optional().isArray(),
  body(['contactChannels.*', 'contact_channels.*'])
    .optional()
    .isIn(['email', 'phone']),
  body('rejectReason').optional().isString().isLength({ max: 500 })
];

exports.updateOrderStatusRules = [
  body('status')
    .notEmpty()
    .isIn(Object.values(ORDER_STATUS))
    .withMessage(`status must be one of: ${Object.values(ORDER_STATUS).join(', ')}`)
];
