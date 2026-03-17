const express = require('express');
const router = express.Router();
const {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  getMyAddresses,
  addMyAddress,
  updateMyAddress,
  deleteMyAddress,
  setDefaultMyAddress,
  getMyRefundAccount,
  upsertMyRefundAccount,
  deleteMyRefundAccount,
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
  markAllMyNotificationsAsRead,
  registerMyPushToken,
  unregisterMyPushToken
} = require('../controllers/userController');
const { protect, authorize } = require('../middlewares/auth');
const { validate } = require('../middlewares/validator');
const {
  createUserRules,
  updateUserRules,
  validateId
} = require('../validators/userValidator');
const {
  CUSTOMER_READONLY_ROLES,
  getRole
} = require('../helpers/roles');

const authorizeUsersListRead = (req, res, next) => {
  const role = getRole(req.user);

  if (role === 'admin' || role === 'manager') {
    return next();
  }

  if (!CUSTOMER_READONLY_ROLES.has(role)) {
    return res.status(403).json({
      success: false,
      message: `User role '${req.user?.role}' is not authorized to access this route`
    });
  }

  const requestedRole = String(req.query.role || '').trim().toLowerCase();
  if (requestedRole && requestedRole !== 'customer') {
    return res.status(403).json({
      success: false,
      message: `User role '${req.user?.role}' can only query customers`
    });
  }

  req.query.role = 'customer';
  return next();
};

