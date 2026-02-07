const asyncHandler = require('../helpers/asyncHandler');
const orderService = require('../services/orderService');
const { SEPAY_WEBHOOK_SECRET } = require('../config/sepay');
const WEBHOOK_LOG_PREFIX = '[SEPAY_WEBHOOK]';

// Simple shared secret check
function verifySignature(req) {
  if (!SEPAY_WEBHOOK_SECRET) return true;

  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const authToken = typeof authHeader === 'string'
    ? authHeader.replace(/^apikey\s+/i, '').replace(/^bearer\s+/i, '').trim()
    : '';

  const token = (
    req.headers['x-sepay-signature'] ||
    req.headers['x-api-key'] ||
    authToken
  );

  return token === SEPAY_WEBHOOK_SECRET;
}

function normalizePaymentCode(rawCode) {
  if (!rawCode) return null;
  // Sepay bank memo may strip separators, e.g. "WDP2602077642"
  const normalized = String(rawCode).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const match = normalized.match(/WDP(\d{10})/);
  if (!match || !match[1]) return null;
  const digits = match[1];
  return `WDP-${digits.slice(0, 6)}-${digits.slice(6)}`;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

exports.sepayWebhook = asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const payload = req.body || {};
  const transferType = String(payload?.transferType || payload?.transfer_type || payload?.type || '').toLowerCase();
  const amount = Number(payload?.amount || payload?.transferAmount || payload?.amount_vnd || 0);
  const webhookId = payload?.id || payload?.webhook_id || payload?.event_id || '';
  const transactionId = payload?.referenceCode || payload?.reference_code || payload?.transaction_id || payload?.txid || payload?.id || '';
  const content = payload?.code || payload?.description || payload?.content || '';
  const paymentCode = normalizePaymentCode(payload?.code || content);

  console.log(`${WEBHOOK_LOG_PREFIX} incoming`, {
    webhookId,
    transferType,
    amount,
    hasPaymentCode: Boolean(paymentCode),
    ip: getClientIp(req),
    userAgent: req.headers['user-agent'] || 'unknown'
  });

  if (!verifySignature(req)) {
    console.warn(`${WEBHOOK_LOG_PREFIX} invalid signature`, {
      webhookId,
      ip: getClientIp(req)
    });
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }

  if (transferType && transferType !== 'in') {
    console.log(`${WEBHOOK_LOG_PREFIX} ignored non-incoming transfer`, {
      webhookId,
      transferType
    });
    return res.status(200).json({ success: true, message: 'Ignored non-incoming transfer' });
  }
  if (!paymentCode) {
    console.warn(`${WEBHOOK_LOG_PREFIX} missing payment code`, {
      webhookId,
      transactionId,
      contentPreview: String(content || '').slice(0, 64)
    });
    return res.status(200).json({ success: true, message: 'No payment code' });
  }

  try {
    const order = await orderService.markPaidBySepay(paymentCode, amount, transactionId, webhookId);
    console.log(`${WEBHOOK_LOG_PREFIX} order updated`, {
      webhookId,
      paymentCode,
      transactionId,
      amount,
      orderId: String(order._id),
      paymentStatus: order.paymentStatus,
      elapsedMs: Date.now() - startedAt
    });
    return res.status(200).json({
      success: true,
      message: 'Order updated',
      orderId: order._id,
      paymentStatus: order.paymentStatus
    });
  } catch (err) {
    console.error(`${WEBHOOK_LOG_PREFIX} update failed`, {
      webhookId,
      paymentCode,
      transactionId,
      amount,
      error: err.message,
      elapsedMs: Date.now() - startedAt
    });
    return res.status(200).json({ success: false, message: err.message });
  }
});
