const authService = require('../services/authService');
const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/response');

// Register
exports.register = asyncHandler(async (req, res) => {
    const result = await authService.register(req.body);
    ApiResponse.created(res, result, 'User registered successfully');
});

// Login
exports.login = asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    ApiResponse.success(res, result, 'Login successful');
});

// Get current user
exports.getMe = asyncHandler(async (req, res) => {
    const user = await authService.getUserById(req.user.id);
    ApiResponse.success(res, user);
});