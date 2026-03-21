const express = require('express');
const storeController = require('../controllers/storeController');
const { protect, authorize } = require('../middlewares/auth');
const { validate, validateId } = require('../middlewares/validator');
const {
  listStoreRules,
  createStoreRules,
  updateStoreRules,
} = require('../validators/storeValidator');

const router = express.Router();

router.get('/', listStoreRules, validate, storeController.listStores);
router.get('/:id', validateId, validate, storeController.getStoreById);

router.use(protect);

router.post(
  '/',
  authorize('admin'),
  createStoreRules,
  validate,
  storeController.createStore
);

router.put(
  '/:id',
  authorize('admin'),
  validateId,
  updateStoreRules,
  validate,
  storeController.updateStore
);

router.delete(
  '/:id',
  authorize('admin'),
  validateId,
  validate,
  storeController.deleteStore
);

module.exports = router;
