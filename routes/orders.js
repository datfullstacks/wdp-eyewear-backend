const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const { protect } = require("../middlewares/auth");
const { validate, validateId } = require("../middlewares/validator");
const {
  updateOrderItemsRules,
  patchOrderItemRules,
  cancelOrderRules,
  requestRefundRules,
  updateRefundStatusRules,
  overrideRefundRules,
  updateOrderOpsStageRules,
  updateOrderOpsExecutionRules,
  updateOrderStatusRules,
  updateShipmentTestStatusRules,
} = require("../validators/orderValidator");

/**
 * @swagger
 * tags:
 *   - name: Orders
 *     description: Order lifecycle, editing, refund, and GHN shipment management
 * components:
 *   schemas:
 *     OrderPrescriptionEye:
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
 *     OrderPrescription:
 *       type: object
 *       properties:
 *         mode:
 *           type: string
 *           enum: [none, manual, upload]
 *         isMyopic:
 *           type: boolean
 *         rightEye:
 *           $ref: '#/components/schemas/OrderPrescriptionEye'
 *         leftEye:
 *           $ref: '#/components/schemas/OrderPrescriptionEye'
 *         pd:
 *           type: string
 *         note:
 *           type: string
 *         attachmentUrls:
 *           type: array
 *           items:
 *             type: string
 *             format: uri
 *     OrderItemCustomization:
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
 *           $ref: '#/components/schemas/OrderPrescription'
 *     OrderItemInput:
 *       type: object
 *       required: [productId, quantity]
 *       properties:
 *         productId:
 *           type: string
 *         variantId:
 *           type: string
 *           nullable: true
 *         quantity:
 *           type: integer
 *           minimum: 1
 *         customization:
 *           $ref: '#/components/schemas/OrderItemCustomization'
 *     ShippingAddress:
 *       type: object
 *       properties:
 *         fullName:
 *           type: string
 *         phone:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         line1:
 *           type: string
 *         line2:
 *           type: string
 *         ward:
 *           type: string
 *         wardCode:
 *           type: string
 *         district:
 *           type: string
 *         districtId:
 *           type: integer
 *         province:
 *           type: string
 *         provinceId:
 *           type: integer
 *         country:
 *           type: string
 *         note:
 *           type: string
 *     OrderItemsUpdateInput:
 *       type: object
 *       required: [items]
 *       properties:
 *         items:
 *           type: array
 *           minItems: 1
 *           items:
 *             $ref: '#/components/schemas/OrderItemInput'
 *         shippingFee:
 *           type: number
 *           minimum: 0
 *         discountAmount:
 *           type: number
 *           minimum: 0
 *         voucherCode:
 *           type: string
 *         shippingMethod:
 *           type: string
 *           enum: [standard, express]
 *         shippingAddress:
 *           $ref: '#/components/schemas/ShippingAddress'
 *         note:
 *           type: string
 *     OrderItemPatchInput:
 *       type: object
 *       properties:
 *         productId:
 *           type: string
 *         variantId:
 *           type: string
 *           nullable: true
 *         quantity:
 *           type: integer
 *           minimum: 1
 *         customization:
 *           $ref: '#/components/schemas/OrderItemCustomization'
 *         note:
 *           type: string
 *     OrderCancelInput:
 *       type: object
 *       properties:
 *         reason:
 *           type: string
 *         contactChannels:
 *           type: array
 *           items:
 *             type: string
 *             enum: [email, phone]
 *         bankAccount:
 *           type: object
 *           properties:
 *             bankName:
 *               type: string
 *             accountNumber:
 *               type: string
 *             accountHolder:
 *               type: string
 *             note:
 *               type: string
 *     RefundResponsibility:
 *       type: string
 *       enum: [customer, system, carrier, mixed]
 *     OrderRefundBreakdown:
 *       type: object
 *       properties:
 *         itemAmount:
 *           type: number
 *           minimum: 0
 *         shippingFeeAmount:
 *           type: number
 *           minimum: 0
 *         returnShippingFeeAmount:
 *           type: number
 *           minimum: 0
 *         total:
 *           type: number
 *           minimum: 0
 *     OrderRefundRequestInput:
 *       type: object
 *       required: [reason]
 *       properties:
 *         reason:
 *           type: string
 *         reasonCode:
 *           type: string
 *         requestShippingFee:
 *           type: boolean
 *         customerPaidReturnShippingFee:
 *           type: number
 *           minimum: 0
 *         responsibility:
 *           $ref: '#/components/schemas/RefundResponsibility'
 *         requiresReturn:
 *           type: boolean
 *         note:
 *           type: string
 *         requestedBreakdown:
 *           $ref: '#/components/schemas/OrderRefundBreakdown'
 *         bankAccount:
 *           type: object
 *           properties:
 *             bankName:
 *               type: string
 *             accountNumber:
 *               type: string
 *             accountHolder:
 *               type: string
 *             note:
 *               type: string
 *     OrderRefundActionInput:
 *       type: object
 *       properties:
 *         action:
 *           type: string
 *           enum: [start_review, customer_submit_info, request_customer_info, approve, reject, escalate, manager_approve, manager_reject, send_back_to_staff, mark_return_pending, confirm_return_received, start_processing, complete]
 *         status:
 *           type: string
 *           description: Legacy fallback. Prefer action.
 *           enum: [reviewing, waiting_customer_info, approved, escalated_to_manager, return_pending, return_received, processing, completed, rejected]
 *         reason:
 *           type: string
 *         reasonCode:
 *           type: string
 *         requestShippingFee:
 *           type: boolean
 *         customerPaidReturnShippingFee:
 *           type: number
 *           minimum: 0
 *         responsibility:
 *           $ref: '#/components/schemas/RefundResponsibility'
 *         requiresReturn:
 *           type: boolean
 *         contactNote:
 *           type: string
 *         contactChannels:
 *           type: array
 *           items:
 *             type: string
 *             enum: [email, phone]
 *         decisionNote:
 *           type: string
 *         note:
 *           type: string
 *         rejectReason:
 *           type: string
 *         escalateReason:
 *           type: string
 *         transactionRef:
 *           type: string
 *         requestedBreakdown:
 *           $ref: '#/components/schemas/OrderRefundBreakdown'
 *         approvedBreakdown:
 *           $ref: '#/components/schemas/OrderRefundBreakdown'
 *         bankAccount:
 *           type: object
 *           properties:
 *             bankName:
 *               type: string
 *             accountNumber:
 *               type: string
 *             accountHolder:
 *               type: string
 *             note:
 *               type: string
 *     OrderStatusInput:
 *       type: object
 *       required: [status]
 *       properties:
 *         status:
 *           type: string
 *           enum: [pending, confirmed, processing, shipped, delivered, cancelled, returned]
 *     OrderOpsStageInput:
 *       type: object
 *       required: [opsStage]
 *       properties:
 *         opsStage:
 *           type: string
 *           enum: [none, pending_operations, picking, waiting_customer_info, on_hold, waiting_arrival, arrived, stocked, ready_to_pack, waiting_lab, lens_processing, lens_fitting, qc_check, packing, ready_to_ship, shipment_created, handover_to_carrier, in_transit, delivery_failed, waiting_redelivery, return_pending, return_in_transit, exception_hold, delivered, closed, returned, cancelled]
 *     OrderOpsChecklist:
 *       type: object
 *       properties:
 *         skuQuantityChecked:
 *           type: boolean
 *         productConditionChecked:
 *           type: boolean
 *         addressChecked:
 *           type: boolean
 *         packageReady:
 *           type: boolean
 *     OrderOpsItemState:
 *       type: object
 *       properties:
 *         picked:
 *           type: boolean
 *         warehouseLocation:
 *           type: string
 *         issueType:
 *           type: string
 *           enum: [out_of_stock, wrong_sku, damaged_item, address_issue, shipping_label_error, other]
 *         issueNote:
 *           type: string
 *         internalNote:
 *           type: string
 *     OrderOpsExecutionInput:
 *       type: object
 *       properties:
 *         assignee:
 *           type: string
 *         salesApprovedBy:
 *           type: string
 *         salesHandoffNote:
 *           type: string
 *         prescriptionFollowUpStatus:
 *           type: string
 *           enum: [none, needs_review, needs_customer_contact, waiting_customer_response, customer_responded]
 *         prescriptionFollowUpNote:
 *           type: string
 *         prescriptionFollowUpUpdatedAt:
 *           type: string
 *           format: date-time
 *         prescriptionFollowUpUpdatedBy:
 *           type: string
 *         internalNote:
 *           type: string
 *         holdReason:
 *           type: string
 *           enum: [payment, address, stock, manual, other]
 *         holdNote:
 *           type: string
 *         paymentFailed:
 *           type: boolean
 *         carrierId:
 *           type: string
 *         trackingCode:
 *           type: string
 *         issueType:
 *           type: string
 *           enum: [out_of_stock, wrong_sku, damaged_item, address_issue, shipping_label_error, other]
 *         issueNote:
 *           type: string
 *         checklist:
 *           $ref: '#/components/schemas/OrderOpsChecklist'
 *         itemStates:
 *           type: object
 *           additionalProperties:
 *             $ref: '#/components/schemas/OrderOpsItemState'
 *     ShipmentTestStatusInput:
 *       type: object
 *       required: [status]
 *       properties:
 *         status:
 *           type: string
 *           enum: [ready_to_pick, picking, storing, transporting, delivering, delivery_fail, waiting_to_return, return, return_transporting, returning, delivered, return_fail, damage, lost, returned]
 *     OrderItem:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         productId:
 *           type: string
 *         variantId:
 *           type: string
 *           nullable: true
 *         name:
 *           type: string
 *         type:
 *           type: string
 *         variantOptions:
 *           type: object
 *           properties:
 *             color:
 *               type: string
 *             size:
 *               type: string
 *         quantity:
 *           type: integer
 *         unitPrice:
 *           type: number
 *         lineTotal:
 *           type: number
 *         depositPercent:
 *           type: number
 *         payNow:
 *           type: number
 *         payLater:
 *           type: number
 *         preOrder:
 *           type: boolean
 *         customization:
 *           $ref: '#/components/schemas/OrderItemCustomization'
 *     OrderPayment:
 *       type: object
 *       nullable: true
 *       properties:
 *         method:
 *           type: string
 *           enum: [cod, credit_card, bank_transfer, e_wallet, sepay]
 *         status:
 *           type: string
 *           enum: [pending, paid, partial, failed, refunded]
 *         amount:
 *           type: number
 *         currency:
 *           type: string
 *         paymentCode:
 *           type: string
 *         content:
 *           type: string
 *         bankAccountId:
 *           type: string
 *           nullable: true
 *         bankAccountNumber:
 *           type: string
 *           nullable: true
 *         bankName:
 *           type: string
 *           nullable: true
 *         bankAccountName:
 *           type: string
 *           nullable: true
 *         description:
 *           type: string
 *           nullable: true
 *         instruction:
 *           type: string
 *           nullable: true
 *         qrUrl:
 *           type: string
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         paidAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *     OrderShipment:
 *       type: object
 *       properties:
 *         provider:
 *           type: string
 *           enum: [ghn]
 *         state:
 *           type: string
 *           enum: [none, created, in_transit, delivered, returning, returned, cancelled, failed]
 *         orderCode:
 *           type: string
 *         clientOrderCode:
 *           type: string
 *         shopId:
 *           type: integer
 *         serviceId:
 *           type: integer
 *         serviceTypeId:
 *           type: integer
 *         serviceName:
 *           type: string
 *         latestStatus:
 *           type: string
 *         latestFailCode:
 *           type: string
 *         latestFailReason:
 *           type: string
 *         labelToken:
 *           type: string
 *         leadtime:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         shippingFee:
 *           type: number
 *         codAmount:
 *           type: number
 *         trackingCode:
 *           type: string
 *         trackingUrl:
 *           type: string
 *         lastAction:
 *           type: string
 *         lastActionAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         lastSyncedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         latestSnapshot:
 *           type: object
 *           nullable: true
 *           additionalProperties: true
 *     Order:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         userId:
 *           type: string
 *         invoiceId:
 *           type: string
 *           nullable: true
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/OrderItem'
 *         subtotal:
 *           type: number
 *         discountAmount:
 *           type: number
 *         shippingFee:
 *           type: number
 *         total:
 *           type: number
 *         payNowTotal:
 *           type: number
 *         payLaterTotal:
 *           type: number
 *         paymentMethod:
 *           type: string
 *           enum: [cod, credit_card, bank_transfer, e_wallet, sepay]
 *         paymentStatus:
 *           type: string
 *           enum: [pending, paid, partial, failed, refunded]
 *         paidAmount:
 *           type: number
 *         paidAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         shippingMethod:
 *           type: string
 *           enum: [standard, express]
 *         shippingAddress:
 *           $ref: '#/components/schemas/ShippingAddress'
 *         voucherCode:
 *           type: string
 *         note:
 *           type: string
 *         paymentCode:
 *           type: string
 *         orderType:
 *           type: string
 *           enum: [ready_stock, pre_order, prescription]
 *         status:
 *           type: string
 *           enum: [pending, confirmed, processing, shipped, delivered, cancelled, returned]
 *         opsStage:
 *           type: string
 *         opsExecution:
 *           allOf:
 *             - $ref: '#/components/schemas/OrderOpsExecutionInput'
 *             - type: object
 *               properties:
 *                 lastUpdatedAt:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 salesApprovedAt:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *         inventoryCommit:
 *           type: object
 *           properties:
 *             committedAt:
 *               type: string
 *               format: date-time
 *               nullable: true
 *             committedBy:
 *               type: string
 *               nullable: true
 *             restoredAt:
 *               type: string
 *               format: date-time
 *               nullable: true
 *             restoredBy:
 *               type: string
 *               nullable: true
 *             lastAction:
 *               type: string
 *               enum: [none, deducted, restored]
 *         shipment:
 *           $ref: '#/components/schemas/OrderShipment'
 *         refund:
 *           type: object
 *           properties:
 *             status:
 *               type: string
 *               enum: [none, requested, reviewing, waiting_customer_info, escalated_to_manager, approved, return_pending, return_received, processing, completed, rejected]
 *             reason:
 *               type: string
 *             responsibility:
 *               $ref: '#/components/schemas/RefundResponsibility'
 *             requiresReturn:
 *               type: boolean
 *             amount:
 *               type: number
 *             requestedBreakdown:
 *               $ref: '#/components/schemas/OrderRefundBreakdown'
 *             approvedBreakdown:
 *               $ref: '#/components/schemas/OrderRefundBreakdown'
 *             bankAccount:
 *               type: object
 *               properties:
 *                 bankName:
 *                   type: string
 *                 accountNumber:
 *                   type: string
 *                 accountHolder:
 *                   type: string
 *                 note:
 *                   type: string
 *             contactChannels:
 *               type: array
 *               items:
 *                 type: string
 *                 enum: [email, phone]
 *             contactNote:
 *               type: string
 *             contactAt:
 *               type: string
 *               format: date-time
 *               nullable: true
 *             processedAt:
 *               type: string
 *               format: date-time
 *               nullable: true
 *             approvedAt:
 *               type: string
 *               format: date-time
 *               nullable: true
 *             escalatedAt:
 *               type: string
 *               format: date-time
 *               nullable: true
 *             escalateReason:
 *               type: string
 *             decisionNote:
 *               type: string
 *             transactionRef:
 *               type: string
 *             rejectReason:
 *               type: string
 *         payment:
 *           $ref: '#/components/schemas/OrderPayment'
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     OrderShippingView:
 *       type: object
 *       properties:
 *         orderId:
 *           type: string
 *         orderStatus:
 *           type: string
 *         opsStage:
 *           type: string
 *         shippingMethod:
 *           type: string
 *         shipment:
 *           $ref: '#/components/schemas/OrderShipment'
 *         currentRole:
 *           type: string
 *           nullable: true
 *         permissions:
 *           type: object
 *           additionalProperties:
 *             type: boolean
 *         roleMatrix:
 *           type: object
 *           additionalProperties: true
 *         testMode:
 *           type: boolean
 *         testStatusOptions:
 *           type: array
 *           items:
 *             type: string
 *     OrderItemPatchResult:
 *       type: object
 *       properties:
 *         order:
 *           $ref: '#/components/schemas/Order'
 *         updatedItem:
 *           $ref: '#/components/schemas/OrderItem'
 *         updatedItemIndex:
 *           type: integer
 *     GhnWebhookResult:
 *       type: object
 *       properties:
 *         applied:
 *           type: boolean
 *         message:
 *           type: string
 *         orderId:
 *           type: string
 *           nullable: true
 *         orderCode:
 *           type: string
 *         clientOrderCode:
 *           type: string
 *         shipmentStatus:
 *           type: string
 *         shipmentState:
 *           type: string
 *         orderStatus:
 *           type: string
 *         opsStage:
 *           type: string
 */

