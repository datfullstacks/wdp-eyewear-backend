const AppError = require("../errors/AppError");
const mongoose = require("mongoose");
const { ORDER_STATUS, PAYMENT_METHODS, PAYMENT_STATUS } = require("../constants");
const { Promotion } = require("../models/Promotion");
const { PromotionRedemption } = require("../models/PromotionRedemption");

const ACTIVE_REDEMPTION_STATES = new Set(["reserved", "consumed"]);
const FINAL_VOUCHER_ORDER_STATUSES = new Set([
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.RETURNED,
]);
const MERCHANT_SIDE_RESPONSIBILITIES = new Set(["system", "carrier", "mixed"]);

function normalizeId(value) {
  const candidate =
    value && typeof value === "object" ? value._id || value.id || "" : value;
  const normalized = String(candidate || "").trim();
  return normalized || "";
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeOptionalString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim() || fallback;
}

function normalizePaymentMethod(value, fallback = "") {
  const normalized = normalizeOptionalString(value, fallback).toLowerCase();
  if (
    normalized === PAYMENT_METHODS.SEPAY ||
    normalized === PAYMENT_METHODS.COD
  ) {
    return normalized;
  }
  return fallback;
}

function normalizeResponsibility(value) {
  const normalized = normalizeOptionalString(value, "").toLowerCase();
  return normalized || "";
}

function isMerchantSideResponsibility(value, { allowMixed = true } = {}) {
  const normalized = normalizeResponsibility(value);
  if (!normalized) return false;
  if (normalized === "mixed") return allowMixed;
  return MERCHANT_SIDE_RESPONSIBILITIES.has(normalized);
}

function shouldConsumeForOrder(order = {}) {
  const paymentMethod = normalizePaymentMethod(order?.paymentMethod);
  const orderStatus = normalizeOptionalString(order?.status, "").toLowerCase();
  const paymentStatus = normalizeOptionalString(
    order?.paymentStatus,
    "",
  ).toLowerCase();

  if (paymentMethod === PAYMENT_METHODS.COD) {
    return ![ORDER_STATUS.PENDING, ORDER_STATUS.CANCELLED].includes(orderStatus);
  }

  return paymentStatus === PAYMENT_STATUS.PAID;
}

function isVoucherFinalized(order = {}) {
  const orderStatus = normalizeOptionalString(order?.status, "").toLowerCase();
  return FINAL_VOUCHER_ORDER_STATUSES.has(orderStatus);
}

function shouldReleaseCurrentRedemption(order = {}, existingState = "", options = {}) {
  const normalizedExistingState = normalizeOptionalString(existingState, "").toLowerCase();
  const orderStatus = normalizeOptionalString(order?.status, "").toLowerCase();
  const refundStatus = normalizeOptionalString(order?.refund?.status, "").toLowerCase();
  const paymentStatus = normalizeOptionalString(order?.paymentStatus, "").toLowerCase();
  const responsibilityExplicit = Boolean(options.responsibilityExplicit);
  const responsibility = responsibilityExplicit
    ? normalizeResponsibility(options.responsibility)
    : normalizeResponsibility(order?.refund?.responsibility);
  const allowMixed = responsibilityExplicit || refundStatus === "completed";
  const merchantSide = isMerchantSideResponsibility(responsibility, { allowMixed });

  if (normalizedExistingState === "reserved" && orderStatus === ORDER_STATUS.CANCELLED) {
    return true;
  }

  if (normalizedExistingState !== "consumed") {
    return false;
  }

  if (isVoucherFinalized(order)) {
    return false;
  }

  if (orderStatus === ORDER_STATUS.CANCELLED) {
    return merchantSide;
  }

  const refundCompleted =
    refundStatus === "completed" || paymentStatus === PAYMENT_STATUS.REFUNDED;

  return refundCompleted && merchantSide;
}

