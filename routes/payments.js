const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

/**
 * @swagger
 * /api/payments/sepay/webhook:
 *   post:
 *     summary: Sepay webhook for incoming bank transfer
 *     tags: [Checkout]
 *     responses:
 *       200:
 *         description: Acknowledge webhook
 */
router.post('/sepay/webhook', paymentController.sepayWebhook);

module.exports = router;
