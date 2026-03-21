const express = require("express");
const systemConfigController = require("../controllers/systemConfigController");
const { protect, authorize } = require("../middlewares/auth");

const router = express.Router();

router.use(protect);
router.use(authorize("admin"));

router.get("/", systemConfigController.getSystemConfig);
router.put("/", systemConfigController.updateSystemConfig);

module.exports = router;
