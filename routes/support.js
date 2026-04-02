const express = require('express');
const router = express.Router();
const supportController = require('../controllers/supportController');
const { protect, authorize } = require('../middlewares/auth');
const { validate, validateId } = require('../middlewares/validator');
const { BUSINESS_STAFF_ROLES } = require('../helpers/roles');
const {
  listSupportTicketRules,
  createSupportTicketRules,
  replySupportTicketRules,
  updateSupportTicketStatusRules,
  createWarrantyOrderRules,
  createWarrantyRefundRules,
} = require('../validators/supportValidator');

/**
 * @swagger
 * tags:
 *   - name: Support
 *     description: Customer support ticket endpoints
 * components:
 *   schemas:
 *     WarrantyMetadata:
 *       type: object
 *       properties:
 *         orderItemId:
 *           type: string
 *         productId:
 *           type: string
 *         variantId:
 *           type: string
 *         itemName:
 *           type: string
 *         warrantyMonths:
 *           type: integer
 *         referenceDate:
 *           type: string
 *           format: date-time
 *         expiresAt:
 *           type: string
 *           format: date-time
 *         eligibility:
 *           type: string
 *           enum: [eligible, expired, not_covered]
 *         decisionNote:
 *           type: string
 *         serviceNote:
 *           type: string
 *         approvedBy:
 *           type: string
 *         approvedAt:
 *           type: string
 *           format: date-time
 *         completedBy:
 *           type: string
 *         completedAt:
 *           type: string
 *           format: date-time
 *     SupportMessage:
 *       type: object
 *       properties:
 *         sender:
 *           type: string
 *           enum: [user, staff]
 *         message:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *     SupportTicket:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         userId:
 *           $ref: '#/components/schemas/User'
 *         email:
 *           type: string
 *         subject:
 *           type: string
 *         category:
 *           type: string
 *           enum: [general, order, prescription, shipping, refund, return, warranty]
 *         status:
 *           type: string
 *           enum: [open, in_progress, resolved, closed, requested, under_review, approved, rejected, in_service, completed]
 *         priority:
 *           type: string
 *           enum: [low, normal, high]
 *         orderId:
 *           type: string
 *         storeId:
 *           type: string
 *         warranty:
 *           $ref: '#/components/schemas/WarrantyMetadata'
 *         messages:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SupportMessage'
 *         lastMessageAt:
 *           type: string
 *           format: date-time
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

router.use(protect);

router.get(
  '/refunds',
  authorize(...BUSINESS_STAFF_ROLES),
  supportController.listRefundCases
);

/**
 * @swagger
 * /api/support/warranties:
 *   get:
 *     summary: List warranty cases for business staff
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [requested, under_review, approved, rejected, in_service, completed]
 *       - in: query
 *         name: eligibility
 *         schema:
 *           type: string
 *           enum: [eligible, expired, not_covered]
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search by paymentCode, customer name, customer phone, or ticket subject
 *       - in: query
 *         name: orderId
 *         schema:
 *           type: string
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Warranty cases list
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
 *                     $ref: '#/components/schemas/SupportTicket'
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
 *         description: Only business staff can access warranty cases
 */
router.get(
  '/warranties',
  authorize(...BUSINESS_STAFF_ROLES),
  listSupportTicketRules,
  validate,
  supportController.listWarrantyCases
);

/**
 * @swagger
 * /api/support:
 *   get:
 *     summary: List support tickets (current user, staff can list more)
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, in_progress, resolved, closed, requested, under_review, approved, rejected, in_service, completed]
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [general, order, prescription, shipping, refund, return, warranty]
 *       - in: query
 *         name: eligibility
 *         schema:
 *           type: string
 *           enum: [eligible, expired, not_covered]
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search by paymentCode, customer name, customer phone, or ticket subject
 *       - in: query
 *         name: orderId
 *         schema:
 *           type: string
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Support tickets list
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
 *                     $ref: '#/components/schemas/SupportTicket'
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
 *     summary: Create support ticket or warranty request
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subject, message]
 *             properties:
 *               subject:
 *                 type: string
 *               message:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               category:
 *                 type: string
 *                 enum: [general, order, prescription, shipping, refund, return, warranty]
 *               priority:
 *                 type: string
 *                 enum: [low, normal, high]
 *               orderId:
 *                 type: string
 *               orderItemId:
 *                 type: string
 *               storeId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Support ticket created
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
 *                   $ref: '#/components/schemas/SupportTicket'
 *       400:
 *         description: Invalid support or warranty payload
 */
router.get('/', listSupportTicketRules, validate, supportController.listTickets);
router.post('/', createSupportTicketRules, validate, supportController.createTicket);

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
 *       400:
 *         description: Invalid reply payload
 */
router.post(
  '/:id/replies',
  validateId,
  replySupportTicketRules,
  validate,
  supportController.replyTicket
);

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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [open, in_progress, resolved, closed, requested, under_review, approved, rejected, in_service, completed]
 *               decisionNote:
 *                 type: string
 *               serviceNote:
 *                 type: string
 *               note:
 *                 type: string
 *     responses:
 *       200:
 *         description: Ticket status updated
 *       403:
 *         description: Staff role cannot perform the requested transition
 */
router.put(
  '/:id/status',
  authorize(...BUSINESS_STAFF_ROLES),
  validateId,
  updateSupportTicketStatusRules,
  validate,
  supportController.updateTicketStatus
);

router.post(
  '/:id/warranty-order',
  authorize(...BUSINESS_STAFF_ROLES),
  validateId,
  createWarrantyOrderRules,
  validate,
  supportController.createWarrantyOrder
);

router.post(
  '/:id/warranty-refund',
  authorize(...BUSINESS_STAFF_ROLES),
  validateId,
  createWarrantyRefundRules,
  validate,
  supportController.createWarrantyRefund
);

module.exports = router;
