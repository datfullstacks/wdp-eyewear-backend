const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
    label: {
        type: String,
        default: ''
    },
    fullName: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        required: true
    },
    email: {
        type: String,
        default: ''
    },
    line1: {
        type: String,
        required: true
    },
    line2: {
        type: String,
        default: ''
    },
    ward: {
        type: String,
        default: ''
    },
    district: {
        type: String,
        required: true
    },
    province: {
        type: String,
        required: true
    },
    country: {
        type: String,
        default: 'VN'
    },
    note: {
        type: String,
        default: ''
    },
    isDefault: {
        type: Boolean,
        default: false
    }
}, { _id: true });

const paymentMethodSchema = new mongoose.Schema({
    label: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['card', 'bank', 'ewallet', 'other'],
        default: 'card'
    },
    provider: {
        type: String,
        default: ''
    },
    maskedNumber: {
        type: String,
        required: true
    },
    holderName: {
        type: String,
        default: ''
    },
    expMonth: {
        type: Number
    },
    expYear: {
        type: Number
    },
    isDefault: {
        type: Boolean,
        default: false
    }
}, { _id: true, timestamps: true });

const eyeSchema = new mongoose.Schema({
    sphere: { type: String, default: '' },
    cyl: { type: String, default: '' },
    axis: { type: String, default: '' }
}, { _id: false });

const prescriptionSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    rightEye: {
        type: eyeSchema,
        default: () => ({})
    },
    leftEye: {
        type: eyeSchema,
        default: () => ({})
    },
    pd: {
        type: String,
        default: ''
    },
    note: {
        type: String,
        default: ''
    },
    isDefault: {
        type: Boolean,
        default: false
    }
}, { _id: true, timestamps: true });

const notificationSchema = new mongoose.Schema({
    type: {
        type: String,
        default: 'system'
    },
    title: {
        type: String,
        required: true
    },
    message: {
        type: String,
        default: ''
    },
    data: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    readAt: {
        type: Date,
        default: null
    }
}, { _id: true, timestamps: true });

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        // Not required for Google OAuth users
    },
    role: {
        type: String,
        enum: ['customer', 'sales', 'operations', 'manager', 'admin'],
        default: 'customer'
    },
    provider: {
        type: String,
        enum: ['local', 'google'],
        default: 'local'
    },
    googleId: {
        type: String,
        sparse: true
    },
    avatar: {
        type: String
    },
    addresses: {
        type: [addressSchema],
        default: []
    },
    favorites: {
        type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
        default: []
    },
    paymentMethods: {
        type: [paymentMethodSchema],
        default: []
    },
    prescriptions: {
        type: [prescriptionSchema],
        default: []
    },
    notifications: {
        type: [notificationSchema],
        default: []
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('User', userSchema);
