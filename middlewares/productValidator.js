const { body, query } = require('express-validator');
const { PRODUCT_TYPES } = require('../config/constants');

exports.createProductRules = [
    body('name').notEmpty().withMessage('Product name is required'),
    body('type').isIn(Object.values(PRODUCT_TYPES)).withMessage('Invalid product type'),
    body('brand').notEmpty().withMessage('Brand is required'),
    body('basePrice').isFloat({ min: 0 }).withMessage('Base price must be a positive number'),
    body('variants').isArray({ min: 1 }).withMessage('At least one variant is required'),
    body('variants.*.color').notEmpty().withMessage('Variant color is required'),
    body('variants.*.stock').isInt({ min: 0 }).withMessage('Stock must be a positive integer')
];

exports.updateProductRules = [
    body('name').optional().notEmpty(),
    body('basePrice').optional().isFloat({ min: 0 }),
    body('status').optional().isIn(['active', 'inactive', 'out_of_stock'])
];

exports.filterProductRules = [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('minPrice').optional().isFloat({ min: 0 }),
    query('maxPrice').optional().isFloat({ min: 0 })
];