const asyncHandler = require('../helpers/asyncHandler');
const orderService = require('../services/orderService');
const { SEPAY_WEBHOOK_SECRET } = require('../config/sepay');

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
  const normalized = String(rawCode).trim().toUpperCase().replace(/\s+/g, '');
  const match = normalized.match(/WDP-?\d{6}-\d{4}/);
  if (!match || !match[0]) return null;
  let paymentCode = match[0];
  if (!paymentCode.startsWith('WDP-')) {
    paymentCode = paymentCode.replace(/^WDP/, 'WDP-');
  }
  return paymentCode.replace('--', '-');
}

exports.sepayWebhook = asyncHandler(async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }

  const payload = req.body || {};
  const transferType = String(payload?.transferType || payload?.transfer_type || payload?.type || '').toLowerCase();
  if (transferType && transferType !== 'in') {
    return res.status(200).json({ success: true, message: 'Ignored non-incoming transfer' });
  }

  const content = payload?.code || payload?.description || payload?.content || '';
  const amount = Number(payload?.amount || payload?.transferAmount || payload?.amount_vnd || 0);
  const webhookId = payload?.id || payload?.webhook_id || payload?.event_id || '';
  const transactionId = payload?.referenceCode || payload?.reference_code || payload?.transaction_id || payload?.txid || payload?.id || '';

  const paymentCode = normalizePaymentCode(payload?.code || content);
  if (!paymentCode) {
    return res.status(200).json({ success: true, message: 'No payment code' });
  }

  try {
    const order = await orderService.markPaidBySepay(paymentCode, amount, transactionId, webhookId);
    return res.status(200).json({
      success: true,
      message: 'Order updated',
      orderId: order._id,
      paymentStatus: order.paymentStatus
    });
  } catch (err) {
    return res.status(200).json({ success: false, message: err.message });
  }
});
