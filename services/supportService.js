const mongoose = require("mongoose");

const AppError = require("../errors/AppError");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Store = require("../models/Store");
const {
  SupportTicket,
  SUPPORT_TICKET_CATEGORIES,
  GENERAL_SUPPORT_STATUSES,
  WARRANTY_SUPPORT_STATUSES,
  SUPPORT_TICKET_STATUSES,
} = require("../models/SupportTicket");
const {
  isBusinessUser,
  isCustomer,
  isStaff,
  isOperation,
  isManager,
  getUserId,
} = require("../helpers/roles");
const {
  canAccessStore,
  buildStoreScopedQuery,
  getAccessibleStoreIds,
  normalizeStoreId,
} = require("../helpers/storeAccess");

const SUPPORT_CATEGORY_SET = new Set(SUPPORT_TICKET_CATEGORIES);
const SUPPORT_STATUS_SET = new Set(SUPPORT_TICKET_STATUSES);
const GENERAL_STATUS_SET = new Set(GENERAL_SUPPORT_STATUSES);
const WARRANTY_STATUS_SET = new Set(WARRANTY_SUPPORT_STATUSES);
const WARRANTY_ELIGIBILITY_SET = new Set([
  "eligible",
  "expired",
  "not_covered",
]);
const SUPPORT_PRIORITY_SET = new Set(["low", "normal", "high"]);
const WARRANTY_TRANSITIONS = Object.freeze({
  requested: ["under_review", "rejected"],
  under_review: ["approved", "rejected"],
  approved: ["in_service", "completed"],
  in_service: ["completed"],
  rejected: [],
  completed: [],
});
const REFUND_STATUS_SET = new Set([
  "requested",
  "reviewing",
  "waiting_customer_info",
  "escalated_to_manager",
  "approved",
  "return_pending",
  "return_received",
  "processing",
  "completed",
  "rejected",
]);

const TICKET_POPULATE = [
  { path: "userId", select: "name email role" },
  {
    path: "orderId",
    select: "paymentCode status orderType total storeId userId createdAt",
  },
  { path: "storeId", select: "name code type status city district" },
  { path: "warranty.productId", select: "name slug fulfillment.warrantyMonths" },
];

function toTrimmedString(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }

  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizeCategory(value) {
  const normalized = toTrimmedString(value, "general").toLowerCase();
  return SUPPORT_CATEGORY_SET.has(normalized) ? normalized : "general";
}

function normalizeStatus(value) {
  const normalized = toTrimmedString(value, "").toLowerCase();
  return SUPPORT_STATUS_SET.has(normalized) ? normalized : "";
}

function isWarrantyCategory(category) {
  return normalizeCategory(category) === "warranty";
}

function parsePagination(options = {}) {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 10));
  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

function addMonths(date, months) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  const next = new Date(date);
  next.setMonth(next.getMonth() + Number(months || 0));
  return next;
}

function resolveWarrantyReferenceDate(order) {
  const deliveredState = toTrimmedString(order?.shipment?.state, "").toLowerCase();
  const shipmentDate =
    deliveredState === "delivered"
      ? order?.shipment?.lastActionAt ||
        order?.shipment?.updatedAt ||
        order?.shipment?.createdAt
      : null;
  const candidate = shipmentDate || order?.confirmedAt || order?.createdAt;
  const normalized = candidate ? new Date(candidate) : null;
  if (!normalized || Number.isNaN(normalized.getTime())) {
    return null;
  }
  return normalized;
}

