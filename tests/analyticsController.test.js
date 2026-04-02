const test = require("node:test");
const assert = require("node:assert/strict");

const analyticsController = require("../controllers/analyticsController");
const Order = require("../models/Order");

const analyticsPrivate = analyticsController.__private;

function createResponseHarness() {
  let resolveResponse;
  let rejectResponse;

  const done = new Promise((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });

  const response = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      resolveResponse(this);
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    send(payload) {
      this.body = payload;
      resolveResponse(this);
      return this;
    },
  };

  return {
    response,
    done,
    reject: rejectResponse,
  };
}

function mockAggregateSequence(results, capturedPipelines) {
  let callIndex = 0;

  return (pipeline) => {
    capturedPipelines.push(pipeline);
    const result = results[Math.min(callIndex, results.length - 1)];
    callIndex += 1;

    return {
      allowDiskUse: async () => result,
      then(resolve, reject) {
        return Promise.resolve(result).then(resolve, reject);
      },
    };
  };
}

test("phase 4 filter normalization keeps aliases and coercions stable", () => {
  const filters = analyticsPrivate.getRefundAnalyticsFilters({
    status: "Completed",
    owner_role: "Operations",
    q: " ORD-01 ",
    attention_only: "true",
    has_proof: "false",
    match_status: "Mismatch",
    action: "COMPLETE",
    actor_role: "Admin",
    from: "2026-03-01",
    to: "2026-03-20",
  });

  assert.equal(filters.status, "completed");
  assert.equal(filters.ownerRole, "operations");
  assert.equal(filters.q, "ord-01");
  assert.equal(filters.attentionOnly, true);
  assert.equal(filters.hasProof, false);
  assert.equal(filters.matchStatus, "mismatch");
  assert.equal(filters.action, "complete");
  assert.equal(filters.actorRole, "admin");
  assert.ok(filters.from instanceof Date);
  assert.ok(filters.to instanceof Date);
});

test("reconciliation pipeline contains DB-level invoice lookup and post filters", () => {
  const pipeline = analyticsPrivate.buildRefundReconciliationBasePipeline({
    status: "approved",
    ownerRole: "operations",
    matchStatus: "awaiting_payout",
    hasProof: false,
    attentionOnly: true,
    q: "ord-2026",
  });

  assert.equal(pipeline[0].$match["refund.status"], "approved");
  assert.equal(pipeline[0].$match["refund.currentOwnerRole"], "operations");
  assert.ok(pipeline.some((stage) => stage.$lookup && stage.$lookup.from === "invoices"));
  assert.ok(
    pipeline.some(
      (stage) =>
        stage.$match &&
        stage.$match.$and &&
        stage.$match.$and.some((entry) => entry.matchStatus === "awaiting_payout"),
    ),
  );
  assert.ok(
    pipeline.some(
      (stage) =>
        stage.$match &&
        stage.$match.$and &&
        stage.$match.$and.some((entry) => entry.payoutProofUrl === ""),
    ),
  );
});

test("audit pipeline unwinds refund history and applies DB-level audit filters", () => {
  const pipeline = analyticsPrivate.buildRefundAuditPipeline({
    status: "processing",
    ownerRole: "operations",
    actorRole: "admin",
    action: "complete",
    q: "retry",
    from: new Date("2026-03-01T00:00:00.000Z"),
    to: new Date("2026-03-20T23:59:59.999Z"),
  });

  assert.ok(pipeline.some((stage) => stage.$unwind && stage.$unwind.path === "$refund.history"));
  assert.ok(
    pipeline.some(
      (stage) =>
        stage.$match &&
        stage.$match.$and &&
        stage.$match.$and.some((entry) => entry.action === "complete"),
    ),
  );
  assert.ok(
    pipeline.some(
      (stage) =>
        stage.$match &&
        stage.$match.$and &&
        stage.$match.$and.some((entry) => entry.actorRole === "admin"),
    ),
  );
});

