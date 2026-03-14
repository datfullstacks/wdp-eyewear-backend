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

const ORDER_OPS_STAGE = {
  NONE: 'none',
  PENDING_OPERATIONS: 'pending_operations',
  PICKING: 'picking',
  WAITING_CUSTOMER_INFO: 'waiting_customer_info',
  ON_HOLD: 'on_hold',
  WAITING_ARRIVAL: 'waiting_arrival',
  ARRIVED: 'arrived',
  STOCKED: 'stocked',
  READY_TO_PACK: 'ready_to_pack',
  WAITING_LAB: 'waiting_lab',
  LENS_PROCESSING: 'lens_processing',
  LENS_FITTING: 'lens_fitting',
  QC_CHECK: 'qc_check',
  PACKING: 'packing',
  READY_TO_SHIP: 'ready_to_ship',
  SHIPMENT_CREATED: 'shipment_created',
  HANDOVER_TO_CARRIER: 'handover_to_carrier',
  IN_TRANSIT: 'in_transit',
  DELIVERY_FAILED: 'delivery_failed',
  WAITING_REDELIVERY: 'waiting_redelivery',
  RETURN_PENDING: 'return_pending',
  RETURN_IN_TRANSIT: 'return_in_transit',
  EXCEPTION_HOLD: 'exception_hold',
  DELIVERED: 'delivered',
  CLOSED: 'closed',
  RETURNED: 'returned',
  CANCELLED: 'cancelled'
};

// Order types
const ORDER_TYPES = {
  READY_STOCK: 'ready_stock',      // K?nh c? s?n
  PRE_ORDER: 'pre_order',          // ??t tr??c
  PRESCRIPTION: 'prescription'      // L?m k?nh theo ??n
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
  E_WALLET: 'e_wallet',
  SEPAY: 'sepay' // current accepted method
};

// Product types
const PRODUCT_TYPES = {
  FRAME: 'frame',                // G?ng k?nh
  LENS: 'lens',                  // Tr?ng k?nh
  SUNGLASSES: 'sunglasses',      // K?nh m?t
  CONTACT_LENS: 'contact_lens',  // K?nh ?p tr?ng
  ACCESSORY: 'accessory',        // Ph? ki?n
  SERVICE: 'service',            // D?ch v?
  BUNDLE: 'bundle',              // Combo
  GIFT_CARD: 'gift_card',        // Th? qu?
  OTHER: 'other'                 // Kh?c
};

// Product status
const PRODUCT_STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  OUT_OF_STOCK: 'out_of_stock'
};

// Try-on status
const TRY_ON_STATUS = {
  DRAFT: 'draft',
  PENDING_REVIEW: 'pending_review',
  APPROVED: 'approved',
  PUBLISHED: 'published',
  REJECTED: 'rejected',
  ARCHIVED: 'archived'
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

// Accessory categories (for validation)
const ACCESSORY_CATEGORIES = [
  'replacement_part',
  'care_solution',
  'case',
  'cleaning_kit',
  'cloth',
  'strap',
  'solution',
  'kit'
];

module.exports = {
  USER_ROLES,
  ORDER_STATUS,
  ORDER_OPS_STAGE,
  ORDER_TYPES,
  PAYMENT_STATUS,
  PAYMENT_METHODS,
  PRODUCT_TYPES,
  PRODUCT_STATUS,
  TRY_ON_STATUS,
  HTTP_STATUS,
  PAGINATION,
  ACCESSORY_CATEGORIES
};
