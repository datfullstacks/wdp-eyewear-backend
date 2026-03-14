const mongoose = require("mongoose");
const User = require("../models/User");
const { sendExpoPushMessages } = require("./expoPush");
const { emitNotificationEvent } = require("../realtime/websocket");

function toTrimmedString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

async function appendUserNotification(
  userId,
  { type = "order", title, message, data = null } = {},
) {
  if (!userId) return;

  const now = new Date();
  const notification = {
    _id: new mongoose.Types.ObjectId(),
    type: toTrimmedString(type, "order") || "order",
    title: toTrimmedString(title) || "Order update",
    message: toTrimmedString(message) || "",
    data,
    readAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await User.updateOne(
    { _id: userId },
    {
      $push: {
        notifications: notification,
      },
    },
  );

  emitNotificationEvent({
    action: "created",
    notification,
    recipients: {
      userIds: [String(userId)],
    },
  });

  try {
    const user = await User.findById(userId).select("pushTokens");
    const pushTokens = Array.isArray(user?.pushTokens) ? user.pushTokens : [];

    if (!pushTokens.length) {
      return;
    }

    const pushPayload = {
      type: toTrimmedString(type, "order") || "order",
      title: toTrimmedString(title) || "Order update",
      message: toTrimmedString(message) || "",
      data,
    };

    const messages = pushTokens.map((item) => ({
      to: String(item?.token || "").trim(),
      title: pushPayload.title,
      body: pushPayload.message || pushPayload.title,
      sound: "default",
      priority: "high",
      channelId: "default",
      data: pushPayload,
    }));

    const { invalidTokens } = await sendExpoPushMessages(messages);
    if (invalidTokens.length) {
      await User.updateOne(
        { _id: userId },
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

module.exports = {
  appendUserNotification,
};