/**
 * @swagger
 * tags:
 *   - name: Users
 *     description: User administration and authenticated profile resources
 * components:
 *   schemas:
 *     UserCreateInput:
 *       type: object
 *       required: [name, email, password, role]
 *       properties:
 *         name:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *           minLength: 6
 *         role:
 *           type: string
 *           enum: [customer, sales, operations, manager, admin]
 *     UserUpdateInput:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         role:
 *           type: string
 *           enum: [customer, sales, operations, manager, admin]
 *     AddressInput:
 *       type: object
 *       properties:
 *         label:
 *           type: string
 *         fullName:
 *           type: string
 *         phone:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         line1:
 *           type: string
 *         line2:
 *           type: string
 *         ward:
 *           type: string
 *         wardCode:
 *           type: string
 *         district:
 *           type: string
 *         districtId:
 *           type: integer
 *         province:
 *           type: string
 *         provinceId:
 *           type: integer
 *         country:
 *           type: string
 *         note:
 *           type: string
 *         isDefault:
 *           type: boolean
 *     Address:
 *       allOf:
 *         - $ref: '#/components/schemas/AddressInput'
 *         - type: object
 *           properties:
 *             _id:
 *               type: string
 *     RefundAccountInput:
 *       type: object
 *       properties:
 *         bankName:
 *           type: string
 *         accountNumber:
 *           type: string
 *         accountHolder:
 *           type: string
 *         branch:
 *           type: string
 *         phone:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         note:
 *           type: string
 *     RefundAccount:
 *       allOf:
 *         - $ref: '#/components/schemas/RefundAccountInput'
 *         - type: object
 *           properties:
 *             updatedAt:
 *               type: string
 *               format: date-time
 *     FavoriteInput:
 *       type: object
 *       required: [productId]
 *       properties:
 *         productId:
 *           type: string
 *     PaymentMethodInput:
 *       type: object
 *       properties:
 *         label:
 *           type: string
 *         type:
 *           type: string
 *           enum: [card, bank, ewallet, other]
 *         provider:
 *           type: string
 *         maskedNumber:
 *           type: string
 *         holderName:
 *           type: string
 *         expMonth:
 *           type: integer
 *         expYear:
 *           type: integer
 *         isDefault:
 *           type: boolean
 *     PaymentMethod:
 *       allOf:
 *         - $ref: '#/components/schemas/PaymentMethodInput'
 *         - type: object
 *           properties:
 *             _id:
 *               type: string
 *             createdAt:
 *               type: string
 *               format: date-time
 *             updatedAt:
 *               type: string
 *               format: date-time
 *     PrescriptionEye:
 *       type: object
 *       properties:
 *         sphere:
 *           type: string
 *         cyl:
 *           type: string
 *         axis:
 *           type: string
 *     PrescriptionInput:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *         rightEye:
 *           $ref: '#/components/schemas/PrescriptionEye'
 *         leftEye:
 *           $ref: '#/components/schemas/PrescriptionEye'
 *         pd:
 *           type: string
 *         note:
 *           type: string
 *         isDefault:
 *           type: boolean
 *     Prescription:
 *       allOf:
 *         - $ref: '#/components/schemas/PrescriptionInput'
 *         - type: object
 *           properties:
 *             _id:
 *               type: string
 *             createdAt:
 *               type: string
 *               format: date-time
 *             updatedAt:
 *               type: string
 *               format: date-time
 *     UserNotification:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         type:
 *           type: string
 *         title:
 *           type: string
 *         message:
 *           type: string
 *         data:
 *           type: object
 *           nullable: true
 *           additionalProperties: true
 *         readAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     PushTokenInput:
 *       type: object
 *       required: [token]
 *       properties:
 *         token:
 *           type: string
 *           example: ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]
 *         platform:
 *           type: string
 *         deviceName:
 *           type: string
 *         deviceModel:
 *           type: string
 *         appOwnership:
 *           type: string
 *         projectId:
 *           type: string
 *     PushToken:
 *       allOf:
 *         - $ref: '#/components/schemas/PushTokenInput'
 *         - type: object
 *           properties:
 *             _id:
 *               type: string
 *             updatedAt:
 *               type: string
 *               format: date-time
 * /api/users/me/addresses:
 *   get:
 *     summary: Get current user addresses
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Addresses retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Address'
 *   post:
 *     summary: Add an address for the current user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AddressInput'
 *     responses:
 *       201:
 *         description: Address added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Address'
 * /api/users/me/addresses/{addressId}:
 *   put:
 *     summary: Update one current user address
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: addressId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AddressInput'
 *     responses:
 *       200:
 *         description: Address updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Address'
 *   delete:
 *     summary: Delete one current user address
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: addressId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Address deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Address'
 * /api/users/me/addresses/{addressId}/default:
 *   put:
 *     summary: Set a current user address as default
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: addressId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Default address updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Address'
 * /api/users/me/refund-account:
 *   get:
 *     summary: Get current user refund account
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Refund account retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   allOf:
 *                     - $ref: '#/components/schemas/RefundAccount'
 *                   nullable: true
 *   put:
 *     summary: Create or update the current user refund account
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RefundAccountInput'
 *     responses:
 *       200:
 *         description: Refund account saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/RefundAccount'
 *   delete:
 *     summary: Delete the current user refund account
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Refund account deleted successfully
 * /api/users/me/favorites:
 *   get:
 *     summary: Get current user favorite product ids
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Favorites retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: string
 *   post:
 *     summary: Add a product to current user favorites
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FavoriteInput'
 *     responses:
 *       200:
 *         description: Favorite added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: string
 *   delete:
 *     summary: Clear all current user favorites
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Favorites cleared successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: string
 * /api/users/me/favorites/{productId}:
 *   delete:
 *     summary: Remove one product from current user favorites
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Favorite removed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: string
 */

