const express = require("express");
const analyticsController = require("../controllers/analyticsController");
const { protect, authorize } = require("../middlewares/auth");

const router = express.Router();

router.use(protect);

router.get(
  "/manager/overview",
  authorize("manager", "admin"),
  analyticsController.getManagerOverview,
);
router.get(
  "/manager/revenue",
  authorize("manager", "admin"),
  analyticsController.getRevenueSummary,
);
router.get(
  "/admin/refunds/overview",
  authorize("admin"),
  analyticsController.getAdminRefundOverview,
);
router.get(
  "/admin/refunds/reconciliation",
  authorize("admin"),
  analyticsController.getRefundReconciliation,
);
router.get(
  "/admin/refunds/reconciliation/export",
  authorize("admin"),
  analyticsController.exportRefundReconciliation,
);
router.get(
  "/admin/refunds/audit",
  authorize("admin"),
  analyticsController.getRefundAuditTrail,
);

module.exports = router;
