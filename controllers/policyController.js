const asyncHandler = require("../helpers/asyncHandler");
const ApiResponse = require("../helpers/response");
const { Policy } = require("../models/Policy");
const User = require("../models/User");
const { ROLE } = require("../helpers/roles");
const {
  broadcastUserNotification,
} = require("../helpers/userNotification");

function normalizeListQuery(query = {}) {
  return {
    page: Math.max(1, Number(query.page || 1)),
    limit: Math.min(100, Math.max(1, Number(query.limit || 20))),
    search: String(query.search || "").trim(),
    category: String(query.category || "").trim().toLowerCase(),
    status: String(query.status || "").trim().toLowerCase(),
  };
}

function buildFilters({ search, category, status }) {
  const filters = {};

  if (category && category !== "all") {
    filters.category = category;
  }

  if (status && status !== "all") {
    filters.status = status;
  }

  if (search) {
    filters.$or = [
      { title: { $regex: search, $options: "i" } },
      { summary: { $regex: search, $options: "i" } },
      { content: { $regex: search, $options: "i" } },
    ];
  }

  return filters;
}

function buildPublicFilters({ search, category }) {
  const now = new Date();
  const filters = [
    { status: "active" },
    { effectiveDate: { $lte: now } },
    {
      $or: [
        { expiryDate: null },
        { expiryDate: { $exists: false } },
        { expiryDate: { $gte: now } },
      ],
    },
  ];

  if (category && category !== "all") {
    filters.push({ category });
  }

  if (search) {
    filters.push({
      $or: [
        { title: { $regex: search, $options: "i" } },
        { summary: { $regex: search, $options: "i" } },
        { content: { $regex: search, $options: "i" } },
      ],
    });
  }

  if (filters.length === 1) {
    return filters[0];
  }

  return { $and: filters };
}

function normalizePolicyDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function resolvePolicyNotificationAction(previousPolicy, nextPolicy) {
  const previousStatus = String(previousPolicy?.status || "").trim().toLowerCase();
  const nextStatus = String(nextPolicy?.status || "").trim().toLowerCase();

  if (previousPolicy && previousStatus === "active" && nextStatus !== "active") {
    return "retired";
  }

  if (nextStatus !== "active") {
    return "";
  }

  if (!previousPolicy || previousStatus !== "active") {
    return "published";
  }

  const fieldsToCompare = [
    "title",
    "category",
    "summary",
    "content",
    "version",
  ];
  const hasFieldChange = fieldsToCompare.some(
    (field) => String(previousPolicy?.[field] || "") !== String(nextPolicy?.[field] || ""),
  );
  const hasDateChange =
    normalizePolicyDate(previousPolicy?.effectiveDate) !==
      normalizePolicyDate(nextPolicy?.effectiveDate) ||
    normalizePolicyDate(previousPolicy?.expiryDate) !==
      normalizePolicyDate(nextPolicy?.expiryDate);

  return hasFieldChange || hasDateChange ? "updated" : "";
}

function formatPolicyEffectiveDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function buildPolicyNotificationPayload(policy, action) {
  const effectiveDateLabel = formatPolicyEffectiveDate(policy?.effectiveDate);
  const title = String(policy?.title || "").trim() || "Chính sách mới";
  const version = String(policy?.version || "").trim() || "1.0";
  const category = String(policy?.category || "").trim() || "general";

  if (action === "retired") {
    return {
      type: "policy",
      title: "Chính sách đã được cập nhật",
      message: `${title} không còn là chính sách đang áp dụng. Vui lòng xem phiên bản mới nhất trong mục chính sách.`,
      data: {
        policyId: String(policy?._id || ""),
        category,
        version,
        status: String(policy?.status || "").trim() || "inactive",
        action,
        path: "/policies",
      },
    };
  }

  return {
    type: "policy",
    title:
      action === "published"
        ? "Chính sách mới đã được ban hành"
        : "Chính sách đã được điều chỉnh",
    message:
      action === "published"
        ? `${title} phiên bản ${version} đã được áp dụng${effectiveDateLabel ? ` từ ngày ${effectiveDateLabel}` : ""}.`
        : `${title} đã được cập nhật lên phiên bản ${version}${effectiveDateLabel ? `, hiệu lực từ ${effectiveDateLabel}` : ""}.`,
    data: {
      policyId: String(policy?._id || ""),
      category,
      version,
      status: String(policy?.status || "").trim() || "active",
      action,
      path: "/policies",
    },
  };
}

