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
 *     CheckoutItem:
 *       type: object
 *       required: [productId, quantity]
 *       properties:
 *         productId:
 *           type: string
 *         variantId:
 *           type: string
 *         quantity:
 *           type: integer
 *     CheckoutAddress:
 *       type: object
 *       properties:
 *         fullName: { type: string }
 *         phone: { type: string }
 *         email: { type: string }
 *         line1: { type: string }
 *         line2: { type: string }
 *         ward: { type: string }
 *         district: { type: string }
 *         province: { type: string }
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
