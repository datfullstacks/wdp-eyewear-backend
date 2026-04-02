const { body, query } = require('express-validator');

exports.listReceiptRules = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('storeId').optional().isMongoId().withMessage('storeId must be a valid Mongo ID'),
  query('supplier').optional().isString(),
  query('receiptCode').optional().isString(),
  query('fromDate').optional().isISO8601(),
  query('toDate').optional().isISO8601()
];

exports.createReceiptRules = [
  body('storeId').optional({ checkFalsy: true }).isMongoId().withMessage('storeId must be a valid Mongo ID'),
  body('supplier').notEmpty().withMessage('supplier is required'),
  body('warehouseLocation').optional().isString(),
  body('receivedAt').optional().isISO8601(),
  body('note').optional().isString(),
  body('items').isArray({ min: 1 }).withMessage('items must be a non-empty array'),
  body('items.*.productId').isMongoId().withMessage('items.*.productId must be a valid Mongo ID'),
  body('items.*.variantId').isMongoId().withMessage('items.*.variantId must be a valid Mongo ID'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('items.*.quantity must be >= 1'),
  body('items.*.unitCost').optional().isFloat({ min: 0 }).withMessage('items.*.unitCost must be >= 0'),
  body('items.*.note').optional().isString()
];

exports.adjustStockRules = [
  body('productId')
    .notEmpty()
    .withMessage('productId is required')
    .isMongoId()
    .withMessage('productId must be a valid Mongo ID'),
  body('variantId')
    .notEmpty()
    .withMessage('variantId is required')
    .isMongoId()
    .withMessage('variantId must be a valid Mongo ID'),
  body('stock')
    .notEmpty()
    .withMessage('stock is required')
    .isInt({ min: 0 })
    .withMessage('stock must be an integer >= 0'),
  body('warehouseLocation').optional().isString(),
  body('note').optional().isString().isLength({ max: 500 }).withMessage('note cannot exceed 500 characters'),
];
