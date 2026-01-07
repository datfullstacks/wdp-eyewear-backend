const { body, param, query } = require('express-validator');

// User update validation
exports.updateUserRules = [
  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Name cannot be empty'),
  body('email')
    .optional()
    .isEmail()
    .withMessage('Please provide a valid email'),
  body('role')
    .optional()
    .isIn(['customer', 'sales', 'operations', 'manager', 'admin'])
    .withMessage('Invalid role')
];

// ID param validation
exports.validateId = [
  param('id').isMongoId().withMessage('Invalid ID format')
];

// Pagination validation
exports.paginationRules = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
];

// Change password validation
exports.changePasswordRules = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters')
];
