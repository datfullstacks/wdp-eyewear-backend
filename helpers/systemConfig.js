const { SystemConfig } = require("../models/SystemConfig");

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

async function getOrCreateSystemConfig() {
  const existing = await SystemConfig.findOne({ key: DEFAULT_SYSTEM_CONFIG.key });
  if (existing) {
    return existing;
  }

  return SystemConfig.create(cloneDefaultSystemConfig());
}

function isManagerPolicyEditorEnabled(config) {
  const configuredValue = config?.featureFlags?.managerPolicyEditorEnabled;
  if (typeof configuredValue === "boolean") {
    return configuredValue;
  }

  return DEFAULT_SYSTEM_CONFIG.featureFlags.managerPolicyEditorEnabled;
}

module.exports = {
  DEFAULT_SYSTEM_CONFIG,
  cloneDefaultSystemConfig,
  getOrCreateSystemConfig,
  isManagerPolicyEditorEnabled,
};
