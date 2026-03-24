const { body, param } = require('express-validator');
const { ORDER_OPS_STAGE, ORDER_STATUS } = require('../constants');

const itemBaseRules = [
  body('items').isArray({ min: 1 }).withMessage('items is required'),
  body(['items.*.productId', 'items.*.product_id'])
    .notEmpty()
    .withMessage('productId is required'),
  body('items.*.quantity')
    .custom((value) => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= 1;
    })
    .withMessage('quantity must be integer >= 1'),
  body(['items.*.variantId', 'items.*.variant_id'])
    .optional({ nullable: true })
    .isString()
    .withMessage('variantId must be string'),
  body('items.*.customization').optional().isObject(),
  body('items.*.customization.selectedColor').optional().isString(),
  body('items.*.customization.selectedSize').optional().isString(),
  body('items.*.customization.photochromic').optional().isBoolean(),
  body('items.*.customization.note').optional().isString().isLength({ max: 500 }),
  body('items.*.customization.combineWith').optional().isObject(),
  body('items.*.customization.combineWith.productId').optional().isMongoId(),
  body('items.*.customization.combineWith.variantId').optional().isString(),
  body('items.*.customization.combineWith.note').optional().isString().isLength({ max: 500 }),
  body('items.*.customization.prescription').optional().isObject(),
  body('items.*.customization.prescription.mode')
    .optional()
    .isIn(['none', 'manual', 'upload'])
    .withMessage('prescription mode must be one of: none, manual, upload'),
  body('items.*.customization.prescription.isMyopic').optional().isBoolean(),
  body('items.*.customization.prescription.rightEye').optional().isObject(),
  body('items.*.customization.prescription.leftEye').optional().isObject(),
  body('items.*.customization.prescription.pd').optional().isString(),
  body('items.*.customization.prescription.note').optional().isString().isLength({ max: 500 }),
  body('items.*.customization.prescription.attachmentUrls').optional().isArray(),
  body('items.*.customization.prescription.attachmentUrls.*').optional().isURL()
];

exports.updateOrderItemsRules = [
  ...itemBaseRules,
  body(['shippingFee', 'shipping_fee']).optional().isFloat({ min: 0 }),
  body(['discountAmount', 'discount_amount']).optional().isFloat({ min: 0 }),
  body(['voucherCode', 'voucher_code']).optional().isString().isLength({ min: 1, max: 64 }),
  body(['shippingMethod', 'shipping_method']).optional().isIn(['standard', 'express']),
  body(['shippingAddress', 'shipping_address']).optional().isObject(),
  body(['shippingAddress.fullName', 'shipping_address.fullName']).optional().isString(),
  body(['shippingAddress.phone', 'shipping_address.phone']).optional().isString(),
  body(['shippingAddress.line1', 'shipping_address.line1']).optional().isString(),
  body(['shippingAddress.line2', 'shipping_address.line2']).optional().isString(),
  body(['shippingAddress.ward', 'shipping_address.ward']).optional().isString(),
  body(['shippingAddress.wardCode', 'shipping_address.wardCode', 'shippingAddress.ward_code', 'shipping_address.ward_code']).optional().isString(),
  body(['shippingAddress.district', 'shipping_address.district']).optional().isString(),
  body(['shippingAddress.districtId', 'shipping_address.districtId', 'shippingAddress.district_id', 'shipping_address.district_id']).optional().isInt({ min: 1 }),
  body(['shippingAddress.province', 'shipping_address.province']).optional().isString(),
  body(['shippingAddress.provinceId', 'shipping_address.provinceId', 'shippingAddress.province_id', 'shipping_address.province_id']).optional().isInt({ min: 1 }),
  body(['shippingAddress.country', 'shipping_address.country']).optional().isString(),
  body(['shippingAddress.note', 'shipping_address.note']).optional().isString().isLength({ max: 500 }),
  body('note').optional().isString().isLength({ max: 500 })
];

exports.patchOrderItemRules = [
  param('itemId')
    .isMongoId()
    .withMessage('Invalid itemId format'),
  body(['productId', 'product_id']).optional().isMongoId(),
  body(['variantId', 'variant_id']).optional({ nullable: true }).isString(),
  body('quantity')
    .optional()
    .custom((value) => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= 1;
    })
    .withMessage('quantity must be integer >= 1'),
  body('customization').optional().isObject(),
  body('customization.selectedColor').optional().isString(),
  body('customization.selectedSize').optional().isString(),
  body('customization.photochromic').optional().isBoolean(),
  body('customization.note').optional().isString().isLength({ max: 500 }),
  body('customization.combineWith').optional().isObject(),
  body('customization.combineWith.productId').optional().isMongoId(),
  body('customization.combineWith.variantId').optional().isString(),
  body('customization.combineWith.note').optional().isString().isLength({ max: 500 }),
  body('customization.prescription').optional().isObject(),
  body('customization.prescription.mode')
    .optional()
    .isIn(['none', 'manual', 'upload'])
    .withMessage('prescription mode must be one of: none, manual, upload'),
  body('customization.prescription.isMyopic').optional().isBoolean(),
  body('customization.prescription.rightEye').optional().isObject(),
  body('customization.prescription.leftEye').optional().isObject(),
  body('customization.prescription.pd').optional().isString(),
  body('customization.prescription.note').optional().isString().isLength({ max: 500 }),
  body('customization.prescription.attachmentUrls').optional().isArray(),
  body('customization.prescription.attachmentUrls.*').optional().isURL(),
  body('note').optional().isString().isLength({ max: 500 })
];

