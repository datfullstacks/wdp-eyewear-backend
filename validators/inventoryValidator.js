const { body, query } = require('express-validator');

exports.listReceiptRules = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('supplier').optional().isString(),
  query('receiptCode').optional().isString(),
  query('fromDate').optional().isISO8601(),
  query('toDate').optional().isISO8601()
];

exports.createReceiptRules = [
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
