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

/**
 * @swagger
 * tags:
 *   - name: Preorders
 *     description: Pre-order batch purchasing, receiving, and status management
 * components:
 *   schemas:
 *     PreorderBatchItemInput:
 *       type: object
 *       required: [productId, variantId, orderedQty]
 *       properties:
 *         productId:
 *           type: string
 *         variantId:
 *           type: string
 *         orderedQty:
 *           type: integer
 *           minimum: 1
 *         sku:
 *           type: string
 *         variantLabel:
 *           type: string
 *     PreorderBatchItem:
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
 *         orderedQty:
 *           type: integer
 *         receivedQty:
 *           type: integer
 *         pendingQty:
 *           type: integer
 *     PreorderReceiveItemInput:
 *       type: object
 *       required: [batchItemId, quantity]
 *       properties:
 *         batchItemId:
 *           type: string
 *         quantity:
 *           type: integer
 *           minimum: 1
 *     PreorderReceipt:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         receivedAt:
 *           type: string
 *           format: date-time
 *         items:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               batchItemId:
 *                 type: string
 *               productId:
 *                 type: string
 *               variantId:
 *                 type: string
 *               quantity:
 *                 type: integer
 *         totalReceived:
 *           type: integer
 *         note:
 *           type: string
 *         receivedBy:
 *           $ref: '#/components/schemas/User'
 *     PreorderBatchInput:
 *       type: object
 *       required: [batchCode, supplier, orderDate, items]
 *       properties:
 *         batchCode:
 *           type: string
 *         supplier:
 *           type: string
 *         orderDate:
 *           type: string
 *           format: date-time
 *         expectedDate:
 *           type: string
 *           format: date-time
 *         status:
 *           type: string
 *           enum: [pending, in_transit, partial, completed, delayed]
 *         note:
 *           type: string
 *         items:
 *           type: array
 *           minItems: 1
 *           items:
 *             $ref: '#/components/schemas/PreorderBatchItemInput'
 *     PreorderBatchReceiveInput:
 *       type: object
 *       required: [items]
 *       properties:
 *         receivedAt:
 *           type: string
 *           format: date-time
 *         note:
 *           type: string
 *         items:
 *           type: array
 *           minItems: 1
 *           items:
 *             $ref: '#/components/schemas/PreorderReceiveItemInput'
 *     PreorderBatchStatusInput:
 *       type: object
 *       required: [status]
 *       properties:
 *         status:
 *           type: string
 *           enum: [pending, in_transit, partial, completed, delayed]
 *     PreorderBatch:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         batchCode:
 *           type: string
 *         supplier:
 *           type: string
 *         orderDate:
 *           type: string
 *           format: date-time
 *         expectedDate:
 *           type: string
 *           format: date-time
 *         status:
 *           type: string
 *           enum: [pending, in_transit, partial, completed, delayed]
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/PreorderBatchItem'
 *         totalItems:
 *           type: integer
 *         receivedItems:
 *           type: integer
 *         receipts:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/PreorderReceipt'
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
 * /api/preorders/batches:
 *   get:
 *     summary: List preorder batches
 *     tags: [Preorders]
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, in_transit, partial, completed, delayed]
 *       - in: query
 *         name: supplier
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Preorder batches retrieved successfully
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
 *                     $ref: '#/components/schemas/PreorderBatch'
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
 *   post:
 *     summary: Create a new preorder batch
 *     tags: [Preorders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PreorderBatchInput'
 *     responses:
 *       201:
 *         description: Preorder batch created successfully
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
 *                   $ref: '#/components/schemas/PreorderBatch'
 * /api/preorders/batches/{id}:
 *   get:
 *     summary: Get preorder batch detail
 *     tags: [Preorders]
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
 *         description: Preorder batch retrieved successfully
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
 *                   $ref: '#/components/schemas/PreorderBatch'
 *       404:
 *         description: Preorder batch not found
 * /api/preorders/batches/{id}/receive:
 *   post:
 *     summary: Confirm receipt for one or more preorder batch items
 *     tags: [Preorders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PreorderBatchReceiveInput'
 *     responses:
 *       200:
 *         description: Preorder receipt confirmed successfully
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
 *                   $ref: '#/components/schemas/PreorderBatch'
 *       400:
 *         description: Invalid receipt payload
 * /api/preorders/batches/{id}/status:
 *   put:
 *     summary: Update preorder batch status manually
 *     tags: [Preorders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PreorderBatchStatusInput'
 *     responses:
 *       200:
 *         description: Preorder batch status updated successfully
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
 *                   $ref: '#/components/schemas/PreorderBatch'
 *       400:
 *         description: Invalid status transition
 */

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