exports.cancelOrderRules = [
  body('reason').optional().isString().isLength({ max: 500 }),
  body('responsibility').optional().isIn(['customer', 'system', 'carrier', 'mixed']),
  body(['contactChannels', 'contact_channels']).optional().isArray(),
  body(['contactChannels.*', 'contact_channels.*'])
    .optional()
    .isIn(['email', 'phone']),
  body(['bankAccount', 'bank_account']).optional().isObject(),
  body(['bankAccount.bankName', 'bank_account.bankName']).optional().isString(),
  body(['bankAccount.accountNumber', 'bank_account.accountNumber']).optional().isString(),
  body(['bankAccount.accountHolder', 'bank_account.accountHolder']).optional().isString(),
  body(['bankAccount.note', 'bank_account.note']).optional().isString().isLength({ max: 500 })
];

exports.requestRefundRules = [
  body('reason').notEmpty().isString().isLength({ max: 500 }),
  body('reasonCode').optional().isString().isLength({ max: 100 }),
  body('requestShippingFee').optional().isBoolean(),
  body('customerPaidReturnShippingFee').optional().isFloat({ min: 0 }),
  body('responsibility').optional().isIn(['customer', 'system', 'carrier', 'mixed']),
  body('requiresReturn').optional().isBoolean(),
  body('note').optional().isString().isLength({ max: 500 }),
  body(['bankAccount', 'bank_account']).optional().isObject(),
  body(['bankAccount.bankName', 'bank_account.bankName']).optional().isString(),
  body(['bankAccount.accountNumber', 'bank_account.accountNumber']).optional().isString(),
  body(['bankAccount.accountHolder', 'bank_account.accountHolder']).optional().isString(),
  body(['bankAccount.note', 'bank_account.note']).optional().isString().isLength({ max: 500 }),
  body(['requestedBreakdown', 'requested_breakdown']).optional().isObject(),
  body([
    'requestedBreakdown.itemAmount',
    'requested_breakdown.itemAmount',
    'requestedBreakdown.shippingFeeAmount',
    'requested_breakdown.shippingFeeAmount',
    'requestedBreakdown.returnShippingFeeAmount',
    'requested_breakdown.returnShippingFeeAmount',
  ])
    .optional()
    .isFloat({ min: 0 }),
  body('evidence').optional().isArray({ max: 6 }),
  body('evidence.*').optional().isURL(),
];

exports.updateRefundStatusRules = [
  body().custom((_, { req }) => {
    const action = String(req.body?.action || '').trim();
    const status = String(req.body?.status || '').trim();
    const allowedActions = [
      'start_review',
      'customer_submit_info',
      'request_customer_info',
      'approve',
      'reject',
      'escalate',
      'manager_approve',
      'manager_reject',
      'send_back_to_staff',
      'mark_return_pending',
      'confirm_return_received',
      'inspection_failed',
      'start_processing',
      'complete',
    ];
    const allowedStatuses = [
      'reviewing',
      'waiting_customer_info',
      'approved',
      'escalated_to_manager',
      'return_pending',
      'return_received',
      'processing',
      'completed',
      'rejected',
    ];

    if (!action && !status) {
      throw new Error('action or status is required');
    }

    if (action && !allowedActions.includes(action)) {
      throw new Error(`action must be one of: ${allowedActions.join(', ')}`);
    }

    if (status && !allowedStatuses.includes(status)) {
      throw new Error(`status must be one of: ${allowedStatuses.join(', ')}`);
    }

    return true;
  }),
  body('contactNote').optional().isString().isLength({ max: 500 }),
  body(['contactChannels', 'contact_channels']).optional().isArray(),
  body(['contactChannels.*', 'contact_channels.*'])
    .optional()
    .isIn(['email', 'phone']),
  body('reason').optional().isString().isLength({ max: 500 }),
  body('reasonCode').optional().isString().isLength({ max: 100 }),
  body('requestShippingFee').optional().isBoolean(),
  body('customerPaidReturnShippingFee').optional().isFloat({ min: 0 }),
  body('rejectReason').optional().isString().isLength({ max: 500 }),
  body('escalateReason').optional().isString().isLength({ max: 500 }),
  body('responsibility').optional().isIn(['customer', 'system', 'carrier', 'mixed']),
  body('requiresReturn').optional().isBoolean(),
  body('decisionNote').optional().isString().isLength({ max: 500 }),
  body('note').optional().isString().isLength({ max: 500 }),
  body('transactionRef').optional().isString().isLength({ max: 200 }),
  body('payoutProofUrl').optional({ checkFalsy: true }).isURL(),
  body('inspectionNote').optional().isString().isLength({ max: 500 }),
  body('returnShipmentCode').optional().isString().isLength({ max: 120 }),
  body('returnCarrier').optional().isString().isLength({ max: 80 }),
  body(['bankAccount', 'bank_account']).optional().isObject(),
  body(['bankAccount.bankName', 'bank_account.bankName']).optional().isString(),
  body(['bankAccount.accountNumber', 'bank_account.accountNumber']).optional().isString(),
  body(['bankAccount.accountHolder', 'bank_account.accountHolder']).optional().isString(),
  body(['bankAccount.note', 'bank_account.note']).optional().isString().isLength({ max: 500 }),
  body(['requestedBreakdown', 'requested_breakdown']).optional().isObject(),
  body([
    'requestedBreakdown.itemAmount',
    'requested_breakdown.itemAmount',
    'requestedBreakdown.shippingFeeAmount',
    'requested_breakdown.shippingFeeAmount',
    'requestedBreakdown.returnShippingFeeAmount',
    'requested_breakdown.returnShippingFeeAmount',
  ])
    .optional()
    .isFloat({ min: 0 }),
  body(['approvedBreakdown', 'approved_breakdown']).optional().isObject(),
  body([
    'approvedBreakdown.itemAmount',
    'approved_breakdown.itemAmount',
    'approvedBreakdown.shippingFeeAmount',
    'approved_breakdown.shippingFeeAmount',
    'approvedBreakdown.returnShippingFeeAmount',
    'approved_breakdown.returnShippingFeeAmount',
  ])
    .optional()
    .isFloat({ min: 0 }),
  body('evidence').optional().isArray({ max: 6 }),
  body('evidence.*').optional().isURL(),
];

