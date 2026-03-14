const { URL } = require('url');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');

let websocketServer = null;
let heartbeatTimer = null;

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase();
}

function normalizeId(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function buildRequestUrl(req) {
  const host = req?.headers?.host || 'localhost';
  return new URL(req.url || '/ws', `http://${host}`);
}

function extractAuthToken(req) {
  const authHeader = String(req?.headers?.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  const requestUrl = buildRequestUrl(req);
  return String(requestUrl.searchParams.get('token') || '').trim();
}

function verifySocketUser(req) {
  const token = extractAuthToken(req);
  if (!token) {
    throw new Error('Missing auth token');
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  return {
    id: normalizeId(decoded?.id),
    role: normalizeRole(decoded?.role),
  };
}

function sendJson(socket, payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function normalizeRecipients(recipients = {}) {
  const roles = Array.isArray(recipients.roles)
    ? recipients.roles.map(normalizeRole).filter(Boolean)
    : [];
  const userIds = Array.isArray(recipients.userIds)
    ? recipients.userIds.map(normalizeId).filter(Boolean)
    : [];

  return {
    roles,
    userIds,
    includeAllAuthenticated: Boolean(recipients.includeAllAuthenticated),
  };
}

function shouldDeliver(socket, recipients) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  if (recipients.includeAllAuthenticated) return true;

  const socketRole = normalizeRole(socket.userRole);
  const socketUserId = normalizeId(socket.userId);

  if (recipients.roles.includes(socketRole)) {
    return true;
  }

  if (recipients.userIds.includes(socketUserId)) {
    return true;
  }

  return false;
}

function emitStatusChanged(event = {}) {
  if (!websocketServer) return;

  const recipients = normalizeRecipients(event.recipients);
  const message = {
    type: 'status.changed',
    domain: String(event.domain || '').trim().toLowerCase(),
    entityId: normalizeId(event.entityId),
    statusField: String(event.statusField || 'status').trim(),
    previousStatus:
      event.previousStatus === undefined || event.previousStatus === null
        ? null
        : String(event.previousStatus).trim().toLowerCase(),
    nextStatus:
      event.nextStatus === undefined || event.nextStatus === null
        ? null
        : String(event.nextStatus).trim().toLowerCase(),
    actor: event.actor || null,
    timestamp: event.timestamp || new Date().toISOString(),
    meta: event.meta && typeof event.meta === 'object' ? event.meta : {},
  };

  websocketServer.clients.forEach((client) => {
    if (shouldDeliver(client, recipients)) {
      sendJson(client, message);
    }
  });
}

function normalizeNotification(notification = null) {
  if (!notification || typeof notification !== 'object') {
    return null;
  }

  return {
    _id: normalizeId(notification._id),
    type: String(notification.type || '').trim() || 'system',
    title: String(notification.title || '').trim(),
    message: String(notification.message || '').trim(),
    data:
      notification.data && typeof notification.data === 'object'
        ? notification.data
        : notification.data ?? null,
    readAt: notification.readAt ? new Date(notification.readAt).toISOString() : null,
    createdAt: notification.createdAt
      ? new Date(notification.createdAt).toISOString()
      : new Date().toISOString(),
    updatedAt: notification.updatedAt
      ? new Date(notification.updatedAt).toISOString()
      : new Date().toISOString(),
  };
}

function emitNotificationEvent(event = {}) {
  if (!websocketServer) return;

  const recipients = normalizeRecipients(event.recipients);
  const message = {
    type: 'notification.event',
    action: String(event.action || 'created').trim().toLowerCase(),
    notification: normalizeNotification(event.notification),
    notificationIds: Array.isArray(event.notificationIds)
      ? event.notificationIds.map(normalizeId).filter(Boolean)
      : [],
    readAt: event.readAt ? new Date(event.readAt).toISOString() : null,
    timestamp: event.timestamp || new Date().toISOString(),
  };

  websocketServer.clients.forEach((client) => {
    if (shouldDeliver(client, recipients)) {
      sendJson(client, message);
    }
  });
}

function initHeartbeat() {
  if (!websocketServer || heartbeatTimer) return;

  heartbeatTimer = setInterval(() => {
    websocketServer.clients.forEach((client) => {
      if (client.isAlive === false) {
        client.terminate();
        return;
      }

      client.isAlive = false;
      if (client.readyState === WebSocket.OPEN) {
        client.ping();
      }
    });
  }, 30000);
}

function initRealtimeServer(server) {
  if (websocketServer) {
    return websocketServer;
  }

  websocketServer = new WebSocket.Server({
    server,
    path: '/ws',
  });

  websocketServer.on('connection', (socket, req) => {
    try {
      const user = verifySocketUser(req);
      socket.userId = user.id;
      socket.userRole = user.role;
      socket.isAlive = true;

      socket.on('pong', () => {
        socket.isAlive = true;
      });

      sendJson(socket, {
        type: 'connection.ready',
        userId: user.id,
        role: user.role,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      socket.close(1008, 'Unauthorized');
    }
  });

  websocketServer.on('close', () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    websocketServer = null;
  });

  initHeartbeat();
  return websocketServer;
}

module.exports = {
  initRealtimeServer,
  emitStatusChanged,
  emitNotificationEvent,
};