/**
 * @swagger
 * /api/orders:
 *   get:
 *     summary: List orders visible to the current user
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
 *           enum: [pending, confirmed, processing, shipped, delivered, cancelled, returned]
 *       - in: query
 *         name: paymentStatus
 *         schema:
 *           type: string
 *           enum: [pending, paid, partial, failed, refunded]
 *       - in: query
 *         name: opsStage
 *         schema:
 *           type: string
 *       - in: query
 *         name: refundStatus
 *         schema:
 *           type: string
 *           enum: [none, requested, reviewing, waiting_customer_info, escalated_to_manager, approved, return_pending, return_received, processing, completed, rejected]
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Staff-only filter for a specific user.
 *     responses:
 *       200:
 *         description: Orders retrieved successfully
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
 *                     $ref: '#/components/schemas/Order'
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
 * /api/orders/shipping/ghn/webhook:
 *   post:
 *     summary: Receive GHN shipping webhook updates
 *     tags: [Orders]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: true
 *     responses:
 *       200:
 *         description: Webhook processed
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
 *                   $ref: '#/components/schemas/GhnWebhookResult'
 *       401:
 *         description: Invalid GHN signature
 * /api/orders/me:
 *   get:
 *     summary: List only the current user orders
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
 *         name: opsStage
 *         schema:
 *           type: string
 *       - in: query
 *         name: refundStatus
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Current user orders retrieved successfully
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
 *                     $ref: '#/components/schemas/Order'
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
 * /api/orders/{id}:
 *   get:
 *     summary: Get one order with payment details
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
 *         description: Order retrieved successfully
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
 *                   $ref: '#/components/schemas/Order'
 *       404:
 *         description: Order not found
 * /api/orders/{id}/shipping:
 *   get:
 *     summary: Get GHN shipping state and allowed actions for an order
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
 *         description: Order shipping retrieved successfully
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
 *                   $ref: '#/components/schemas/OrderShippingView'
 *       403:
 *         description: Forbidden
 * /api/orders/{id}/shipping/create:
 *   post:
 *     summary: Create a GHN shipment for an order
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
 *         description: GHN shipment created
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
 *                   $ref: '#/components/schemas/OrderShippingView'
 *       400:
 *         description: Shipment cannot be created for this order
 * /api/orders/{id}/shipping/sync:
 *   post:
 *     summary: Sync GHN shipment data from the carrier
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
 *         description: GHN shipment synced
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
 *                   $ref: '#/components/schemas/OrderShippingView'
 */

