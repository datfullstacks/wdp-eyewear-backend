// User roles
const USER_ROLES = {
  CUSTOMER: 'customer',
  SALES: 'sales',
  OPERATIONS: 'operations',
  MANAGER: 'manager',
  ADMIN: 'admin'
};

// Order status
const ORDER_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  RETURNED: 'returned'
};

// Order types
const ORDER_TYPES = {
  READY_STOCK: 'ready_stock',      // Kính có sẵn
  PRE_ORDER: 'pre_order',          // Đặt trước
  PRESCRIPTION: 'prescription'      // Làm kính theo đơn
};

// Payment status
const PAYMENT_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  REFUNDED: 'refunded'
};

// Payment methods
const PAYMENT_METHODS = {
  COD: 'cod',
  CREDIT_CARD: 'credit_card',
  BANK_TRANSFER: 'bank_transfer',
  E_WALLET: 'e_wallet'
};

// Product types
const PRODUCT_TYPES = {
  FRAME: 'frame',      // Gọng kính
  LENS: 'lens',        // Tròng kính
  SUNGLASSES: 'sunglasses',
  ACCESSORIES: 'accessories'
};

// HTTP Status codes
const HTTP_STATUS = {
  // 2xx Success
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  
  // 4xx Client Errors
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  GONE: 410,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  
  // 5xx Server Errors
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
};

// Pagination defaults
const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100
};

module.exports = {
  USER_ROLES,
  ORDER_STATUS,
  ORDER_TYPES,
  PAYMENT_STATUS,
  PAYMENT_METHODS,
  PRODUCT_TYPES,
  HTTP_STATUS,
  PAGINATION
};
