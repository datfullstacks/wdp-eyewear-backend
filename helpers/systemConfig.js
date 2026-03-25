const { SystemConfig } = require("../models/SystemConfig");

const SYSTEM_CONFIG_CACHE_TTL_MS = Math.max(
  1_000,
  Number(process.env.SYSTEM_CONFIG_CACHE_TTL_MS || 10_000),
);

const DEFAULT_SYSTEM_CONFIG = Object.freeze({
  key: "default",
  featureFlags: {
    preorderEnabled: true,
    splitPaymentEnabled: true,
    refundWorkflowEnabled: true,
    managerPolicyEditorEnabled: true,
  },
  payments: {
    payNowGateway: "sepay",
    codEnabled: true,
    supportedPayNowMethods: ["sepay"],
  },
  shipping: {
    defaultCarrier: "ghn",
    ghnEnabled: true,
    allowEstimatedShippingFee: true,
  },
  notifications: {
    emailEnabled: true,
    pushEnabled: true,
    smsEnabled: false,
  },
  refunds: {
    staffApprovalLimit: 300000,
    requiresManagerForReturn: true,
    requiresManagerForShippingRefund: true,
    requirePayoutProof: false,
  },
  integrations: {
    sepay: { enabled: true },
    ghn: { enabled: true },
  },
  maintenanceMode: false,
});

const systemConfigCache = {
  value: null,
  expiresAt: 0,
  promise: null,
};

function cloneDefaultSystemConfig() {
  return {
    key: DEFAULT_SYSTEM_CONFIG.key,
    featureFlags: { ...DEFAULT_SYSTEM_CONFIG.featureFlags },
    payments: {
      ...DEFAULT_SYSTEM_CONFIG.payments,
      supportedPayNowMethods: [...DEFAULT_SYSTEM_CONFIG.payments.supportedPayNowMethods],
    },
    shipping: { ...DEFAULT_SYSTEM_CONFIG.shipping },
    notifications: { ...DEFAULT_SYSTEM_CONFIG.notifications },
    refunds: { ...DEFAULT_SYSTEM_CONFIG.refunds },
    integrations: {
      sepay: { ...DEFAULT_SYSTEM_CONFIG.integrations.sepay },
      ghn: { ...DEFAULT_SYSTEM_CONFIG.integrations.ghn },
    },
    maintenanceMode: DEFAULT_SYSTEM_CONFIG.maintenanceMode,
  };
}

function cloneNormalizedSystemConfig(config = {}) {
  const normalized = normalizeSystemConfigDocument(config);
  return {
    key: normalized.key,
    featureFlags: { ...normalized.featureFlags },
    payments: {
      ...normalized.payments,
      supportedPayNowMethods: [...normalized.payments.supportedPayNowMethods],
    },
    shipping: { ...normalized.shipping },
    notifications: { ...normalized.notifications },
    refunds: { ...normalized.refunds },
    integrations: {
      sepay: { ...normalized.integrations.sepay },
      ghn: { ...normalized.integrations.ghn },
    },
    maintenanceMode: normalized.maintenanceMode,
  };
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  if (Number.isFinite(number)) {
    return Math.max(0, Math.round(number));
  }
  return fallback;
}

function normalizePercent(value, fallback = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, number));
}

function normalizeShippingCollectionTiming(value, fallback = "upfront") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "with_balance") return "on_delivery";
  return normalized === "on_delivery" ? "on_delivery" : fallback;
}

