const { emitStatusChanged } = require('../realtime/websocket');
const { getRole, getUserId, ROLE } = require('./roles');

const DEFAULT_BUSINESS_RECIPIENT_ROLES = [
  ROLE.STAFF,
  ROLE.OPERATION,
  ROLE.MANAGER,
];

function normalizeId(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeStatus(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

function sanitizeMeta(meta = {}) {
  if (!meta || typeof meta !== 'object') return {};

  const output = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;

    if (value === null) {
      output[key] = null;
      continue;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      output[key] = value;
      continue;
    }

    output[key] = String(value);
  }

  return output;
}

function buildActor(currentUser) {
  const id = normalizeId(getUserId(currentUser));
  const role = getRole(currentUser);

  if (!id && !role) {
    return null;
  }

  return {
    id: id || null,
    role: role || null,
  };
}

function publishStatusChange({
  domain,
  entityId,
  statusField = 'status',
  previousStatus,
  nextStatus,
  currentUser = null,
  recipientRoles = DEFAULT_BUSINESS_RECIPIENT_ROLES,
  recipientUserIds = [],
  meta = {},
}) {
  const fromStatus = normalizeStatus(previousStatus);
  const toStatus = normalizeStatus(nextStatus);

  if (!domain || !entityId || fromStatus === toStatus) {
    return false;
  }

  emitStatusChanged({
    domain,
    entityId: normalizeId(entityId),
    statusField,
    previousStatus: fromStatus,
    nextStatus: toStatus,
    actor: buildActor(currentUser),
    recipients: {
      roles: recipientRoles,
      userIds: recipientUserIds.map(normalizeId).filter(Boolean),
    },
    meta: sanitizeMeta(meta),
  });

  return true;
}

module.exports = {
  DEFAULT_BUSINESS_RECIPIENT_ROLES,
  publishStatusChange,
};
