const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');
const { protect } = require('../middlewares/auth');
const { validate, validateId } = require('../middlewares/validator');
const { param } = require('express-validator');

/**
 * @swagger
 * tags:
 *   - name: Invoices
 *     description: Invoice management endpoints
 */

/**
 * @swagger
 * /api/invoices:
 *   get:
 *     summary: List invoices (current user; staff can filter by userId/orderId)
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Invoices list
 */
router.get('/', protect, invoiceController.listInvoices);

/**
 * @swagger
 * /api/invoices/me:
 *   get:
 *     summary: List current user invoices
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: My invoices list
 */
router.get('/me', protect, invoiceController.listMyInvoices);

/**
 * @swagger
 * /api/invoices/order/{orderId}:
 *   get:
 *     summary: Get invoice by order id
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Invoice detail
 */
router.get(
  '/order/:orderId',
  protect,
  param('orderId').isMongoId().withMessage('Invalid order id'),
  validate,
  invoiceController.getInvoiceByOrder
);

/**
 * @swagger
 * /api/invoices/{id}:
 *   get:
 *     summary: Get invoice detail
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Invoice detail
 */
router.get('/:id', protect, validateId, validate, invoiceController.getInvoice);

module.exports = router;
