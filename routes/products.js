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
 *   - name: Products
 *     description: Product management endpoints
 * components:
 *   schemas:
 *     ProductVariant:
 *       type: object
 *       properties:
 *         sku:
 *           type: string
 *         barcode:
 *           type: string
 *         options:
 *           type: object
 *           properties:
 *             color:
 *               type: string
 *             size:
 *               type: string
 *         price:
 *           type: number
 *         stock:
 *           type: integer
 *         warehouseLocation:
 *           type: string
 *         assetIds:
 *           type: array
 *           items:
 *             type: string
 *     MediaAsset:
 *       type: object
 *       properties:
 *         assetType:
 *           type: string
 *           enum: ["2d", "3d"]
 *         role:
 *           type: string
 *           enum: [hero, gallery, thumbnail, lifestyle, try_on, viewer]
 *         url:
 *           type: string
 *         format:
 *           type: string
 *           enum: [glb, gltf, usdz]
 *         posterUrl:
 *           type: string
 *         order:
 *           type: integer
 *     PreOrder:
 *       type: object
 *       properties:
 *         enabled:
 *           type: boolean
 *         startAt:
 *           type: string
 *           format: date-time
 *         endAt:
 *           type: string
 *           format: date-time
 *         shipFrom:
 *           type: string
 *           format: date-time
 *         shipTo:
 *           type: string
 *           format: date-time
 *         depositPercent:
 *           type: number
 *         maxQuantityPerOrder:
 *           type: integer
 *         allowCod:
 *           type: boolean
 *         note:
 *           type: string
 *     ProductInput:
 *       type: object
 *       required: [name, type, brand, pricing, inventory]
 *       properties:
 *         name:
 *           type: string
 *         type:
 *           type: string
 *           enum: [sunglasses, frame, lens, contact_lens, accessory, service, bundle, gift_card, other]
 *         brand:
 *           type: string
 *         description:
 *           type: string
 *         pricing:
 *           type: object
 *           required: [currency, basePrice]
 *           properties:
 *             currency:
 *               type: string
 *               example: VND
 *             basePrice:
 *               type: number
 *             msrp:
 *               type: number
 *             salePrice:
 *               type: number
 *             discountPercent:
 *               type: number
 *             taxRate:
 *               type: number
 *         inventory:
 *           type: object
 *           required: [track]
 *           properties:
 *             track:
 *               type: boolean
 *             threshold:
 *               type: integer
 *         preOrder:
 *           $ref: '#/components/schemas/PreOrder'
 *         specs:
 *           type: object
 *           description: Type-specific specs (see product.md)
 *         variants:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ProductVariant'
 *         media:
 *           type: object
 *           properties:
 *             primaryAssetId:
 *               type: string
 *             assets:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/MediaAsset'
 *             tryOn:
 *               type: object
 *               properties:
 *                 enabled:
 *                   type: boolean
 *                 arUrl:
 *                   type: string
 *                 assetIds:
 *                   type: array
 *                   items:
 *                     type: string
 *         servicesIncluded:
 *           type: array
 *           items:
 *             type: string
 *         bundleIds:
 *           type: array
 *           items:
 *             type: string
 *     Product:
 *       allOf:
 *         - $ref: '#/components/schemas/ProductInput'
 *         - type: object
 *           properties:
 *             _id:
 *               type: string
 *             slug:
 *               type: string
 *             status:
 *               type: string
 *             preOrder:
 *               $ref: '#/components/schemas/PreOrder'
 *             ratingsAverage:
 *               type: number
 *             ratingsQuantity:
 *               type: integer
 *             createdAt:
 *               type: string
 *               format: date-time
 *             updatedAt:
 *               type: string
 *               format: date-time
 */

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: Get all products (Public)
 *     tags:
 *       - Products
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: number
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           example: "-createdAt"
 *     responses:
 *       200:
 *         description: List of products
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Products retrieved successfully
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Product'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 */
router.get('/', filterProductRules, validate, productController.getAllProducts);

/**
 * @swagger
 * /api/products/{id}:
 *   get:
 *     summary: Get product details
 *     tags:
 *       - Products
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Product details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Product'
 *       404:
 *         description: Product not found
 */
router.get('/:id', validateId, validate, productController.getProductById);

// --- Protected Routes (Admin/Manager/Operations) ---
router.use(protect);

/**
 * @swagger
 * /api/products:
 *   post:
 *     summary: Create new product (Admin/Manager/Ops only)
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProductInput'
 *           example:
 *             name: "K?nh Rayban Aviator"
 *             type: "sunglasses"
 *             brand: "Rayban"
 *             description: "K?nh m?t ki?u phi c?ng, ch?ng UV."
 *             pricing:
 *               currency: "VND"
 *               basePrice: 2500000
 *               salePrice: 2250000
 *               discountPercent: 10
 *             inventory:
 *               track: true
 *               threshold: 5
 *             preOrder:
 *               enabled: true
 *               startAt: "2026-02-01T00:00:00Z"
 *               endAt: "2026-02-10T23:59:59Z"
 *               shipFrom: "2026-02-20T00:00:00Z"
 *               shipTo: "2026-02-28T00:00:00Z"
 *               depositPercent: 20
 *               maxQuantityPerOrder: 2
 *               allowCod: false
 *               note: "Pre-order batch ships late Feb"
 *             specs:
 *               common:
 *                 shape: "aviator"
 *                 gender: "unisex"
 *               frame:
 *                 material: "acetate"
 *                 hingeType: "spring"
 *               lens:
 *                 uvProtection: "UV400"
 *                 polarized: true
 *                 tintColor: "smoke"
 *                 tintPercent: 85
 *             variants:
 *               - sku: "RB-AVT-BLK-M"
 *                 options:
 *                   color: "?en"
 *                   size: "M"
 *                 price: 2500000
 *                 stock: 10
 *             media:
 *               assets:
 *                 - assetType: "2d"
 *                   role: "hero"
 *                   url: "https://cdn.wdp-eyewear.com/products/rb-avt-hero.jpg"
 *                 - assetType: "3d"
 *                   role: "viewer"
 *                   url: "https://cdn.wdp-eyewear.com/products/rb-avt.glb"
 *                   format: "glb"
 *                   posterUrl: "https://cdn.wdp-eyewear.com/products/rb-avt-poster.jpg"
 *     responses:
 *       201:
 *         description: Product created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Product'
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
 *   put:
 *     summary: Update product
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProductInput'
 *     responses:
 *       200:
 *         description: Product updated
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
 *   delete:
 *     summary: Delete product (Admin only)
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Product deleted
 */
router.delete(
    '/:id', 
    authorize('admin'), 
    validateId, 
    validate, 
    productController.deleteProduct
);

module.exports = router;
