const express = require('express');
const router = express.Router();
const {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  getMyAddresses,
  addMyAddress,
  updateMyAddress,
  deleteMyAddress,
  setDefaultMyAddress,
  getMyFavorites,
  addMyFavorite,
  removeMyFavorite,
  clearMyFavorites,
  getMyPaymentMethods,
  addMyPaymentMethod,
  updateMyPaymentMethod,
  deleteMyPaymentMethod,
  setDefaultMyPaymentMethod,
  getMyPrescriptions,
  addMyPrescription,
  updateMyPrescription,
  deleteMyPrescription,
  setDefaultMyPrescription,
  getMyNotifications,
  markMyNotificationAsRead,
  markAllMyNotificationsAsRead
} = require('../controllers/userController');
const { protect, authorize } = require('../middlewares/auth');

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: User management endpoints
 */

// Protect all routes
router.use(protect);

router.get('/me/addresses', getMyAddresses);
router.post('/me/addresses', addMyAddress);
router.put('/me/addresses/:addressId', updateMyAddress);
router.delete('/me/addresses/:addressId', deleteMyAddress);
router.put('/me/addresses/:addressId/default', setDefaultMyAddress);

router.get('/me/favorites', getMyFavorites);
router.post('/me/favorites', addMyFavorite);
router.delete('/me/favorites/:productId', removeMyFavorite);
router.delete('/me/favorites', clearMyFavorites);

router.get('/me/payment-methods', getMyPaymentMethods);
router.post('/me/payment-methods', addMyPaymentMethod);
router.put('/me/payment-methods/:methodId', updateMyPaymentMethod);
router.delete('/me/payment-methods/:methodId', deleteMyPaymentMethod);
router.put('/me/payment-methods/:methodId/default', setDefaultMyPaymentMethod);

router.get('/me/prescriptions', getMyPrescriptions);
router.post('/me/prescriptions', addMyPrescription);
router.put('/me/prescriptions/:prescriptionId', updateMyPrescription);
router.delete('/me/prescriptions/:prescriptionId', deleteMyPrescription);
router.put('/me/prescriptions/:prescriptionId/default', setDefaultMyPrescription);

router.get('/me/notifications', getMyNotifications);
router.put('/me/notifications/read-all', markAllMyNotificationsAsRead);
router.put('/me/notifications/:notificationId/read', markMyNotificationAsRead);

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users (Admin/Manager only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [customer, sales, operations, manager, admin]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Users retrieved successfully
 *       403:
 *         description: Forbidden - Admin/Manager only
 */
router.get('/', authorize('admin', 'manager'), getAllUsers);

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Get user by ID
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User retrieved successfully
 *       404:
 *         description: User not found
 */
router.get('/:id', getUserById);

/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     summary: Update user (Admin/Manager only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               role:
 *                 type: string
 *     responses:
 *       200:
 *         description: User updated successfully
 *       403:
 *         description: Forbidden
 */
router.put('/:id', authorize('admin', 'manager'), updateUser);

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     summary: Delete user (Admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User deleted successfully
 *       403:
 *         description: Forbidden - Admin only
 */
router.delete('/:id', authorize('admin'), deleteUser);

module.exports = router;
