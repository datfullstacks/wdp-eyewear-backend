const test = require("node:test");
const assert = require("node:assert/strict");

const { ORDER_TYPES } = require("../constants");
const orderService = require("../services/orderService");

const { inferOrderType } = orderService.__test;

function makeItem({
  productId,
  variantId = "",
  type,
  preOrder = false,
  customization = {},
  workflowFamily,
}) {
  return {
    productId,
    variantId,
    type,
    preOrder,
    customization,
    workflowFamily,
  };
}

test("single frame and lens can checkout together as a prescription order", () => {
  const orderType = inferOrderType([
    makeItem({
      productId: "frame-1",
      variantId: "frame-variant-1",
      type: "frame",
    }),
    makeItem({
      productId: "lens-1",
      variantId: "lens-variant-1",
      type: "lens",
      customization: {
        prescription: { mode: "manual" },
      },
    }),
  ]);

  assert.equal(orderType, ORDER_TYPES.PRESCRIPTION);
});

test("multiple frame and lens pairs can checkout together when combineWith links are reciprocal", () => {
  const orderType = inferOrderType([
    makeItem({
      productId: "frame-1",
      variantId: "frame-variant-1",
      type: "frame",
      customization: {
        combineWith: {
          productId: "lens-1",
          variantId: "lens-variant-1",
        },
      },
    }),
    makeItem({
      productId: "lens-1",
      variantId: "lens-variant-1",
      type: "lens",
      customization: {
        prescription: { mode: "manual" },
        combineWith: {
          productId: "frame-1",
          variantId: "frame-variant-1",
        },
      },
    }),
    makeItem({
      productId: "frame-2",
      variantId: "frame-variant-2",
      type: "frame",
      customization: {
        combineWith: {
          productId: "lens-2",
          variantId: "lens-variant-2",
        },
      },
    }),
    makeItem({
      productId: "lens-2",
      variantId: "lens-variant-2",
      type: "lens",
      customization: {
        prescription: { mode: "upload", attachmentUrls: ["https://example.com/rx.jpg"] },
        combineWith: {
          productId: "frame-2",
          variantId: "frame-variant-2",
        },
      },
    }),
  ]);

  assert.equal(orderType, ORDER_TYPES.PRESCRIPTION);
});

test("multiple mixed frame and lens items still require valid pairing", () => {
  assert.throws(
    () =>
      inferOrderType([
        makeItem({
          productId: "frame-1",
          variantId: "frame-variant-1",
          type: "frame",
        }),
        makeItem({
          productId: "frame-2",
          variantId: "frame-variant-2",
          type: "frame",
        }),
        makeItem({
          productId: "lens-1",
          variantId: "lens-variant-1",
          type: "lens",
          customization: {
            prescription: { mode: "manual" },
            combineWith: {
              productId: "frame-1",
              variantId: "frame-variant-1",
            },
          },
        }),
        makeItem({
          productId: "lens-2",
          variantId: "lens-variant-2",
          type: "lens",
          customization: {
            prescription: { mode: "manual" },
          },
        }),
      ]),
    /Items from different workflow families must be checked out separately/,
  );
});

test("mixed prescription and ready stock items that are not frame plus lens remain blocked", () => {
  assert.throws(
    () =>
      inferOrderType([
        makeItem({
          productId: "accessory-1",
          variantId: "accessory-variant-1",
          type: "accessory",
        }),
        makeItem({
          productId: "lens-1",
          variantId: "lens-variant-1",
          type: "lens",
          customization: {
            prescription: { mode: "manual" },
          },
        }),
      ]),
    /Items from different workflow families must be checked out separately/,
  );
});
