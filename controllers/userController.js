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

// Get my addresses
exports.getMyAddresses = asyncHandler(async (req, res) => {
  const addresses = await userService.getMyAddresses(req.user.id);
  ApiResponse.success(res, addresses, 'Addresses retrieved successfully');
});

// Add address to current user
exports.addMyAddress = asyncHandler(async (req, res) => {
  const addresses = await userService.addMyAddress(req.user.id, req.body);
  ApiResponse.created(res, addresses, 'Address added successfully');
});

// Update current user address
exports.updateMyAddress = asyncHandler(async (req, res) => {
  const addresses = await userService.updateMyAddress(req.user.id, req.params.addressId, req.body);
  ApiResponse.success(res, addresses, 'Address updated successfully');
});

// Delete current user address
exports.deleteMyAddress = asyncHandler(async (req, res) => {
  const addresses = await userService.deleteMyAddress(req.user.id, req.params.addressId);
  ApiResponse.success(res, addresses, 'Address deleted successfully');
});

// Set default address
exports.setDefaultMyAddress = asyncHandler(async (req, res) => {
  const addresses = await userService.setDefaultAddress(req.user.id, req.params.addressId);
  ApiResponse.success(res, addresses, 'Default address updated successfully');
});

// Favorites
exports.getMyFavorites = asyncHandler(async (req, res) => {
  const favorites = await userService.getMyFavoriteIds(req.user.id);
  ApiResponse.success(res, favorites, 'Favorites retrieved successfully');
});

exports.addMyFavorite = asyncHandler(async (req, res) => {
  const favorites = await userService.addMyFavorite(req.user.id, req.body.productId);
  ApiResponse.success(res, favorites, 'Favorite added successfully');
});

exports.removeMyFavorite = asyncHandler(async (req, res) => {
  const favorites = await userService.removeMyFavorite(req.user.id, req.params.productId);
  ApiResponse.success(res, favorites, 'Favorite removed successfully');
});

exports.clearMyFavorites = asyncHandler(async (req, res) => {
  const favorites = await userService.clearMyFavorites(req.user.id);
  ApiResponse.success(res, favorites, 'Favorites cleared successfully');
});

// Payment methods
exports.getMyPaymentMethods = asyncHandler(async (req, res) => {
  const methods = await userService.getMyPaymentMethods(req.user.id);
  ApiResponse.success(res, methods, 'Payment methods retrieved successfully');
});

exports.addMyPaymentMethod = asyncHandler(async (req, res) => {
  const methods = await userService.addMyPaymentMethod(req.user.id, req.body);
  ApiResponse.created(res, methods, 'Payment method added successfully');
});

exports.updateMyPaymentMethod = asyncHandler(async (req, res) => {
  const methods = await userService.updateMyPaymentMethod(req.user.id, req.params.methodId, req.body);
  ApiResponse.success(res, methods, 'Payment method updated successfully');
});

exports.deleteMyPaymentMethod = asyncHandler(async (req, res) => {
  const methods = await userService.deleteMyPaymentMethod(req.user.id, req.params.methodId);
  ApiResponse.success(res, methods, 'Payment method deleted successfully');
});

exports.setDefaultMyPaymentMethod = asyncHandler(async (req, res) => {
  const methods = await userService.setDefaultPaymentMethod(req.user.id, req.params.methodId);
  ApiResponse.success(res, methods, 'Default payment method updated successfully');
});

// Prescriptions
exports.getMyPrescriptions = asyncHandler(async (req, res) => {
  const prescriptions = await userService.getMyPrescriptions(req.user.id);
  ApiResponse.success(res, prescriptions, 'Prescriptions retrieved successfully');
});

exports.addMyPrescription = asyncHandler(async (req, res) => {
  const prescriptions = await userService.addMyPrescription(req.user.id, req.body);
  ApiResponse.created(res, prescriptions, 'Prescription added successfully');
});

exports.updateMyPrescription = asyncHandler(async (req, res) => {
  const prescriptions = await userService.updateMyPrescription(req.user.id, req.params.prescriptionId, req.body);
  ApiResponse.success(res, prescriptions, 'Prescription updated successfully');
});

exports.deleteMyPrescription = asyncHandler(async (req, res) => {
  const prescriptions = await userService.deleteMyPrescription(req.user.id, req.params.prescriptionId);
  ApiResponse.success(res, prescriptions, 'Prescription deleted successfully');
});

exports.setDefaultMyPrescription = asyncHandler(async (req, res) => {
  const prescriptions = await userService.setDefaultPrescription(req.user.id, req.params.prescriptionId);
  ApiResponse.success(res, prescriptions, 'Default prescription updated successfully');
});

// Notifications
exports.getMyNotifications = asyncHandler(async (req, res) => {
  const notifications = await userService.getMyNotifications(req.user.id);
  ApiResponse.success(res, notifications, 'Notifications retrieved successfully');
});

exports.markMyNotificationAsRead = asyncHandler(async (req, res) => {
  const notifications = await userService.markMyNotificationAsRead(req.user.id, req.params.notificationId);
  ApiResponse.success(res, notifications, 'Notification marked as read');
});

exports.markAllMyNotificationsAsRead = asyncHandler(async (req, res) => {
  const notifications = await userService.markAllNotificationsAsRead(req.user.id);
  ApiResponse.success(res, notifications, 'All notifications marked as read');
});
