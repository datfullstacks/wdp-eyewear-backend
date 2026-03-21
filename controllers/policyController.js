const asyncHandler = require("../helpers/asyncHandler");
const ApiResponse = require("../helpers/response");
const { Policy } = require("../models/Policy");

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

exports.createPolicy = asyncHandler(async (req, res) => {
  const policy = await Policy.create({
    ...req.body,
    createdBy: req.user?._id || null,
    updatedBy: req.user?._id || null,
  });

  ApiResponse.created(res, toPolicyPayload(policy), "Policy created successfully");
});

exports.getPolicyById = asyncHandler(async (req, res) => {
  const policy = await Policy.findById(req.params.id);
  if (!policy) {
    return ApiResponse.notFound(res, "Policy not found");
  }

  ApiResponse.success(res, toPolicyPayload(policy));
});

exports.updatePolicy = asyncHandler(async (req, res) => {
  const policy = await Policy.findByIdAndUpdate(
    req.params.id,
    {
      ...req.body,
      updatedBy: req.user?._id || null,
    },
    { new: true, runValidators: true },
  );

  if (!policy) {
    return ApiResponse.notFound(res, "Policy not found");
  }

  ApiResponse.success(res, toPolicyPayload(policy), "Policy updated successfully");
});

exports.deletePolicy = asyncHandler(async (req, res) => {
  const policy = await Policy.findByIdAndDelete(req.params.id);
  if (!policy) {
    return ApiResponse.notFound(res, "Policy not found");
  }

  ApiResponse.success(res, null, "Policy deleted successfully");
});
