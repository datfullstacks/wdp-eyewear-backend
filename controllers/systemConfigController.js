const asyncHandler = require("../helpers/asyncHandler");
const ApiResponse = require("../helpers/response");
const { SystemConfig } = require("../models/SystemConfig");
const { getOrCreateSystemConfig } = require("../helpers/systemConfig");
const AppError = require("../errors/AppError");

function toPayload(config) {
  return {
    id: String(config._id),
    key: config.key,
    featureFlags: config.featureFlags,
    payments: config.payments,
    shipping: config.shipping,
    notifications: config.notifications,
    refunds: {
      staffApprovalLimit: Number(config.refunds?.staffApprovalLimit ?? 300000),
      requiresManagerForReturn:
        typeof config.refunds?.requiresManagerForReturn === "boolean"
          ? config.refunds.requiresManagerForReturn
          : true,
      requiresManagerForShippingRefund:
        typeof config.refunds?.requiresManagerForShippingRefund === "boolean"
          ? config.refunds.requiresManagerForShippingRefund
          : true,
      requirePayoutProof:
        typeof config.refunds?.requirePayoutProof === "boolean"
          ? config.refunds.requirePayoutProof
          : false,
    },
    integrations: config.integrations,
    maintenanceMode: config.maintenanceMode,
    updatedAt: config.updatedAt,
    updatedBy: config.updatedBy,
  };
}

exports.getSystemConfig = asyncHandler(async (req, res) => {
  const config = await getOrCreateSystemConfig();
  ApiResponse.success(res, toPayload(config), "System config retrieved successfully");
});

exports.updateSystemConfig = asyncHandler(async (req, res) => {
  const current = await getOrCreateSystemConfig();
  const payload =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body
      : null;

  if (!payload || Object.keys(payload).length === 0) {
    throw new AppError("Request body must be a non-empty JSON object", 400);
  }

  const nextConfig = await SystemConfig.findByIdAndUpdate(
    current._id,
    {
      $set: {
        featureFlags: {
          ...current.featureFlags?.toObject?.(),
          ...(payload.featureFlags || {}),
        },
        payments: {
          ...current.payments?.toObject?.(),
          ...(payload.payments || {}),
        },
        shipping: {
          ...current.shipping?.toObject?.(),
          ...(payload.shipping || {}),
        },
        notifications: {
          ...current.notifications?.toObject?.(),
          ...(payload.notifications || {}),
        },
        refunds: {
          ...current.refunds?.toObject?.(),
          ...(payload.refunds || {}),
        },
        integrations: {
          ...current.integrations?.toObject?.(),
          ...(payload.integrations || {}),
        },
        maintenanceMode:
          typeof payload.maintenanceMode === "boolean"
            ? payload.maintenanceMode
            : current.maintenanceMode,
        updatedBy: req.user?._id || null,
      },
    },
    { new: true, runValidators: true },
  );

  if (!nextConfig) {
    throw new AppError("System config not found", 404);
  }

  ApiResponse.success(
    res,
    toPayload(nextConfig),
    "System config updated successfully",
  );
});
