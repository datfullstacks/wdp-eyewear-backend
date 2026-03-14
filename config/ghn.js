require("dotenv").config({ quiet: true });
const axios = require("axios");

const GHN_PRODUCTION_BASE_URL = "https://online-gateway.ghn.vn";
const GHN_TEST_BASE_URL = "https://dev-online-gateway.ghn.vn";

function normalizeString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(
    String(value).trim().toLowerCase(),
  );
}

function normalizeTimeout(value, fallback = 10000) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1000) return fallback;
  return Math.floor(number);
}

const GHN_USE_TEST = normalizeBoolean(process.env.GHN_USE_TEST, false);
const GHN_BASE_URL = normalizeString(
  process.env.GHN_BASE_URL,
  GHN_USE_TEST ? GHN_TEST_BASE_URL : GHN_PRODUCTION_BASE_URL,
);
const GHN_TOKEN = normalizeString(process.env.GHN_TOKEN);
const GHN_SHOP_ID = normalizeString(process.env.GHN_SHOP_ID);
const GHN_TIMEOUT_MS = normalizeTimeout(process.env.GHN_TIMEOUT_MS, 10000);
const GHN_WEBHOOK_SECRET = normalizeString(process.env.GHN_WEBHOOK_SECRET);

const ghnClient = axios.create({
  baseURL: GHN_BASE_URL,
  timeout: GHN_TIMEOUT_MS,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
});

function buildGhnHeaders({
  token = GHN_TOKEN,
  shopId = null,
  extraHeaders = {},
} = {}) {
  const headers = {
    ...extraHeaders,
  };

  const resolvedToken = normalizeString(token, GHN_TOKEN);
  const resolvedShopId = normalizeString(shopId);

  if (resolvedToken) {
    headers.Token = resolvedToken;
    headers.Authorization = resolvedToken.toLowerCase().startsWith("bearer ")
      ? resolvedToken
      : `Bearer ${resolvedToken}`;
  }

  if (resolvedShopId) {
    headers.ShopId = resolvedShopId;
  }

  return headers;
}

function isGhnConfigured({ requireShopId = false } = {}) {
  if (!GHN_TOKEN) return false;
  if (requireShopId && !GHN_SHOP_ID) return false;
  return true;
}

module.exports = {
  ghnClient,
  GHN_BASE_URL,
  GHN_PRODUCTION_BASE_URL,
  GHN_TEST_BASE_URL,
  GHN_USE_TEST,
  GHN_TOKEN,
  GHN_SHOP_ID,
  GHN_TIMEOUT_MS,
  GHN_WEBHOOK_SECRET,
  buildGhnHeaders,
  isGhnConfigured,
};
