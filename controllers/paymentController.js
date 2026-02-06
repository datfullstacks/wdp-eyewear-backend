const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/response');
const orderService = require('../services/orderService');
const { SEPAY_WEBHOOK_SECRET } = require('../config/sepay');

// Simple shared secret check
function verifySignature(req) {
  if (!SEPAY_WEBHOOK_SECRET) return true;
  const token = req.headers['x-sepay-signature'] || req.headers['x-api-key'];
  return token === SEPAY_WEBHOOK_SECRET;
}

exports.sepayWebhook = asyncHandler(async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }

  const payload = req.body || {};
  const content = payload?.code || payload?.description || payload?.content || '';
  const amount = Number(payload?.amount || payload?.transferAmount || payload?.amount_vnd || 0);
  const transactionId = payload?.id || payload?.transaction_id || payload?.txid || '';

  const match = payload?.code ? [payload.code] : content.match(/WDP-?\d{6}-\d{4}/);
  if (!match || !match[0]) {
    return res.status(200).json({ success: true, message: 'No payment code' });
  }
  const paymentCode = match[0].replace(' ', '').replace('WDP', 'WDP-').replace('--', '-');

  try {
    const order = await orderService.markPaidBySepay(paymentCode, amount, transactionId);
    return res.status(200).json({ success: true, message: 'Order updated', orderId: order._id });
  } catch (err) {
    return res.status(200).json({ success: false, message: err.message });
  }
});
