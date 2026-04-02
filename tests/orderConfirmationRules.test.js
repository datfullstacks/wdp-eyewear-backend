const test = require("node:test");
const assert = require("node:assert/strict");

const AppError = require("../errors/AppError");
const orderService = require("../services/orderService");

const { assertOrderCanBeConfirmed } = orderService.__test;

test("ready-stock order can be confirmed before payment by sales", () => {
  assert.doesNotThrow(() =>
    assertOrderCanBeConfirmed(
      {
        orderType: "ready_stock",
        paymentStatus: "pending",
        paymentMethod: "sepay",
        opsExecution: { approvalState: "none" },
      },
      { id: "sales-1", role: "sales" },
    ),
  );
});

test("pre-order still requires paid status before sales confirmation", () => {
  assert.throws(
    () =>
      assertOrderCanBeConfirmed(
        {
          orderType: "pre_order",
          paymentStatus: "pending",
          paymentMethod: "sepay",
          opsExecution: { approvalState: "none" },
        },
        { id: "sales-1", role: "sales" },
      ),
    (error) =>
      error instanceof AppError &&
      error.statusCode === 400 &&
      error.message === "Only fully paid orders can be confirmed",
  );
});

test("manager can confirm escalated ready-stock order before payment", () => {
  assert.doesNotThrow(() =>
    assertOrderCanBeConfirmed(
      {
        orderType: "ready_stock",
        paymentStatus: "pending",
        paymentMethod: "sepay",
        opsExecution: { approvalState: "manager_review_requested" },
      },
      { id: "manager-1", role: "manager" },
    ),
  );
});
