const Cart = require('../models/Cart');
const Product = require('../models/Product');
const AppError = require('../errors/AppError');

const CART_TYPES = {
  READY_STOCK: 'ready_stock',
  PRE_ORDER: 'pre_order'
};

const PRESCRIPTION_MODES = new Set(['none', 'manual', 'upload']);

function normalizeCartType(value) {
  const cartType = String(value || '').trim().toLowerCase();
  if (!Object.values(CART_TYPES).includes(cartType)) {
    throw new AppError('cartType must be ready_stock or pre_order', 400);
  }
  return cartType;
}

function normalizePositiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new AppError(`${fieldName} must be integer >= 1`, 400);
  }
  return number;
}

function toTrimmedString(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function pickVariant(product, variantId) {
  if (!variantId) return null;
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const variant = variants.find((item) => String(item._id) === String(variantId));
  if (!variant) {
    throw new AppError(`Variant not found for product ${product._id}`, 404);
  }
  return variant;
}

function assertPreOrderWindow(product) {
  const now = Date.now();
  const startAt = product?.preOrder?.startAt ? new Date(product.preOrder.startAt).getTime() : null;
  const endAt = product?.preOrder?.endAt ? new Date(product.preOrder.endAt).getTime() : null;

  if (startAt && now < startAt) {
    throw new AppError(`Pre-order has not started for "${product.name}"`, 400);
  }
  if (endAt && now > endAt) {
    throw new AppError(`Pre-order has ended for "${product.name}"`, 400);
  }
}

function normalizeEye(eye = {}, fallback = '0') {
  return {
    sphere: toTrimmedString(eye.sphere, fallback) || fallback,
    cyl: toTrimmedString(eye.cyl, fallback) || fallback,
    axis: toTrimmedString(eye.axis, fallback) || fallback,
    add: toTrimmedString(eye.add, fallback) || fallback
  };
}

function normalizeCustomization(input = {}, variant = null) {
  const raw = (input && typeof input === 'object' && input.customization) || {};
  const modeInput = toTrimmedString(raw?.prescription?.mode || 'none', 'none').toLowerCase();
  const mode = PRESCRIPTION_MODES.has(modeInput) ? modeInput : 'none';
  const isMyopic = Boolean(raw?.prescription?.isMyopic);
  const attachmentUrls = Array.isArray(raw?.prescription?.attachmentUrls)
    ? raw.prescription.attachmentUrls.map((url) => toTrimmedString(url)).filter(Boolean)
    : [];

  if (mode === 'upload' && attachmentUrls.length === 0) {
    throw new AppError('customization.prescription.attachmentUrls is required for upload mode', 400);
  }

  const prescription = {
    mode,
    isMyopic,
    rightEye: isMyopic ? normalizeEye(raw?.prescription?.rightEye, '') : normalizeEye({}, '0'),
    leftEye: isMyopic ? normalizeEye(raw?.prescription?.leftEye, '') : normalizeEye({}, '0'),
    pd: isMyopic
      ? toTrimmedString(raw?.prescription?.pd, '')
      : '0',
    note: toTrimmedString(raw?.prescription?.note, isMyopic ? '' : 'Khong can do can thi: dien 0 cho cac thong so.'),
    attachmentUrls
  };

  return {
    selectedColor: toTrimmedString(raw.selectedColor || raw.color || variant?.options?.color, ''),
    selectedSize: toTrimmedString(raw.selectedSize || raw.size || variant?.options?.size, ''),
    photochromic: Boolean(raw.photochromic),
    prescription,
    orderMadeFromPrescriptionImage: mode === 'upload' || Boolean(raw.orderMadeFromPrescriptionImage),
    combineWith: {
      productId: raw?.combineWith?.productId || raw?.combineWith?.product_id || null,
      variantId: raw?.combineWith?.variantId || raw?.combineWith?.variant_id || null,
      note: toTrimmedString(raw?.combineWith?.note, '')
    },
    note: toTrimmedString(raw.note, '')
  };
}

function pickPrice(product, variant) {
  if (variant && variant.price != null) return Number(variant.price);
  return Number(product?.pricing?.salePrice ?? product?.pricing?.basePrice ?? 0);
}

function sumVariantStock(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return variants.reduce((sum, variant) => sum + Number(variant?.stock || 0), 0);
}

async function getOrCreateCart(userId, cartType) {
  let cart = await Cart.findOne({ userId, cartType });
  if (!cart) {
    cart = await Cart.create({
      userId,
      cartType,
      items: []
    });
  }
  return cart;
}

async function validateCartItemInput(input, cartType) {
  const productId = input?.productId || input?.product_id;
  if (!productId) throw new AppError('productId is required', 400);
  const quantity = normalizePositiveInteger(input.quantity, 'quantity');

  const product = await Product.findById(productId).select(
    '_id name status preOrder pricing variants'
  );
  if (!product) throw new AppError('Product not found', 404);
  if (product.status !== 'active') throw new AppError(`Product "${product.name}" is not available`, 400);

  const variant = pickVariant(product, input.variantId || input.variant_id);
  const isPreOrder = Boolean(product?.preOrder?.enabled);
  if (cartType === CART_TYPES.PRE_ORDER && !isPreOrder) {
    throw new AppError(`"${product.name}" is not pre-order`, 400);
  }
  if (cartType === CART_TYPES.READY_STOCK && isPreOrder) {
    throw new AppError(`"${product.name}" is pre-order and must be in pre-order cart`, 400);
  }

  if (isPreOrder) {
    assertPreOrderWindow(product);
    const maxQty = Number(product.preOrder?.maxQuantityPerOrder || 0);
    if (maxQty > 0 && quantity > maxQty) {
      throw new AppError(`Quantity exceeds pre-order max for "${product.name}"`, 400);
    }
  } else {
    const available = variant ? Number(variant.stock || 0) : sumVariantStock(product);
    if (available < quantity) {
      throw new AppError(`Insufficient stock for "${product.name}"`, 400);
    }
  }

  return {
    product,
    variant,
    quantity,
    preOrder: isPreOrder,
    customization: normalizeCustomization(input, variant)
  };
}

async function buildCartResponse(cartDoc) {
  const cart = await Cart.findById(cartDoc._id).populate({
    path: 'items.productId',
    select: '_id name type pricing variants preOrder'
  });

  const items = Array.isArray(cart?.items) ? cart.items : [];
  const normalizedItems = items.map((item) => {
    const product = item.productId;
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    const variant = variants.find((v) => String(v._id) === String(item.variantId || ''));
    const unitPrice = pickPrice(product, variant);
    const lineTotal = unitPrice * Number(item.quantity || 0);
    return {
      _id: item._id,
      productId: product?._id || item.productId,
      name: product?.name || '',
      type: product?.type || '',
      variantId: item.variantId || null,
      quantity: item.quantity,
      preOrder: Boolean(item.preOrder),
      unitPrice,
      lineTotal,
      customization: item.customization || {}
    };
  });

  const subtotal = normalizedItems.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);

  return {
    _id: cart._id,
    userId: cart.userId,
    cartType: cart.cartType,
    items: normalizedItems,
    summary: {
      itemCount: normalizedItems.length,
      quantityTotal: normalizedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      subtotal
    },
    createdAt: cart.createdAt,
    updatedAt: cart.updatedAt
  };
}

