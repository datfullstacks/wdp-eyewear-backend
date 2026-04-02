const express = require('express');
const inventoryController = require('../controllers/inventoryController');
const { protect, authorize } = require('../middlewares/auth');
const { validate, validateId } = require('../middlewares/validator');
const {
  listReceiptRules,
  createReceiptRules,
  adjustStockRules,
} = require('../validators/inventoryValidator');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Inventory
 *     description: Stock receipt and inventory intake operations
 * components:
 *   schemas:
 *     StockReceiptItemInput:
 *       type: object
 *       required: [productId, variantId, quantity]
 *       properties:
 *         productId:
 *           type: string
 *         variantId:
 *           type: string
 *         quantity:
 *           type: integer
 *           minimum: 1
 *         unitCost:
 *           type: number
 *           minimum: 0
 *         note:
 *           type: string
 *     StockReceiptItem:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         productId:
 *           type: string
 *         variantId:
 *           type: string
 *         sku:
 *           type: string
 *         productName:
 *           type: string
 *         variantLabel:
 *           type: string
 *         quantity:
 *           type: integer
 *         unitCost:
 *           type: number
 *         lineTotal:
 *           type: number
 *         note:
 *           type: string
 *     StockReceiptInput:
 *       type: object
 *       required: [storeId, supplier, items]
 *       properties:
 *         storeId:
 *           type: string
 *         supplier:
 *           type: string
 *         warehouseLocation:
 *           type: string
 *         receivedAt:
 *           type: string
 *           format: date-time
 *         note:
 *           type: string
 *         items:
 *           type: array
 *           minItems: 1
 *           items:
 *             $ref: '#/components/schemas/StockReceiptItemInput'
 *     StockReceipt:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         receiptCode:
 *           type: string
 *         storeId:
 *           type: string
 *         supplier:
 *           type: string
 *         warehouseLocation:
 *           type: string
 *         receivedAt:
 *           type: string
 *           format: date-time
 *         status:
 *           type: string
 *           enum: [confirmed]
 *         totalQuantity:
 *           type: integer
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/StockReceiptItem'
 *         note:
 *           type: string
 *         createdBy:
 *           $ref: '#/components/schemas/User'
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 * /api/inventory/receipts:
 *   get:
 *     summary: List stock receipts
 *     tags: [Inventory]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *       - in: query
 *         name: storeId
 *         schema:
 *           type: string
 *       - in: query
 *         name: supplier
 *         schema:
 *           type: string
 *       - in: query
 *         name: receiptCode
 *         schema:
 *           type: string
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Stock receipts retrieved successfully
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
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/StockReceipt'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *       403:
 *         description: Forbidden
 *   post:
 *     summary: Create a store-scoped stock receipt and increment inventory
 *     tags: [Inventory]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StockReceiptInput'
 *     responses:
 *       201:
 *         description: Stock receipt created successfully
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
 *                   $ref: '#/components/schemas/StockReceipt'
 *       400:
 *         description: Invalid receipt payload
 *       403:
 *         description: Forbidden
 * /api/inventory/receipts/{id}:
 *   get:
 *     summary: Get one stock receipt by id
 *     tags: [Inventory]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Stock receipt retrieved successfully
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
 *                   $ref: '#/components/schemas/StockReceipt'
 *       404:
 *         description: Stock receipt not found
 *       403:
 *         description: Store-scoped user cannot access this receipt
 */

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

router.post(
  '/adjustments',
  authorize('manager', 'operations'),
  adjustStockRules,
  validate,
  inventoryController.adjustStock
);

module.exports = router;
