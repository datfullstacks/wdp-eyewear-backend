const mongoose = require("mongoose");
const User = require("../models/User");
const { getEffectiveSystemConfig } = require("./systemConfig");
const { sendExpoPushMessages } = require("./expoPush");
const { emitNotificationEvent } = require("../realtime/websocket");

function toTrimmedString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function buildNotificationRecord({ type = "order", title, message, data = null } = {}) {
  const now = new Date();
  return {
    _id: new mongoose.Types.ObjectId(),
    type: toTrimmedString(type, "order") || "order",
    title: toTrimmedString(title) || "Order update",
    message: toTrimmedString(message) || "",
    data,
    readAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function dispatchNotificationDelivery(userFilter, recipientUserIds, notification) {
  const systemConfig = await getEffectiveSystemConfig();
  emitNotificationEvent({
    action: "created",
    notification,
    recipients: {
      userIds: recipientUserIds.map((item) => String(item)),
    },
  });

  if (systemConfig?.notifications?.pushEnabled === false) {
    return;
  }

  try {
    const users = await User.find(userFilter).select("pushTokens");
    const pushPayload = {
      type: toTrimmedString(notification.type, "order") || "order",
      title: toTrimmedString(notification.title) || "Order update",
      message: toTrimmedString(notification.message) || "",
      data: notification.data ?? null,
    };
    const messages = users.flatMap((user) => {
      const pushTokens = Array.isArray(user?.pushTokens) ? user.pushTokens : [];
      return pushTokens.map((item) => ({
        to: String(item?.token || "").trim(),
        title: pushPayload.title,
        body: pushPayload.message || pushPayload.title,
        sound: "default",
        priority: "high",
        channelId: "default",
        data: pushPayload,
      }));
    });

    if (!messages.length) {
      return;
    }

    const { invalidTokens } = await sendExpoPushMessages(messages);
    if (invalidTokens.length) {
      await User.updateMany(
        userFilter,
        {
          $pull: {
            pushTokens: {
              token: { $in: invalidTokens },
            },
          },
        },
      );
    }
  } catch (error) {
    console.error("Failed to dispatch Expo push notification:", error?.message || error);
  }
}

async function appendUserNotification(
  userId,
  { type = "order", title, message, data = null } = {},
) {
  if (!userId) return;

  const notification = buildNotificationRecord({
    type,
    title,
    message,
    data,
  });

  await User.updateOne(
    { _id: userId },
    {
      $push: {
        notifications: notification,
      },
    },
  );

  await dispatchNotificationDelivery(
    { _id: userId },
    [userId],
    notification,
  );
}

async function broadcastUserNotification(
  userIds = [],
  { type = "system", title, message, data = null } = {},
) {
  const normalizedUserIds = Array.from(
    new Set(
      (Array.isArray(userIds) ? userIds : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );

  if (!normalizedUserIds.length) {
    return;
  }

  const notification = buildNotificationRecord({
    type,
    title,
    message,
    data,
  });

  const userFilter = {
    _id: { $in: normalizedUserIds },
  };

  await User.updateMany(userFilter, {
    $push: {
      notifications: notification,
    },
  });

  await dispatchNotificationDelivery(userFilter, normalizedUserIds, notification);
}

module.exports = {
  appendUserNotification,
  broadcastUserNotification,
};
