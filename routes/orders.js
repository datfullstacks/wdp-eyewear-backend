const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { protect } = require('../middlewares/auth');
const { validate, validateId } = require('../middlewares/validator');
const {
  updateOrderItemsRules,
  patchOrderItemRules,
  cancelOrderRules,
  updateRefundStatusRules,
  updateOrderStatusRules
} = require('../validators/orderValidator');

/**
 * @swagger
 * tags:
 *   - name: Orders
 *     description: Order status
 */

/**
 * @swagger
 * /api/orders:
 *   get:
 *     summary: List orders (customer sees own orders, staff sees all and can filter by userId)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: paymentStatus
 *         schema:
 *           type: string
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Orders list
 */
router.get('/', protect, orderController.listOrders);

/**
 * @swagger
 * /api/orders/me:
 *   get:
 *     summary: List current user orders
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: My orders list
 */
router.get('/me', protect, orderController.listMyOrders);

/**
 * @swagger
 * /api/orders/{id}:
 *   get:
 *     summary: Get order detail (owner or staff)
 *     tags: [Orders]
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
 *         description: Order detail
 */
router.get('/:id', protect, validateId, validate, orderController.getOrder);

router.put(
  '/:id/items',
  protect,
  validateId,
  updateOrderItemsRules,
  validate,
  orderController.updateOrderItems
);

router.patch(
  '/:id/items/:itemId',
  protect,
  validateId,
  patchOrderItemRules,
  validate,
  orderController.patchOrderItem
);

router.put(
  '/:id/status',
  protect,
  validateId,
  updateOrderStatusRules,
  validate,
  orderController.updateOrderStatus
);

/**
 * @swagger
 * /api/orders/{id}/cancel:
 *   put:
 *     summary: Cancel order (owner or staff)
 *     tags: [Orders]
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
 *         description: Order cancelled
 */
router.put(
  '/:id/cancel',
  protect,
  validateId,
  cancelOrderRules,
  validate,
  orderController.cancelOrder
);

router.put(
  '/:id/refund',
  protect,
  validateId,
  updateRefundStatusRules,
  validate,
  orderController.updateRefundStatus
);

module.exports = router;