/**
 * @swagger
 * /api/users/me/payment-methods:
 *   get:
 *     summary: Get current user payment methods
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payment methods retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PaymentMethod'
 *   post:
 *     summary: Add a payment method for the current user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PaymentMethodInput'
 *     responses:
 *       201:
 *         description: Payment method added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PaymentMethod'
 * /api/users/me/payment-methods/{methodId}:
 *   put:
 *     summary: Update one payment method for the current user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: methodId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PaymentMethodInput'
 *     responses:
 *       200:
 *         description: Payment method updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PaymentMethod'
 *   delete:
 *     summary: Delete one payment method from the current user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: methodId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment method deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PaymentMethod'
 * /api/users/me/payment-methods/{methodId}/default:
 *   put:
 *     summary: Set one payment method as default
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: methodId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Default payment method updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PaymentMethod'
 * /api/users/me/prescriptions:
 *   get:
 *     summary: Get current user prescriptions
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Prescriptions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Prescription'
 *   post:
 *     summary: Add a prescription for the current user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PrescriptionInput'
 *     responses:
 *       201:
 *         description: Prescription added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Prescription'
 * /api/users/me/prescriptions/{prescriptionId}:
 *   put:
 *     summary: Update one current user prescription
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: prescriptionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PrescriptionInput'
 *     responses:
 *       200:
 *         description: Prescription updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Prescription'
 *   delete:
 *     summary: Delete one current user prescription
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: prescriptionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Prescription deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Prescription'
 * /api/users/me/prescriptions/{prescriptionId}/default:
 *   put:
 *     summary: Set one prescription as default
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: prescriptionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Default prescription updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Prescription'
 */

// Protect all routes
router.use(protect);

router.get('/me/addresses', getMyAddresses);
router.post('/me/addresses', addMyAddress);
router.put('/me/addresses/:addressId', updateMyAddress);
router.delete('/me/addresses/:addressId', deleteMyAddress);
router.put('/me/addresses/:addressId/default', setDefaultMyAddress);

router.get('/me/refund-account', getMyRefundAccount);
router.put('/me/refund-account', upsertMyRefundAccount);
router.delete('/me/refund-account', deleteMyRefundAccount);

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

/**
 * @swagger
 * /api/users/me/notifications:
 *   get:
 *     summary: Get current user notifications
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Notifications retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/UserNotification'
 * /api/users/me/notifications/read-all:
 *   put:
 *     summary: Mark all current user notifications as read
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/UserNotification'
 * /api/users/me/notifications/{notificationId}/read:
 *   put:
 *     summary: Mark one current user notification as read
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notification marked as read
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/UserNotification'
 * /api/users/me/push-tokens:
 *   post:
 *     summary: Register an Expo push token for the current user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PushTokenInput'
 *     responses:
 *       200:
 *         description: Push token registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PushToken'
 *   delete:
 *     summary: Unregister an Expo push token for the current user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Push token unregistered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PushToken'
 */

router.get('/me/notifications', getMyNotifications);
router.put('/me/notifications/read-all', markAllMyNotificationsAsRead);
router.put('/me/notifications/:notificationId/read', markMyNotificationAsRead);
router.post('/me/push-tokens', registerMyPushToken);
router.delete('/me/push-tokens', unregisterMyPushToken);

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Create a new user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserCreateInput'
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       403:
 *         description: Forbidden
 *   get:
 *     summary: List users with role-aware filtering
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *       403:
 *         description: Forbidden
 * /api/users/{id}:
 *   get:
 *     summary: Get one user by id
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       404:
 *         description: User not found
 *   put:
 *     summary: Update one user
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
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserUpdateInput'
 *     responses:
 *       200:
 *         description: User updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       403:
 *         description: Forbidden
 *   delete:
 *     summary: Delete one user when role policy allows it
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
 *       400:
 *         description: User cannot be deleted because of related data
 *       403:
 *         description: Forbidden
 */

router.post(
  '/',
  authorize('admin', 'manager'),
  createUserRules,
  validate,
  createUser
);

router.get('/', authorizeUsersListRead, getAllUsers);

router.get('/:id', validateId, validate, getUserById);

router.put(
  '/:id',
  authorize('admin', 'manager'),
  validateId,
  updateUserRules,
  validate,
  updateUser
);

router.delete('/:id', authorize('admin', 'manager'), validateId, validate, deleteUser);

module.exports = router;
