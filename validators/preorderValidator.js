const { body, query } = require('express-validator');
const { PREORDER_BATCH_STATUSES } = require('../models/PreorderBatch');

exports.listPreorderBatchRules = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(PREORDER_BATCH_STATUSES),
  query('supplier').optional().isString(),
  query('search').optional().isString()
];

exports.createPreorderBatchRules = [
  body('batchCode').notEmpty().withMessage('batchCode is required').isString(),
  body('supplier').notEmpty().withMessage('supplier is required').isString(),
  body('orderDate').notEmpty().withMessage('orderDate is required').isISO8601(),
  body('expectedDate').optional().isISO8601(),
  body('status').optional().isIn(PREORDER_BATCH_STATUSES),
  body('note').optional().isString(),
  body('items').isArray({ min: 1 }).withMessage('items must be a non-empty array'),
  body('items.*.productId').isMongoId().withMessage('items.*.productId must be a valid Mongo ID'),
  body('items.*.variantId').isMongoId().withMessage('items.*.variantId must be a valid Mongo ID'),
  body('items.*.orderedQty').isInt({ min: 1 }).withMessage('items.*.orderedQty must be >= 1'),
  body('items.*.sku').optional().isString(),
  body('items.*.variantLabel').optional().isString()
];

exports.receivePreorderBatchRules = [
  body('receivedAt').optional().isISO8601(),
  body('note').optional().isString(),
  body('items').isArray({ min: 1 }).withMessage('items must be a non-empty array'),
  body('items.*.batchItemId').isMongoId().withMessage('items.*.batchItemId must be a valid Mongo ID'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('items.*.quantity must be >= 1')
];

exports.updatePreorderBatchStatusRules = [
  body('status')
    .notEmpty()
    .withMessage('status is required')
    .isIn(PREORDER_BATCH_STATUSES)
    .withMessage(`status must be one of: ${PREORDER_BATCH_STATUSES.join(', ')}`)
];
