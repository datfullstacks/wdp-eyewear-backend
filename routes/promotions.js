const express = require('express');
const promotionController = require('../controllers/promotionController');
const { protect, authorize } = require('../middlewares/auth');
const { validate, validateId } = require('../middlewares/validator');
const { BUSINESS_MANAGER_ROLES } = require('../helpers/roles');
const {
  validatePromotionRules,
  createPromotionRules,
  updatePromotionRules,
} = require('../validators/promotionValidator');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Promotions
 *     description: Voucher validation and checkout discount preview
 * components:
 *   schemas:
 *     PromotionValidationItemInput:
 *       type: object
 *       required: [productId, quantity]
 *       properties:
 *         productId:
 *           type: string
 *         variantId:
 *           type: string
 *           nullable: true
 *         quantity:
 *           type: integer
 *           minimum: 1
 *         customization:
 *           type: object
 *           nullable: true
 *     PromotionValidationInput:
 *       type: object
 *       required: [voucherCode, items]
 *       properties:
 *         voucherCode:
 *           type: string
 *         items:
 *           type: array
 *           minItems: 1
 *           items:
 *             $ref: '#/components/schemas/PromotionValidationItemInput'
 *         shippingFee:
 *           type: number
 *           minimum: 0
 *         shippingMethod:
 *           type: string
 *           enum: [standard, express]
 *         shippingAddress:
 *           type: object
 *           nullable: true
 *           properties:
 *             wardCode:
 *               type: string
 *             districtId:
 *               type: integer
 *             provinceId:
 *               type: integer
 *         cartType:
 *           type: string
 *           enum: [ready_stock, pre_order]
 *     PromotionMeta:
 *       type: object
 *       nullable: true
 *       properties:
 *         code:
 *           type: string
 *         name:
 *           type: string
 *         type:
 *           type: string
 *           enum: [percent, fixed]
 *         value:
 *           type: number
 *         maxDiscount:
 *           type: number
 *         minOrderValue:
 *           type: number
 *         cartType:
 *           type: string
 *           enum: [all, ready_stock, pre_order]
 *     PromotionValidationResult:
 *       type: object
 *       properties:
 *         valid:
 *           type: boolean
 *         voucher:
 *           $ref: '#/components/schemas/PromotionMeta'
 *         breakdown:
 *           type: object
 *           properties:
 *             subtotal:
 *               type: number
 *             shippingFee:
 *               type: number
 *             discountAmount:
 *               type: number
 *             total:
 *               type: number
 *             payNow:
 *               type: number
 *             payLater:
 *               type: number
 * /api/promotions/validate:
 *   post:
 *     summary: Validate a voucher code against cart items and shipping context
 *     tags: [Promotions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PromotionValidationInput'
 *     responses:
 *       200:
 *         description: Voucher validated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/PromotionValidationResult'
 *       400:
 *         description: Invalid or inapplicable voucher
 */

router.get(
  '/',
  protect,
  authorize(...BUSINESS_MANAGER_ROLES),
  promotionController.listPromotions
);
router.post(
  '/',
  protect,
  authorize(...BUSINESS_MANAGER_ROLES),
  createPromotionRules,
  validate,
  promotionController.createPromotion
);
router.post('/validate', validatePromotionRules, validate, promotionController.validateVoucher);
router.get(
  '/:id',
  protect,
  authorize(...BUSINESS_MANAGER_ROLES),
  validateId,
  validate,
  promotionController.getPromotionById
);
router.put(
  '/:id',
  protect,
  authorize(...BUSINESS_MANAGER_ROLES),
  validateId,
  updatePromotionRules,
  validate,
  promotionController.updatePromotion
);
router.delete(
  '/:id',
  protect,
  authorize(...BUSINESS_MANAGER_ROLES),
  validateId,
  validate,
  promotionController.deletePromotion
);

module.exports = router;