router.get("/", protect, orderController.listOrders);

router.post("/shipping/ghn/webhook", orderController.ghnShippingWebhook);

router.get("/me", protect, orderController.listMyOrders);

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

/**
 * @swagger
 * /api/orders/{id}/shipping/test-status:
 *   post:
 *     summary: Manually move GHN shipment to the next test status
 *     tags: [Orders]
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
 *             $ref: '#/components/schemas/ShipmentTestStatusInput'
 *     responses:
 *       200:
 *         description: GHN test shipment status updated
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
 *                   $ref: '#/components/schemas/OrderShippingView'
 *       400:
 *         description: Unsupported or disallowed test status
 * /api/orders/{id}/shipping/print-label:
 *   post:
 *     summary: Generate or refresh GHN print label token
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
 *         description: GHN label token generated
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
 *                   $ref: '#/components/schemas/OrderShippingView'
 * /api/orders/{id}/shipping/cancel:
 *   post:
 *     summary: Cancel a GHN shipment
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
 *         description: GHN shipment cancelled
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
 *                   $ref: '#/components/schemas/OrderShippingView'
 * /api/orders/{id}/shipping/return:
 *   post:
 *     summary: Move a GHN shipment into return flow
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
 *         description: GHN shipment moved to return flow
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
 *                   $ref: '#/components/schemas/OrderShippingView'
 * /api/orders/{id}/shipping/delivery-again:
 *   post:
 *     summary: Request GHN to deliver the shipment again
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
 *         description: GHN delivery-again requested
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
 *                   $ref: '#/components/schemas/OrderShippingView'
 * /api/orders/{id}/items:
 *   put:
 *     summary: Replace the editable items and pricing inputs for an order
 *     tags: [Orders]
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
 *             $ref: '#/components/schemas/OrderItemsUpdateInput'
 *     responses:
 *       200:
 *         description: Order items updated
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
 *                   $ref: '#/components/schemas/Order'
 *       400:
 *         description: Invalid update payload
 * /api/orders/{id}/items/{itemId}:
 *   patch:
 *     summary: Patch one order item in place
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OrderItemPatchInput'
 *     responses:
 *       200:
 *         description: Order item updated
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
 *                   $ref: '#/components/schemas/OrderItemPatchResult'
 *       404:
 *         description: Order item not found
 */

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

