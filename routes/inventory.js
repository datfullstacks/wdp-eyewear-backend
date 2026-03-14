const express = require('express');
const inventoryController = require('../controllers/inventoryController');
const { protect, authorize } = require('../middlewares/auth');
const { validate, validateId } = require('../middlewares/validator');
const { listReceiptRules, createReceiptRules } = require('../validators/inventoryValidator');

const router = express.Router();

router.use(protect);

router.get(
  '/receipts',
  authorize('manager', 'operations', 'sales'),
  listReceiptRules,
  validate,
  inventoryController.listReceipts
);

router.get(
  '/receipts/:id',
  authorize('manager', 'operations', 'sales'),
  validateId,
  validate,
  inventoryController.getReceiptById
);

router.post(
  '/receipts',
  authorize('manager', 'operations'),
  createReceiptRules,
  validate,
  inventoryController.createReceipt
);

module.exports = router;
