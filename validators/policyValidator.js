const { body } = require("express-validator");
const { POLICY_CATEGORIES, POLICY_STATUSES } = require("../models/Policy");

const basePolicyRules = [
  body("title")
    .optional({ nullable: false })
    .isString()
    .trim()
    .notEmpty()
    .withMessage("title is required"),
  body("category")
    .optional({ nullable: false })
    .isIn(POLICY_CATEGORIES)
    .withMessage("category is invalid"),
  body("summary")
    .optional({ nullable: false })
    .isString()
    .trim()
    .notEmpty()
    .withMessage("summary is required"),
  body("content")
    .optional({ nullable: false })
    .isString()
    .trim()
    .notEmpty()
    .withMessage("content is required"),
  body("effectiveDate")
    .optional({ nullable: false })
    .isISO8601()
    .withMessage("effectiveDate must be a valid date"),
  body("expiryDate")
    .optional({ nullable: true, checkFalsy: true })
    .isISO8601()
    .withMessage("expiryDate must be a valid date"),
  body("status")
    .optional({ nullable: false })
    .isIn(POLICY_STATUSES)
    .withMessage("status is invalid"),
  body("version")
    .optional({ nullable: false })
    .isString()
    .trim()
    .notEmpty()
    .withMessage("version is required"),
];

exports.createPolicyRules = [
  body("title").exists({ checkFalsy: true }),
  body("category").exists({ checkFalsy: true }),
  body("summary").exists({ checkFalsy: true }),
  body("content").exists({ checkFalsy: true }),
  body("effectiveDate").exists({ checkFalsy: true }),
  ...basePolicyRules,
];

exports.updatePolicyRules = basePolicyRules;
