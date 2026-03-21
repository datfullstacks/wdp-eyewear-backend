function normalizeStoreId(value) {
  const candidate =
    value && typeof value === "object"
      ? value._id || value.id || ""
      : value;
  const normalized = String(candidate || "").trim();
  return normalized || "";
}

function dedupeStoreIds(values = []) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => normalizeStoreId(value))
        .filter(Boolean),
    ),
  ];
}

function normalizeStoreAccess(input = {}) {
  const mode =
    String(input?.mode || "all").trim().toLowerCase() === "selected"
      ? "selected"
      : "all";
  const primaryStoreId = normalizeStoreId(input?.primaryStoreId);
  const requestedStoreIds = dedupeStoreIds(input?.storeIds);
  const storeIds =
    mode === "selected"
      ? dedupeStoreIds([primaryStoreId, ...requestedStoreIds])
      : [];

  return {
    mode,
    primaryStoreId: primaryStoreId || undefined,
    storeIds,
    note: String(input?.note || "").trim(),
  };
}

function getUserStoreAccess(user) {
  const normalized = normalizeStoreAccess(user?.storeAccess);
  const role = String(user?.role || "").trim().toLowerCase();
  if (role === "admin") {
    return {
      mode: "all",
      primaryStoreId: undefined,
      storeIds: [],
      note: normalized.note,
    };
  }
  return normalized;
}

function getAccessibleStoreIds(user) {
  const storeAccess = getUserStoreAccess(user);
  return storeAccess.mode === "selected" ? [...storeAccess.storeIds] : null;
}

function hasGlobalStoreAccess(user) {
  return getAccessibleStoreIds(user) === null;
}

function canAccessStore(user, storeId) {
  const normalizedStoreId = normalizeStoreId(storeId);
  const accessibleStoreIds = getAccessibleStoreIds(user);

  if (!normalizedStoreId) {
    return accessibleStoreIds === null;
  }

  return accessibleStoreIds === null
    ? true
    : accessibleStoreIds.includes(normalizedStoreId);
}

function isStoreScopeWithinAllowed(scopeLike, allowedStoreIds) {
  if (!Array.isArray(allowedStoreIds)) {
    return true;
  }

  const normalized = normalizeStoreAccess(scopeLike);
  if (normalized.mode !== "selected") {
    return false;
  }

  if (normalized.storeIds.length === 0) {
    return false;
  }

  return normalized.storeIds.every((storeId) => allowedStoreIds.includes(storeId));
}

function buildStoreScopedQuery(user, field = "storeId") {
  const accessibleStoreIds = getAccessibleStoreIds(user);
  if (accessibleStoreIds === null) {
    return {};
  }

  return {
    [field]: { $in: accessibleStoreIds },
  };
}

module.exports = {
  normalizeStoreId,
  normalizeStoreAccess,
  getUserStoreAccess,
  getAccessibleStoreIds,
  hasGlobalStoreAccess,
  canAccessStore,
  isStoreScopeWithinAllowed,
  buildStoreScopedQuery,
};
