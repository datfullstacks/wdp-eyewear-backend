
const { body, query } = require('express-validator');
const { PRODUCT_TYPES, PRODUCT_STATUS, ACCESSORY_CATEGORIES } = require('../constants');

const createTypeGuards = () => [
  body().custom((value, { req }) => {
    const t = req.body.type;
    if (t === PRODUCT_TYPES.SUNGLASSES) {
      const reqs = [
        ['specs.frame.material', 'Sunglasses cần specs.frame.material'],
        ['specs.lens.uvProtection', 'Sunglasses cần specs.lens.uvProtection'],
        ['specs.dimensions.bridgeMm', 'Sunglasses cần specs.dimensions.bridgeMm'],
        ['specs.dimensions.templeLengthMm', 'Sunglasses cần specs.dimensions.templeLengthMm'],
        ['specs.dimensions.lensWidthMm', 'Sunglasses cần specs.dimensions.lensWidthMm']
      ];
      reqs.forEach(([path, msg]) => {
        const parts = path.split('.');
        let cur = req.body;
        for (const p of parts) cur = cur?.[p];
        if (cur === undefined || cur === null || cur === '') {
          throw new Error(msg);
        }
      });
    }
    return true;
  }),
  // Frame
  body().custom((value, { req }) => {
    if (req.body.type === PRODUCT_TYPES.FRAME) {
      const reqs = [
        ['specs.frame.material', 'Frame cần specs.frame.material'],
        ['specs.frame.hingeType', 'Frame cần specs.frame.hingeType'],
        ['specs.dimensions.bridgeMm', 'Frame cần specs.dimensions.bridgeMm'],
        ['specs.dimensions.templeLengthMm', 'Frame cần specs.dimensions.templeLengthMm'],
        ['specs.dimensions.lensWidthMm', 'Frame cần specs.dimensions.lensWidthMm']
      ];
      reqs.forEach(([path, msg]) => {
        const parts = path.split('.');
        let cur = req.body;
        for (const p of parts) cur = cur?.[p];
        if (cur === undefined || cur === null || cur === '') {
          throw new Error(msg);
        }
      });
    }
    return true;
  }),
  // Lens
  body().custom((value, { req }) => {
    if (req.body.type === PRODUCT_TYPES.LENS) {
      const reqs = [
        ['specs.lens.lensType', 'Lens cần specs.lens.lensType'],
        ['specs.lens.material', 'Lens cần specs.lens.material'],
        ['specs.lens.index', 'Lens cần specs.lens.index'],
        ['specs.lens.prescriptionRange.sphMin', 'Lens cần specs.lens.prescriptionRange.sphMin'],
        ['specs.lens.prescriptionRange.sphMax', 'Lens cần specs.lens.prescriptionRange.sphMax']
      ];
      reqs.forEach(([path, msg]) => {
        const parts = path.split('.');
        let cur = req.body;
        for (const p of parts) cur = cur?.[p];
        if (cur === undefined || cur === null || cur === '') {
          throw new Error(msg);
        }
      });
    }
    return true;
  }),
  // Contact lens
  body().custom((value, { req }) => {
    if (req.body.type === PRODUCT_TYPES.CONTACT_LENS) {
      const reqs = [
        ['specs.contactLens.replacementCycle', 'Contact lens cần replacementCycle'],
        ['specs.contactLens.baseCurveMm', 'Contact lens cần baseCurveMm'],
        ['specs.contactLens.diameterMm', 'Contact lens cần diameterMm'],
        ['specs.contactLens.powerRange.sphMin', 'Contact lens cần powerRange.sphMin'],
        ['specs.contactLens.powerRange.sphMax', 'Contact lens cần powerRange.sphMax']
      ];
      reqs.forEach(([path, msg]) => {
        const parts = path.split('.');
        let cur = req.body;
        for (const p of parts) cur = cur?.[p];
        if (cur === undefined || cur === null || cur === '') {
          throw new Error(msg);
        }
      });
    }
    return true;
  }),
  // Accessory
  body().custom((value, { req }) => {
    if (req.body.type === PRODUCT_TYPES.ACCESSORY) {
      const cat = req.body?.specs?.accessory?.category;
      if (!cat) throw new Error('Accessory cần specs.accessory.category');
      if (ACCESSORY_CATEGORIES && !ACCESSORY_CATEGORIES.includes(cat)) {
        throw new Error(`Accessory category không hợp lệ. Hợp lệ: ${ACCESSORY_CATEGORIES.join(', ')}`);
      }
    }
    return true;
  }),
  // Service
  body().custom((value, { req }) => {
    if (req.body.type === PRODUCT_TYPES.SERVICE) {
      if (!req.body?.specs?.service?.durationMinutes) {
        throw new Error('Service cần specs.service.durationMinutes');
      }
      if (!req.body?.specs?.service?.serviceScope) {
        throw new Error('Service cần specs.service.serviceScope');
      }
    }
    return true;
  }),
  // Bundle
  body().custom((value, { req }) => {
    if (req.body.type === PRODUCT_TYPES.BUNDLE) {
      const items = req.body?.specs?.bundle?.items;
      if (!Array.isArray(items) || items.length < 1) {
        throw new Error('Bundle cần specs.bundle.items >= 1');
      }
      if (!req.body?.specs?.bundle?.bundlePricing) {
        throw new Error('Bundle cần specs.bundle.bundlePricing');
      }
    }
    return true;
  }),
  // Gift card
  body().custom((value, { req }) => {
    if (req.body.type === PRODUCT_TYPES.GIFT_CARD) {
      if (req.body?.specs?.giftCard?.value == null) {
        throw new Error('Gift card cần specs.giftCard.value');
      }
      if (!req.body?.specs?.giftCard?.deliveryMethod) {
        throw new Error('Gift card cần specs.giftCard.deliveryMethod');
      }
    }
    return true;
  })
];