async function notifyCustomersAboutPolicyChange(policy, action) {
  if (!action) return;

  const customers = await User.find({ role: ROLE.CUSTOMER }).select("_id").lean();
  const customerIds = customers.map((item) => item?._id).filter(Boolean);

  if (!customerIds.length) {
    return;
  }

  await broadcastUserNotification(
    customerIds,
    buildPolicyNotificationPayload(policy, action),
  );
}

function toPolicyPayload(policy) {
  return {
    id: String(policy._id),
    title: policy.title,
    category: policy.category,
    summary: policy.summary,
    content: policy.content,
    effectiveDate: policy.effectiveDate,
    expiryDate: policy.expiryDate,
    status: policy.status,
    version: policy.version,
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
    createdBy: policy.createdBy,
    updatedBy: policy.updatedBy,
  };
}

exports.listPolicies = asyncHandler(async (req, res) => {
  const query = normalizeListQuery(req.query);
  const filters = buildFilters(query);
  const skip = (query.page - 1) * query.limit;

  const [rows, total] = await Promise.all([
    Policy.find(filters).sort({ updatedAt: -1 }).skip(skip).limit(query.limit),
    Policy.countDocuments(filters),
  ]);

  ApiResponse.paginate(
    res,
    rows.map(toPolicyPayload),
    {
      page: query.page,
      limit: query.limit,
      total,
    },
    "Policies retrieved successfully",
  );
});

exports.listPublicPolicies = asyncHandler(async (req, res) => {
  const query = normalizeListQuery(req.query);
  const filters = buildPublicFilters(query);
  const skip = (query.page - 1) * query.limit;

  const [rows, total] = await Promise.all([
    Policy.find(filters).sort({ effectiveDate: -1, updatedAt: -1 }).skip(skip).limit(query.limit),
    Policy.countDocuments(filters),
  ]);

  ApiResponse.paginate(
    res,
    rows.map(toPolicyPayload),
    {
      page: query.page,
      limit: query.limit,
      total,
    },
    "Active policies retrieved successfully",
  );
});

exports.createPolicy = asyncHandler(async (req, res) => {
  const policy = await Policy.create({
    ...req.body,
    createdBy: req.user?._id || null,
    updatedBy: req.user?._id || null,
  });

  try {
    const action = resolvePolicyNotificationAction(null, policy);
    await notifyCustomersAboutPolicyChange(policy, action);
  } catch (error) {
    console.error(
      "Failed to notify customers about policy creation:",
      error?.message || error,
    );
  }

  ApiResponse.created(res, toPolicyPayload(policy), "Policy created successfully");
});

exports.getPublicPolicyById = asyncHandler(async (req, res) => {
  const policy = await Policy.findOne({
    _id: req.params.id,
    ...buildPublicFilters({}),
  });
  if (!policy) {
    return ApiResponse.notFound(res, "Policy not found");
  }

  ApiResponse.success(res, toPolicyPayload(policy));
});

exports.getPolicyById = asyncHandler(async (req, res) => {
  const policy = await Policy.findById(req.params.id);
  if (!policy) {
    return ApiResponse.notFound(res, "Policy not found");
  }

  ApiResponse.success(res, toPolicyPayload(policy));
});

exports.updatePolicy = asyncHandler(async (req, res) => {
  const policy = await Policy.findById(req.params.id);
  if (!policy) {
    return ApiResponse.notFound(res, "Policy not found");
  }

  const previousPolicy = policy.toObject();
  Object.assign(policy, req.body, {
    updatedBy: req.user?._id || null,
  });
  await policy.save();

  try {
    const action = resolvePolicyNotificationAction(previousPolicy, policy);
    await notifyCustomersAboutPolicyChange(policy, action);
  } catch (error) {
    console.error(
      "Failed to notify customers about policy update:",
      error?.message || error,
    );
  }

  ApiResponse.success(res, toPolicyPayload(policy), "Policy updated successfully");
});

exports.deletePolicy = asyncHandler(async (req, res) => {
  const policy = await Policy.findByIdAndDelete(req.params.id);
  if (!policy) {
    return ApiResponse.notFound(res, "Policy not found");
  }

  try {
    const action = resolvePolicyNotificationAction(policy, {
      ...policy.toObject(),
      status: "inactive",
    });
    await notifyCustomersAboutPolicyChange(
      {
        ...policy.toObject(),
        _id: policy._id,
        status: "inactive",
      },
      action,
    );
  } catch (error) {
    console.error(
      "Failed to notify customers about policy deletion:",
      error?.message || error,
    );
  }

  ApiResponse.success(res, null, "Policy deleted successfully");
});