function buildUsageSummary(promotion = {}, counts = {}) {
  const usageLimit = Math.max(0, Number(promotion?.usageLimit || 0));
  const reservedCount = Math.max(0, Number(counts?.reservedCount || 0));
  const usedCount = Math.max(0, Number(counts?.usedCount || 0));
  const activeCount = reservedCount + usedCount;

  return {
    reservedCount,
    usedCount,
    activeCount,
    remainingCount:
      usageLimit > 0 ? Math.max(0, usageLimit - activeCount) : null,
  };
}

async function getPromotionUsageSummaryMap(promotions = [], options = {}) {
  const promotionList = Array.isArray(promotions) ? promotions : [promotions];
  const promotionIds = [
    ...new Set(
      promotionList
        .map((promotion) => normalizeId(promotion?._id || promotion?.id || promotion))
        .filter(Boolean),
    ),
  ];
  const excludedOrderId = normalizeId(options.excludeOrderId);

  if (promotionIds.length === 0) {
    return new Map();
  }

  const match = {
    promotionId: {
      $in: promotionIds.map((id) => new mongoose.Types.ObjectId(id)),
    },
  };
  if (excludedOrderId) {
    match.orderId = { $ne: new mongoose.Types.ObjectId(excludedOrderId) };
  }

  const rows = await PromotionRedemption.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$promotionId",
        reservedCount: {
          $sum: {
            $cond: [{ $eq: ["$state", "reserved"] }, 1, 0],
          },
        },
        usedCount: {
          $sum: {
            $cond: [{ $eq: ["$state", "consumed"] }, 1, 0],
          },
        },
      },
    },
  ]);

  const rowMap = new Map(
    rows.map((row) => [
      normalizeId(row?._id),
      {
        reservedCount: Number(row?.reservedCount || 0),
        usedCount: Number(row?.usedCount || 0),
      },
    ]),
  );

  return new Map(
    promotionList.map((promotion) => {
      const id = normalizeId(promotion?._id || promotion?.id || promotion);
      return [id, buildUsageSummary(promotion, rowMap.get(id) || {})];
    }),
  );
}

async function syncPromotionUsedCount(promotionId) {
  const normalizedPromotionId = normalizeId(promotionId);
  if (!normalizedPromotionId) return null;

  const usedCount = await PromotionRedemption.countDocuments({
    promotionId: normalizedPromotionId,
    state: "consumed",
  });

  await Promotion.findByIdAndUpdate(normalizedPromotionId, {
    $set: { usedCount },
  });

  return usedCount;
}

async function syncPromotionUsedCounts(promotionIds = []) {
  const ids = [...new Set((Array.isArray(promotionIds) ? promotionIds : [promotionIds]).map(normalizeId).filter(Boolean))];
  if (ids.length === 0) return;
  await Promise.all(ids.map((promotionId) => syncPromotionUsedCount(promotionId)));
}

async function assertPromotionHasCapacity(promotion, { existingRedemption = null } = {}) {
  const usageLimit = Math.max(0, Number(promotion?.usageLimit || 0));
  if (usageLimit <= 0) return;

  if (
    existingRedemption &&
    ACTIVE_REDEMPTION_STATES.has(
      normalizeOptionalString(existingRedemption?.state, "").toLowerCase(),
    )
  ) {
    return;
  }

  const activeCount = await PromotionRedemption.countDocuments({
    promotionId: promotion._id,
    state: { $in: ["reserved", "consumed"] },
  });

  if (activeCount >= usageLimit) {
    throw new AppError("Voucher usage limit reached", 400);
  }
}

function buildSnapshotUpdate(order = {}, options = {}) {
  const responsibility =
    options.responsibilityExplicit === true
      ? normalizeResponsibility(options.responsibility)
      : normalizeResponsibility(order?.refund?.responsibility);

  return {
    userId: normalizeId(order?.userId) || null,
    code: normalizeCode(order?.promotionApplied?.code || order?.voucherCode),
    paymentMethod: normalizePaymentMethod(order?.paymentMethod),
    orderStatus: normalizeOptionalString(order?.status, "").toLowerCase(),
    paymentStatus: normalizeOptionalString(order?.paymentStatus, "").toLowerCase(),
    responsibility,
  };
}

