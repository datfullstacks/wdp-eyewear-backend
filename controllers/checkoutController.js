const asyncHandler = require("../helpers/asyncHandler");
const ApiResponse = require("../helpers/response");
const orderService = require("../services/orderService");
const { PAYMENT_METHODS } = require("../constants");
const {
  SEPAY_BANK_ACCOUNT_ID,
  SEPAY_BANK_ACCOUNT_NUMBER,
  SEPAY_BANK_NAME,
  SEPAY_BANK_ACCOUNT_NAME,
} = require("../config/sepay");

const buildSepayQrUrl = ({ accountNumber, bankName, amount, description }) => {
  if (!accountNumber || !bankName) return null;
  const params = [
    `acc=${encodeURIComponent(accountNumber)}`,
    `bank=${encodeURIComponent(bankName)}`,
  ];

  if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
    params.push(`amount=${Math.round(amount)}`);
  }

  if (description) {
    params.push(`des=${encodeURIComponent(description)}`);
  }

  return `https://qr.sepay.vn/img?${params.join("&")}`;
};

const normalizeInput = (body) => {
  const normalizeNumber = (v, def = 0) => {
    if (v === undefined || v === null || v === "") return def;
    const n = Number(v);
    return Number.isNaN(n) ? def : n;
  };

  const items = Array.isArray(body.items)
    ? body.items.map((item) => ({
        productId: item.productId || item.product_id,
        variantId: item.variantId ?? item.variant_id ?? null,
        quantity: Number(item.quantity || 0),
        customization: item.customization,
      }))
    : [];

  return {
    items,
    shippingFee: normalizeNumber(body.shippingFee ?? body.shipping_fee, 0),
    discountAmount: normalizeNumber(
      body.discountAmount ?? body.discount_amount,
      0,
    ),
    paymentMethod: body.paymentMethod || body.payment_method,
    shippingMethod: body.shippingMethod || body.shipping_method,
    shippingAddress: body.shippingAddress || body.shipping_address,
    storeId: body.storeId || body.store_id,
    cartType: body.cartType || body.cart_type,
    voucherCode: body.voucherCode || body.voucher_code,
    note: body.note,
  };
};

// GET/POST quote checkout
exports.quote = asyncHandler(async (req, res) => {
  const input = normalizeInput(req.body);
  const result = await orderService.quote(
    input.items,
    input.shippingFee,
    input.discountAmount,
    {
      cartType: input.cartType,
      paymentMethod: input.paymentMethod,
      voucherCode: input.voucherCode,
      shippingMethod: input.shippingMethod,
      shippingAddress: input.shippingAddress,
      storeId: input.storeId,
      currentUser: req.user || null,
    },
  );
  ApiResponse.success(res, {
    ...result,
    paymentMethod: result.paymentMethod || input.paymentMethod || PAYMENT_METHODS.SEPAY,
  });
});

