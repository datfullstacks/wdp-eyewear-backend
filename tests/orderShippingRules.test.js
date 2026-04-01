const test = require("node:test");
const assert = require("node:assert/strict");

const orderShippingService = require("../services/orderShippingService");

const {
  canCreateShipmentWithOutstandingSepayBalance,
} = orderShippingService.__test;

test("pre-order can still create shipment when SePay balance remains", () => {
  assert.equal(
    canCreateShipmentWithOutstandingSepayBalance({
      orderType: "pre_order",
      paymentMethod: "sepay",
      payLaterMethod: "sepay",
      total: 1200000,
      payNowTotal: 300000,
      paidAmount: 300000,
    }),
    true,
  );
});

test("ready-stock still blocks shipment when SePay balance remains", () => {
  assert.equal(
    canCreateShipmentWithOutstandingSepayBalance({
      orderType: "ready_stock",
      paymentMethod: "sepay",
      payLaterMethod: "sepay",
      total: 1200000,
      payNowTotal: 300000,
      paidAmount: 300000,
    }),
    false,
  );
});

test("fully covered SePay payment still allows shipment for non-preorder", () => {
  assert.equal(
    canCreateShipmentWithOutstandingSepayBalance({
      orderType: "ready_stock",
      paymentMethod: "sepay",
      payLaterMethod: "sepay",
      total: 1200000,
      payNowTotal: 300000,
      paidAmount: 1200000,
    }),
    true,
  );
});