/**
 * @swagger
 * /api/orders/{id}/status:
 *   put:
 *     summary: Update the public order status
 *     tags: [Orders]
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
 *             $ref: '#/components/schemas/OrderStatusInput'
 *     responses:
 *       200:
 *         description: Order status updated
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
 *                   $ref: '#/components/schemas/Order'
 * /api/orders/{id}/ops-stage:
 *   put:
 *     summary: Update the internal operations stage
 *     tags: [Orders]
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
 *             $ref: '#/components/schemas/OrderOpsStageInput'
 *     responses:
 *       200:
 *         description: Order ops stage updated
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
 *                   $ref: '#/components/schemas/Order'
 * /api/orders/{id}/ops-execution:
 *   put:
 *     summary: Update operations execution metadata
 *     tags: [Orders]
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
 *             $ref: '#/components/schemas/OrderOpsExecutionInput'
 *     responses:
 *       200:
 *         description: Order ops execution updated
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
 *                   $ref: '#/components/schemas/Order'
 * /api/orders/{id}/cancel:
 *   put:
 *     summary: Cancel an order
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OrderCancelInput'
 *     responses:
 *       200:
 *         description: Order cancelled
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
 *                   $ref: '#/components/schemas/Order'
 * /api/orders/{id}/refund-request:
 *   post:
 *     summary: Create a refund request for an order
 *     tags: [Orders]
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
 *             $ref: '#/components/schemas/OrderRefundRequestInput'
 *     responses:
 *       201:
 *         description: Refund request created
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
 *                   $ref: '#/components/schemas/Order'
 * /api/orders/{id}/refund:
 *   put:
 *     summary: Update refund workflow state for an order
 *     tags: [Orders]
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
 *             $ref: '#/components/schemas/OrderRefundActionInput'
 *     responses:
 *       200:
 *         description: Order refund status updated
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
 *                   $ref: '#/components/schemas/Order'
 */

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

router.put(
  "/:id/cancel",
  protect,
  validateId,
  cancelOrderRules,
  validate,
  orderController.cancelOrder,
);

router.post(
  "/:id/refund-request",
  protect,
  validateId,
  requestRefundRules,
  validate,
  orderController.createRefundRequest,
);

router.put(
  "/:id/refund",
  protect,
  validateId,
  updateRefundStatusRules,
  validate,
  orderController.updateRefundStatus,
);

router.post(
  "/:id/refund-override",
  protect,
  validateId,
  overrideRefundRules,
  validate,
  orderController.overrideRefund,
);

module.exports = router;
