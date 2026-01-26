const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { protect, authorize } = require('../middlewares/auth');
const { validate, validateId } = require('../middlewares/validator');
const { 
    createProductRules, 
    updateProductRules, 
    filterProductRules 
} = require('../middlewares/productValidator');
/**
 * @swagger
 * tags:
 * name: Products
 * description: Product management endpoints
 */

/**
 * @swagger
 * /api/products:
 * get:
 * summary: Get all products (Public)
 * tags: [Products]
 * parameters:
 * - in: query
 * name: page
 * schema:
 * type: integer
 * - in: query
 * name: limit
 * schema:
 * type: integer
 * - in: query
 * name: search
 * schema:
 * type: string
 * - in: query
 * name: type
 * schema:
 * type: string
 * enum: [frame, lens, sunglasses, accessories]
 * responses:
 * 200:
 * description: List of products
 */
router.get('/', filterProductRules, validate, productController.getAllProducts);

/**
 * @swagger
 * /api/products/{id}:
 * get:
 * summary: Get product details
 * tags: [Products]
 * parameters:
 * - in: path
 * name: id
 * required: true
 * schema:
 * type: string
 * responses:
 * 200:
 * description: Product details
 * 404:
 * description: Product not found
 */
router.get('/:id', validateId, validate, productController.getProductById);

// --- Protected Routes (Admin/Manager/Operations) ---
router.use(protect);

/**
 * @swagger
 * /api/products:
 * post:
 * summary: Create new product (Admin/Manager/Ops only)
 * tags: [Products]
 * security:
 * - bearerAuth: []
 * requestBody:
 * required: true
 * content:
 * application/json:
 * schema:
 * type: object
 * required:
 * - name
 * - type
 * - basePrice
 * properties:
 * name:
 * type: string
 * type:
 * type: string
 * basePrice:
 * type: number
 * responses:
 * 201:
 * description: Product created
 */
router.post(
    '/', 
    authorize('admin', 'manager', 'operations'), 
    createProductRules, 
    validate, 
    productController.createProduct
);

/**
 * @swagger
 * /api/products/{id}:
 * put:
 * summary: Update product
 * tags: [Products]
 * security:
 * - bearerAuth: []
 * parameters:
 * - in: path
 * name: id
 * required: true
 * responses:
 * 200:
 * description: Product updated
 */
router.put(
    '/:id', 
    authorize('admin', 'manager', 'operations'), 
    validateId, 
    updateProductRules, 
    validate, 
    productController.updateProduct
);

/**
 * @swagger
 * /api/products/{id}:
 * delete:
 * summary: Delete product (Admin only)
 * tags: [Products]
 * security:
 * - bearerAuth: []
 * parameters:
 * - in: path
 * name: id
 * required: true
 * responses:
 * 200:
 * description: Product deleted
 */
router.delete(
    '/:id', 
    authorize('admin'), 
    validateId, 
    validate, 
    productController.deleteProduct
);

module.exports = router;