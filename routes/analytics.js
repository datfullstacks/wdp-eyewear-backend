const express = require("express");
const analyticsController = require("../controllers/analyticsController");
const { protect, authorize } = require("../middlewares/auth");
const { BUSINESS_MANAGER_ROLES } = require("../helpers/roles");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Analytics
 *     description: Business analytics endpoints owned by manager role
 * /api/analytics/manager/overview:
 *   get:
 *     summary: Get manager business overview
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Manager overview returned successfully
 *       403:
 *         description: Only manager can access business analytics
 * /api/analytics/manager/revenue:
 *   get:
 *     summary: Get manager revenue summary
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Revenue summary returned successfully
 *       403:
 *         description: Only manager can access revenue analytics
 * /api/analytics/manager/products:
 *   get:
 *     summary: Get manager product and order cadence analytics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Product analytics returned successfully
 *       403:
 *         description: Only manager can access product analytics
 * /api/analytics/admin/refunds/overview:
 *   get:
 *     summary: Legacy refund analytics path retained for compatibility, manager-only
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Refund overview returned successfully
 *       403:
 *         description: System admin no longer owns business refund analytics
 * /api/analytics/admin/refunds/reconciliation:
 *   get:
 *     summary: Legacy refund reconciliation path retained for compatibility, manager-only
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Refund reconciliation returned successfully
 * /api/analytics/admin/refunds/reconciliation/export:
 *   get:
 *     summary: Legacy refund reconciliation export path retained for compatibility, manager-only
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Refund reconciliation CSV exported successfully
 * /api/analytics/admin/refunds/audit:
 *   get:
 *     summary: Legacy refund audit path retained for compatibility, manager-only
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Refund audit trail returned successfully
 */

router.use(protect);

router.get(
  "/manager/overview",
  authorize(...BUSINESS_MANAGER_ROLES),
  analyticsController.getManagerOverview,
);
router.get(
  "/manager/revenue",
  authorize(...BUSINESS_MANAGER_ROLES),
  analyticsController.getRevenueSummary,
);
router.get(
  "/manager/products",
  authorize(...BUSINESS_MANAGER_ROLES),
  analyticsController.getManagerProductAnalytics,
);
router.get(
  "/admin/refunds/overview",
  authorize(...BUSINESS_MANAGER_ROLES),
  analyticsController.getAdminRefundOverview,
);
router.get(
  "/admin/refunds/reconciliation",
  authorize(...BUSINESS_MANAGER_ROLES),
  analyticsController.getRefundReconciliation,
);
router.get(
  "/admin/refunds/reconciliation/export",
  authorize(...BUSINESS_MANAGER_ROLES),
  analyticsController.exportRefundReconciliation,
);
router.get(
  "/admin/refunds/audit",
  authorize(...BUSINESS_MANAGER_ROLES),
  analyticsController.getRefundAuditTrail,
);

module.exports = router;