exports.createProductRules = [
    body('name').notEmpty().withMessage('Product name is required'),
    body('type').isIn(Object.values(PRODUCT_TYPES)).withMessage('Invalid product type'),
    body('brand').notEmpty().withMessage('Brand is required'),

  body('pricing.currency')
    .notEmpty().withMessage('Currency is required')
    .isLength({ min: 3, max: 3 }).withMessage('Currency must be ISO 4217 code (3 letters)'),
  body('pricing.basePrice')
    .notEmpty().withMessage('Base price is required')
    .isFloat({ min: 0 }).withMessage('Base price must be a positive number'),
  body('pricing.salePrice')
    .optional()
    .isFloat({ min: 0 }).withMessage('Sale price must be a positive number')
    .custom((value, { req }) => {
      const base = req.body?.pricing?.basePrice;
      if (base != null && Number(value) > Number(base)) {
        throw new Error('Sale price must be less than or equal to base price');
      }
      return true;
    }),
  body('pricing.discountPercent')
    .optional()
    .isFloat({ min: 0, max: 100 }).withMessage('Discount percent must be between 0 and 100'),
  body('pricing.taxRate')
    .optional()
    .isFloat({ min: 0, max: 100 }).withMessage('Tax rate must be between 0 and 100'),

  body('inventory.track')
    .notEmpty().withMessage('inventory.track is required')
    .isBoolean().withMessage('inventory.track must be boolean'),
  body('inventory.threshold')
    .optional()
    .isInt({ min: 0 }).withMessage('inventory.threshold must be >= 0'),

  body('variants')
    .optional()
    .isArray().withMessage('variants must be an array'),
  body('variants.*.price')
    .optional()
    .isFloat({ min: 0 }).withMessage('Variant price must be >= 0'),
  body('variants.*.stock')
    .optional()
    .isInt({ min: 0 }).withMessage('Variant stock must be >= 0'),
  body('variants.*.options.size')
    .optional()
    .isString().withMessage('Variant size must be a string')
].concat(createTypeGuards());

exports.updateProductRules = [
  body('name').optional().notEmpty(),
  body('type').optional().isIn(Object.values(PRODUCT_TYPES)),
  body('brand').optional().notEmpty(),

  body('pricing.basePrice').optional().isFloat({ min: 0 }),
  body('pricing.currency').optional().isLength({ min: 3, max: 3 }),
  body('pricing.salePrice')
    .optional()
    .isFloat({ min: 0 })
    .custom((value, { req }) => {
      const base = req.body?.pricing?.basePrice;
      if (base != null && Number(value) > Number(base)) {
        throw new Error('Sale price must be less than or equal to base price');
      }
      return true;
    }),
  body('pricing.discountPercent').optional().isFloat({ min: 0, max: 100 }),
  body('pricing.taxRate').optional().isFloat({ min: 0, max: 100 }),

  body('inventory.track').optional().isBoolean(),
  body('inventory.threshold').optional().isInt({ min: 0 }),

  body('status').optional().isIn(Object.values(PRODUCT_STATUS)),

  body('variants').optional().isArray(),
  body('variants.*.price').optional().isFloat({ min: 0 }),
  body('variants.*.stock').optional().isInt({ min: 0 })
].concat(createTypeGuards());

exports.filterProductRules = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('minPrice').optional().isFloat({ min: 0 }),
  query('maxPrice').optional().isFloat({ min: 0 }),
  query('type').optional().isString(),
  query('status').optional().isString(),
  query('brand').optional().isString(),
  query('search').optional().isString(),
  query('sort').optional().isString()
];
