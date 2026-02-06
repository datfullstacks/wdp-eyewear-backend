const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const AppError = require('../errors/AppError');
const { supabaseAuth } = require('./supabaseClient');

class AuthService {
  // Generate JWT Token
  generateToken(userId, userRole) {
    return jwt.sign(
      { id: userId, role: userRole },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
  }

  // Register new user
  async register(userData) {
    const { name, email, password, role } = userData;

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new AppError('User already exists', 400);
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      provider: 'local',
      role: role || 'customer'
    });

    // Generate token
    const token = this.generateToken(user._id, user.role);

    return {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      token
    };
  }

  // Login user
  async login(email, password) {
    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      throw new AppError('Invalid credentials', 401);
    }

    // Google users cannot login with email/password
    if (user.provider === 'google' && !user.password) {
      throw new AppError('Tài khoản này sử dụng Google. Vui lòng đăng nhập bằng Google.', 401);
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new AppError('Invalid credentials', 401);
    }

    // Generate token
    const token = this.generateToken(user._id, user.role);

    return {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar
      },
      token
    };
  }

  // Login with Google (via Supabase OAuth – verify accessToken)
  async loginWithGoogle(accessToken) {
    if (!supabaseAuth) {
      throw new AppError('Supabase is not configured', 500);
    }

    // Verify Supabase access_token → lấy user info
    const { data: userData, error: supabaseError } =
      await supabaseAuth.auth.getUser(accessToken);

    if (supabaseError || !userData?.user) {
      throw new AppError(
        `Google authentication failed: ${supabaseError?.message || 'Invalid token'}`,
        401
      );
    }

    const meta = userData.user.user_metadata || {};
    const email = meta.email || userData.user.email;
    const fullName = meta.full_name || meta.name;
    const avatarUrl = meta.avatar_url || meta.picture;
    const googleId = meta.sub || userData.user.id;

    if (!email) {
      throw new AppError('Could not retrieve email from Google account', 400);
    }

    // Find or create user in MongoDB
    let user = await User.findOne({ email });

    if (!user) {
      // Create new user for Google sign-in (no password)
      user = await User.create({
        name: fullName || email.split('@')[0],
        email,
        provider: 'google',
        googleId,
        avatar: avatarUrl,
      });
    } else {
      // Link Google info to existing account if not linked yet
      let needsSave = false;
      if (!user.googleId) {
        user.googleId = googleId;
        needsSave = true;
      }
      if (avatarUrl && !user.avatar) {
        user.avatar = avatarUrl;
        needsSave = true;
      }
      if (needsSave) await user.save();
    }

    const token = this.generateToken(user._id, user.role);

    return {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        provider: user.provider,
      },
      token,
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

  // Verify token
  verifyToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      throw new AppError('Invalid token', 401);
    }
  }
}

module.exports = new AuthService();