function normalizeSystemConfigDocument(config = {}) {
  const source =
    config && typeof config.toObject === "function" ? config.toObject() : config || {};

  return {
    key: DEFAULT_SYSTEM_CONFIG.key,
    featureFlags: {
      preorderEnabled: normalizeBoolean(
        source?.featureFlags?.preorderEnabled,
        DEFAULT_SYSTEM_CONFIG.featureFlags.preorderEnabled,
      ),
      splitPaymentEnabled: normalizeBoolean(
        source?.featureFlags?.splitPaymentEnabled,
        DEFAULT_SYSTEM_CONFIG.featureFlags.splitPaymentEnabled,
      ),
      refundWorkflowEnabled: normalizeBoolean(
        source?.featureFlags?.refundWorkflowEnabled,
        DEFAULT_SYSTEM_CONFIG.featureFlags.refundWorkflowEnabled,
      ),
      managerPolicyEditorEnabled: normalizeBoolean(
        source?.featureFlags?.managerPolicyEditorEnabled,
        DEFAULT_SYSTEM_CONFIG.featureFlags.managerPolicyEditorEnabled,
      ),
    },
    payments: {
      payNowGateway: "sepay",
      codEnabled: normalizeBoolean(
        source?.payments?.codEnabled,
        DEFAULT_SYSTEM_CONFIG.payments.codEnabled,
      ),
      supportedPayNowMethods: ["sepay"],
    },
    shipping: {
      defaultCarrier: "ghn",
      ghnEnabled: normalizeBoolean(
        source?.shipping?.ghnEnabled,
        DEFAULT_SYSTEM_CONFIG.shipping.ghnEnabled,
      ),
      allowEstimatedShippingFee: normalizeBoolean(
        source?.shipping?.allowEstimatedShippingFee,
        DEFAULT_SYSTEM_CONFIG.shipping.allowEstimatedShippingFee,
      ),
    },
    notifications: {
      emailEnabled: normalizeBoolean(
        source?.notifications?.emailEnabled,
        DEFAULT_SYSTEM_CONFIG.notifications.emailEnabled,
      ),
      pushEnabled: normalizeBoolean(
        source?.notifications?.pushEnabled,
        DEFAULT_SYSTEM_CONFIG.notifications.pushEnabled,
      ),
      smsEnabled: normalizeBoolean(
        source?.notifications?.smsEnabled,
        DEFAULT_SYSTEM_CONFIG.notifications.smsEnabled,
      ),
    },
    refunds: {
      staffApprovalLimit: normalizeNonNegativeInteger(
        source?.refunds?.staffApprovalLimit,
        DEFAULT_SYSTEM_CONFIG.refunds.staffApprovalLimit,
      ),
      requiresManagerForReturn: normalizeBoolean(
        source?.refunds?.requiresManagerForReturn,
        DEFAULT_SYSTEM_CONFIG.refunds.requiresManagerForReturn,
      ),
      requiresManagerForShippingRefund: normalizeBoolean(
        source?.refunds?.requiresManagerForShippingRefund,
        DEFAULT_SYSTEM_CONFIG.refunds.requiresManagerForShippingRefund,
      ),
      requirePayoutProof: normalizeBoolean(
        source?.refunds?.requirePayoutProof,
        DEFAULT_SYSTEM_CONFIG.refunds.requirePayoutProof,
      ),
    },
    integrations: {
      sepay: {
        enabled: normalizeBoolean(
          source?.integrations?.sepay?.enabled,
          DEFAULT_SYSTEM_CONFIG.integrations.sepay.enabled,
        ),
      },
      ghn: {
        enabled: normalizeBoolean(
          source?.integrations?.ghn?.enabled,
          DEFAULT_SYSTEM_CONFIG.integrations.ghn.enabled,
        ),
      },
    },
    maintenanceMode: normalizeBoolean(
      source?.maintenanceMode,
      DEFAULT_SYSTEM_CONFIG.maintenanceMode,
    ),
  };
}

function toRuntimeSystemConfig(config = {}) {
  const normalized = normalizeSystemConfigDocument(config);
  return {
    featureFlags: {
      preorderEnabled: normalized.featureFlags.preorderEnabled,
      splitPaymentEnabled: normalized.featureFlags.splitPaymentEnabled,
      refundWorkflowEnabled: normalized.featureFlags.refundWorkflowEnabled,
      managerPolicyEditorEnabled:
        normalized.featureFlags.managerPolicyEditorEnabled,
    },
    payments: {
      codEnabled: normalized.payments.codEnabled,
    },
    shipping: {
      ghnEnabled: normalized.shipping.ghnEnabled,
      allowEstimatedShippingFee: normalized.shipping.allowEstimatedShippingFee,
    },
    maintenanceMode: normalized.maintenanceMode,
  };
}

async function getOrCreateSystemConfig() {
  const existing = await SystemConfig.findOne({ key: DEFAULT_SYSTEM_CONFIG.key });
  if (existing) {
    return existing;
  }

  const created = await SystemConfig.create(cloneDefaultSystemConfig());
  invalidateSystemConfigCache();
  return created;
}

async function getEffectiveSystemConfig({ forceFresh = false } = {}) {
  if (
    !forceFresh &&
    systemConfigCache.value &&
    Date.now() < Number(systemConfigCache.expiresAt || 0)
  ) {
    return cloneNormalizedSystemConfig(systemConfigCache.value);
  }

  if (systemConfigCache.promise) {
    const pending = await systemConfigCache.promise;
    return cloneNormalizedSystemConfig(pending);
  }

  systemConfigCache.promise = getOrCreateSystemConfig()
    .then((doc) => {
      const normalized = normalizeSystemConfigDocument(doc);
      systemConfigCache.value = normalized;
      systemConfigCache.expiresAt = Date.now() + SYSTEM_CONFIG_CACHE_TTL_MS;
      return normalized;
    })
    .catch(() => {
      const fallback = cloneDefaultSystemConfig();
      systemConfigCache.value = fallback;
      systemConfigCache.expiresAt = Date.now() + SYSTEM_CONFIG_CACHE_TTL_MS;
      return fallback;
    })
    .finally(() => {
      systemConfigCache.promise = null;
    });

  const resolved = await systemConfigCache.promise;
  return cloneNormalizedSystemConfig(resolved);
}

