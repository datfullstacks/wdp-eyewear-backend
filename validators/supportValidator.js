const { body, query } = require("express-validator");

const {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_STATUSES,
  SUPPORT_TICKET_OWNER_ROLES,
  SUPPORT_ATTACHMENT_TYPES,
} = require("../models/SupportTicket");

const WARRANTY_ELIGIBILITY = ["eligible", "expired", "not_covered"];
const SUPPORT_PRIORITIES = ["low", "normal", "high"];
const MAX_SUPPORT_ATTACHMENTS = 6;
const AFTER_SALES_EVIDENCE_REQUIRED_CATEGORIES = new Set([
  "order",
  "refund",
  "return",
  "warranty",
]);
const SUPPORT_ATTACHMENT_TYPE_SET = new Set(SUPPORT_ATTACHMENT_TYPES);

function toTrimmedString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (error) {
    return false;
  }
}

function getAttachmentItems(bodyValue = {}) {
  return Array.isArray(bodyValue?.attachments)
    ? bodyValue.attachments.filter(
        (item) => item !== undefined && item !== null && item !== "",
      )
    : [];
}

function validateSupportAttachmentItem(value) {
  if (typeof value === "string") {
    if (!isHttpUrl(value)) {
      throw new Error("attachments items must be valid URLs");
    }
    return true;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("attachments items must be objects");
  }

  const url = toTrimmedString(value.url || value.uri || value.publicUrl, "");
  if (!isHttpUrl(url)) {
    throw new Error("attachments items must include a valid url");
  }

  const type = toTrimmedString(
    value.type || value.kind || value.mediaType,
    "",
  ).toLowerCase();
  if (type && !SUPPORT_ATTACHMENT_TYPE_SET.has(type)) {
    throw new Error(
      `attachments items type must be one of: ${SUPPORT_ATTACHMENT_TYPES.join(", ")}`,
    );
  }

  const mimeType = toTrimmedString(
    value.mimeType || value.contentType || value.mimetype,
    "",
  ).toLowerCase();
  if (mimeType && !mimeType.startsWith("image/") && !mimeType.startsWith("video/")) {
    throw new Error("attachments items mimeType must be image/* or video/*");
  }

  if (value.size !== undefined && value.size !== null && value.size !== "") {
    const size = Number(value.size);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error("attachments items size must be a positive number");
    }
  }

  return true;
}

function requiresAfterSalesEvidence(bodyValue = {}) {
  const category = toTrimmedString(bodyValue?.category, "general").toLowerCase();
  const orderId = toTrimmedString(bodyValue?.orderId || bodyValue?.order_id, "");
  return Boolean(orderId) && AFTER_SALES_EVIDENCE_REQUIRED_CATEGORIES.has(category);
}

const supportAttachmentRules = [
  body("attachments")
    .optional()
    .isArray({ max: MAX_SUPPORT_ATTACHMENTS })
    .withMessage(
      `attachments must be an array of up to ${MAX_SUPPORT_ATTACHMENTS} items`,
    ),
  body("attachments.*").custom(validateSupportAttachmentItem),
];

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
  query("ownerRole")
    .optional({ checkFalsy: true })
    .isIn(SUPPORT_TICKET_OWNER_ROLES)
    .withMessage(`ownerRole must be one of: ${SUPPORT_TICKET_OWNER_ROLES.join(", ")}`),
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
  ...supportAttachmentRules,
  body().custom((_, { req }) => {
    const category = String(req.body?.category || "general").trim().toLowerCase();
    if (category !== "warranty") {
      if (
        requiresAfterSalesEvidence(req.body) &&
        getAttachmentItems(req.body).length === 0
      ) {
        throw new Error(
          "At least one image or video is required for after-sales support tickets",
        );
      }
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
    if (getAttachmentItems(req.body).length === 0) {
      throw new Error(
        "At least one image or video is required for after-sales support tickets",
      );
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
  ...supportAttachmentRules,
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