function buildWarrantySnapshot(order, orderItem, product) {
  const warrantyMonths = Math.max(
    0,
    Number(product?.fulfillment?.warrantyMonths || 0),
  );
  const referenceDate = resolveWarrantyReferenceDate(order);
  const expiresAt =
    warrantyMonths > 0 && referenceDate ? addMonths(referenceDate, warrantyMonths) : null;
  const now = new Date();
  const eligibility =
    warrantyMonths <= 0
      ? "not_covered"
      : expiresAt && expiresAt >= now
        ? "eligible"
        : "expired";

  return {
    orderItemId: orderItem?._id || null,
    productId: orderItem?.productId || product?._id || null,
    variantId: orderItem?.variantId || null,
    itemName: toTrimmedString(orderItem?.name || product?.name, ""),
    warrantyMonths,
    referenceDate,
    expiresAt,
    eligibility,
    decisionNote: "",
    serviceNote: "",
    approvedBy: null,
    approvedAt: null,
    completedBy: null,
    completedAt: null,
  };
}

function buildPagination(page, limit, total) {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

function assertSupportAccess(currentUser) {
  if (!currentUser || (!isCustomer(currentUser) && !isBusinessUser(currentUser))) {
    throw new AppError("Forbidden", 403);
  }
}

function assertBusinessTicketAccess(ticket, currentUser) {
  if (!isBusinessUser(currentUser)) {
    throw new AppError("Forbidden", 403);
  }

  const ticketStoreId = normalizeStoreId(ticket?.storeId);
  if (!ticketStoreId) {
    if (!isManager(currentUser)) {
      throw new AppError("Forbidden", 403);
    }
    return;
  }

  if (!canAccessStore(currentUser, ticketStoreId)) {
    throw new AppError("Forbidden", 403);
  }
}

function buildBusinessTicketVisibilityQuery(currentUser) {
  if (!isBusinessUser(currentUser)) {
    throw new AppError("Forbidden", 403);
  }

  const accessibleStoreIds = getAccessibleStoreIds(currentUser);
  if (isManager(currentUser)) {
    if (accessibleStoreIds === null) {
      return {};
    }

    return {
      $or: [
        { storeId: { $in: accessibleStoreIds } },
        { storeId: null },
      ],
    };
  }

  if (accessibleStoreIds === null) {
    return {
      storeId: { $ne: null },
    };
  }

  return {
    storeId: { $in: accessibleStoreIds },
  };
}

async function findAccessibleOrder(orderId, currentUser) {
  if (!orderId || !mongoose.isValidObjectId(orderId)) {
    throw new AppError("orderId is invalid", 400);
  }

  const order = await Order.findById(orderId).select(
    "_id userId storeId status orderType createdAt confirmedAt shipment items paymentCode",
  );
  if (!order) {
    throw new AppError("Order not found", 404);
  }

  const actorUserId = getUserId(currentUser);
  if (isCustomer(currentUser) && String(order.userId) !== String(actorUserId)) {
    throw new AppError("Forbidden", 403);
  }

  if (isBusinessUser(currentUser)) {
    const orderStoreId = normalizeStoreId(order.storeId);
    if (orderStoreId && !canAccessStore(currentUser, orderStoreId)) {
      throw new AppError("Forbidden", 403);
    }
  }

  return order;
}

async function resolveRequestedStoreId(storeId, currentUser) {
  const normalizedStoreId = normalizeStoreId(storeId);
  if (!normalizedStoreId) {
    return "";
  }

  const exists = await Store.exists({ _id: normalizedStoreId });
  if (!exists) {
    throw new AppError("Store not found", 404);
  }

  if (isBusinessUser(currentUser) && !canAccessStore(currentUser, normalizedStoreId)) {
    throw new AppError("Forbidden", 403);
  }

  return normalizedStoreId;
}

function populateTicketQuery(query) {
  return query.populate(TICKET_POPULATE);
}

async function findSearchableOrderIds(currentUser, search) {
  const normalizedSearch = toTrimmedString(search, "");
  if (!normalizedSearch) {
    return [];
  }

  const orderQuery = {
    $or: [
      { paymentCode: { $regex: normalizedSearch, $options: "i" } },
      { "shippingAddress.fullName": { $regex: normalizedSearch, $options: "i" } },
      { "shippingAddress.phone": { $regex: normalizedSearch, $options: "i" } },
    ],
  };

  if (isCustomer(currentUser)) {
    orderQuery.userId = getUserId(currentUser);
  } else {
    Object.assign(orderQuery, buildStoreScopedQuery(currentUser, "storeId"));
  }

  const orders = await Order.find(orderQuery).select("_id").limit(50);
  return orders.map((order) => order?._id).filter(Boolean);
}

function validateWarrantyTransition(currentStatus, nextStatus, currentUser) {
  if (!WARRANTY_STATUS_SET.has(nextStatus)) {
    throw new AppError("Invalid warranty status", 400);
  }

  if (isManager(currentUser)) {
    return;
  }

  if (isOperation(currentUser)) {
    if (!["in_service", "completed"].includes(nextStatus)) {
      throw new AppError(
        "Operations can only move warranty cases to in_service or completed",
        403,
      );
    }
  } else if (isStaff(currentUser)) {
    if (!["under_review", "approved", "rejected"].includes(nextStatus)) {
      throw new AppError(
        "Sales/support can only review or decide warranty cases",
        403,
      );
    }
  } else {
    throw new AppError("Forbidden", 403);
  }

  const allowed = WARRANTY_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(nextStatus)) {
    throw new AppError(
      `Warranty status cannot transition from ${currentStatus} to ${nextStatus}`,
      400,
    );
  }
}

