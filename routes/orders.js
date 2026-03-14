const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const { protect } = require("../middlewares/auth");
const { validate, validateId } = require("../middlewares/validator");
const {
  updateOrderItemsRules,
  patchOrderItemRules,
  cancelOrderRules,
  updateRefundStatusRules,
  updateOrderOpsStageRules,
  updateOrderOpsExecutionRules,
  updateOrderStatusRules,
  updateShipmentTestStatusRules,
} = require("../validators/orderValidator");

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
router.get("/", protect, orderController.listOrders);

router.post("/shipping/ghn/webhook", orderController.ghnShippingWebhook);

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
router.get("/me", protect, orderController.listMyOrders);

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
router.get("/:id", protect, validateId, validate, orderController.getOrder);

router.get(
  "/:id/shipping",
  protect,
  validateId,
  validate,
  orderController.getOrderShipping,
);

router.post(
  "/:id/shipping/create",
  protect,
  validateId,
  validate,
  orderController.createOrderShipment,
);

router.post(
  "/:id/shipping/sync",
  protect,
  validateId,
  validate,
  orderController.syncOrderShipment,
);

router.post(
  "/:id/shipping/test-status",
  protect,
  validateId,
  updateShipmentTestStatusRules,
  validate,
  orderController.updateOrderShipmentTestStatus,
);

router.post(
  "/:id/shipping/print-label",
  protect,
  validateId,
  validate,
  orderController.printOrderShipmentLabel,
);

router.post(
  "/:id/shipping/cancel",
  protect,
  validateId,
  validate,
  orderController.cancelOrderShipment,
);

router.post(
  "/:id/shipping/return",
  protect,
  validateId,
  validate,
  orderController.returnOrderShipment,
);

router.post(
  "/:id/shipping/delivery-again",
  protect,
  validateId,
  validate,
  orderController.requestOrderShipmentDeliveryAgain,
);

router.put(
  "/:id/items",
  protect,
  validateId,
  updateOrderItemsRules,
  validate,
  orderController.updateOrderItems,
);

router.patch(
  "/:id/items/:itemId",
  protect,
  validateId,
  patchOrderItemRules,
  validate,
  orderController.patchOrderItem,
);

router.put(
  "/:id/status",
  protect,
  validateId,
  updateOrderStatusRules,
  validate,
  orderController.updateOrderStatus,
);

router.put(
  "/:id/ops-stage",
  protect,
  validateId,
  updateOrderOpsStageRules,
  validate,
  orderController.updateOrderOpsStage,
);

router.put(
  "/:id/ops-execution",
  protect,
  validateId,
  updateOrderOpsExecutionRules,
  validate,
  orderController.updateOrderOpsExecution,
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
  "/:id/cancel",
  protect,
  validateId,
  cancelOrderRules,
  validate,
  orderController.cancelOrder,
);

router.put(
  "/:id/refund",
  protect,
  validateId,
  updateRefundStatusRules,
  validate,
  orderController.updateRefundStatus,
);

module.exports = router;
