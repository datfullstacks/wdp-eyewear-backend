const express = require("express");
const policyController = require("../controllers/policyController");
const { protect, authorize } = require("../middlewares/auth");
const {
  enforceManagerPolicyEditorEnabled,
} = require("../middlewares/runtimeSystemConfig");
const { validate, validateId } = require("../middlewares/validator");
const { POLICY_GOVERNANCE_ROLES } = require("../helpers/roles");
const {
  createPolicyRules,
  updatePolicyRules,
} = require("../validators/policyValidator");

const router = express.Router();

router.use(protect);
router.use(authorize(...POLICY_GOVERNANCE_ROLES));
router.use(enforceManagerPolicyEditorEnabled);

router.get("/", policyController.listPolicies);
router.post(
  "/",
  createPolicyRules,
  validate,
  policyController.createPolicy,
);
router.get(
  "/:id",
  validateId,
  validate,
  policyController.getPolicyById,
);
router.put(
  "/:id",
  validateId,
  updatePolicyRules,
  validate,
  policyController.updatePolicy,
);
router.delete(
  "/:id",
  validateId,
  validate,
  policyController.deletePolicy,
);

module.exports = router;
