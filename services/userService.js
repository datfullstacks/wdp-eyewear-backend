const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Invoice = require('../models/Invoice');
const Store = require('../models/Store');
const bcrypt = require('bcryptjs');
const AppError = require('../errors/AppError');
const { isExpoPushToken } = require('../helpers/expoPush');
const {
  findRefundBank,
  normalizeRefundAccountNumber,
  isRefundAccountNumberFormatValid,
} = require('../helpers/refundBankCatalog');
const { emitNotificationEvent } = require('../realtime/websocket');
const {
  ROLE,
  normalizeRole,
  getListableUserRoles,
  canManageUserRole,
  canReadUserRecord,
  canDeleteUser
} = require('../helpers/roles');
const {
  normalizeStoreAccess,
  getUserStoreAccess,
  getAccessibleStoreIds,
  isStoreScopeWithinAllowed,
} = require('../helpers/storeAccess');

const USER_STORE_POPULATE = [
  {
    path: 'storeAccess.primaryStoreId',
    select:
      'name code type status phone email addressLine1 ward district city openingHours supportsTryOn supportsPickup isDefault',
  },
  {
    path: 'storeAccess.storeIds',
    select:
      'name code type status phone email addressLine1 ward district city openingHours supportsTryOn supportsPickup isDefault',
  },
];

class UserService {
  normalizePushTokenInput(input = {}) {
    const token = String(input?.token ?? '').trim();
    if (!token) {
      throw new AppError('token is required', 400);
    }

    if (!isExpoPushToken(token)) {
      throw new AppError('Invalid Expo push token', 400);
    }

    return {
      token,
      platform: String(input?.platform ?? '').trim().toLowerCase(),
      deviceName: String(input?.deviceName ?? '').trim(),
      deviceModel: String(input?.deviceModel ?? '').trim(),
      appOwnership: String(input?.appOwnership ?? '').trim(),
      projectId: String(input?.projectId ?? '').trim(),
      updatedAt: new Date(),
    };
  }

