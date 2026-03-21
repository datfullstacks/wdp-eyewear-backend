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
    wardCode: {
        type: String,
        default: ''
    },
    district: {
        type: String,
        required: true
    },
    districtId: {
        type: Number
    },
    province: {
        type: String,
        required: true
    },
    provinceId: {
        type: Number
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

const pushTokenSchema = new mongoose.Schema({
    token: {
        type: String,
        required: true
    },
    platform: {
        type: String,
        default: ''
    },
    deviceName: {
        type: String,
        default: ''
    },
    deviceModel: {
        type: String,
        default: ''
    },
    appOwnership: {
        type: String,
        default: ''
    },
    projectId: {
        type: String,
        default: ''
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, { _id: true });

const refundAccountSchema = new mongoose.Schema({
    bankName: {
        type: String,
        required: true
    },
    accountNumber: {
        type: String,
        required: true
    },
    accountHolder: {
        type: String,
        required: true
    },
    branch: {
        type: String,
        default: ''
    },
    phone: {
        type: String,
        default: ''
    },
    email: {
        type: String,
        default: ''
    },
    note: {
        type: String,
        default: ''
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, { _id: false });

const storeAccessSchema = new mongoose.Schema({
    mode: {
        type: String,
        enum: ['all', 'selected'],
        default: 'all'
    },
    primaryStoreId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
        default: null
    },
    storeIds: {
        type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Store' }],
        default: []
    },
    note: {
        type: String,
        default: ''
    }
}, { _id: false });

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
    phone: {
        type: String,
        default: ''
    },
    department: {
        type: String,
        default: ''
    },
    position: {
        type: String,
        default: ''
    },
    permissions: {
        type: [String],
        default: []
    },
    storeAccess: {
        type: storeAccessSchema,
        default: () => ({})
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
    },
    pushTokens: {
        type: [pushTokenSchema],
        default: []
    },
    refundAccount: {
        type: refundAccountSchema,
        default: null
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('User', userSchema);
