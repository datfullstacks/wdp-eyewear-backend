const asyncHandler = require("../helpers/asyncHandler");
const ApiResponse = require("../helpers/response");
const { SystemConfig } = require("../models/SystemConfig");
const { getOrCreateSystemConfig } = require("../helpers/systemConfig");

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

  const nextConfig = await SystemConfig.findByIdAndUpdate(
    current._id,
    {
      $set: {
        featureFlags: {
          ...current.featureFlags?.toObject?.(),
          ...(req.body.featureFlags || {}),
        },
        payments: {
          ...current.payments?.toObject?.(),
          ...(req.body.payments || {}),
        },
        shipping: {
          ...current.shipping?.toObject?.(),
          ...(req.body.shipping || {}),
        },
        notifications: {
          ...current.notifications?.toObject?.(),
          ...(req.body.notifications || {}),
        },
        refunds: {
          ...current.refunds?.toObject?.(),
          ...(req.body.refunds || {}),
        },
        integrations: {
          ...current.integrations?.toObject?.(),
          ...(req.body.integrations || {}),
        },
        maintenanceMode:
          typeof req.body.maintenanceMode === "boolean"
            ? req.body.maintenanceMode
            : current.maintenanceMode,
        updatedBy: req.user?._id || null,
      },
    },
    { new: true, runValidators: true },
  );

  ApiResponse.success(
    res,
    toPayload(nextConfig),
    "System config updated successfully",
  );
});
