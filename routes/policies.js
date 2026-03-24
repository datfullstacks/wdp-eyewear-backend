const express = require("express");
const policyController = require("../controllers/policyController");
const { protect, authorize } = require("../middlewares/auth");
const { validate, validateId } = require("../middlewares/validator");
const { POLICY_GOVERNANCE_ROLES } = require("../helpers/roles");
const {
  createPolicyRules,
  updatePolicyRules,
} = require("../validators/policyValidator");

const router = express.Router();

router.use(protect);

router.get("/", authorize(...POLICY_GOVERNANCE_ROLES), policyController.listPolicies);
router.post(
  "/",
  authorize(...POLICY_GOVERNANCE_ROLES),
  createPolicyRules,
  validate,
  policyController.createPolicy,
);
router.get(
  "/:id",
  authorize(...POLICY_GOVERNANCE_ROLES),
  validateId,
  validate,
  policyController.getPolicyById,
);
router.put(
  "/:id",
  authorize(...POLICY_GOVERNANCE_ROLES),
  validateId,
  updatePolicyRules,
  validate,
  policyController.updatePolicy,
);
router.delete(
  "/:id",
  authorize(...POLICY_GOVERNANCE_ROLES),
  validateId,
  validate,
  policyController.deletePolicy,
);

module.exports = router;