async function getRuntimeSystemConfig(options = {}) {
  const config = await getEffectiveSystemConfig(options);
  return toRuntimeSystemConfig(config);
}

function invalidateSystemConfigCache() {
  systemConfigCache.value = null;
  systemConfigCache.expiresAt = 0;
  systemConfigCache.promise = null;
}

function isManagerPolicyEditorEnabled(config) {
  const configuredValue = config?.featureFlags?.managerPolicyEditorEnabled;
  if (typeof configuredValue === "boolean") {
    return configuredValue;
  }

  return DEFAULT_SYSTEM_CONFIG.featureFlags.managerPolicyEditorEnabled;
}

function isPreorderEnabled(config) {
  return normalizeBoolean(
    config?.featureFlags?.preorderEnabled,
    DEFAULT_SYSTEM_CONFIG.featureFlags.preorderEnabled,
  );
}

function isRefundWorkflowEnabled(config) {
  return normalizeBoolean(
    config?.featureFlags?.refundWorkflowEnabled,
    DEFAULT_SYSTEM_CONFIG.featureFlags.refundWorkflowEnabled,
  );
}

function isCodEnabled(config) {
  return normalizeBoolean(
    config?.payments?.codEnabled,
    DEFAULT_SYSTEM_CONFIG.payments.codEnabled,
  );
}

function isMaintenanceMode(config) {
  return normalizeBoolean(
    config?.maintenanceMode,
    DEFAULT_SYSTEM_CONFIG.maintenanceMode,
  );
}

function canUseGhn(config) {
  const normalized = normalizeSystemConfigDocument(config);
  return (
    normalized.shipping.ghnEnabled &&
    normalizeBoolean(
      normalized.integrations?.ghn?.enabled,
      DEFAULT_SYSTEM_CONFIG.integrations.ghn.enabled,
    )
  );
}

function shouldForcePreOrderUpfront(config) {
  const normalized = normalizeSystemConfigDocument(config);
  return (
    !normalized.featureFlags.splitPaymentEnabled || !normalized.payments.codEnabled
  );
}

function resolvePreOrderRuntimeConfig(preOrderConfig = {}, systemConfig = {}) {
  const normalizedConfig = normalizeSystemConfigDocument(systemConfig);
  const sourceEnabled = normalizeBoolean(preOrderConfig?.enabled, false);
  const enabled = sourceEnabled && isPreorderEnabled(normalizedConfig);
  const forcedFullUpfront = enabled && shouldForcePreOrderUpfront(normalizedConfig);

  return {
    enabled,
    allowCod:
      enabled &&
      !forcedFullUpfront &&
      normalizeBoolean(preOrderConfig?.allowCod, true) &&
      isCodEnabled(normalizedConfig),
    depositPercent: enabled
      ? forcedFullUpfront
        ? 100
        : normalizePercent(preOrderConfig?.depositPercent, 100)
      : 100,
    shippingCollectionTiming: enabled
      ? forcedFullUpfront
        ? "upfront"
        : normalizeShippingCollectionTiming(
            preOrderConfig?.shippingCollectionTiming,
            "upfront",
          )
      : "upfront",
    maxQuantityPerOrder: normalizeNonNegativeInteger(
      preOrderConfig?.maxQuantityPerOrder,
      0,
    ),
    forcedFullUpfront,
  };
}

module.exports = {
  DEFAULT_SYSTEM_CONFIG,
  cloneDefaultSystemConfig,
  cloneNormalizedSystemConfig,
  normalizeSystemConfigDocument,
  toRuntimeSystemConfig,
  getOrCreateSystemConfig,
  getEffectiveSystemConfig,
  getRuntimeSystemConfig,
  invalidateSystemConfigCache,
  isManagerPolicyEditorEnabled,
  isPreorderEnabled,
  isRefundWorkflowEnabled,
  isCodEnabled,
  isMaintenanceMode,
  canUseGhn,
  shouldForcePreOrderUpfront,
  resolvePreOrderRuntimeConfig,
};