class CartService {
  async getCart(userId, cartTypeInput) {
    const cartType = normalizeCartType(cartTypeInput);
    const cart = await getOrCreateCart(userId, cartType);
    return buildCartResponse(cart);
  }

  async upsertItem(userId, cartTypeInput, itemInput) {
    const cartType = normalizeCartType(cartTypeInput);
    const cart = await getOrCreateCart(userId, cartType);
    const validated = await validateCartItemInput(itemInput, cartType);

    const itemId = itemInput?.itemId || itemInput?.item_id || null;
    const items = Array.isArray(cart.items) ? cart.items : [];
    let target = null;

    if (itemId) {
      target = items.find((item) => String(item._id) === String(itemId));
    }
    if (!target) {
      target = items.find((item) => (
        String(item.productId) === String(validated.product._id) &&
        String(item.variantId || '') === String(validated.variant?._id || '')
      ));
    }

    if (!target) {
      items.push({
        productId: validated.product._id,
        variantId: validated.variant?._id || null,
        quantity: validated.quantity,
        preOrder: validated.preOrder,
        customization: validated.customization
      });
    } else {
      target.productId = validated.product._id;
      target.variantId = validated.variant?._id || null;
      target.quantity = validated.quantity;
      target.preOrder = validated.preOrder;
      target.customization = validated.customization;
    }

    cart.items = items;
    await cart.save();
    return buildCartResponse(cart);
  }

  async replaceItems(userId, cartTypeInput, itemsInput = []) {
    const cartType = normalizeCartType(cartTypeInput);
    if (!Array.isArray(itemsInput)) {
      throw new AppError('items must be an array', 400);
    }

    const cart = await getOrCreateCart(userId, cartType);
    const nextItems = [];
    for (const itemInput of itemsInput) {
      const validated = await validateCartItemInput(itemInput, cartType);
      nextItems.push({
        productId: validated.product._id,
        variantId: validated.variant?._id || null,
        quantity: validated.quantity,
        preOrder: validated.preOrder,
        customization: validated.customization
      });
    }

    cart.items = nextItems;
    await cart.save();
    return buildCartResponse(cart);
  }

  async removeItem(userId, cartTypeInput, itemId) {
    const cartType = normalizeCartType(cartTypeInput);
    const cart = await getOrCreateCart(userId, cartType);
    cart.items = (cart.items || []).filter((item) => String(item._id) !== String(itemId));
    await cart.save();
    return buildCartResponse(cart);
  }

  async clearCart(userId, cartTypeInput) {
    const cartType = normalizeCartType(cartTypeInput);
    const cart = await getOrCreateCart(userId, cartType);
    cart.items = [];
    await cart.save();
    return buildCartResponse(cart);
  }
}

module.exports = new CartService();
