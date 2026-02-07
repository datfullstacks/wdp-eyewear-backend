const express = require('express');
const router = express.Router();
const supportController = require('../controllers/supportController');
const { protect, authorize } = require('../middlewares/auth');
const { validate, validateId } = require('../middlewares/validator');

/**
 * @swagger
 * tags:
 *   - name: Support
 *     description: Customer support ticket endpoints
 */

router.use(protect);

/**
 * @swagger
 * /api/support:
 *   get:
 *     summary: List support tickets (current user, staff can list more)
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Support tickets list
 *   post:
 *     summary: Create support ticket
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Support ticket created
 */
router.get('/', supportController.listTickets);
router.post('/', supportController.createTicket);

/**
 * @swagger
 * /api/support/{id}:
 *   get:
 *     summary: Get support ticket detail
 *     tags: [Support]
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
 *         description: Support ticket detail
 */
router.get('/:id', validateId, validate, supportController.getTicket);

/**
 * @swagger
 * /api/support/{id}/replies:
 *   post:
 *     summary: Reply to support ticket
 *     tags: [Support]
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
 *         description: Reply sent
 */
router.post('/:id/replies', validateId, validate, supportController.replyTicket);

/**
 * @swagger
 * /api/support/{id}/status:
 *   put:
 *     summary: Update support ticket status (staff only)
 *     tags: [Support]
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
 *         description: Ticket status updated
 */
router.put(
  '/:id/status',
  authorize('admin', 'manager', 'operations', 'sales'),
  validateId,
  validate,
  supportController.updateTicketStatus
);

module.exports = router;