class SupportService {
  async listTickets(currentUser, options = {}) {
    assertSupportAccess(currentUser);

    const { page, limit, skip } = parsePagination(options);
    const query = {};
    const normalizedCategory = options.category
      ? normalizeCategory(options.category)
      : "";
    const normalizedStatus = normalizeStatus(options.status);
    const normalizedEligibility = toTrimmedString(options.eligibility, "").toLowerCase();
    const normalizedSearch = toTrimmedString(options.q, "");
    const normalizedOrderId = toTrimmedString(
      options.orderId || options.order_id,
      "",
    );

    if (normalizedCategory) {
      query.category = normalizedCategory;
    }

    if (normalizedStatus) {
      query.status = normalizedStatus;
    }

    if (normalizedEligibility) {
      if (!WARRANTY_ELIGIBILITY_SET.has(normalizedEligibility)) {
        throw new AppError("Invalid warranty eligibility filter", 400);
      }
      query["warranty.eligibility"] = normalizedEligibility;
      if (!query.category) {
        query.category = "warranty";
      }
    }

    if (isCustomer(currentUser)) {
      query.userId = getUserId(currentUser);
    } else {
      Object.assign(query, buildBusinessTicketVisibilityQuery(currentUser));
      if (options.userId && mongoose.isValidObjectId(options.userId)) {
        query.userId = options.userId;
      }
    }

    if (normalizedOrderId) {
      const order = await findAccessibleOrder(normalizedOrderId, currentUser);
      query.orderId = order._id;
    }

    if (normalizedSearch) {
      const matchedOrderIds = await findSearchableOrderIds(
        currentUser,
        normalizedSearch,
      );
      const searchConditions = [
        { subject: { $regex: normalizedSearch, $options: "i" } },
      ];

      if (matchedOrderIds.length > 0) {
        searchConditions.push({ orderId: { $in: matchedOrderIds } });
      }

      query.$or = searchConditions;
    }

    const [tickets, total] = await Promise.all([
      populateTicketQuery(
        SupportTicket.find(query).sort({ lastMessageAt: -1, createdAt: -1 }),
      )
        .skip(skip)
        .limit(limit),
      SupportTicket.countDocuments(query),
    ]);

    return {
      tickets,
      pagination: buildPagination(page, limit, total),
    };
  }

  async listWarrantyCases(currentUser, options = {}) {
    if (!isBusinessUser(currentUser)) {
      throw new AppError("Forbidden", 403);
    }

    const result = await this.listTickets(currentUser, {
      ...options,
      category: "warranty",
    });

    return {
      cases: result.tickets,
      pagination: result.pagination,
    };
  }

