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

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new AppError('User already exists', 400);
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      provider: 'local',
      role: role || 'customer'
    });

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
    const user = await User.findOne({ email });
    if (!user) {
      throw new AppError('Invalid credentials', 401);
    }

    if (user.provider === 'google' && !user.password) {
      throw new AppError('This account uses Google sign-in. Please login with Google.', 401);
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new AppError('Invalid credentials', 401);
    }

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

  // Login with Google via Supabase.
  // Supports either Supabase accessToken or Google idToken.
  async loginWithGoogle({ accessToken, idToken }) {
    if (!supabaseAuth) {
      throw new AppError('Supabase is not configured', 500);
    }

    if (!accessToken && !idToken) {
      throw new AppError('accessToken or idToken is required', 400);
    }

    let supabaseAccessToken = accessToken;

    if (!supabaseAccessToken && idToken) {
      const { data: signInData, error: signInError } =
        await supabaseAuth.auth.signInWithIdToken({
          provider: 'google',
          token: idToken
        });

      if (signInError || !signInData?.session?.access_token) {
        throw new AppError(
          `Google authentication failed: ${signInError?.message || 'Invalid Google idToken'}`,
          401
        );
      }

      supabaseAccessToken = signInData.session.access_token;
    }

    const { data: userData, error: supabaseError } =
      await supabaseAuth.auth.getUser(supabaseAccessToken);

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

    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        name: fullName || email.split('@')[0],
        email,
        provider: 'google',
        googleId,
        avatar: avatarUrl
      });
    } else {
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
        provider: user.provider
      },
      token,
      supabaseAccessToken
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
