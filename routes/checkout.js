const express = require('express');
const router = express.Router();
const checkoutController = require('../controllers/checkoutController');
const { protect } = require('../middlewares/auth');
const { validate } = require('../middlewares/validator');
const { checkoutRules, checkoutQuoteRules } = require('../validators/checkoutValidator');

/**
 * @swagger
 * tags:
 *   - name: Checkout
 *     description: Checkout flow with Sepay
 * components:
 *   schemas:
 *     CheckoutPrescriptionEye:
 *       type: object
 *       properties:
 *         sphere:
 *           type: string
 *         cyl:
 *           type: string
 *         axis:
 *           type: string
 *         add:
 *           type: string
 *     CheckoutPrescription:
 *       type: object
 *       properties:
 *         mode:
 *           type: string
 *           enum: [none, manual, upload]
 *         isMyopic:
 *           type: boolean
 *         rightEye:
 *           $ref: '#/components/schemas/CheckoutPrescriptionEye'
 *         leftEye:
 *           $ref: '#/components/schemas/CheckoutPrescriptionEye'
 *         pd:
 *           type: string
 *         note:
 *           type: string
 *         attachmentUrls:
 *           type: array
 *           items:
 *             type: string
 *             format: uri
 *     CheckoutItemCustomization:
 *       type: object
 *       properties:
 *         selectedColor:
 *           type: string
 *         selectedSize:
 *           type: string
 *         photochromic:
 *           type: boolean
 *         note:
 *           type: string
 *         combineWith:
 *           type: object
 *           properties:
 *             productId:
 *               type: string
 *             variantId:
 *               type: string
 *             note:
 *               type: string
 *         prescription:
 *           $ref: '#/components/schemas/CheckoutPrescription'
 *     CheckoutItem:
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
 *           example: 1
 *         customization:
 *           $ref: '#/components/schemas/CheckoutItemCustomization'
 *     CheckoutAddress:
 *       type: object
 *       properties:
 *         fullName: { type: string }
 *         phone: { type: string }
 *         email: { type: string }
 *         line1: { type: string }
 *         line2: { type: string }
 *         ward: { type: string }
 *         wardCode: { type: string }
 *         district: { type: string }
 *         districtId: { type: integer }
 *         province: { type: string }
 *         provinceId: { type: integer }
 *         country: { type: string }
 *         note: { type: string }
 *     CheckoutInput:
 *       type: object
 *       required: [items]
 *       properties:
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/CheckoutItem'
 *         shippingFee:
 *           type: number
 *           example: 25000
 *         discountAmount:
 *           type: number
 *           example: 0
 *         shippingMethod:
 *           type: string
 *           enum: [standard, express]
 *         shippingAddress:
 *           $ref: '#/components/schemas/CheckoutAddress'
 *         cartType:
 *           type: string
 *           enum: [ready_stock, pre_order]
 *         voucherCode:
 *           type: string
 *         note:
 *           type: string
 */

/**
 * @swagger
 * /api/checkout/quote:
 *   post:
 *     summary: Get checkout quote (subtotal, shipping, deposit) without creating order
 *     tags: [Checkout]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CheckoutInput'
 *     responses:
 *       200:
 *         description: Quote calculated
 */
router.post('/quote', checkoutQuoteRules, validate, checkoutController.quote);

/**
 * @swagger
 * /api/checkout:
 *   post:
 *     summary: Create checkout order and return Sepay payment instructions
 *     tags: [Checkout]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CheckoutInput'
 *     responses:
 *       201:
 *         description: Order created
 */
router.post('/', protect, checkoutRules, validate, checkoutController.create);

module.exports = router;
