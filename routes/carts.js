const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartController');
const { protect } = require('../middlewares/auth');
const { validate } = require('../middlewares/validator');
const {
  cartTypeRules,
  upsertItemRules,
  replaceItemsRules,
  removeItemRules
} = require('../validators/cartValidator');

router.use(protect);

router.get('/:cartType', cartTypeRules, validate, cartController.getMyCart);
router.put('/:cartType/items', upsertItemRules, validate, cartController.upsertMyCartItem);
router.put('/:cartType/items/bulk', replaceItemsRules, validate, cartController.replaceMyCartItems);
router.delete('/:cartType/items/:itemId', removeItemRules, validate, cartController.removeMyCartItem);
router.delete('/:cartType/clear', cartTypeRules, validate, cartController.clearMyCart);

module.exports = router;
