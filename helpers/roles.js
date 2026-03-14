const ROLE = {
  CUSTOMER: "customer",
  STAFF: "sales",
  OPERATION: "operations",
  MANAGER: "manager",
  ADMIN: "admin",
};

const GHN_ACTION = {
  VIEW_TRACKING: "view_tracking",
  CREATE_SHIPMENT: "create_shipment",
  SYNC_SHIPMENT: "sync_shipment",
  UPDATE_TEST_STATUS: "update_test_status",
  PRINT_LABEL: "print_label",
  CANCEL_SHIPMENT: "cancel_shipment",
  RETURN_SHIPMENT: "return_shipment",
  DELIVERY_AGAIN: "delivery_again",
};

const VALID_ROLES = new Set(Object.values(ROLE));
const BUSINESS_ROLES = new Set([ROLE.STAFF, ROLE.OPERATION, ROLE.MANAGER]);
const CUSTOMER_READONLY_ROLES = new Set([ROLE.STAFF, ROLE.OPERATION]);
const GHN_ROLE_MATRIX = Object.freeze({
  [ROLE.CUSTOMER]: [],
  [ROLE.STAFF]: [GHN_ACTION.VIEW_TRACKING],
  [ROLE.OPERATION]: [
    GHN_ACTION.VIEW_TRACKING,
    GHN_ACTION.CREATE_SHIPMENT,
    GHN_ACTION.SYNC_SHIPMENT,
    GHN_ACTION.UPDATE_TEST_STATUS,
    GHN_ACTION.PRINT_LABEL,
    GHN_ACTION.CANCEL_SHIPMENT,
    GHN_ACTION.RETURN_SHIPMENT,
    GHN_ACTION.DELIVERY_AGAIN,
  ],
  [ROLE.MANAGER]: [
    GHN_ACTION.VIEW_TRACKING,
    GHN_ACTION.CREATE_SHIPMENT,
    GHN_ACTION.SYNC_SHIPMENT,
    GHN_ACTION.UPDATE_TEST_STATUS,
    GHN_ACTION.PRINT_LABEL,
    GHN_ACTION.CANCEL_SHIPMENT,
    GHN_ACTION.RETURN_SHIPMENT,
    GHN_ACTION.DELIVERY_AGAIN,
  ],
  [ROLE.ADMIN]: [],
});
const GHN_ACTIONS = new Set(Object.values(GHN_ACTION));

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function getRole(user) {
  return normalizeRole(user?.role);
}

function getUserId(user) {
  return user?.id || user?._id || null;
}

function isCustomer(user) {
  return getRole(user) === ROLE.CUSTOMER;
}

function isStaff(user) {
  return getRole(user) === ROLE.STAFF;
}

function isOperation(user) {
  return getRole(user) === ROLE.OPERATION;
}

function isManager(user) {
  return getRole(user) === ROLE.MANAGER;
}

function isAdmin(user) {
  return getRole(user) === ROLE.ADMIN;
}

function isBusinessUser(user) {
  return BUSINESS_ROLES.has(getRole(user));
}

function canReadUsersList(user) {
  const role = getRole(user);
  return CUSTOMER_READONLY_ROLES.has(role) || isManager(user) || isAdmin(user);
}

function canReadOnlyCustomers(user) {
  return CUSTOMER_READONLY_ROLES.has(getRole(user));
}

function canManageUserRole(actor, targetRole) {
  const actorRole = getRole(actor);
  const normalizedTargetRole = normalizeRole(targetRole);

  if (!VALID_ROLES.has(normalizedTargetRole)) {
    return false;
  }

  if (actorRole === ROLE.ADMIN) {
    return true;
  }

  if (actorRole === ROLE.MANAGER) {
    return normalizedTargetRole !== ROLE.ADMIN;
  }

  return false;
}

function canReadUserRecord(actor, targetUser) {
  if (!actor || !targetUser) {
    return false;
  }

  const actorId = getUserId(actor);
  const targetId = getUserId(targetUser);
  if (actorId && targetId && String(actorId) === String(targetId)) {
    return true;
  }

  if (isAdmin(actor) || isManager(actor)) {
    return true;
  }

  if (canReadOnlyCustomers(actor)) {
    return getRole(targetUser) === ROLE.CUSTOMER;
  }

  return false;
}

function canDeleteUser(actor, targetUser) {
  if (!actor || !targetUser) {
    return false;
  }

  const actorRole = getRole(actor);
  const targetRole = getRole(targetUser);
  const actorId = getUserId(actor);
  const targetId = getUserId(targetUser);

  if (actorId && targetId && String(actorId) === String(targetId)) {
    return false;
  }

  if (actorRole === ROLE.ADMIN) {
    return true;
  }

  if (actorRole === ROLE.MANAGER) {
    return targetRole !== ROLE.ADMIN;
  }

  return false;
}

function getGhnRoleMatrix() {
  return Object.fromEntries(
    Object.entries(GHN_ROLE_MATRIX).map(([role, actions]) => [
      role,
      [...actions],
    ]),
  );
}

function getAllowedGhnActions(userOrRole) {
  const role =
    typeof userOrRole === "string"
      ? normalizeRole(userOrRole)
      : getRole(userOrRole);

  return [...(GHN_ROLE_MATRIX[role] || [])];
}

function canAccessGhnAction(user, action) {
  const normalizedAction = String(action || "")
    .trim()
    .toLowerCase();
  if (!GHN_ACTIONS.has(normalizedAction)) {
    return false;
  }

  return getAllowedGhnActions(user).includes(normalizedAction);
}

module.exports = {
  ROLE,
  GHN_ACTION,
  VALID_ROLES,
  BUSINESS_ROLES,
  CUSTOMER_READONLY_ROLES,
  GHN_ROLE_MATRIX,
  normalizeRole,
  getRole,
  getUserId,
  isCustomer,
  isStaff,
  isOperation,
  isManager,
  isAdmin,
  isBusinessUser,
  canReadUsersList,
  canReadOnlyCustomers,
  canManageUserRole,
  canReadUserRecord,
  canDeleteUser,
  getGhnRoleMatrix,
  getAllowedGhnActions,
  canAccessGhnAction,
};
