const userService = require('../services/userService');
const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/response');

// Get all users (Admin only)
exports.getAllUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, role, search } = req.query;
  const result = await userService.getAllUsers(
    parseInt(page),
    parseInt(limit),
    { role, search }
  );
  
  ApiResponse.paginate(
    res,
    result.users,
    result.pagination,
    'Users retrieved successfully'
  );
});

// Get user by ID
exports.getUserById = asyncHandler(async (req, res) => {
  const user = await userService.getUserById(req.params.id);
  ApiResponse.success(res, user);
});

// Update user
exports.updateUser = asyncHandler(async (req, res) => {
  const user = await userService.updateUser(req.params.id, req.body);
  ApiResponse.success(res, user, 'User updated successfully');
});

// Delete user
exports.deleteUser = asyncHandler(async (req, res) => {
  await userService.deleteUser(req.params.id);
  ApiResponse.success(res, null, 'User deleted successfully');
});

// Change password
exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const result = await userService.changePassword(
    req.user.id,
    currentPassword,
    newPassword
  );
  ApiResponse.success(res, result, 'Password changed successfully');
});

// Get user statistics
exports.getUserStats = asyncHandler(async (req, res) => {
  const stats = await userService.getUserStats();
  ApiResponse.success(res, stats, 'User statistics retrieved successfully');
});