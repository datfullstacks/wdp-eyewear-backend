const axios = require('axios');

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_TOKEN_PATTERN = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;
const EXPO_PUSH_CHUNK_SIZE = 100;

function isExpoPushToken(value) {
  return EXPO_PUSH_TOKEN_PATTERN.test(String(value || '').trim());
}

function chunkArray(list, size) {
  const chunks = [];
  for (let index = 0; index < list.length; index += size) {
    chunks.push(list.slice(index, index + size));
  }
  return chunks;
}

async function sendExpoPushMessages(messages = []) {
  const normalizedMessages = Array.isArray(messages)
    ? messages.filter((item) => item && isExpoPushToken(item.to))
    : [];

  if (!normalizedMessages.length) {
    return {
      tickets: [],
      invalidTokens: [],
    };
  }

  const tickets = [];
  const invalidTokens = [];

  for (const chunk of chunkArray(normalizedMessages, EXPO_PUSH_CHUNK_SIZE)) {
    const response = await axios.post(EXPO_PUSH_ENDPOINT, chunk, {
      headers: {
        accept: 'application/json',
        'accept-encoding': 'gzip, deflate',
        'content-type': 'application/json',
      },
      timeout: 15000,
    });

    const chunkTickets = Array.isArray(response?.data?.data) ? response.data.data : [];
    tickets.push(...chunkTickets);

    chunkTickets.forEach((ticket, index) => {
      if (
        ticket?.status === 'error' &&
        ticket?.details?.error === 'DeviceNotRegistered'
      ) {
        invalidTokens.push(String(chunk[index]?.to || '').trim());
      }
    });
  }

  return {
    tickets,
    invalidTokens: Array.from(new Set(invalidTokens.filter(Boolean))),
  };
}

module.exports = {
  isExpoPushToken,
  sendExpoPushMessages,
};