test("top product pipeline unwinds items and looks up product metadata", () => {
  const pipeline = analyticsPrivate.buildTopProductPerformancePipeline(
    {
      start: new Date("2026-01-01T00:00:00.000Z"),
      end: new Date("2027-01-01T00:00:00.000Z"),
    },
    5,
  );

  assert.equal(pipeline[0].$match.status.$ne, "cancelled");
  assert.equal(pipeline[1].$unwind, "$items");
  assert.ok(
    pipeline.some(
      (stage) => stage.$lookup && stage.$lookup.from === "products",
    ),
  );
  assert.ok(
    pipeline.some(
      (stage) => stage.$limit === 5,
    ),
  );
});

test("CSV export escapes cells and keeps reconciliation columns stable", () => {
  const csv = analyticsPrivate.buildRefundReconciliationCsv([
    {
      orderCode: 'ORD-"01"',
      customerName: "Alice, Nguyen",
      customerPhone: "0901",
      refundStatus: "completed",
      currentOwnerRole: "none",
      matchStatus: "matched",
      paidAmount: 100000,
      requestedAmount: 100000,
      approvedAmount: 100000,
      settledAmount: 100000,
      discrepancyAmount: 0,
      invoiceCode: "INV-01",
      invoiceStatus: "paid",
      invoiceAmountDue: 0,
      transactionRef: "TX-01",
      processedAt: "2026-03-20T10:00:00.000Z",
      attentionReason: "",
    },
  ]);

  assert.match(csv, /^﻿orderCode,customerName,customerPhone,/);
  assert.match(csv, /"ORD-""01"""/);
  assert.match(csv, /"Alice, Nguyen"/);
});

test("getRefundReconciliation uses aggregate facet and returns paginated payload", async () => {
  const originalAggregate = Order.aggregate;
  const pipelines = [];
  Order.aggregate = mockAggregateSequence(
    [
      [
        {
          rows: [
            {
              orderId: "o1",
              orderCode: "ORD-01",
              customerName: "Alice",
              refundStatus: "processing",
              approvedAmount: 100000,
              settledAmount: 0,
              discrepancyAmount: 100000,
              matchStatus: "awaiting_payout",
              paidAmount: 100000,
              invoiceCode: "INV-01",
              invoiceStatus: "paid",
              invoiceAmountDue: 0,
              transactionRef: "",
              refundReason: "duplicate payment",
              attentionReason: "",
            },
          ],
          pagination: [{ total: 1 }],
          summary: [
            {
              requestedTotal: 100000,
              approvedTotal: 100000,
              settledTotal: 0,
              totalPaidAmount: 100000,
              outstandingTotal: 100000,
              mismatchedCases: 0,
              awaitingPayoutCases: 1,
            },
          ],
        },
      ],
    ],
    pipelines,
  );

  try {
    const { response, done, reject } = createResponseHarness();
    analyticsController.getRefundReconciliation(
      {
        query: {
          page: "1",
          limit: "20",
          match_status: "awaiting_payout",
        },
      },
      response,
      reject,
    );

    const result = await done;

    assert.equal(result.statusCode, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.pagination.total, 1);
    assert.equal(result.body.data.rows[0].orderCode, "ORD-01");
    assert.ok(
      pipelines[0].some(
        (stage) =>
          stage.$facet &&
          stage.$facet.rows &&
          stage.$facet.summary &&
          stage.$facet.pagination,
      ),
    );
  } finally {
    Order.aggregate = originalAggregate;
  }
});

test("exportRefundReconciliation returns CSV attachment with filtered aggregate rows", async () => {
  const originalAggregate = Order.aggregate;
  Order.aggregate = mockAggregateSequence(
    [
      [
        {
          orderCode: "ORD-02",
          customerName: "Bob",
          customerPhone: "0902",
          refundStatus: "completed",
          currentOwnerRole: "none",
          matchStatus: "matched",
          paidAmount: 200000,
          requestedAmount: 200000,
          approvedAmount: 200000,
          settledAmount: 200000,
          discrepancyAmount: 0,
          invoiceCode: "INV-02",
          invoiceStatus: "paid",
          invoiceAmountDue: 0,
          transactionRef: "TX-02",
          processedAt: "2026-03-20T11:00:00.000Z",
          attentionReason: "",
        },
      ],
    ],
    [],
  );

  try {
    const { response, done, reject } = createResponseHarness();
    analyticsController.exportRefundReconciliation(
      {
        query: {
          status: "completed",
        },
      },
      response,
      reject,
    );

    const result = await done;

    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["Content-Type"], "text/csv; charset=utf-8");
    assert.match(result.headers["Content-Disposition"], /refund-reconciliation-/);
    assert.match(result.body, /ORD-02/);
  } finally {
    Order.aggregate = originalAggregate;
  }
});

