function randomDigits(len) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += Math.floor(Math.random() * 10).toString();
  }
  return out;
}

function generatePaymentCode() {
  // Format: WDP-YYMMDD-XXXX
  const now = new Date();
  const y = String(now.getUTCFullYear()).slice(-2);
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `WDP-${y}${m}${d}-${randomDigits(4)}`;
}

module.exports = { generatePaymentCode };