  async listRefundCases(currentUser, options = {}) {
    if (!isBusinessUser(currentUser)) {
      throw new AppError("Forbidden", 403);
    }

    const { page, limit, skip } = parsePagination(options);
    const query = {
      "refund.status": { $ne: "none" },
      ...buildStoreScopedQuery(currentUser, "storeId"),
    };
    const normalizedStatus = toTrimmedString(options.status, "").toLowerCase();
    const ownerRole = toTrimmedString(options.ownerRole, "").toLowerCase();
    const search = toTrimmedString(options.q, "");

    if (normalizedStatus) {
      if (!REFUND_STATUS_SET.has(normalizedStatus)) {
        throw new AppError("Invalid refund status filter", 400);
      }
      query["refund.status"] = normalizedStatus;
    }

    if (ownerRole) {
      query["refund.currentOwnerRole"] = ownerRole;
    }

    if (search) {
      query.$or = [
        { paymentCode: { $regex: search, $options: "i" } },
        { "shippingAddress.fullName": { $regex: search, $options: "i" } },
        { "shippingAddress.phone": { $regex: search, $options: "i" } },
      ];
    }

    const [cases, total] = await Promise.all([
      Order.find(query)
        .populate([
          { path: "userId", select: "name email role" },
          { path: "storeId", select: "name code type status city district" },
        ])
        .sort({ updatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(query),
    ]);

    return {
      cases,
      pagination: buildPagination(page, limit, total),
    };
  }

  async getTicketById(id, currentUser) {
    assertSupportAccess(currentUser);

    const ticket = await populateTicketQuery(SupportTicket.findById(id));
    if (!ticket) {
      throw new AppError("Support ticket not found", 404);
    }

    const actorUserId = getUserId(currentUser);
    if (String(ticket.userId?._id || ticket.userId) === String(actorUserId)) {
      return ticket;
    }

    assertBusinessTicketAccess(ticket, currentUser);
    return ticket;
  }

  async createTicket(currentUser, payload = {}) {
    assertSupportAccess(currentUser);

    const subject = toTrimmedString(payload.subject, "");
    const message = toTrimmedString(payload.message, "");
    if (!subject) {
      throw new AppError("subject is required", 400);
    }
    if (!message) {
      throw new AppError("message is required", 400);
    }

    const category = normalizeCategory(payload.category);
    const orderId = toTrimmedString(payload.orderId || payload.order_id, "");
    const email = toTrimmedString(payload.email || currentUser?.email, "");
    const sender = isBusinessUser(currentUser) ? "staff" : "user";
    const priorityInput = toTrimmedString(payload.priority, "normal").toLowerCase();

    let order = null;
    if (orderId) {
      order = await findAccessibleOrder(orderId, currentUser);
    }

    let status = "open";
    let warranty = null;
    let storeId = normalizeStoreId(order?.storeId);

    if (!storeId) {
      storeId = await resolveRequestedStoreId(
        payload.storeId || payload.store_id,
        currentUser,
      );
    }

    if (isWarrantyCategory(category)) {
      if (!order) {
        throw new AppError("Warranty requests must reference an order", 400);
      }

      const orderItemId = toTrimmedString(
        payload.orderItemId || payload.order_item_id,
        "",
      );
      if (!orderItemId || !mongoose.isValidObjectId(orderItemId)) {
        throw new AppError("orderItemId is required for warranty requests", 400);
      }

      const orderItem = (Array.isArray(order.items) ? order.items : []).find(
        (item) => String(item?._id) === orderItemId,
      );
      if (!orderItem) {
        throw new AppError("Order item not found", 404);
      }

      const product = await Product.findById(orderItem.productId).select(
        "_id name fulfillment.warrantyMonths",
      );
      if (!product) {
        throw new AppError("Product not found for warranty request", 404);
      }

      warranty = buildWarrantySnapshot(order, orderItem, product);
      status = "requested";
    }

    if (isBusinessUser(currentUser) && !isManager(currentUser) && !storeId) {
      throw new AppError(
        "storeId is required when staff creates a ticket without a store-linked order",
        400,
      );
    }

    const ticketUserId = order?.userId || getUserId(currentUser);

    const created = await SupportTicket.create({
      userId: ticketUserId,
      email,
      subject,
      category,
      status,
      priority: SUPPORT_PRIORITY_SET.has(priorityInput) ? priorityInput : "normal",
      orderId: order?._id || null,
      storeId: storeId || null,
      warranty,
      messages: [
        {
          sender,
          message,
        },
      ],
      lastMessageAt: new Date(),
    });

    return this.getTicketById(created._id, currentUser);
  }

  async addReply(id, currentUser, payload = {}) {
    const ticket = await this.getTicketById(id, currentUser);
    const message = toTrimmedString(payload.message, "");
    if (!message) {
      throw new AppError("message is required", 400);
    }

    const actorUserId = getUserId(currentUser);
    const isOwner = String(ticket.userId?._id || ticket.userId) === String(actorUserId);
    if (!isOwner && !isBusinessUser(currentUser)) {
      throw new AppError("Forbidden", 403);
    }

    const sender = isBusinessUser(currentUser) ? "staff" : "user";
    ticket.messages.push({ sender, message });
    ticket.lastMessageAt = new Date();

    if (!isWarrantyCategory(ticket.category)) {
      if (sender === "staff" && ticket.status === "open") {
        ticket.status = "in_progress";
      }
      if (sender === "user" && ["resolved", "closed"].includes(ticket.status)) {
        ticket.status = "in_progress";
      }
    }

    await ticket.save();
    return this.getTicketById(ticket._id, currentUser);
  }

  async updateStatus(id, currentUser, payload = {}) {
    if (!isBusinessUser(currentUser)) {
      throw new AppError("Forbidden", 403);
    }

    const nextStatus =
      typeof payload === "string"
        ? normalizeStatus(payload)
        : normalizeStatus(payload.status);
    if (!nextStatus) {
      throw new AppError("status is required", 400);
    }

    const ticket = await this.getTicketById(id, currentUser);
    assertBusinessTicketAccess(ticket, currentUser);

    if (isWarrantyCategory(ticket.category)) {
      validateWarrantyTransition(ticket.status, nextStatus, currentUser);

      ticket.status = nextStatus;
      if (!ticket.warranty) {
        ticket.warranty = {};
      }

      const decisionNote = toTrimmedString(payload.decisionNote || payload.note, "");
      const serviceNote = toTrimmedString(payload.serviceNote, "");

      if (decisionNote) {
        ticket.warranty.decisionNote = decisionNote;
      }
      if (serviceNote) {
        ticket.warranty.serviceNote = serviceNote;
      }

      if (nextStatus === "approved") {
        ticket.warranty.approvedBy = getUserId(currentUser);
        ticket.warranty.approvedAt = new Date();
      }
      if (nextStatus === "completed") {
        ticket.warranty.completedBy = getUserId(currentUser);
        ticket.warranty.completedAt = new Date();
      }
    } else {
      if (!GENERAL_STATUS_SET.has(nextStatus)) {
        throw new AppError("Invalid support ticket status", 400);
      }
      ticket.status = nextStatus;
    }

    ticket.lastMessageAt = new Date();
    await ticket.save();

    return this.getTicketById(ticket._id, currentUser);
  }
}

module.exports = new SupportService();
module.exports.__private = {
  normalizeCategory,
  isWarrantyCategory,
  resolveWarrantyReferenceDate,
  addMonths,
  buildWarrantySnapshot,
  validateWarrantyTransition,
  buildBusinessTicketVisibilityQuery,
  resolveRequestedStoreId,
};