async function releaseRedemption(redemption, options = {}) {
  if (!redemption) return null;

  redemption.state = "released";
  redemption.releaseReason = normalizeOptionalString(options.releaseReason, redemption.releaseReason || "");
  redemption.responsibility = normalizeResponsibility(
    options.responsibility ?? redemption.responsibility,
  );
  redemption.releasedAt = options.releasedAt || new Date();
  redemption.orderStatus = normalizeOptionalString(
    options.orderStatus,
    redemption.orderStatus || "",
  ).toLowerCase();
  redemption.paymentStatus = normalizeOptionalString(
    options.paymentStatus,
    redemption.paymentStatus || "",
  ).toLowerCase();
  redemption.paymentMethod = normalizePaymentMethod(
    options.paymentMethod,
    redemption.paymentMethod || "",
  );

  await redemption.save();
  await syncPromotionUsedCount(redemption.promotionId);
  return redemption;
}

async function releasePromotionRedemptionsForOrder(orderId, options = {}) {
  const normalizedOrderId = normalizeId(orderId);
  if (!normalizedOrderId) return [];

  const redemptions = await PromotionRedemption.find({
    orderId: normalizedOrderId,
    state: { $in: ["reserved", "consumed"] },
  });

  const affectedPromotionIds = new Set();
  const results = [];

  for (const redemption of redemptions) {
    affectedPromotionIds.add(normalizeId(redemption.promotionId));
    results.push(
      await releaseRedemption(redemption, {
        ...options,
        orderStatus: options.orderStatus,
        paymentStatus: options.paymentStatus,
        paymentMethod: options.paymentMethod,
      }),
    );
  }

  await syncPromotionUsedCounts([...affectedPromotionIds]);
  return results;
}

async function upsertCurrentRedemption(order, targetPromotion, existingRedemption, options = {}) {
  const snapshot = buildSnapshotUpdate(order, options);
  const shouldRelease = shouldReleaseCurrentRedemption(
    order,
    existingRedemption?.state || "",
    options,
  );
  const shouldConsume = shouldConsumeForOrder(order);
  const shouldFinalizeConsumption = isVoucherFinalized(order);

  if (shouldRelease) {
    if (!existingRedemption) {
      const created = await PromotionRedemption.create({
        promotionId: targetPromotion._id,
        orderId: order._id,
        userId: snapshot.userId,
        code: snapshot.code || normalizeCode(targetPromotion.code),
        state: "released",
        paymentMethod: snapshot.paymentMethod,
        orderStatus: snapshot.orderStatus,
        paymentStatus: snapshot.paymentStatus,
        responsibility: snapshot.responsibility,
        releaseReason: normalizeOptionalString(options.releaseReason, "order_released"),
        reservedAt: order?.createdAt || new Date(),
        releasedAt: options.releasedAt || new Date(),
      });
      await syncPromotionUsedCount(targetPromotion._id);
      return created;
    }

    return releaseRedemption(existingRedemption, {
      releaseReason: options.releaseReason || "order_released",
      responsibility: snapshot.responsibility,
      orderStatus: snapshot.orderStatus,
      paymentStatus: snapshot.paymentStatus,
      paymentMethod: snapshot.paymentMethod,
      releasedAt: options.releasedAt || new Date(),
    });
  }

  await assertPromotionHasCapacity(targetPromotion, {
    existingRedemption,
  });

  const now = new Date();
  const nextState =
    normalizeOptionalString(existingRedemption?.state, "").toLowerCase() === "consumed"
      ? "consumed"
      : shouldConsume || shouldFinalizeConsumption
        ? "consumed"
        : "reserved";

  const payload = {
    promotionId: targetPromotion._id,
    orderId: order._id,
    userId: snapshot.userId,
    code: snapshot.code || normalizeCode(targetPromotion.code),
    state: nextState,
    paymentMethod: snapshot.paymentMethod,
    orderStatus: snapshot.orderStatus,
    paymentStatus: snapshot.paymentStatus,
    responsibility: snapshot.responsibility,
    releaseReason: nextState === "released" ? normalizeOptionalString(options.releaseReason, "") : "",
    reservedAt: existingRedemption?.reservedAt || order?.createdAt || now,
    consumedAt:
      nextState === "consumed"
        ? existingRedemption?.consumedAt || now
        : existingRedemption?.consumedAt || null,
    releasedAt: null,
  };

  let redemption = existingRedemption;
  if (!redemption) {
    redemption = await PromotionRedemption.create(payload);
  } else {
    Object.assign(redemption, payload);
    await redemption.save();
  }

  await syncPromotionUsedCount(targetPromotion._id);
  return redemption;
}

