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

/**
 * @swagger
 * tags:
 *   - name: Carts
 *     description: Authenticated ready-stock and pre-order cart management
 * components:
 *   schemas:
 *     CartPrescriptionEye:
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
 *     CartPrescription:
 *       type: object
 *       properties:
 *         mode:
 *           type: string
 *           enum: [none, manual, upload]
 *         isMyopic:
 *           type: boolean
 *         rightEye:
 *           $ref: '#/components/schemas/CartPrescriptionEye'
 *         leftEye:
 *           $ref: '#/components/schemas/CartPrescriptionEye'
 *         pd:
 *           type: string
 *         note:
 *           type: string
 *         attachmentUrls:
 *           type: array
 *           items:
 *             type: string
 *             format: uri
 *     CartItemCustomization:
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
 *           $ref: '#/components/schemas/CartPrescription'
 *     CartItemInput:
 *       type: object
 *       required: [productId, quantity]
 *       properties:
 *         itemId:
 *           type: string
 *           description: Existing cart item id. Optional when upserting.
 *         productId:
 *           type: string
 *         variantId:
 *           type: string
 *           nullable: true
 *         quantity:
 *           type: integer
 *           minimum: 1
 *         customization:
 *           $ref: '#/components/schemas/CartItemCustomization'
 *     CartItemsReplaceInput:
 *       type: object
 *       required: [items]
 *       properties:
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/CartItemInput'
 *     CartItem:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         productId:
 *           type: string
 *         name:
 *           type: string
 *         type:
 *           type: string
 *         variantId:
 *           type: string
 *           nullable: true
 *         quantity:
 *           type: integer
 *         preOrder:
 *           type: boolean
 *         unitPrice:
 *           type: number
 *         lineTotal:
 *           type: number
 *         customization:
 *           $ref: '#/components/schemas/CartItemCustomization'
 *     CartSummary:
 *       type: object
 *       properties:
 *         itemCount:
 *           type: integer
 *         quantityTotal:
 *           type: integer
 *         subtotal:
 *           type: number
 *     Cart:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         userId:
 *           type: string
 *         cartType:
 *           type: string
 *           enum: [ready_stock, pre_order]
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/CartItem'
 *         summary:
 *           $ref: '#/components/schemas/CartSummary'
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 * /api/carts/{cartType}:
 *   get:
 *     summary: Get current user's cart by type
 *     tags: [Carts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cartType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [ready_stock, pre_order]
 *     responses:
 *       200:
 *         description: Cart retrieved successfully
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
 *                   $ref: '#/components/schemas/Cart'
 *       401:
 *         description: Unauthorized
 * /api/carts/{cartType}/items:
 *   put:
 *     summary: Add or update a single cart item
 *     tags: [Carts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cartType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [ready_stock, pre_order]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CartItemInput'
 *     responses:
 *       200:
 *         description: Cart item updated successfully
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
 *                   $ref: '#/components/schemas/Cart'
 *       400:
 *         description: Invalid cart payload
 * /api/carts/{cartType}/items/bulk:
 *   put:
 *     summary: Replace all cart items with a new set
 *     tags: [Carts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cartType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [ready_stock, pre_order]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CartItemsReplaceInput'
 *     responses:
 *       200:
 *         description: Cart replaced successfully
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
 *                   $ref: '#/components/schemas/Cart'
 * /api/carts/{cartType}/items/{itemId}:
 *   delete:
 *     summary: Remove one item from the current user's cart
 *     tags: [Carts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cartType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [ready_stock, pre_order]
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Cart item removed successfully
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
 *                   $ref: '#/components/schemas/Cart'
 *       404:
 *         description: Cart item not found
 * /api/carts/{cartType}/clear:
 *   delete:
 *     summary: Remove every item from the current user's cart
 *     tags: [Carts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cartType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [ready_stock, pre_order]
 *     responses:
 *       200:
 *         description: Cart cleared successfully
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
 *                   $ref: '#/components/schemas/Cart'
 */

router.use(protect);

router.get('/:cartType', cartTypeRules, validate, cartController.getMyCart);
router.put('/:cartType/items', upsertItemRules, validate, cartController.upsertMyCartItem);
router.put('/:cartType/items/bulk', replaceItemsRules, validate, cartController.replaceMyCartItems);
router.delete('/:cartType/items/:itemId', removeItemRules, validate, cartController.removeMyCartItem);
router.delete('/:cartType/clear', cartTypeRules, validate, cartController.clearMyCart);

module.exports = router;
