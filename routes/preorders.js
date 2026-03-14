const express = require('express');
const preorderController = require('../controllers/preorderController');
const { protect, authorize } = require('../middlewares/auth');
const { validate, validateId } = require('../middlewares/validator');
const {
  listPreorderBatchRules,
  createPreorderBatchRules,
  receivePreorderBatchRules,
  updatePreorderBatchStatusRules
} = require('../validators/preorderValidator');

const router = express.Router();

router.use(protect);

router.get(
  '/batches',
  authorize('manager', 'operations', 'sales'),
  listPreorderBatchRules,
  validate,
  preorderController.listBatches
);

router.get(
  '/batches/:id',
  authorize('manager', 'operations', 'sales'),
  validateId,
  validate,
  preorderController.getBatchById
);

router.post(
  '/batches',
  authorize('manager', 'operations'),
  createPreorderBatchRules,
  validate,
  preorderController.createBatch
);

router.post(
  '/batches/:id/receive',
  authorize('manager', 'operations'),
  validateId,
  receivePreorderBatchRules,
  validate,
  preorderController.receiveBatch
);

router.put(
  '/batches/:id/status',
  authorize('manager', 'operations'),
  validateId,
  updatePreorderBatchStatusRules,
  validate,
  preorderController.updateBatchStatus
);

module.exports = router;
