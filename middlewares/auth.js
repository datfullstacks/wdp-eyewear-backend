const jwt = require('jsonwebtoken');
const User = require('../models/User');

function extractBearerToken(req) {
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    return req.headers.authorization.split(' ')[1];
  }

  return null;
}

async function resolveUserFromToken(token) {
  if (!token) return null;

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await User.findById(decoded.id).select('-password');
  return user || null;
}

exports.hydrateOptionalUser = async (req, res, next) => {
  if (req.user) {
    next();
    return;
  }

  const token = extractBearerToken(req);
  if (!token) {
    next();
    return;
  }

  try {
    const user = await resolveUserFromToken(token);
    if (user) {
      req.user = user;
    }
  } catch (error) {
    // Ignore invalid optional tokens here. Protected routes still enforce auth.
  }

  next();
};

// Protect routes
exports.protect = async (req, res, next) => {
  if (req.user) {
    next();
    return;
  }

  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Not authorized to access this route' });
  }

  try {
    req.user = await resolveUserFromToken(token);
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }

    next();
  } catch (error) {
    return res.status(401).json({ message: 'Not authorized to access this route' });
  }
};

// Authorize roles
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `User role '${req.user.role}' is not authorized to access this route`
      });
    }
    next();
  };
};

exports.extractBearerToken = extractBearerToken;
exports.resolveUserFromToken = resolveUserFromToken;
