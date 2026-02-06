const mongoose = require('mongoose');

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
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('User', userSchema);