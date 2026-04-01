const Product = require('../models/Product');
const Store = require('../models/Store');
const AppError = require('../errors/AppError');
const { PREORDER_BATCH_STATUSES, PreorderBatch } = require('../models/PreorderBatch');
const { publishStatusChange } = require('../helpers/statusEvents');
const { buildStoreScopedQuery, canAccessStore } = require('../helpers/storeAccess');
const { findSingleStoreId } = require('../helpers/singleStore');

const PREORDER_STATUS_SET = new Set(PREORDER_BATCH_STATUSES);

function normalizePositiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new AppError(`${fieldName} must be an integer >= 1`, 400);
  }
  return number;
}

function buildVariantLabel(variant = {}) {
  const parts = [];
  if (variant?.options?.color) parts.push(String(variant.options.color).trim());
  if (variant?.options?.size) parts.push(String(variant.options.size).trim());
  return parts.join(' / ');
}

class PreorderService {
  async resolveStoreId(storeId, currentUser) {
    const normalizedStoreId = String(storeId || '').trim();
    if (!normalizedStoreId) {
      return findSingleStoreId();
    }

    if (!canAccessStore(currentUser, normalizedStoreId)) {
      throw new AppError('Forbidden', 403);
    }

    const exists = await Store.exists({ _id: normalizedStoreId });
    if (!exists) {
      throw new AppError('Store not found', 404);
    }

    return findSingleStoreId();
  }

  buildScopedQuery(currentUser) {
    if (!currentUser?.id) {
      throw new AppError('Unauthorized', 401);
    }

    return { ...buildStoreScopedQuery(currentUser, 'storeId') };
  }

  async getScopedBatch(batchId, currentUser) {
    const batch = await PreorderBatch.findOne({
      _id: batchId,
      ...this.buildScopedQuery(currentUser),
    });

    if (!batch) {
      throw new AppError('Preorder batch not found', 404);
    }

    return batch;
  }