  normalizePositiveInteger(value, fieldName) {
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized < 1) {
      throw new AppError(`${fieldName} must be a positive integer`, 400);
    }
    return normalized;
  }

  async normalizeUserStoreAccess(input = {}, targetRole) {
    const normalizedRole = normalizeRole(targetRole);
    if (normalizedRole === ROLE.ADMIN) {
      return {
        mode: 'all',
        primaryStoreId: undefined,
        storeIds: [],
        note: String(input?.note || '').trim(),
      };
    }

    const normalized = normalizeStoreAccess(input);
    const requestedIds = [...new Set(
      [
        normalized.primaryStoreId,
        ...(Array.isArray(normalized.storeIds) ? normalized.storeIds : []),
      ].filter(Boolean)
    )];

    if (requestedIds.length > 0) {
      const stores = await Store.find({ _id: { $in: requestedIds } }).select('_id');
      const knownIds = new Set(stores.map((store) => String(store._id)));
      const invalidIds = requestedIds.filter((storeId) => !knownIds.has(String(storeId)));
      if (invalidIds.length > 0) {
        throw new AppError('storeAccess contains unknown store id(s)', 400);
      }
    }

    if (normalized.mode === 'selected' && normalized.storeIds.length === 0) {
      throw new AppError('Selected store scope requires at least one store', 400);
    }

    if (normalized.mode === 'selected' && !normalized.primaryStoreId) {
      throw new AppError('Selected store scope requires primaryStoreId', 400);
    }

    return normalized;
  }

  assertActorCanAssignStoreAccess(currentUser, targetStoreAccess, targetRole) {
    const actorStoreIds = getAccessibleStoreIds(currentUser);
    if (actorStoreIds === null) {
      return;
    }

    if (!isStoreScopeWithinAllowed(targetStoreAccess, actorStoreIds)) {
      throw new AppError(
        `Cannot assign ${targetRole} outside the current user's store scope`,
        403,
      );
    }
  }

  paginateRows(rows, page, limit) {
    const total = rows.length;
    const skip = (page - 1) * limit;
    const paginatedRows = rows.slice(skip, skip + limit);
    return {
      rows: paginatedRows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  buildUserQuery(filters = {}) {
    const query = {};

    if (filters.role) {
      query.role = normalizeRole(filters.role);
    }

    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: 'i' } },
        { email: { $regex: filters.search, $options: 'i' } },
        { phone: { $regex: filters.search, $options: 'i' } },
      ];
    }

    return query;
  }

  getUserQueryBuilder() {
    return User.find().select('-password').populate(USER_STORE_POPULATE);
  }

  canActorAccessBusinessUser(currentUser, targetUser) {
    if (!canReadUserRecord(currentUser, targetUser)) {
      return false;
    }

    const actorStoreIds = getAccessibleStoreIds(currentUser);
    if (actorStoreIds === null) {
      return true;
    }

    if (normalizeRole(targetUser?.role) === ROLE.CUSTOMER) {
      return false;
    }

    return isStoreScopeWithinAllowed(targetUser?.storeAccess, actorStoreIds);
  }

  async canActorAccessCustomer(currentUser, customerId) {
    const actorStoreIds = getAccessibleStoreIds(currentUser);
    if (actorStoreIds === null) {
      return true;
    }

    if (!customerId) {
      return false;
    }

    const accessibleOrder = await Order.exists({
      userId: customerId,
      storeId: { $in: actorStoreIds },
    });

    return Boolean(accessibleOrder);
  }

  normalizeAddressInput(addressData = {}, { partial = false } = {}) {
    const payload = {};
    const fields = [
      'label',
      'fullName',
      'phone',
      'email',
      'line1',
      'line2',
      'ward',
      'district',
      'province',
      'country',
      'note'
    ];

    for (const field of fields) {
      if (addressData[field] === undefined) continue;
      payload[field] = String(addressData[field] ?? '').trim();
    }

    if (addressData.isDefault !== undefined) {
      payload.isDefault = Boolean(addressData.isDefault);
    }

    const provinceId = addressData.provinceId ?? addressData.province_id;
    if (provinceId !== undefined) {
      payload.provinceId = this.normalizePositiveInteger(provinceId, 'provinceId');
    }

    const districtId = addressData.districtId ?? addressData.district_id;
    if (districtId !== undefined) {
      payload.districtId = this.normalizePositiveInteger(districtId, 'districtId');
    }

    const wardCode = addressData.wardCode ?? addressData.ward_code;
    if (wardCode !== undefined) {
      payload.wardCode = String(wardCode ?? '').trim();
    }

    if (!partial) {
      const requiredFields = ['fullName', 'phone', 'line1', 'district', 'province'];
      for (const field of requiredFields) {
        const value = payload[field];
        if (!value) {
          throw new AppError(`${field} is required`, 400);
        }
      }
    }

    if (payload.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(payload.email)) {
        throw new AppError('Invalid email format', 400);
      }
    }

    if (payload.country === '') {
      payload.country = 'VN';
    }

    if (payload.wardCode === '') {
      payload.wardCode = '';
    }

    return payload;
  }

  async getMyAddresses(userId) {
    const user = await User.findById(userId).select('addresses');
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const addresses = Array.isArray(user.addresses) ? user.addresses : [];
    return addresses.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  }

  async addMyAddress(userId, addressData) {
    const user = await User.findById(userId).select('addresses');
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const payload = this.normalizeAddressInput(addressData, { partial: false });
    const addresses = Array.isArray(user.addresses) ? user.addresses : [];
    const shouldSetDefault = payload.isDefault || addresses.length === 0;

    if (shouldSetDefault) {
      addresses.forEach((address) => {
        address.isDefault = false;
      });
    }

    addresses.push({
      ...payload,
      isDefault: shouldSetDefault
    });

    user.addresses = addresses;
    await user.save();
    return user.addresses;
  }

  async updateMyAddress(userId, addressId, addressData) {
    const user = await User.findById(userId).select('addresses');
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const addresses = Array.isArray(user.addresses) ? user.addresses : [];
    const index = addresses.findIndex((address) => String(address._id) === String(addressId));
    if (index < 0) {
      throw new AppError('Address not found', 404);
    }

    const payload = this.normalizeAddressInput(addressData, { partial: true });
    if (!Object.keys(payload).length) {
      throw new AppError('No address fields to update', 400);
    }

    const target = addresses[index];
    Object.assign(target, payload);

    if (payload.isDefault === true) {
      addresses.forEach((address, i) => {
        address.isDefault = i === index;
      });
    }

    if (!addresses.some((address) => address.isDefault) && addresses.length > 0) {
      addresses[0].isDefault = true;
    }

    user.addresses = addresses;
    await user.save();
    return user.addresses;
  }

  async deleteMyAddress(userId, addressId) {
    const user = await User.findById(userId).select('addresses');
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const addresses = Array.isArray(user.addresses) ? user.addresses : [];
    const index = addresses.findIndex((address) => String(address._id) === String(addressId));
    if (index < 0) {
      throw new AppError('Address not found', 404);
    }

    const wasDefault = Boolean(addresses[index].isDefault);
    addresses.splice(index, 1);

    if (wasDefault && addresses.length > 0 && !addresses.some((address) => address.isDefault)) {
      addresses[0].isDefault = true;
    }

    user.addresses = addresses;
    await user.save();
    return user.addresses;
  }

  async setDefaultAddress(userId, addressId) {
    const user = await User.findById(userId).select('addresses');
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const addresses = Array.isArray(user.addresses) ? user.addresses : [];
    const index = addresses.findIndex((address) => String(address._id) === String(addressId));
    if (index < 0) {
      throw new AppError('Address not found', 404);
    }

    addresses.forEach((address, i) => {
      address.isDefault = i === index;
    });

    user.addresses = addresses;
    await user.save();
    return user.addresses;
  }

  normalizeRefundAccountInput(input = {}, { partial = false } = {}) {
    const payload = {};
    const fields = ['bankCode', 'bankName', 'accountNumber', 'accountHolder', 'branch', 'phone', 'email', 'note'];
    for (const field of fields) {
      if (input[field] === undefined) continue;
      payload[field] = String(input[field] ?? '').trim();
    }

    if (payload.bankCode !== undefined || payload.bankName !== undefined) {
      const resolvedBank = findRefundBank({
        bankCode: payload.bankCode,
        bankName: payload.bankName,
      });
      if (resolvedBank) {
        payload.bankCode = resolvedBank.code;
        payload.bankName = resolvedBank.name;
      } else {
        payload.bankCode = '';
      }
    }

    if (payload.accountNumber) {
      payload.accountNumber = normalizeRefundAccountNumber(payload.accountNumber);
    }

    if (!partial) {
      if (!payload.bankCode) throw new AppError('bankCode is required', 400);
      if (!payload.bankName) throw new AppError('bankName is required', 400);
      if (!payload.accountNumber) throw new AppError('accountNumber is required', 400);
      if (!payload.accountHolder) throw new AppError('accountHolder is required', 400);
    }

    if (payload.accountNumber && !isRefundAccountNumberFormatValid(payload.accountNumber)) {
      throw new AppError('accountNumber must contain 8 to 19 digits', 400);
    }

    if (payload.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(payload.email)) {
        throw new AppError('Invalid email format', 400);
      }
    }

    payload.updatedAt = new Date();
    return payload;
  }

  async getMyRefundAccount(userId) {
    const user = await User.findById(userId).select('refundAccount');
    if (!user) throw new AppError('User not found', 404);
    return user.refundAccount || null;
  }

  async upsertMyRefundAccount(userId, input) {
    const user = await User.findById(userId).select('refundAccount');
    if (!user) throw new AppError('User not found', 404);

    const existing = user.refundAccount || null;
    const payload = this.normalizeRefundAccountInput(input, { partial: Boolean(existing) });
    user.refundAccount = {
      ...(existing || {}),
      ...payload
    };
    await user.save();
    return user.refundAccount;
  }

  async deleteMyRefundAccount(userId) {
    const user = await User.findById(userId).select('refundAccount');
    if (!user) throw new AppError('User not found', 404);
    user.refundAccount = null;
    await user.save();
    return null;
  }

  async getMyFavoriteIds(userId) {
    const user = await User.findById(userId).select('favorites');
    if (!user) {
      throw new AppError('User not found', 404);
    }
    return (user.favorites || []).map((id) => String(id));
  }

  async addMyFavorite(userId, productId) {
    if (!productId) {
      throw new AppError('productId is required', 400);
    }
    const product = await Product.findById(productId).select('_id');
    if (!product) {
      throw new AppError('Product not found', 404);
    }

    const user = await User.findById(userId).select('favorites');
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const exists = (user.favorites || []).some((id) => String(id) === String(productId));
    if (!exists) {
      user.favorites = [...(user.favorites || []), product._id];
      await user.save();
    }

    return (user.favorites || []).map((id) => String(id));
  }

  async removeMyFavorite(userId, productId) {
    const user = await User.findById(userId).select('favorites');
    if (!user) {
      throw new AppError('User not found', 404);
    }

    user.favorites = (user.favorites || []).filter((id) => String(id) !== String(productId));
    await user.save();
    return (user.favorites || []).map((id) => String(id));
  }

  async clearMyFavorites(userId) {
    const user = await User.findById(userId).select('favorites');
    if (!user) {
      throw new AppError('User not found', 404);
    }
    user.favorites = [];
    await user.save();
    return [];
  }

  normalizePaymentMethodInput(input = {}, { partial = false } = {}) {
    const payload = {};
    const textFields = ['label', 'type', 'provider', 'maskedNumber', 'holderName'];
    for (const field of textFields) {
      if (input[field] === undefined) continue;
      payload[field] = String(input[field] ?? '').trim();
    }
    if (input.expMonth !== undefined) payload.expMonth = Number(input.expMonth);
    if (input.expYear !== undefined) payload.expYear = Number(input.expYear);
    if (input.isDefault !== undefined) payload.isDefault = Boolean(input.isDefault);

    if (!partial) {
      if (!payload.label) throw new AppError('label is required', 400);
      if (!payload.maskedNumber) throw new AppError('maskedNumber is required', 400);
    }

    if (payload.expMonth !== undefined && (!Number.isFinite(payload.expMonth) || payload.expMonth < 1 || payload.expMonth > 12)) {
      throw new AppError('expMonth must be between 1 and 12', 400);
    }
    if (payload.expYear !== undefined && (!Number.isFinite(payload.expYear) || payload.expYear < 2000 || payload.expYear > 3000)) {
      throw new AppError('expYear is invalid', 400);
    }
    if (!payload.type && !partial) payload.type = 'card';

    return payload;
  }

  async getMyPaymentMethods(userId) {
    const user = await User.findById(userId).select('paymentMethods');
    if (!user) throw new AppError('User not found', 404);
    const list = Array.isArray(user.paymentMethods) ? user.paymentMethods : [];
    return list.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  }

  async addMyPaymentMethod(userId, input) {
    const user = await User.findById(userId).select('paymentMethods');
    if (!user) throw new AppError('User not found', 404);

    const payload = this.normalizePaymentMethodInput(input, { partial: false });
    const methods = Array.isArray(user.paymentMethods) ? user.paymentMethods : [];
    const shouldDefault = payload.isDefault || methods.length === 0;
    if (shouldDefault) {
      methods.forEach((m) => { m.isDefault = false; });
    }
    methods.push({ ...payload, isDefault: shouldDefault });
    user.paymentMethods = methods;
    await user.save();
    return user.paymentMethods;
  }

  async updateMyPaymentMethod(userId, methodId, input) {
    const user = await User.findById(userId).select('paymentMethods');
    if (!user) throw new AppError('User not found', 404);
    const methods = Array.isArray(user.paymentMethods) ? user.paymentMethods : [];
    const index = methods.findIndex((m) => String(m._id) === String(methodId));
    if (index < 0) throw new AppError('Payment method not found', 404);

    const payload = this.normalizePaymentMethodInput(input, { partial: true });
    if (!Object.keys(payload).length) throw new AppError('No fields to update', 400);
    Object.assign(methods[index], payload);

    if (payload.isDefault === true) {
      methods.forEach((m, i) => { m.isDefault = i === index; });
    }
    if (!methods.some((m) => m.isDefault) && methods.length > 0) {
      methods[0].isDefault = true;
    }
    user.paymentMethods = methods;
    await user.save();
    return user.paymentMethods;
  }

  async deleteMyPaymentMethod(userId, methodId) {
    const user = await User.findById(userId).select('paymentMethods');
    if (!user) throw new AppError('User not found', 404);
    const methods = Array.isArray(user.paymentMethods) ? user.paymentMethods : [];
    const index = methods.findIndex((m) => String(m._id) === String(methodId));
    if (index < 0) throw new AppError('Payment method not found', 404);

    const wasDefault = Boolean(methods[index].isDefault);
    methods.splice(index, 1);
    if (wasDefault && methods.length > 0 && !methods.some((m) => m.isDefault)) {
      methods[0].isDefault = true;
    }
    user.paymentMethods = methods;
    await user.save();
    return user.paymentMethods;
  }

  async setDefaultPaymentMethod(userId, methodId) {
    const user = await User.findById(userId).select('paymentMethods');
    if (!user) throw new AppError('User not found', 404);
    const methods = Array.isArray(user.paymentMethods) ? user.paymentMethods : [];
    const index = methods.findIndex((m) => String(m._id) === String(methodId));
    if (index < 0) throw new AppError('Payment method not found', 404);
    methods.forEach((m, i) => { m.isDefault = i === index; });
    user.paymentMethods = methods;
    await user.save();
    return user.paymentMethods;
  }

  normalizePrescriptionInput(input = {}, { partial = false } = {}) {
    const payload = {};
    if (input.name !== undefined) payload.name = String(input.name ?? '').trim();
    if (input.pd !== undefined) payload.pd = String(input.pd ?? '').trim();
    if (input.note !== undefined) payload.note = String(input.note ?? '').trim();
    if (input.isDefault !== undefined) payload.isDefault = Boolean(input.isDefault);

    const normalizeEye = (eye) => ({
      sphere: String(eye?.sphere ?? '').trim(),
      cyl: String(eye?.cyl ?? '').trim(),
      axis: String(eye?.axis ?? '').trim(),
      add: String(eye?.add ?? '').trim(),
    });
    if (input.rightEye !== undefined) payload.rightEye = normalizeEye(input.rightEye);
    if (input.leftEye !== undefined) payload.leftEye = normalizeEye(input.leftEye);

    if (!partial && !payload.name) {
      throw new AppError('name is required', 400);
    }
    return payload;
  }

  async getMyPrescriptions(userId) {
    const user = await User.findById(userId).select('prescriptions');
    if (!user) throw new AppError('User not found', 404);
    const list = Array.isArray(user.prescriptions) ? user.prescriptions : [];
    return list.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  }

  async addMyPrescription(userId, input) {
    const user = await User.findById(userId).select('prescriptions');
    if (!user) throw new AppError('User not found', 404);
    const payload = this.normalizePrescriptionInput(input, { partial: false });
    const prescriptions = Array.isArray(user.prescriptions) ? user.prescriptions : [];
    const shouldDefault = payload.isDefault || prescriptions.length === 0;
    if (shouldDefault) prescriptions.forEach((p) => { p.isDefault = false; });
    prescriptions.push({ ...payload, isDefault: shouldDefault });
    user.prescriptions = prescriptions;
    await user.save();
    return user.prescriptions;
  }

  async updateMyPrescription(userId, prescriptionId, input) {
    const user = await User.findById(userId).select('prescriptions');
    if (!user) throw new AppError('User not found', 404);
    const prescriptions = Array.isArray(user.prescriptions) ? user.prescriptions : [];
    const index = prescriptions.findIndex((p) => String(p._id) === String(prescriptionId));
    if (index < 0) throw new AppError('Prescription not found', 404);
    const payload = this.normalizePrescriptionInput(input, { partial: true });
    if (!Object.keys(payload).length) throw new AppError('No fields to update', 400);
    Object.assign(prescriptions[index], payload);
    if (payload.isDefault === true) prescriptions.forEach((p, i) => { p.isDefault = i === index; });
    if (!prescriptions.some((p) => p.isDefault) && prescriptions.length > 0) prescriptions[0].isDefault = true;
    user.prescriptions = prescriptions;
    await user.save();
    return user.prescriptions;
  }

  async deleteMyPrescription(userId, prescriptionId) {
    const user = await User.findById(userId).select('prescriptions');
    if (!user) throw new AppError('User not found', 404);
    const prescriptions = Array.isArray(user.prescriptions) ? user.prescriptions : [];
    const index = prescriptions.findIndex((p) => String(p._id) === String(prescriptionId));
    if (index < 0) throw new AppError('Prescription not found', 404);
    const wasDefault = Boolean(prescriptions[index].isDefault);
    prescriptions.splice(index, 1);
    if (wasDefault && prescriptions.length > 0 && !prescriptions.some((p) => p.isDefault)) prescriptions[0].isDefault = true;
    user.prescriptions = prescriptions;
    await user.save();
    return user.prescriptions;
  }

  async setDefaultPrescription(userId, prescriptionId) {
    const user = await User.findById(userId).select('prescriptions');
    if (!user) throw new AppError('User not found', 404);
    const prescriptions = Array.isArray(user.prescriptions) ? user.prescriptions : [];
    const index = prescriptions.findIndex((p) => String(p._id) === String(prescriptionId));
    if (index < 0) throw new AppError('Prescription not found', 404);
    prescriptions.forEach((p, i) => { p.isDefault = i === index; });
    user.prescriptions = prescriptions;
    await user.save();
    return user.prescriptions;
  }

  async getMyNotifications(userId) {
    const user = await User.findById(userId).select('notifications');
    if (!user) throw new AppError('User not found', 404);
    const notifications = Array.isArray(user.notifications) ? user.notifications : [];
    return notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async markMyNotificationAsRead(userId, notificationId) {
    const user = await User.findById(userId).select('notifications');
    if (!user) throw new AppError('User not found', 404);
    const notifications = Array.isArray(user.notifications) ? user.notifications : [];
    const item = notifications.find((n) => String(n._id) === String(notificationId));
    if (!item) throw new AppError('Notification not found', 404);
    if (!item.readAt) item.readAt = new Date();
    user.notifications = notifications;
    await user.save();
    emitNotificationEvent({
      action: 'read',
      notification: item.toObject ? item.toObject() : item,
      notificationIds: [String(item._id)],
      readAt: item.readAt,
      recipients: {
        userIds: [String(userId)],
      },
    });
    return user.notifications;
  }

  async markAllNotificationsAsRead(userId) {
    const user = await User.findById(userId).select('notifications');
    if (!user) throw new AppError('User not found', 404);
    const notifications = Array.isArray(user.notifications) ? user.notifications : [];
    const now = new Date();
    notifications.forEach((n) => {
      if (!n.readAt) n.readAt = now;
    });
    user.notifications = notifications;
    await user.save();
    emitNotificationEvent({
      action: 'read_all',
      notificationIds: notifications.map((n) => String(n._id)),
      readAt: now,
      recipients: {
        userIds: [String(userId)],
      },
    });
    return user.notifications;
  }

  async registerMyPushToken(userId, input = {}) {
    const payload = this.normalizePushTokenInput(input);
    const user = await User.findById(userId).select('pushTokens');
    if (!user) {
      throw new AppError('User not found', 404);
    }

    await User.updateMany(
      { _id: { $ne: userId } },
      {
        $pull: {
          pushTokens: {
            token: payload.token,
          },
        },
      },
    );

    const pushTokens = Array.isArray(user.pushTokens) ? user.pushTokens : [];
    const existingIndex = pushTokens.findIndex(
      (item) => String(item?.token || '') === payload.token,
    );

    if (existingIndex >= 0) {
      Object.assign(pushTokens[existingIndex], payload);
    } else {
      pushTokens.push(payload);
    }

    user.pushTokens = pushTokens;
    await user.save();
    return user.pushTokens;
  }

  async unregisterMyPushToken(userId, tokenValue) {
    const token = String(tokenValue ?? '').trim();
    if (!token) {
      throw new AppError('token is required', 400);
    }

    const user = await User.findById(userId).select('pushTokens');
    if (!user) {
      throw new AppError('User not found', 404);
    }

    user.pushTokens = (Array.isArray(user.pushTokens) ? user.pushTokens : []).filter(
      (item) => String(item?.token || '') !== token,
    );
    await user.save();
    return user.pushTokens;
  }

  async createUser(userData, currentUser) {
    const { name, email, password, role } = userData;
    const normalizedRole = normalizeRole(role);

    if (!canManageUserRole(currentUser, normalizedRole)) {
      throw new AppError('Forbidden', 403);
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new AppError('Email already in use', 400);
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const storeAccess = await this.normalizeUserStoreAccess(
      userData.storeAccess,
      normalizedRole || ROLE.CUSTOMER
    );
    this.assertActorCanAssignStoreAccess(
      currentUser,
      storeAccess,
      normalizedRole || ROLE.CUSTOMER
    );

    const user = await User.create({
      name: String(name || '').trim(),
      email: String(email || '').trim().toLowerCase(),
      password: hashedPassword,
      provider: 'local',
      role: normalizedRole || ROLE.CUSTOMER,
      phone: String(userData.phone || '').trim(),
      department: String(userData.department || '').trim(),
      position: String(userData.position || '').trim(),
      permissions: Array.isArray(userData.permissions)
        ? userData.permissions.map((value) => String(value || '').trim()).filter(Boolean)
        : [],
      storeAccess
    });

    return User.findById(user._id).select('-password').populate(USER_STORE_POPULATE);
  }

  // Get all users with pagination
  async getAllUsers(page = 1, limit = 10, filters = {}, currentUser) {
    const normalizedRoleFilter = normalizeRole(filters.role);
    const listableRoles = getListableUserRoles(currentUser);
    const actorStoreIds = getAccessibleStoreIds(currentUser);

    if (!listableRoles.length) {
      throw new AppError('Forbidden', 403);
    }

    if (normalizedRoleFilter && !listableRoles.includes(normalizedRoleFilter)) {
      throw new AppError('Forbidden', 403);
    }

    const query = this.buildUserQuery({
      ...filters,
      role: normalizedRoleFilter || undefined,
    });

    if (!normalizedRoleFilter) {
      query.role = { $in: listableRoles };
    }

    if (actorStoreIds === null) {
      const skip = (page - 1) * limit;
      const [users, total] = await Promise.all([
        User.find(query)
          .select('-password')
          .populate(USER_STORE_POPULATE)
          .skip(skip)
          .limit(limit)
          .sort({ createdAt: -1 }),
        User.countDocuments(query)
      ]);

      return {
        users,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      };
    }

    const candidates = await User.find(query)
      .select('-password')
      .populate(USER_STORE_POPULATE)
      .sort({ createdAt: -1 });
    const accessFlags = await Promise.all(
      candidates.map(async (user) => {
        if (normalizeRole(user.role) === ROLE.CUSTOMER) {
          return this.canActorAccessCustomer(currentUser, user._id);
        }

        return this.canActorAccessBusinessUser(currentUser, user);
      })
    );
    const filteredUsers = candidates.filter((user, index) => Boolean(accessFlags[index]));
    const { rows, pagination } = this.paginateRows(filteredUsers, page, limit);

    return {
      users: rows,
      pagination
    };
  }

  // Get user by ID
  async getUserById(userId, currentUser) {
    const user = await User.findById(userId)
      .select('-password')
      .populate(USER_STORE_POPULATE);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (!canReadUserRecord(currentUser, user)) {
      throw new AppError('Forbidden', 403);
    }

    if (normalizeRole(user.role) === ROLE.CUSTOMER) {
      const canAccessCustomer = await this.canActorAccessCustomer(currentUser, user._id);
      if (!canAccessCustomer) {
        throw new AppError('Forbidden', 403);
      }
    } else if (!this.canActorAccessBusinessUser(currentUser, user)) {
      throw new AppError('Forbidden', 403);
    }

    return user;
  }

  // Update user
  async updateUser(userId, updateData, currentUser) {
    const { name, email, role } = updateData;
    const existingUser = await User.findById(userId)
      .select('-password')
      .populate(USER_STORE_POPULATE);
    if (!existingUser) {
      throw new AppError('User not found', 404);
    }

    const nextRole = role === undefined ? existingUser.role : normalizeRole(role);
    if (!canManageUserRole(currentUser, nextRole) || !canReadUserRecord(currentUser, existingUser)) {
      throw new AppError('Forbidden', 403);
    }

    // Check if email is being changed and if it's already taken
    if (email) {
      const duplicateUser = await User.findOne({ email, _id: { $ne: userId } });
      if (duplicateUser) {
        throw new AppError('Email already in use', 400);
      }
    }

    if (normalizeRole(existingUser.role) === ROLE.CUSTOMER) {
      const canAccessCustomer = await this.canActorAccessCustomer(currentUser, existingUser._id);
      if (!canAccessCustomer) {
        throw new AppError('Forbidden', 403);
      }
    } else if (!this.canActorAccessBusinessUser(currentUser, existingUser)) {
      throw new AppError('Forbidden', 403);
    }

    const nextStoreAccess = await this.normalizeUserStoreAccess(
      updateData.storeAccess !== undefined ? updateData.storeAccess : existingUser.storeAccess,
      nextRole
    );
    this.assertActorCanAssignStoreAccess(currentUser, nextStoreAccess, nextRole);

    const updatePayload = {};
    if (name !== undefined) updatePayload.name = name;
    if (email !== undefined) updatePayload.email = email;
    if (role !== undefined) updatePayload.role = nextRole;
    if (updateData.phone !== undefined) updatePayload.phone = String(updateData.phone || '').trim();
    if (updateData.department !== undefined) {
      updatePayload.department = String(updateData.department || '').trim();
    }
    if (updateData.position !== undefined) {
      updatePayload.position = String(updateData.position || '').trim();
    }
    if (updateData.permissions !== undefined) {
      updatePayload.permissions = Array.isArray(updateData.permissions)
        ? updateData.permissions.map((value) => String(value || '').trim()).filter(Boolean)
        : [];
    }
    if (updateData.storeAccess !== undefined || role !== undefined) {
      updatePayload.storeAccess = nextStoreAccess;
    }

    if (!Object.keys(updatePayload).length) {
      throw new AppError('No user fields to update', 400);
    }

    const user = await User.findByIdAndUpdate(userId, updatePayload, {
      new: true,
      runValidators: true
    }).select('-password').populate(USER_STORE_POPULATE);

    return user;
  }

  // Delete user
  async deleteUser(userId, currentUser) {
    const targetUser = await User.findById(userId)
      .select('-password')
      .populate(USER_STORE_POPULATE);
    if (!targetUser) {
      throw new AppError('User not found', 404);
    }

    if (!canDeleteUser(currentUser, targetUser)) {
      throw new AppError('Forbidden', 403);
    }

    if (normalizeRole(targetUser.role) === ROLE.CUSTOMER) {
      const canAccessCustomer = await this.canActorAccessCustomer(currentUser, targetUser._id);
      if (!canAccessCustomer) {
        throw new AppError('Forbidden', 403);
      }
    } else if (!this.canActorAccessBusinessUser(currentUser, targetUser)) {
      throw new AppError('Forbidden', 403);
    }

    const [orderCount, invoiceCount] = await Promise.all([
      Order.countDocuments({ userId }),
      Invoice.countDocuments({ userId })
    ]);

    if (orderCount > 0 || invoiceCount > 0) {
      throw new AppError(
        'User has related orders/invoices and cannot be deleted',
        400
      );
    }

    await User.findByIdAndDelete(userId);
    return targetUser;
  }

  // Change password
  async changePassword(userId, currentPassword, newPassword) {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new AppError('Current password is incorrect', 400);
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    return { message: 'Password changed successfully' };
  }

  // Get user statistics
  async getUserStats(currentUser) {
    const visibleRoles = getListableUserRoles(currentUser);
    const actorStoreIds = getAccessibleStoreIds(currentUser);

    if (!visibleRoles.length) {
      throw new AppError('Forbidden', 403);
    }

    if (actorStoreIds === null) {
      const stats = await User.aggregate([
        {
          $match: {
            role: { $in: visibleRoles }
          }
        },
        {
          $group: {
            _id: '$role',
            count: { $sum: 1 }
          }
        }
      ]);

      const total = await User.countDocuments({
        role: { $in: visibleRoles }
      });

      return {
        total,
        byRole: stats.reduce((acc, stat) => {
          acc[stat._id] = stat.count;
          return acc;
        }, {})
      };
    }

    const candidates = await User.find({
      role: { $in: visibleRoles }
    })
      .select('-password')
      .populate(USER_STORE_POPULATE);
    const accessFlags = await Promise.all(
      candidates.map(async (user) => {
        if (normalizeRole(user.role) === ROLE.CUSTOMER) {
          return this.canActorAccessCustomer(currentUser, user._id);
        }

        return this.canActorAccessBusinessUser(currentUser, user);
      })
    );
    const accessibleUsers = candidates.filter((user, index) => Boolean(accessFlags[index]));

    const byRole = accessibleUsers.reduce((acc, user) => {
      const roleKey = normalizeRole(user.role) || ROLE.CUSTOMER;
      acc[roleKey] = Number(acc[roleKey] || 0) + 1;
      return acc;
    }, {});

    return {
      total: accessibleUsers.length,
      byRole
    };
  }
}

module.exports = new UserService();
