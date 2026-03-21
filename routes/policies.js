const express = require("express");
const policyController = require("../controllers/policyController");
const { protect, authorize } = require("../middlewares/auth");
const { validate, validateId } = require("../middlewares/validator");
const {
  createPolicyRules,
  updatePolicyRules,
} = require("../validators/policyValidator");

const router = express.Router();

router.use(protect);

router.get("/", authorize("manager", "admin"), policyController.listPolicies);
router.post(
  "/",
  authorize("manager", "admin"),
  createPolicyRules,
  validate,
  policyController.createPolicy,
);
router.get(
  "/:id",
  authorize("manager", "admin"),
  validateId,
  validate,
  policyController.getPolicyById,
);
router.put(
  "/:id",
  authorize("manager", "admin"),
  validateId,
  updatePolicyRules,
  validate,
  policyController.updatePolicy,
);
router.delete(
  "/:id",
  authorize("manager", "admin"),
  validateId,
  validate,
  policyController.deletePolicy,
);

module.exports = router;
