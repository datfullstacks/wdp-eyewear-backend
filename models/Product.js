const mongoose = require('mongoose');
const { PRODUCT_TYPES, PRODUCT_STATUS } = require('../constants');

const productSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    slug: { // Dùng cho SEO URL (ví dụ: kinh-ram-rayban-x1)
        type: String,
        slug: 'name',
        unique: true,
        lowercase: true
    },
    description: {
        type: String
    },
    type: {
        type: String,
        enum: Object.values(PRODUCT_TYPES),
        required: true
    },
    brand: {
        type: String,
        required: true
    },
    basePrice: {
        type: Number,
        required: true,
        min: 0
    },
    // Thông số kỹ thuật chung (chất liệu, kiểu dáng...)
    specs: {
        material: String, // Nhựa, Kim loại...
        shape: String,    // Tròn, Vuông, Mắt mèo...
        gender: { type: String, enum: ['men', 'women', 'unisex', 'kids'] },
        lensType: String  // Chỉ dùng cho tròng kính (Chống UV, Đổi màu...)
    },
    // Các biến thể (Màu đen size M, Màu vàng size L...)
    variants: [{
        sku: String,
        color: String,
        size: String,
        price: Number, // Giá riêng nếu khác basePrice
        stock: {
            type: Number,
            default: 0
        },
        images: [String] // URL ảnh
    }],
    status: {
        type: String,
        enum: Object.values(PRODUCT_STATUS),
        default: PRODUCT_STATUS.ACTIVE
    },
    ratingsAverage: {
        type: Number,
        default: 4.5,
        min: 1,
        max: 5,
        set: val => Math.round(val * 10) / 10
    },
    ratingsQuantity: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Index để tìm kiếm nhanh
productSchema.index({ name: 'text', description: 'text', brand: 'text' });
productSchema.index({ basePrice: 1, ratingsAverage: -1 });

module.exports = mongoose.model('Product', productSchema);
