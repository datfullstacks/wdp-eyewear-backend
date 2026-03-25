const asyncHandler = require("../helpers/asyncHandler");
const ApiResponse = require("../helpers/response");
const { SystemConfig } = require("../models/SystemConfig");
const {
  getOrCreateSystemConfig,
  getRuntimeSystemConfig,
  invalidateSystemConfigCache,
  normalizeSystemConfigDocument,
} = require("../helpers/systemConfig");
const AppError = require("../errors/AppError");

function toPayload(config) {
  const normalized = normalizeSystemConfigDocument(config);
  return {
    id: String(config._id),
    key: normalized.key,
    featureFlags: normalized.featureFlags,
    payments: normalized.payments,
    shipping: normalized.shipping,
    notifications: normalized.notifications,
    refunds: {
      staffApprovalLimit: Number(normalized.refunds?.staffApprovalLimit ?? 300000),
      requiresManagerForReturn:
        typeof normalized.refunds?.requiresManagerForReturn === "boolean"
          ? normalized.refunds.requiresManagerForReturn
          : true,
      requiresManagerForShippingRefund:
        typeof normalized.refunds?.requiresManagerForShippingRefund === "boolean"
          ? normalized.refunds.requiresManagerForShippingRefund
          : true,
      requirePayoutProof:
        typeof normalized.refunds?.requirePayoutProof === "boolean"
          ? normalized.refunds.requirePayoutProof
          : false,
    },
    integrations: normalized.integrations,
    maintenanceMode: normalized.maintenanceMode,
    updatedAt: config.updatedAt,
    updatedBy: config.updatedBy,
  };
}

exports.getSystemConfig = asyncHandler(async (req, res) => {
  const config = await getOrCreateSystemConfig();
  ApiResponse.success(res, toPayload(config), "System config retrieved successfully");
});

exports.getRuntimeSystemConfig = asyncHandler(async (req, res) => {
  const runtimeConfig = await getRuntimeSystemConfig();
  ApiResponse.success(
    res,
    runtimeConfig,
    "Runtime system config retrieved successfully",
  );
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

  const currentConfig = normalizeSystemConfigDocument(current);
  const nextConfigPayload = normalizeSystemConfigDocument({
    ...currentConfig,
    featureFlags: {
      ...currentConfig.featureFlags,
      ...(payload.featureFlags || {}),
    },
    payments: {
      ...currentConfig.payments,
      ...(payload.payments || {}),
    },
    shipping: {
      ...currentConfig.shipping,
      ...(payload.shipping || {}),
    },
    notifications: {
      ...currentConfig.notifications,
      ...(payload.notifications || {}),
    },
    refunds: {
      ...currentConfig.refunds,
      ...(payload.refunds || {}),
    },
    integrations: {
      ...currentConfig.integrations,
      ...(payload.integrations || {}),
      sepay: {
        ...currentConfig.integrations.sepay,
        ...(payload.integrations?.sepay || {}),
      },
      ghn: {
        ...currentConfig.integrations.ghn,
        ...(payload.integrations?.ghn || {}),
      },
    },
    maintenanceMode:
      typeof payload.maintenanceMode === "boolean"
        ? payload.maintenanceMode
        : currentConfig.maintenanceMode,
  });

  const nextConfig = await SystemConfig.findByIdAndUpdate(
    current._id,
    {
      $set: {
        key: nextConfigPayload.key,
        featureFlags: nextConfigPayload.featureFlags,
        payments: nextConfigPayload.payments,
        shipping: nextConfigPayload.shipping,
        notifications: nextConfigPayload.notifications,
        refunds: nextConfigPayload.refunds,
        integrations: nextConfigPayload.integrations,
        maintenanceMode: nextConfigPayload.maintenanceMode,
        updatedBy: req.user?._id || null,
      },
    },
    { returnDocument: "after", runValidators: true },
  );

  if (!nextConfig) {
    throw new AppError("System config not found", 404);
  }

  invalidateSystemConfigCache();

  ApiResponse.success(
    res,
    toPayload(nextConfig),
    "System config updated successfully",
  );
});