  async resolveBatchItems(itemsInput = []) {
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

      const orderedQty = normalizePositiveInteger(input.orderedQty, `items[${i}].orderedQty`);
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
        orderedQty,
        receivedQty: 0,
        pendingQty: orderedQty
      });
    }

    return resolved;
  }

  async createBatch(payload = {}, currentUser) {
    if (!currentUser?.id) throw new AppError('Unauthorized', 401);

    const batchCode = String(payload.batchCode || '').trim().toUpperCase();
    const supplier = String(payload.supplier || '').trim();
    const note = String(payload.note || '').trim();
    const statusInput = String(payload.status || 'pending').trim().toLowerCase();
    const status = PREORDER_STATUS_SET.has(statusInput) ? statusInput : 'pending';

    if (!batchCode) throw new AppError('batchCode is required', 400);
    if (!supplier) throw new AppError('supplier is required', 400);
    const storeId = await this.resolveStoreId(payload.storeId || payload.store_id, currentUser);

    const orderDate = payload.orderDate ? new Date(payload.orderDate) : new Date();
    if (Number.isNaN(orderDate.getTime())) throw new AppError('orderDate is invalid', 400);

    const expectedDate = payload.expectedDate ? new Date(payload.expectedDate) : null;
    if (expectedDate && Number.isNaN(expectedDate.getTime())) {
      throw new AppError('expectedDate is invalid', 400);
    }
    if (expectedDate && expectedDate < orderDate) {
      throw new AppError('expectedDate must be after or equal to orderDate', 400);
    }

    const existing = await PreorderBatch.findOne({ batchCode });
    if (existing) throw new AppError('batchCode already exists', 400);

    const items = await this.resolveBatchItems(payload.items);
    const totalItems = items.reduce((sum, item) => sum + Number(item.orderedQty || 0), 0);

    const batch = await PreorderBatch.create({
      batchCode,
      storeId,
      supplier,
      orderDate,
      expectedDate: expectedDate || undefined,
      status,
      items,
      totalItems,
      receivedItems: 0,
      note,
      createdBy: currentUser.id
    });

    return PreorderBatch.findById(batch._id).populate([
      { path: 'createdBy', select: 'name email role' },
      { path: 'storeId', select: 'name code type status city district' },
    ]);
  }

  async listBatches(options = {}, currentUser) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 10));
    const skip = (page - 1) * limit;
    const query = this.buildScopedQuery(currentUser);

    if (options.storeId) {
      const scopedStoreId = await this.resolveStoreId(options.storeId, currentUser);
      query.storeId = scopedStoreId;
    }

    if (options.status) {
      const normalized = String(options.status).trim().toLowerCase();
      if (PREORDER_STATUS_SET.has(normalized)) {
        query.status = normalized;
      }
    }

    if (options.supplier) {
      query.supplier = { $regex: String(options.supplier).trim(), $options: 'i' };
    }

    if (options.search) {
      const search = String(options.search).trim();
      query.$or = [
        { batchCode: { $regex: search, $options: 'i' } },
        { supplier: { $regex: search, $options: 'i' } }
      ];
    }

    const [batches, total] = await Promise.all([
      PreorderBatch.find(query)
        .populate({ path: 'createdBy', select: 'name email role' })
        .populate({ path: 'storeId', select: 'name code type status city district' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      PreorderBatch.countDocuments(query)
    ]);

    return {
      batches,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async getBatchById(id, currentUser) {
    const batch = await PreorderBatch.findOne({
      _id: id,
      ...this.buildScopedQuery(currentUser),
    })
      .populate({ path: 'createdBy', select: 'name email role' })
      .populate({ path: 'storeId', select: 'name code type status city district' })
      .populate({ path: 'receipts.receivedBy', select: 'name email role' })
      .populate({ path: 'items.productId', select: 'name type brand status variants' });

    if (!batch) throw new AppError('Preorder batch not found', 404);
    return batch;
  }

  async receiveBatch(batchId, payload = {}, currentUser) {
    if (!currentUser?.id) throw new AppError('Unauthorized', 401);

    const batch = await this.getScopedBatch(batchId, currentUser);
    const previousStatus = batch.status;

    if (batch.status === 'completed' && batch.items.every((item) => Number(item.pendingQty || 0) === 0)) {
      throw new AppError('Batch is already completed', 400);
    }

    const itemsInput = Array.isArray(payload.items) ? payload.items : [];
    if (itemsInput.length === 0) throw new AppError('items is required', 400);

    const qtyByBatchItemId = new Map();
    for (let i = 0; i < itemsInput.length; i += 1) {
      const input = itemsInput[i] || {};
      const batchItemId = String(input.batchItemId || '').trim();
      if (!batchItemId) throw new AppError(`items[${i}].batchItemId is required`, 400);
      const quantity = normalizePositiveInteger(input.quantity, `items[${i}].quantity`);

      const prev = qtyByBatchItemId.get(batchItemId) || 0;
      qtyByBatchItemId.set(batchItemId, prev + quantity);
    }

    const changes = [];
    for (const [batchItemId, quantity] of qtyByBatchItemId.entries()) {
      const item = batch.items.id(batchItemId);
      if (!item) throw new AppError(`Batch item not found: ${batchItemId}`, 404);
      if (quantity > Number(item.pendingQty || 0)) {
        throw new AppError(`Quantity exceeds pending amount for item ${batchItemId}`, 400);
      }
      changes.push({ item, quantity });
    }

    for (const change of changes) {
      const result = await Product.updateOne(
        { _id: change.item.productId, 'variants._id': change.item.variantId },
        { $inc: { 'variants.$.stock': change.quantity } }
      );
      if (!result.matchedCount) {
        throw new AppError('Failed to update product stock', 400);
      }
    }

    for (const change of changes) {
      change.item.receivedQty = Number(change.item.receivedQty || 0) + change.quantity;
      change.item.pendingQty = Number(change.item.pendingQty || 0) - change.quantity;
    }

    const totalReceived = changes.reduce((sum, change) => sum + change.quantity, 0);
    const receivedAt = payload.receivedAt ? new Date(payload.receivedAt) : new Date();
    if (Number.isNaN(receivedAt.getTime())) throw new AppError('receivedAt is invalid', 400);

    batch.receivedItems = batch.items.reduce((sum, item) => sum + Number(item.receivedQty || 0), 0);
    if (batch.items.every((item) => Number(item.pendingQty || 0) === 0)) {
      batch.status = 'completed';
    } else if (batch.receivedItems > 0) {
      batch.status = 'partial';
    }

    batch.receipts.push({
      receivedAt,
      items: changes.map((change) => ({
        batchItemId: change.item._id,
        productId: change.item.productId,
        variantId: change.item.variantId,
        quantity: change.quantity
      })),
      totalReceived,
      note: String(payload.note || '').trim(),
      receivedBy: currentUser.id
    });

    await batch.save();
    publishStatusChange({
      domain: 'preorder_batch',
      entityId: batch._id,
      previousStatus,
      nextStatus: batch.status,
      currentUser,
      meta: {
        batchCode: batch.batchCode,
        supplier: batch.supplier,
      },
    });
    return this.getBatchById(batch._id, currentUser);
  }

  async updateBatchStatus(batchId, status, currentUser = null) {
    const normalized = String(status || '').trim().toLowerCase();
    if (!PREORDER_STATUS_SET.has(normalized)) {
      throw new AppError('Invalid status', 400);
    }

    const batch = await this.getScopedBatch(batchId, currentUser);
    const previousStatus = batch.status;

    if (normalized === 'completed' && batch.items.some((item) => Number(item.pendingQty || 0) > 0)) {
      throw new AppError('Cannot mark completed while pending quantity remains', 400);
    }

    if (normalized === 'pending' && Number(batch.receivedItems || 0) > 0) {
      throw new AppError('Cannot set status to pending after receiving goods', 400);
    }

    batch.status = normalized;
    await batch.save();
    publishStatusChange({
      domain: 'preorder_batch',
      entityId: batch._id,
      previousStatus,
      nextStatus: batch.status,
      currentUser,
      meta: {
        batchCode: batch.batchCode,
        supplier: batch.supplier,
      },
    });
    return this.getBatchById(batch._id, currentUser);
  }
}

module.exports = new PreorderService();
