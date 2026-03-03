const express = require('express');
const promotionController = require('../controllers/promotionController');
const { validate } = require('../middlewares/validator');
const { validatePromotionRules } = require('../validators/promotionValidator');

const router = express.Router();

router.post('/validate', validatePromotionRules, validate, promotionController.validateVoucher);

module.exports = router;