async function syncOrderPromotionRedemption(order, options = {}) {
  if (!order?._id) return null;

  const currentPromotionCode = normalizeCode(
    order?.promotionApplied?.code || order?.voucherCode,
  );
  const currentPromotionId = normalizeId(order?.promotionApplied?.promotionId);
  const existingRedemptions = await PromotionRedemption.find({
    orderId: order._id,
  });
  const affectedPromotionIds = new Set(
    existingRedemptions.map((redemption) => normalizeId(redemption?.promotionId)),
  );

  let targetPromotion = null;
  if (currentPromotionId) {
    targetPromotion = await Promotion.findById(currentPromotionId);
  } else if (currentPromotionCode) {
    targetPromotion = await Promotion.findOne({ code: currentPromotionCode });
  }

  const targetPromotionId = normalizeId(targetPromotion?._id);
  const obsoleteRedemptions = existingRedemptions.filter(
    (redemption) =>
      targetPromotionId &&
      normalizeId(redemption?.promotionId) !== targetPromotionId &&
      ACTIVE_REDEMPTION_STATES.has(
        normalizeOptionalString(redemption?.state, "").toLowerCase(),
      ),
  );

  if (!targetPromotion) {
    for (const redemption of existingRedemptions) {
      if (
        ACTIVE_REDEMPTION_STATES.has(
          normalizeOptionalString(redemption?.state, "").toLowerCase(),
        )
      ) {
        await releaseRedemption(redemption, {
          releaseReason: options.releaseReason || "voucher_removed",
          responsibility: options.responsibility,
          orderStatus: order?.status,
          paymentStatus: order?.paymentStatus,
          paymentMethod: order?.paymentMethod,
        });
      }
    }

    await syncPromotionUsedCounts([...affectedPromotionIds]);
    return null;
  }

  affectedPromotionIds.add(targetPromotionId);

  for (const redemption of obsoleteRedemptions) {
    await releaseRedemption(redemption, {
      releaseReason: options.releaseReason || "voucher_changed",
      responsibility: options.responsibility,
      orderStatus: order?.status,
      paymentStatus: order?.paymentStatus,
      paymentMethod: order?.paymentMethod,
    });
  }

  const currentRedemption =
    existingRedemptions.find(
      (redemption) => normalizeId(redemption?.promotionId) === targetPromotionId,
    ) || null;

  const result = await upsertCurrentRedemption(
    order,
    targetPromotion,
    currentRedemption,
    options,
  );

  await syncPromotionUsedCounts([...affectedPromotionIds]);
  return result;
}

function deriveBackfillRedemptionState(order = {}, options = {}) {
  const existingState = normalizeOptionalString(options.existingState, "reserved").toLowerCase();
  if (shouldReleaseCurrentRedemption(order, existingState, options)) {
    return "released";
  }
  if (existingState === "consumed" || shouldConsumeForOrder(order) || isVoucherFinalized(order)) {
    return "consumed";
  }
  return "reserved";
}

module.exports = {
  getPromotionUsageSummaryMap,
  syncPromotionUsedCount,
  syncPromotionUsedCounts,
  syncOrderPromotionRedemption,
  releasePromotionRedemptionsForOrder,
  deriveBackfillRedemptionState,
  __private: {
    normalizeCode,
    normalizePaymentMethod,
    normalizeResponsibility,
    isMerchantSideResponsibility,
    shouldConsumeForOrder,
    shouldReleaseCurrentRedemption,
    buildUsageSummary,
    deriveBackfillRedemptionState,
  },
};
