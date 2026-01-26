const productService = require('../services/productService');
const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/response');

exports.createProduct = asyncHandler(async (req, res) => {
    const product = await productService.createProduct(req.body);
    ApiResponse.created(res, product, 'Product created successfully');
});

exports.getAllProducts = asyncHandler(async (req, res) => {
    const { page, limit, search, type, brand, status, minPrice, maxPrice, sort } = req.query;
    
    const result = await productService.getAllProducts(
        parseInt(page) || 1,
        parseInt(limit) || 10,
        { search, type, brand, status, minPrice, maxPrice },
        sort
    );
    
    ApiResponse.paginate(res, result.products, result.pagination, 'Products retrieved successfully');
});

exports.getProductById = asyncHandler(async (req, res) => {
    const product = await productService.getProductById(req.params.id);
    ApiResponse.success(res, product);
});

exports.updateProduct = asyncHandler(async (req, res) => {
    const product = await productService.updateProduct(req.params.id, req.body);
    ApiResponse.success(res, product, 'Product updated successfully');
});

exports.deleteProduct = asyncHandler(async (req, res) => {
    await productService.deleteProduct(req.params.id);
    ApiResponse.success(res, null, 'Product deleted successfully');
});