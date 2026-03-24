const { body, query } = require("express-validator");

const {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_STATUSES,
} = require("../models/SupportTicket");

const WARRANTY_ELIGIBILITY = ["eligible", "expired", "not_covered"];
const SUPPORT_PRIORITIES = ["low", "normal", "high"];

exports.listSupportTicketRules = [
  query("page").optional().isInt({ min: 1 }).withMessage("page must be >= 1"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit must be between 1 and 100"),
  query("q")
    .optional({ checkFalsy: true })
    .isString()
    .isLength({ max: 200 })
    .withMessage("q cannot exceed 200 characters"),
  query("status")
    .optional()
    .isIn(SUPPORT_TICKET_STATUSES)
    .withMessage(`status must be one of: ${SUPPORT_TICKET_STATUSES.join(", ")}`),
  query("category")
    .optional()
    .isIn(SUPPORT_TICKET_CATEGORIES)
    .withMessage(`category must be one of: ${SUPPORT_TICKET_CATEGORIES.join(", ")}`),
  query("eligibility")
    .optional()
    .isIn(WARRANTY_ELIGIBILITY)
    .withMessage(`eligibility must be one of: ${WARRANTY_ELIGIBILITY.join(", ")}`),
  query("userId")
    .optional()
    .isMongoId()
    .withMessage("userId must be a valid Mongo ID"),
  query("orderId")
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage("orderId must be a valid Mongo ID"),
];

exports.createSupportTicketRules = [
  body("subject")
    .trim()
    .notEmpty()
    .withMessage("subject is required")
    .isLength({ max: 200 })
    .withMessage("subject cannot exceed 200 characters"),
  body("message")
    .trim()
    .notEmpty()
    .withMessage("message is required")
    .isLength({ max: 5000 })
    .withMessage("message cannot exceed 5000 characters"),
  body("email")
    .optional({ checkFalsy: true })
    .isEmail()
    .withMessage("email must be valid"),
  body("category")
    .optional()
    .isIn(SUPPORT_TICKET_CATEGORIES)
    .withMessage(`category must be one of: ${SUPPORT_TICKET_CATEGORIES.join(", ")}`),
  body("priority")
    .optional()
    .isIn(SUPPORT_PRIORITIES)
    .withMessage(`priority must be one of: ${SUPPORT_PRIORITIES.join(", ")}`),
  body(["orderId", "order_id"])
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage("orderId must be a valid Mongo ID"),
  body(["orderItemId", "order_item_id"])
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage("orderItemId must be a valid Mongo ID"),
  body(["storeId", "store_id"])
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage("storeId must be a valid Mongo ID"),
  body().custom((_, { req }) => {
    const category = String(req.body?.category || "general").trim().toLowerCase();
    if (category !== "warranty") {
      return true;
    }

    const orderId = String(req.body?.orderId || req.body?.order_id || "").trim();
    const orderItemId = String(
      req.body?.orderItemId || req.body?.order_item_id || "",
    ).trim();

    if (!orderId) {
      throw new Error("orderId is required for warranty tickets");
    }

    if (!orderItemId) {
      throw new Error("orderItemId is required for warranty tickets");
    }

    return true;
  }),
];

exports.replySupportTicketRules = [
  body("message")
    .trim()
    .notEmpty()
    .withMessage("message is required")
    .isLength({ max: 5000 })
    .withMessage("message cannot exceed 5000 characters"),
];

exports.updateSupportTicketStatusRules = [
  body("status")
    .trim()
    .notEmpty()
    .withMessage("status is required")
    .isIn(SUPPORT_TICKET_STATUSES)
    .withMessage(`status must be one of: ${SUPPORT_TICKET_STATUSES.join(", ")}`),
  body("decisionNote")
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage("decisionNote cannot exceed 500 characters"),
  body("serviceNote")
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage("serviceNote cannot exceed 500 characters"),
  body("note")
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage("note cannot exceed 500 characters"),
];
