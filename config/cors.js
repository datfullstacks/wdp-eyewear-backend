// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman)
    if (!origin) return callback(null, true);

    const allowedOrigins = (process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : [
          process.env.FRONTEND_URL || 'http://localhost:3000',
          process.env.FRONTEND_URL_ALT || 'http://localhost:3001',
          process.env.VITE_DEV_URL || 'http://localhost:5173',
          process.env.EXPO_DEV_URL || 'http://localhost:8081',
          process.env.REACT_NATIVE_NETWORK_URL,
          process.env.PRODUCTION_FRONTEND_URL,
          process.env.MOBILE_APP_URL
        ]
    ).filter(Boolean); // Remove undefined values
    console.log('CORS allowedOrigins:', allowedOrigins);

    console.log('CORS check - request origin:', origin);
    // Allow if origin matches exactly any allowed origin
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // Allow cookies
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

module.exports = corsOptions;
