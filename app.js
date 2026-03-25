require('dotenv').config();
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const connectDB = require('./config/database');
const corsOptions = require('./config/cors');
const { swaggerUi, swaggerDocs } = require('./config/swagger');
const errorHandler = require('./errors/errorHandler');
const AppError = require('./errors/AppError');
const { hydrateOptionalUser } = require('./middlewares/auth');
const { enforceRuntimeMaintenance } = require('./middlewares/runtimeSystemConfig');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var authRouter = require('./routes/auth');
var uploadRouter = require('./routes/upload');
var productsRouter = require('./routes/products');
var checkoutRouter = require('./routes/checkout');
var paymentsRouter = require('./routes/payments');
var ordersRouter = require('./routes/orders');
var supportRouter = require('./routes/support');
var invoicesRouter = require('./routes/invoices');
var inventoryRouter = require('./routes/inventory');
var preordersRouter = require('./routes/preorders');
var cartsRouter = require('./routes/carts');
var promotionsRouter = require('./routes/promotions');
var locationsRouter = require('./routes/locations');
var storesRouter = require('./routes/stores');
var policiesRouter = require('./routes/policies');
var systemConfigRouter = require('./routes/systemConfig');
var analyticsRouter = require('./routes/analytics');

var app = express();

// Database connection
connectDB();

// Security middleware
app.use(helmet());
app.use(cors(corsOptions));

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(hydrateOptionalUser);
app.use(enforceRuntimeMaintenance);

// Serve static files (for uploaded images)
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'WDP Eyewear API Docs'
}));

// Routes
app.use('/', indexRouter);
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/uploads', uploadRouter);
app.use('/api/products', productsRouter);
app.use('/api/checkout', checkoutRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/support', supportRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/preorders', preordersRouter);
app.use('/api/carts', cartsRouter);
app.use('/api/promotions', promotionsRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/stores', storesRouter);
app.use('/api/policies', policiesRouter);
app.use('/api/system-config', systemConfigRouter);
app.use('/api/analytics', analyticsRouter);

// Handle undefined routes
app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Global error handler
app.use(errorHandler);

module.exports = app;