// Create order + return sepay instructions
exports.create = asyncHandler(async (req, res) => {
  const input = normalizeInput(req.body);
  const userId = req.user?.id;

  const { order, quote, invoice } = await orderService.createOrder({
    userId,
    itemsInput: input.items,
    shippingFee: input.shippingFee ?? 0,
    discountAmount: input.discountAmount ?? 0,
    shippingMethod: input.shippingMethod || "standard",
    shippingAddress: input.shippingAddress,
    storeId: input.storeId,
    cartType: input.cartType,
    paymentMethod: input.paymentMethod,
    voucherCode: input.voucherCode,
    note: input.note,
  });

  const selectedPaymentMethod = String(
    quote.paymentMethod || input.paymentMethod || PAYMENT_METHODS.SEPAY,
  )
    .trim()
    .toLowerCase();
  const isCodOrder = selectedPaymentMethod === PAYMENT_METHODS.COD;
  const payAmount = isCodOrder ? quote.payLater : quote.payNow;
  const hasSepayBalanceLeg =
    !isCodOrder &&
    String(quote.payLaterMethod || "").trim().toLowerCase() ===
      PAYMENT_METHODS.SEPAY &&
    Number(quote.payLater || 0) > 0;
  const hasCodBalanceLeg =
    !isCodOrder &&
    String(quote.payLaterMethod || "").trim().toLowerCase() ===
      PAYMENT_METHODS.COD &&
    Number(quote.payLater || 0) > 0;
  const paymentContent = order.paymentCode;
  const bankAccountNumber =
    SEPAY_BANK_ACCOUNT_NUMBER || SEPAY_BANK_ACCOUNT_ID || null;
  const bankName = SEPAY_BANK_NAME || null;
  const paymentDescription = isCodOrder
    ? "Thanh toán khi nhận hàng"
    : payAmount > 0
      ? `Nhap dung noi dung: ${paymentContent}`
      : "Khong can thanh toan truoc";
  const paymentInstruction = isCodOrder
    ? "Khach hang thanh toan khi nhan hang (COD)."
    : payAmount > 0
      ? hasSepayBalanceLeg
        ? "Chuyen khoan SePay cho dot dau va giu nguyen noi dung de he thong tu dong xac nhan. Phan con lai se tiep tuc thu qua SePay truoc khi giao hang."
        : hasCodBalanceLeg
          ? "Chuyen khoan SePay cho phan dat coc da bao gom phi van chuyen. Phan tien hang con lai se thu qua COD khi giao hang."
        : "Chuyen khoan SePay va giu nguyen noi dung de he thong tu dong xac nhan"
      : hasSepayBalanceLeg
        ? "Dot dau khong can thanh toan. Phan con lai se thu qua SePay truoc khi giao hang."
        : hasCodBalanceLeg
          ? "Da ghi nhan phan dat coc/phi ship. Phan tien hang con lai se thu qua COD khi giao hang."
        : "Don hang khong co khoan thanh toan truoc. Phan con lai se thu theo COD neu co.";

  const paymentInstructions = {
    method: isCodOrder
      ? PAYMENT_METHODS.COD
      : quote.payNowMethod || PAYMENT_METHODS.SEPAY,
    status: isCodOrder ? "PENDING_COD" : payAmount > 0 ? "PENDING_QR" : "PAID",
    amount: payAmount,
    currency: "VND",
    paymentCode: order.paymentCode,
    content: paymentContent,
    bankAccountId: SEPAY_BANK_ACCOUNT_ID || null,
    bankAccountNumber,
    bankName,
    bankAccountName: SEPAY_BANK_ACCOUNT_NAME || null,
    description: paymentDescription,
    instruction: paymentInstruction,
    qrUrl: !isCodOrder && payAmount > 0
      ? buildSepayQrUrl({
          accountNumber: bankAccountNumber,
          bankName,
          amount: payAmount,
          description: paymentContent,
        })
      : null,
  };

  ApiResponse.created(
    res,
    {
      orderId: order._id,
      invoice: invoice
        ? {
            invoiceId: invoice._id,
            invoiceCode: invoice.invoiceCode,
            status: invoice.status,
            amountDue: invoice.amountDue,
            total: invoice.total,
          }
        : null,
      payment: paymentInstructions,
      breakdown: {
        subtotal: quote.subtotal,
        shippingFee: quote.shippingFee,
        discountAmount: quote.discountAmount,
        total: quote.total,
        orderType: quote.orderType,
        allowedPaymentMethods: quote.allowedPaymentMethods,
        payNow: quote.payNow,
        payLater: quote.payLater,
        paymentMethod: quote.paymentMethod,
        payNowMethod: quote.payNowMethod,
        payLaterMethod: quote.payLaterMethod,
        shippingFeeMode: quote.shippingFeeMode,
        shippingCollectionTiming: quote.shippingCollectionTiming,
      },
      orderType: quote.orderType,
      allowedPaymentMethods: quote.allowedPaymentMethods,
      paymentMethod: quote.paymentMethod,
      paymentStatus: order.paymentStatus,
      voucherCode: order.voucherCode || null,
    },
    "Checkout created. Proceed with Sepay payment.",
  );
});
