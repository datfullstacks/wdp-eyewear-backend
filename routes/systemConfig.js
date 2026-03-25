const express = require("express");
const systemConfigController = require("../controllers/systemConfigController");
const { protect, authorize } = require("../middlewares/auth");
const { SYSTEM_ADMIN_ROLES } = require("../helpers/roles");

const router = express.Router();

router.get("/runtime", systemConfigController.getRuntimeSystemConfig);

router.use(protect);
router.use(authorize(...SYSTEM_ADMIN_ROLES));

router.get("/", systemConfigController.getSystemConfig);
router.put("/", systemConfigController.updateSystemConfig);

module.exports = router;