exports.overrideRefundRules = [
  body('action')
    .notEmpty()
    .isIn([
      'reassign_sales',
      'reassign_manager',
      'reassign_operations',
      'reset_reviewing',
      'retry_customer_notification',
    ]),
  body('reason').notEmpty().isString().isLength({ max: 500 }),
];

exports.updateOrderStatusRules = [
  body('status')
    .notEmpty()
    .isIn(Object.values(ORDER_STATUS))
    .withMessage(`status must be one of: ${Object.values(ORDER_STATUS).join(', ')}`)
];

exports.updateOrderOpsStageRules = [
  body().custom((_, { req }) => {
    const rawOpsStage = req.body?.opsStage ?? req.body?.ops_stage;
    const opsStage = typeof rawOpsStage === 'string' ? rawOpsStage.trim() : rawOpsStage;

    if (!opsStage) {
      throw new Error('opsStage is required');
    }

    if (!Object.values(ORDER_OPS_STAGE).includes(opsStage)) {
      throw new Error(
        `opsStage must be one of: ${Object.values(ORDER_OPS_STAGE).join(', ')}`
      );
    }

    return true;
  })
];

exports.updateOrderOpsExecutionRules = [
  body().isObject().withMessage('ops execution payload must be an object'),
  body('assignee').optional({ nullable: true }).isString().isLength({ max: 120 }),
  body('salesApprovedBy')
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 120 }),
  body('salesHandoffNote')
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 1000 }),
  body('approvalState')
    .optional({ nullable: true })
    .isIn(['none', 'manager_review_requested', 'sent_back_to_sale']),
  body('managerReviewRequestedAt')
    .optional({ nullable: true })
    .isISO8601(),
  body('managerReviewRequestedBy')
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 120 }),
  body('managerReviewReason')
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 1000 }),
  body('internalNote')
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 1000 }),
  body('holdReason')
    .optional({ nullable: true })
    .isIn(['payment', 'address', 'stock', 'manual', 'other', '', null]),
  body('holdNote').optional({ nullable: true }).isString().isLength({ max: 500 }),
  body('paymentFailed').optional({ nullable: true }).isBoolean(),
  body('carrierId').optional({ nullable: true }).isString().isLength({ max: 40 }),
  body('trackingCode')
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 120 }),
  body('issueType')
    .optional({ nullable: true })
    .isIn([
      'out_of_stock',
      'wrong_sku',
      'damaged_item',
      'address_issue',
      'shipping_label_error',
      'other',
      '',
      null,
    ]),
  body('issueNote').optional({ nullable: true }).isString().isLength({ max: 500 }),
  body('checklist').optional({ nullable: true }).isObject(),
  body('itemStates').optional({ nullable: true }).isObject(),
];

exports.updateShipmentTestStatusRules = [
  body('status')
    .notEmpty()
    .isIn(['ready_to_pick', 'picking', 'transporting', 'delivered', 'returned'])
    .withMessage(
      'status must be one of: ready_to_pick, picking, transporting, delivered, returned'
    )
];
