const Product = require('../models/Product');
const Store = require('../models/Store');
const StockReceipt = require('../models/StockReceipt');
const AppError = require('../errors/AppError');
const { buildStoreScopedQuery, canAccessStore } = require('../helpers/storeAccess');

function randomDigits(length) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += Math.floor(Math.random() * 10).toString();
  }
  return out;
}

function buildReceiptCode() {
  const now = new Date();
  const y = String(now.getUTCFullYear());
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `GRN-${y}${m}${d}-${randomDigits(5)}`;
}

async function generateUniqueReceiptCode() {
  for (let i = 0; i < 10; i += 1) {
    const code = buildReceiptCode();
    const exists = await StockReceipt.exists({ receiptCode: code });
    if (!exists) return code;
  }

  throw new AppError('Could not generate unique receipt code', 500);
}

function buildVariantLabel(variant = {}) {
  const parts = [];
  if (variant?.options?.color) parts.push(String(variant.options.color).trim());
  if (variant?.options?.size) parts.push(String(variant.options.size).trim());
  return parts.join(' / ');
}

function normalizePositiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new AppError(`${fieldName} must be an integer >= 1`, 400);
  }
  return number;
}

function normalizeNonNegativeNumber(value, fieldName) {
  if (value === undefined || value === null || value === '') return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new AppError(`${fieldName} must be a non-negative number`, 400);
  }
  return number;
}

class InventoryService {
  async resolveStoreId(storeId, currentUser) {
    const normalizedStoreId = String(storeId || '').trim();
    if (!normalizedStoreId) {
      throw new AppError('storeId is required', 400);
    }

    if (!canAccessStore(currentUser, normalizedStoreId)) {
      throw new AppError('Forbidden', 403);
    }

    const exists = await Store.exists({ _id: normalizedStoreId });
    if (!exists) {
      throw new AppError('Store not found', 404);
    }

    return normalizedStoreId;
  }

  buildScopedQuery(currentUser) {
    if (!currentUser?.id) {
      throw new AppError('Unauthorized', 401);
    }

    return { ...buildStoreScopedQuery(currentUser, 'storeId') };
  }

  async resolveReceiptItems(itemsInput = []) {
    if (!Array.isArray(itemsInput) || itemsInput.length === 0) {
      throw new AppError('items is required', 400);
    }

    const resolved = [];

    for (let i = 0; i < itemsInput.length; i += 1) {
      const input = itemsInput[i] || {};
      const productId = input.productId || input.product_id;
      const variantId = input.variantId || input.variant_id;
      if (!productId) throw new AppError(`items[${i}].productId is required`, 400);
      if (!variantId) throw new AppError(`items[${i}].variantId is required`, 400);

      const quantity = normalizePositiveInteger(input.quantity, `items[${i}].quantity`);
      const unitCost = normalizeNonNegativeNumber(input.unitCost, `items[${i}].unitCost`);
      const note = String(input.note || '').trim();

      const product = await Product.findById(productId).select('_id name variants');
      if (!product) throw new AppError(`Product not found for items[${i}]`, 404);

      const variants = Array.isArray(product.variants) ? product.variants : [];
      const variant = variants.find((item) => String(item._id) === String(variantId));
      if (!variant) throw new AppError(`Variant not found for items[${i}]`, 404);

      resolved.push({
        productId: product._id,
        variantId: variant._id,
        sku: String(input.sku || variant.sku || '').trim(),
        productName: product.name,
        variantLabel: String(input.variantLabel || buildVariantLabel(variant) || '').trim(),
        quantity,
        unitCost,
        lineTotal: unitCost * quantity,
        note
      });
    }

    return resolved;
  }

  async createStockReceipt(payload = {}, currentUser) {
    if (!currentUser?.id) throw new AppError('Unauthorized', 401);

    const supplier = String(payload.supplier || '').trim();
    if (!supplier) throw new AppError('supplier is required', 400);

    const warehouseLocation = String(payload.warehouseLocation || '').trim();
    const note = String(payload.note || '').trim();
    const receivedAt = payload.receivedAt ? new Date(payload.receivedAt) : new Date();
    if (Number.isNaN(receivedAt.getTime())) {
      throw new AppError('receivedAt is invalid', 400);
    }
    const storeId = await this.resolveStoreId(payload.storeId || payload.store_id, currentUser);

    const items = await this.resolveReceiptItems(payload.items);

    for (const item of items) {
      const result = await Product.updateOne(
        { _id: item.productId, 'variants._id': item.variantId },
        { $inc: { 'variants.$.stock': item.quantity } }
      );

      if (!result.matchedCount) {
        throw new AppError('Failed to update product stock', 400);
      }
    }

    const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const receiptCode = await generateUniqueReceiptCode();

    const receipt = await StockReceipt.create({
      receiptCode,
      storeId,
      supplier,
      warehouseLocation,
      receivedAt,
      status: 'confirmed',
      totalQuantity,
      items,
      note,
      createdBy: currentUser.id
    });

    return StockReceipt.findById(receipt._id).populate([
      { path: 'createdBy', select: 'name email role' },
      { path: 'storeId', select: 'name code type status city district' },
    ]);
  }

  async listStockReceipts(options = {}, currentUser) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 10));
    const skip = (page - 1) * limit;
    const query = this.buildScopedQuery(currentUser);

    if (options.storeId) {
      const scopedStoreId = await this.resolveStoreId(options.storeId, currentUser);
      query.storeId = scopedStoreId;
    }

    if (options.supplier) {
      query.supplier = { $regex: String(options.supplier).trim(), $options: 'i' };
    }

    if (options.receiptCode) {
      query.receiptCode = { $regex: String(options.receiptCode).trim(), $options: 'i' };
    }

    if (options.fromDate || options.toDate) {
      query.receivedAt = {};
      if (options.fromDate) {
        const fromDate = new Date(options.fromDate);
        if (Number.isNaN(fromDate.getTime())) throw new AppError('fromDate is invalid', 400);
        query.receivedAt.$gte = fromDate;
      }
      if (options.toDate) {
        const toDate = new Date(options.toDate);
        if (Number.isNaN(toDate.getTime())) throw new AppError('toDate is invalid', 400);
        query.receivedAt.$lte = toDate;
      }
    }

    const [receipts, total] = await Promise.all([
      StockReceipt.find(query)
        .populate({ path: 'createdBy', select: 'name email role' })
        .populate({ path: 'storeId', select: 'name code type status city district' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      StockReceipt.countDocuments(query)
    ]);

    return {
      receipts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async getStockReceiptById(id, currentUser) {
    const receipt = await StockReceipt.findOne({
      _id: id,
      ...this.buildScopedQuery(currentUser),
    })
      .populate({ path: 'createdBy', select: 'name email role' })
      .populate({ path: 'storeId', select: 'name code type status city district' })
      .populate({ path: 'items.productId', select: 'name type brand status' });

    if (!receipt) throw new AppError('Stock receipt not found', 404);
    return receipt;
  }
}

module.exports = new InventoryService();
