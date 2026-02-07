const User = require('../models/User');
const Product = require('../models/Product');
const AppError = require('../errors/AppError');

class UserService {
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
      axis: String(eye?.axis ?? '').trim()
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
    return user.notifications;
  }

  // Get all users with pagination
  async getAllUsers(page = 1, limit = 10, filters = {}) {
    const skip = (page - 1) * limit;
    
    const query = {};
    if (filters.role) query.role = filters.role;
    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: 'i' } },
        { email: { $regex: filters.search, $options: 'i' } }
      ];
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password')
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

  // Get user by ID
  async getUserById(userId) {
    const user = await User.findById(userId).select('-password');
    if (!user) {
      throw new AppError('User not found', 404);
    }
    return user;
  }

  // Update user
  async updateUser(userId, updateData) {
    const { name, email, role } = updateData;

    // Check if email is being changed and if it's already taken
    if (email) {
      const existingUser = await User.findOne({ email, _id: { $ne: userId } });
      if (existingUser) {
        throw new AppError('Email already in use', 400);
      }
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { name, email, role },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      throw new AppError('User not found', 404);
    }

    return user;
  }

  // Delete user
  async deleteUser(userId) {
    const user = await User.findByIdAndDelete(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }
    return user;
  }

  // Change password
  async changePassword(userId, currentPassword, newPassword) {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Verify current password
    const bcrypt = require('bcryptjs');
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
  async getUserStats() {
    const stats = await User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);

    const total = await User.countDocuments();

    return {
      total,
      byRole: stats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {})
    };
  }
}

module.exports = new UserService();
