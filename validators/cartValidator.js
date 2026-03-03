const { param, body } = require('express-validator');

exports.cartTypeRules = [
  param('cartType')
    .isIn(['ready_stock', 'pre_order'])
    .withMessage('cartType must be ready_stock or pre_order')
];

exports.upsertItemRules = [
  ...exports.cartTypeRules,
  body(['itemId', 'item_id']).optional().isString(),
  body(['productId', 'product_id']).notEmpty().withMessage('productId is required'),
  body('quantity')
    .custom((value) => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= 1;
    })
    .withMessage('quantity must be integer >= 1'),
  body(['variantId', 'variant_id']).optional({ nullable: true }).isString(),
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
  body('customization.prescription.mode').optional().isIn(['none', 'manual', 'upload']),
  body('customization.prescription.isMyopic').optional().isBoolean(),
  body('customization.prescription.attachmentUrls').optional().isArray(),
  body('customization.prescription.attachmentUrls.*').optional().isURL()
];

exports.replaceItemsRules = [
  ...exports.cartTypeRules,
  body('items').isArray().withMessage('items must be an array'),
  body('items.*.productId').notEmpty().withMessage('items.*.productId is required'),
  body('items.*.quantity')
    .custom((value) => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= 1;
    })
    .withMessage('items.*.quantity must be integer >= 1'),
  body('items.*.variantId').optional({ nullable: true }).isString()
];

exports.removeItemRules = [
  ...exports.cartTypeRules,
  param('itemId').isMongoId().withMessage('Invalid itemId')
];
