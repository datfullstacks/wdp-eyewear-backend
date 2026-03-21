const { body, param, query } = require('express-validator');

exports.createUserRules = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required'),
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters'),
  body('role')
    .notEmpty()
    .withMessage('Role is required')
    .bail()
    .isIn(['customer', 'sales', 'operations', 'manager', 'admin'])
    .withMessage('Invalid role'),
  body('phone')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Phone cannot exceed 50 characters'),
  body('department')
    .optional()
    .trim()
    .isLength({ max: 120 })
    .withMessage('Department cannot exceed 120 characters'),
  body('position')
    .optional()
    .trim()
    .isLength({ max: 120 })
    .withMessage('Position cannot exceed 120 characters'),
  body('permissions')
    .optional()
    .isArray()
    .withMessage('permissions must be an array'),
  body('permissions.*')
    .optional()
    .isString()
    .withMessage('Each permission must be a string'),
  body('storeAccess')
    .optional()
    .isObject()
    .withMessage('storeAccess must be an object'),
  body('storeAccess.mode')
    .optional()
    .isIn(['all', 'selected'])
    .withMessage('storeAccess.mode must be all or selected'),
  body('storeAccess.primaryStoreId')
    .optional({ nullable: true, checkFalsy: true })
    .isMongoId()
    .withMessage('storeAccess.primaryStoreId must be a valid id'),
  body('storeAccess.storeIds')
    .optional()
    .isArray()
    .withMessage('storeAccess.storeIds must be an array'),
  body('storeAccess.storeIds.*')
    .optional()
    .isMongoId()
    .withMessage('Each storeAccess.storeIds entry must be a valid id'),
  body('storeAccess.note')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('storeAccess.note cannot exceed 500 characters')
];

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
    .withMessage('Invalid role'),
  body('phone')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Phone cannot exceed 50 characters'),
  body('department')
    .optional()
    .trim()
    .isLength({ max: 120 })
    .withMessage('Department cannot exceed 120 characters'),
  body('position')
    .optional()
    .trim()
    .isLength({ max: 120 })
    .withMessage('Position cannot exceed 120 characters'),
  body('permissions')
    .optional()
    .isArray()
    .withMessage('permissions must be an array'),
  body('permissions.*')
    .optional()
    .isString()
    .withMessage('Each permission must be a string'),
  body('storeAccess')
    .optional()
    .isObject()
    .withMessage('storeAccess must be an object'),
  body('storeAccess.mode')
    .optional()
    .isIn(['all', 'selected'])
    .withMessage('storeAccess.mode must be all or selected'),
  body('storeAccess.primaryStoreId')
    .optional({ nullable: true, checkFalsy: true })
    .isMongoId()
    .withMessage('storeAccess.primaryStoreId must be a valid id'),
  body('storeAccess.storeIds')
    .optional()
    .isArray()
    .withMessage('storeAccess.storeIds must be an array'),
  body('storeAccess.storeIds.*')
    .optional()
    .isMongoId()
    .withMessage('Each storeAccess.storeIds entry must be a valid id'),
  body('storeAccess.note')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('storeAccess.note cannot exceed 500 characters')
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
