require('dotenv').config();
const axios = require('axios');

const SEPAY_BASE_URL = process.env.SEPAY_BASE_URL || 'https://api.sepay.vn';
const SEPAY_CLIENT_ID = process.env.SEPAY_CLIENT_ID || '';
const SEPAY_CLIENT_SECRET = process.env.SEPAY_CLIENT_SECRET || '';
const SEPAY_WEBHOOK_SECRET = process.env.SEPAY_WEBHOOK_SECRET || '';
const SEPAY_BANK_ACCOUNT_ID = process.env.SEPAY_BANK_ACCOUNT_ID || '';
const SEPAY_BANK_ACCOUNT_NUMBER = process.env.SEPAY_BANK_ACCOUNT_NUMBER || '';
const SEPAY_BANK_NAME = process.env.SEPAY_BANK_NAME || '';
const SEPAY_BANK_ACCOUNT_NAME = process.env.SEPAY_BANK_ACCOUNT_NAME || '';

const sepayClient = axios.create({
  baseURL: SEPAY_BASE_URL,
  timeout: 8000
});

async function getAccessToken() {
  if (!SEPAY_CLIENT_ID || !SEPAY_CLIENT_SECRET) return null;
  const { data } = await sepayClient.post('/auth/token', {
    client_id: SEPAY_CLIENT_ID,
    client_secret: SEPAY_CLIENT_SECRET,
    scope: 'transaction',
    grant_type: 'client_credentials'
  });
  return data?.access_token;
}

module.exports = {
  sepayClient,
  getAccessToken,
  SEPAY_WEBHOOK_SECRET,
  SEPAY_BANK_ACCOUNT_ID,
  SEPAY_BANK_ACCOUNT_NUMBER,
  SEPAY_BANK_NAME,
  SEPAY_BANK_ACCOUNT_NAME
};
