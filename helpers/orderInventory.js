const Product = require("../models/Product");
const AppError = require("../errors/AppError");
const { ORDER_OPS_STAGE, ORDER_STATUS, ORDER_TYPES } = require("../constants");

const PREORDER_COMMIT_OPS_STAGES = new Set([
  ORDER_OPS_STAGE.READY_TO_PACK,
  ORDER_OPS_STAGE.PACKING,
  ORDER_OPS_STAGE.READY_TO_SHIP,
  ORDER_OPS_STAGE.SHIPMENT_CREATED,
  ORDER_OPS_STAGE.HANDOVER_TO_CARRIER,
  ORDER_OPS_STAGE.IN_TRANSIT,
  ORDER_OPS_STAGE.DELIVERY_FAILED,
  ORDER_OPS_STAGE.WAITING_REDELIVERY,
  ORDER_OPS_STAGE.RETURN_PENDING,
  ORDER_OPS_STAGE.RETURN_IN_TRANSIT,
  ORDER_OPS_STAGE.EXCEPTION_HOLD,
  ORDER_OPS_STAGE.DELIVERED,
  ORDER_OPS_STAGE.RETURNED,
  ORDER_OPS_STAGE.CLOSED,
]);

function toTrimmedString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function normalizeOrderStatus(value) {
  const normalized = toTrimmedString(value, "").toLowerCase();
  if (Object.values(ORDER_STATUS).includes(normalized)) {
    return normalized;
  }
  return ORDER_STATUS.PENDING;
}

function normalizeOrderType(value) {
  const normalized = toTrimmedString(value, "").toLowerCase();
  if (Object.values(ORDER_TYPES).includes(normalized)) {
    return normalized;
  }
  return ORDER_TYPES.READY_STOCK;
}

function isTrackedInventoryProduct(product) {
  return Boolean(product) && product.inventory?.track !== false;
}

function shouldCommitInventory(order) {
  if (!order) return false;
  const normalizedOrderType = normalizeOrderType(order.orderType);
  if (normalizedOrderType === ORDER_TYPES.READY_STOCK) {
    return [
      ORDER_STATUS.CONFIRMED,
      ORDER_STATUS.PROCESSING,
      ORDER_STATUS.SHIPPED,
      ORDER_STATUS.DELIVERED,
      ORDER_STATUS.RETURNED,
    ].includes(normalizeOrderStatus(order.status));
  }

  if (normalizedOrderType === ORDER_TYPES.PRE_ORDER) {
    return PREORDER_COMMIT_OPS_STAGES.has(
      toTrimmedString(order?.opsStage, "").toLowerCase(),
    );
  }

  return false;
}

function hasCommittedInventory(order) {
  return Boolean(
    order?.inventoryCommit?.committedAt && !order?.inventoryCommit?.restoredAt,
  );
}

function hasInventoryEverBeenCommitted(order) {
  return Boolean(order?.inventoryCommit?.committedAt);
}

function ensureInventoryCommitState(order) {
  if (!order.inventoryCommit || typeof order.inventoryCommit !== "object") {
    order.inventoryCommit = {};
  }
  return order.inventoryCommit;
}

async function buildInventoryAdjustments(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) {
    return [];
  }

  const productIds = [
    ...new Set(
      items.map((item) => toTrimmedString(item?.productId)).filter(Boolean),
    ),
  ];

  const products = await Product.find({ _id: { $in: productIds } })
    .select("_id name type inventory variants")
    .lean();
  const productMap = new Map(products.map((product) => [String(product._id), product]));
  const groupedAdjustments = new Map();

  for (const item of items) {
    const productId = toTrimmedString(item?.productId);
    if (!productId) continue;

    const product = productMap.get(productId);
    if (!product) {
      throw new AppError(`Product not found for order item ${productId}`, 404);
    }

    if (!isTrackedInventoryProduct(product)) {
      continue;
    }

    const variants = Array.isArray(product.variants) ? product.variants : [];
    const rawVariantId = toTrimmedString(item?.variantId);
    const variant = rawVariantId
      ? variants.find((entry) => String(entry?._id) === rawVariantId)
      : variants.length === 1
        ? variants[0]
        : null;

    if (!variant?._id) {
      throw new AppError(
        `Cannot adjust inventory for "${product.name}" because the variant is missing`,
        400,
      );
    }

    const quantity = Number(item?.quantity || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }

    const key = `${productId}:${String(variant._id)}`;
    const current = groupedAdjustments.get(key) || {
      productId: product._id,
      productName: product.name,
      productType: product.type,
      variantId: variant._id,
      quantity: 0,
    };
    current.quantity += quantity;
    groupedAdjustments.set(key, current);
  }

  return [...groupedAdjustments.values()];
}

async function applyInventoryIncrements(adjustments, direction) {
  const multiplier = direction === "restore" ? 1 : -1;
  const applied = [];

  try {
    for (const adjustment of adjustments) {
      const query = {
        _id: adjustment.productId,
        "variants._id": adjustment.variantId,
      };

      if (direction === "deduct") {
        query["variants.stock"] = { $gte: adjustment.quantity };
      }

      const result = await Product.updateOne(query, {
        $inc: { "variants.$.stock": multiplier * adjustment.quantity },
      });

      if (!result?.modifiedCount) {
        const reason =
          direction === "deduct"
            ? `Insufficient stock to commit inventory for "${adjustment.productName}"`
            : `Cannot restore inventory for "${adjustment.productName}"`;
        throw new AppError(reason, 400);
      }

      applied.push(adjustment);
    }
  } catch (error) {
    if (direction === "deduct" && applied.length) {
      for (const adjustment of applied) {
        await Product.updateOne(
          {
            _id: adjustment.productId,
            "variants._id": adjustment.variantId,
          },
          { $inc: { "variants.$.stock": adjustment.quantity } },
        );
      }
    }

    throw error;
  }
}

async function commitOrderInventory(order, actorId = null) {
  if (
    !shouldCommitInventory(order) ||
    hasCommittedInventory(order) ||
    hasInventoryEverBeenCommitted(order)
  ) {
    return false;
  }

  const adjustments = await buildInventoryAdjustments(order);
  if (!adjustments.length) {
    return false;
  }

  await applyInventoryIncrements(adjustments, "deduct");

  const inventoryCommit = ensureInventoryCommitState(order);
  inventoryCommit.committedAt = new Date();
  inventoryCommit.committedBy = actorId || undefined;
  inventoryCommit.restoredAt = undefined;
  inventoryCommit.restoredBy = undefined;
  inventoryCommit.lastAction = "deducted";
  order.markModified("inventoryCommit");
  return true;
}

async function restoreOrderInventory(order, actorId = null) {
  if (!hasCommittedInventory(order)) {
    return false;
  }

  const adjustments = await buildInventoryAdjustments(order);
  if (adjustments.length) {
    await applyInventoryIncrements(adjustments, "restore");
  }

  const inventoryCommit = ensureInventoryCommitState(order);
  inventoryCommit.restoredAt = new Date();
  inventoryCommit.restoredBy = actorId || undefined;
  inventoryCommit.lastAction = "restored";
  order.markModified("inventoryCommit");
  return true;
}

module.exports = {
  commitOrderInventory,
  hasCommittedInventory,
  restoreOrderInventory,
  shouldCommitInventory,
};
