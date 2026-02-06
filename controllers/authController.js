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

// Google Login (via Supabase OAuth)
exports.googleLogin = asyncHandler(async (req, res) => {
    const { accessToken, idToken, token } = req.body;
    const normalizedAccessToken = accessToken || token;

    if (!normalizedAccessToken && !idToken) {
        return res.status(400).json({
            success: false,
            message: 'accessToken or idToken is required'
        });
    }

    const result = await authService.loginWithGoogle({
        accessToken: normalizedAccessToken,
        idToken
    });

    ApiResponse.success(res, result, 'Google login successful');
});

// Get current user
exports.getMe = asyncHandler(async (req, res) => {
    const user = await authService.getUserById(req.user.id);
    ApiResponse.success(res, user);
});
