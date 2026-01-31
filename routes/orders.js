const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { protect } = require('../middlewares/auth');
const { validate, validateId } = require('../middlewares/validator');

/**
 * @swagger
 * tags:
 *   - name: Orders
 *     description: Order status
 */

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
router.put('/:id/cancel', protect, validateId, validate, orderController.cancelOrder);

module.exports = router;
