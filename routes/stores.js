const express = require('express');
const storeController = require('../controllers/storeController');
const { protect, authorize } = require('../middlewares/auth');
const { validate, validateId } = require('../middlewares/validator');
const { SYSTEM_ADMIN_ROLES } = require('../helpers/roles');
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
  authorize(...SYSTEM_ADMIN_ROLES),
  createStoreRules,
  validate,
  storeController.createStore
);

router.put(
  '/:id',
  authorize(...SYSTEM_ADMIN_ROLES),
  validateId,
  updateStoreRules,
  validate,
  storeController.updateStore
);

router.delete(
  '/:id',
  authorize(...SYSTEM_ADMIN_ROLES),
  validateId,
  validate,
  storeController.deleteStore
);

module.exports = router;
