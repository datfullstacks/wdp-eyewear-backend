const Product = require('../models/Product');
const AppError = require('../errors/AppError');

class ProductService {
    // Create
    async createProduct(productData) {
        // Tạo slug đơn giản từ name (hoặc dùng thư viện slugify nếu muốn chuẩn hơn)
        if (!productData.slug) {
            productData.slug = productData.name.toLowerCase().split(' ').join('-');
        }
        
        const product = await Product.create(productData);
        return product;
    }

    // Get All with Filter, Sort, Pagination
    async getAllProducts(page = 1, limit = 10, filters = {}, sort = '-createdAt') {
        const skip = (page - 1) * limit;
        const queryObj = {};

        // Filtering
        if (filters.search) {
            queryObj.$text = { $search: filters.search };
        }
        if (filters.type) queryObj.type = filters.type;
        if (filters.brand) queryObj.brand = filters.brand;
        if (filters.status) queryObj.status = filters.status;
        
        // Price Range
        if (filters.minPrice || filters.maxPrice) {
            queryObj.basePrice = {};
            if (filters.minPrice) queryObj.basePrice.$gte = Number(filters.minPrice);
            if (filters.maxPrice) queryObj.basePrice.$lte = Number(filters.maxPrice);
        }

        const [products, total] = await Promise.all([
            Product.find(queryObj)
                .sort(sort)
                .skip(skip)
                .limit(limit),
            Product.countDocuments(queryObj)
        ]);

        return {
            products,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    // Get One by ID
    async getProductById(id) {
        const product = await Product.findById(id);
        if (!product) {
            throw new AppError('Product not found', 404);
        }
        return product;
    }

    // Update
    async updateProduct(id, updateData) {
        const product = await Product.findByIdAndUpdate(id, updateData, {
            new: true,
            runValidators: true
        });
        if (!product) {
            throw new AppError('Product not found', 404);
        }
        return product;
    }

    // Delete (Soft delete logic thường tốt hơn, nhưng ở đây làm hard delete theo CRUD)
    async deleteProduct(id) {
        const product = await Product.findByIdAndDelete(id);
        if (!product) {
            throw new AppError('Product not found', 404);
        }
        return null;
    }
}

module.exports = new ProductService();