test("getRefundAuditTrail returns aggregated audit buckets and pagination", async () => {
  const originalAggregate = Order.aggregate;
  Order.aggregate = mockAggregateSequence(
    [
      [
        {
          summary: [{ totalEvents: 2, uniqueOrders: 1 }],
          byAction: [
            { action: "complete", count: 1 },
            { action: "start_processing", count: 1 },
          ],
          byActorRole: [{ role: "operations", count: 2 }],
          rows: [
            {
              id: "evt-1",
              orderCode: "ORD-03",
              customerName: "Cara",
              actorName: "Ops One",
              actorRole: "operations",
              action: "complete",
              fromStatus: "processing",
              toStatus: "completed",
              createdAt: "2026-03-20T12:00:00.000Z",
            },
          ],
          pagination: [{ total: 2 }],
        },
      ],
    ],
    [],
  );

  try {
    const { response, done, reject } = createResponseHarness();
    analyticsController.getRefundAuditTrail(
      {
        query: {
          page: "1",
          limit: "20",
          actor_role: "operations",
        },
      },
      response,
      reject,
    );

    const result = await done;

    assert.equal(result.statusCode, 200);
    assert.equal(result.body.data.summary.totalEvents, 2);
    assert.equal(result.body.data.byAction[0].action, "complete");
    assert.equal(result.body.data.pagination.total, 2);
    assert.equal(result.body.data.rows[0].orderCode, "ORD-03");
  } finally {
    Order.aggregate = originalAggregate;
  }
});

test("getManagerProductAnalytics returns order cadence summary and top products", async () => {
  const originalAggregate = Order.aggregate;
  const pipelines = [];
  Order.aggregate = mockAggregateSequence(
    [
      [{ _id: null, orders: 2, units: 3, revenue: 120000 }],
      [{ _id: null, orders: 10, units: 14, revenue: 650000 }],
      [{ _id: null, orders: 24, units: 31, revenue: 1540000 }],
      [{ _id: null, orders: 80, units: 112, revenue: 5200000 }],
      [
        {
          _id: { year: 2026, month: 4, day: 2 },
          orders: 2,
          units: 3,
          revenue: 120000,
        },
      ],
      [
        {
          _id: { year: 2026, month: 4 },
          orders: 10,
          units: 14,
          revenue: 650000,
        },
      ],
      [
        {
          _id: { year: 2026, quarter: 2 },
          orders: 24,
          units: 31,
          revenue: 1540000,
        },
      ],
      [
        {
          _id: { year: 2026 },
          orders: 80,
          units: 112,
          revenue: 5200000,
        },
      ],
      [
        {
          productId: "661111111111111111111111",
          name: "Classic Frame",
          brand: "Eyes Dream",
          type: "eyeglasses",
          orders: 18,
          unitsSold: 24,
          revenue: 1840000,
          lastOrderedAt: new Date("2026-04-02T08:00:00.000Z"),
        },
      ],
    ],
    pipelines,
  );

  try {
    const { response, done, reject } = createResponseHarness();
    analyticsController.getManagerProductAnalytics(
      { query: {} },
      response,
      reject,
    );

    const result = await done;

    assert.equal(result.statusCode, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.summary.ordersToday, 2);
    assert.equal(result.body.data.summary.ordersThisQuarter, 24);
    assert.equal(result.body.data.timelines.daily.at(-1).orders, 2);
    assert.equal(result.body.data.timelines.monthly.at(-1).units, 14);
    assert.equal(result.body.data.timelines.quarterly.at(-1).orders, 24);
    assert.equal(result.body.data.timelines.yearly.at(-1).orders, 80);
    assert.equal(result.body.data.topProducts[0].name, "Classic Frame");
    assert.equal(result.body.data.topProducts[0].unitsSold, 24);
    assert.ok(
      pipelines[8].some(
        (stage) => stage.$lookup && stage.$lookup.from === "products",
      ),
    );
  } finally {
    Order.aggregate = originalAggregate;
  }
});
