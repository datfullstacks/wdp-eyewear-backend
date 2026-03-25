const AppError = require("../errors/AppError");
const { getRole } = require("../helpers/roles");
const {
  getRuntimeSystemConfig,
} = require("../helpers/systemConfig");

const MAINTENANCE_EXEMPT_PREFIXES = [
  "/",
  "/api/auth",
  "/api/system-config",
  "/api/payments/sepay/webhook",
  "/api/orders/shipping/ghn/webhook",
  "/api-docs",
  "/uploads",
];

function isExemptMaintenancePath(req) {
  if (req.method === "OPTIONS") return true;

  const path = String(req.path || req.originalUrl || "").trim();
  if (!path) return false;

  return MAINTENANCE_EXEMPT_PREFIXES.some((prefix) => {
    if (prefix === "/") {
      return path === "/";
    }
    return path === prefix || path.startsWith(`${prefix}/`);
  });
}

exports.enforceRuntimeMaintenance = async (req, res, next) => {
  if (isExemptMaintenancePath(req)) {
    next();
    return;
  }

  const runtimeConfig = await getRuntimeSystemConfig();
  if (!runtimeConfig.maintenanceMode) {
    next();
    return;
  }

  if (getRole(req.user) === "admin") {
    next();
    return;
  }

  next(
    new AppError(
      "System is currently in maintenance mode.",
      503,
      "SYSTEM_MAINTENANCE",
    ),
  );
};

exports.enforceManagerPolicyEditorEnabled = async (req, res, next) => {
  const runtimeConfig = await getRuntimeSystemConfig();
  if (runtimeConfig.featureFlags?.managerPolicyEditorEnabled !== false) {
    next();
    return;
  }

  next(
    new AppError(
      "Manager policy editor is currently disabled.",
      403,
      "POLICY_EDITOR_DISABLED",
    ),
  );
};
