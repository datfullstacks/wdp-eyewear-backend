const test = require("node:test");
const assert = require("node:assert/strict");

const AppError = require("../errors/AppError");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Store = require("../models/Store");
const supportTicketModel = require("../models/SupportTicket");
const supportService = require("../services/supportService");

const { SupportTicket } = supportTicketModel;
const {
  buildWarrantySnapshot,
  buildBusinessTicketVisibilityQuery,
  isWarrantyCategory,
  resolveWarrantyReferenceDate,
  resolveRequestedStoreId,
  validateWarrantyTransition,
} = supportService.__private;

function createTicketQuery(result) {
  return {
    populate: async () => result,
  };
}

function createListQuery(capturedQueries, query, result) {
  capturedQueries.push(query);
  return {
    populate() {
      return this;
    },
    sort() {
      return this;
    },
    skip() {
      return this;
    },
    limit() {
      return Promise.resolve(result);
    },
  };
}

function patchMethods(patches) {
  const originals = patches.map(({ target, key }) => ({
    target,
    key,
    original: target[key],
  }));

  for (const patch of patches) {
    patch.target[patch.key] = patch.value;
  }

  return () => {
    for (const item of originals) {
      item.target[item.key] = item.original;
    }
  };
}

test("support service recognizes warranty category", () => {
  assert.equal(isWarrantyCategory("warranty"), true);
  assert.equal(isWarrantyCategory("WARRANTY"), true);
  assert.equal(isWarrantyCategory("refund"), false);
});

test("support service resolves warranty reference date from delivered shipment first", () => {
  const referenceDate = resolveWarrantyReferenceDate({
    shipment: {
      state: "delivered",
      lastActionAt: new Date("2026-01-10T00:00:00.000Z"),
    },
    confirmedAt: new Date("2026-01-05T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });

  assert.equal(referenceDate.toISOString(), "2026-01-10T00:00:00.000Z");
});

test("support service builds eligible warranty snapshot from product warranty months", () => {
  const snapshot = buildWarrantySnapshot(
    {
      confirmedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
    },
    {
      _id: "507f191e810c19729de860ea",
      productId: "507f191e810c19729de860eb",
      variantId: "507f191e810c19729de860ec",
      name: "Titanium Frame",
    },
    {
      _id: "507f191e810c19729de860eb",
      name: "Titanium Frame",
      fulfillment: { warrantyMonths: 6 },
    },
  );

  assert.equal(snapshot.eligibility, "eligible");
  assert.equal(snapshot.warrantyMonths, 6);
  assert.equal(snapshot.itemName, "Titanium Frame");
});

test("support service marks warranty as expired or not covered when applicable", () => {
  const expired = buildWarrantySnapshot(
    {
      confirmedAt: new Date("2025-01-01T00:00:00.000Z"),
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
    },
    {
      _id: "507f191e810c19729de860ed",
      productId: "507f191e810c19729de860ee",
      name: "Classic Lens",
    },
    {
      _id: "507f191e810c19729de860ee",
      name: "Classic Lens",
      fulfillment: { warrantyMonths: 1 },
    },
  );
  const notCovered = buildWarrantySnapshot(
    {
      confirmedAt: new Date(),
      createdAt: new Date(),
    },
    {
      _id: "507f191e810c19729de860ef",
      productId: "507f191e810c19729de860f0",
      name: "Cleaning Service",
    },
    {
      _id: "507f191e810c19729de860f0",
      name: "Cleaning Service",
      fulfillment: { warrantyMonths: 0 },
    },
  );

  assert.equal(expired.eligibility, "expired");
  assert.equal(notCovered.eligibility, "not_covered");
});

test("support service enforces warranty transitions by business role", () => {
  assert.doesNotThrow(() =>
    validateWarrantyTransition("requested", "under_review", {
      id: "sales-1",
      role: "sales",
    }),
  );
  assert.doesNotThrow(() =>
    validateWarrantyTransition("approved", "in_service", {
      id: "ops-1",
      role: "operations",
    }),
  );
  assert.doesNotThrow(() =>
    validateWarrantyTransition("requested", "completed", {
      id: "manager-1",
      role: "manager",
    }),
  );

  assert.throws(
    () =>
      validateWarrantyTransition("requested", "completed", {
        id: "sales-1",
        role: "sales",
      }),
    (error) =>
      error instanceof AppError &&
      /sales\/support can only review or decide warranty cases/i.test(
        error.message,
      ),
  );

  assert.throws(
    () =>
      validateWarrantyTransition("requested", "under_review", {
        id: "ops-1",
        role: "operations",
      }),
    (error) =>
      error instanceof AppError &&
      /operations can only move warranty cases/i.test(error.message),
  );
});

test("support service creates warranty ticket from order item and product warranty", async (t) => {
  const order = {
    _id: "507f191e810c19729de86001",
    userId: "customer-1",
    storeId: "507f191e810c19729de86002",
    items: [
      {
        _id: "507f191e810c19729de86003",
        productId: "507f191e810c19729de86004",
        variantId: "507f191e810c19729de86005",
        name: "Titanium Frame",
      },
    ],
    confirmedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
  };
  const createdPayloads = [];
  const restore = patchMethods([
    {
      target: Order,
      key: "findById",
      value: () => ({
        select: async () => order,
      }),
    },
    {
      target: Product,
      key: "findById",
      value: () => ({
        select: async () => ({
          _id: "507f191e810c19729de86004",
          name: "Titanium Frame",
          fulfillment: { warrantyMonths: 12 },
        }),
      }),
    },
    {
      target: SupportTicket,
      key: "create",
      value: async (payload) => {
        createdPayloads.push(payload);
        return { _id: "507f191e810c19729de86006" };
      },
    },
    {
      target: SupportTicket,
      key: "findById",
      value: () =>
        createTicketQuery({
          _id: "507f191e810c19729de86006",
          userId: { _id: "customer-1" },
          storeId: "507f191e810c19729de86002",
          category: "warranty",
          status: "requested",
          warranty: { eligibility: "eligible" },
        }),
    },
  ]);
  t.after(restore);

  const ticket = await supportService.createTicket(
    { id: "customer-1", role: "customer", email: "customer@example.com" },
    {
      subject: "Need warranty support",
      message: "My frame hinge is loose",
      category: "warranty",
      orderId: "507f191e810c19729de86001",
      orderItemId: "507f191e810c19729de86003",
      attachments: [
        {
          url: "https://example.com/evidence/frame.jpg",
          type: "image",
          mimeType: "image/jpeg",
        },
      ],
    },
  );

  assert.equal(createdPayloads.length, 1);
  assert.equal(createdPayloads[0].userId, "customer-1");
  assert.equal(createdPayloads[0].status, "requested");
  assert.equal(createdPayloads[0].storeId, "507f191e810c19729de86002");
  assert.equal(createdPayloads[0].warranty.eligibility, "eligible");
  assert.equal(ticket.status, "requested");
});

test("support service assigns order-linked staff-created tickets to the customer owner", async (t) => {
  const order = {
    _id: "507f191e810c19729de86007",
    userId: "customer-77",
    storeId: "507f191e810c19729de86008",
    items: [],
    createdAt: new Date(),
  };
  const createdPayloads = [];
  const restore = patchMethods([
    {
      target: Order,
      key: "findById",
      value: () => ({
        select: async () => order,
      }),
    },
    {
      target: SupportTicket,
      key: "create",
      value: async (payload) => {
        createdPayloads.push(payload);
        return { _id: "507f191e810c19729de86009" };
      },
    },
    {
      target: SupportTicket,
      key: "findById",
      value: () =>
        createTicketQuery({
          _id: "507f191e810c19729de86009",
          userId: { _id: "customer-77" },
          storeId: "507f191e810c19729de86008",
          category: "prescription",
          status: "open",
          messages: [],
        }),
    },
  ]);
  t.after(restore);

  await supportService.createTicket(
    { id: "sales-1", role: "sales", email: "sales@example.com" },
    {
      subject: "Prescription clarification for ORD-1001",
      message: "Please confirm your prescription values.",
      category: "prescription",
      orderId: "507f191e810c19729de86007",
    },
  );

  assert.equal(createdPayloads.length, 1);
  assert.equal(createdPayloads[0].userId, "customer-77");
  assert.equal(createdPayloads[0].storeId, "507f191e810c19729de86008");
});

test("support service forces customer-created ticket priority to normal", async (t) => {
  const createdPayloads = [];
  const restore = patchMethods([
    {
      target: Store,
      key: "findOne",
      value: () => ({
        sort: async () => ({ _id: "store-single-1" }),
      }),
    },
    {
      target: SupportTicket,
      key: "create",
      value: async (payload) => {
        createdPayloads.push(payload);
        return { _id: "507f191e810c19729de86061" };
      },
    },
    {
      target: SupportTicket,
      key: "findById",
      value: () =>
        createTicketQuery({
          _id: "507f191e810c19729de86061",
          userId: { _id: "customer-1" },
          storeId: null,
          category: "general",
          status: "open",
          priority: "normal",
          messages: [],
        }),
    },
  ]);
  t.after(restore);

  await supportService.createTicket(
    { id: "customer-1", role: "customer", email: "customer@example.com" },
    {
      subject: "Need support",
      message: "Please check my request",
      category: "general",
      priority: "high",
    },
  );

  assert.equal(createdPayloads.length, 1);
  assert.equal(createdPayloads[0].priority, "normal");
});

test("support service preserves staff-selected ticket priority", async (t) => {
  const createdPayloads = [];
  const restore = patchMethods([
    {
      target: SupportTicket,
      key: "create",
      value: async (payload) => {
        createdPayloads.push(payload);
        return { _id: "507f191e810c19729de86062" };
      },
    },
    {
      target: SupportTicket,
      key: "findById",
      value: () =>
        createTicketQuery({
          _id: "507f191e810c19729de86062",
          userId: { _id: "customer-77" },
          storeId: "507f191e810c19729de86008",
          category: "prescription",
          status: "open",
          priority: "high",
          messages: [],
        }),
    },
    {
      target: Order,
      key: "findById",
      value: () => ({
        select: async () => ({
          _id: "507f191e810c19729de86007",
          userId: "customer-77",
          storeId: "507f191e810c19729de86008",
          items: [],
          createdAt: new Date(),
        }),
      }),
    },
  ]);
  t.after(restore);

  await supportService.createTicket(
    { id: "sales-1", role: "sales", email: "sales@example.com" },
    {
      subject: "Prescription clarification for ORD-1001",
      message: "Please confirm your prescription values.",
      category: "prescription",
      orderId: "507f191e810c19729de86007",
      priority: "high",
    },
  );

  assert.equal(createdPayloads.length, 1);
  assert.equal(createdPayloads[0].priority, "high");
});

test("support service requires evidence for after-sales order tickets", async (t) => {
  const restore = patchMethods([
    {
      target: Order,
      key: "findById",
      value: () => ({
        select: async () => ({
          _id: "507f191e810c19729de86071",
          userId: "customer-1",
          storeId: "507f191e810c19729de86072",
          items: [],
          createdAt: new Date(),
        }),
      }),
    },
  ]);
  t.after(restore);

  await assert.rejects(
    () =>
      supportService.createTicket(
        { id: "customer-1", role: "customer", email: "customer@example.com" },
        {
          subject: "Order defect",
          message: "The frame is broken",
          category: "order",
          orderId: "507f191e810c19729de86071",
        },
      ),
    (error) =>
      error instanceof AppError &&
      /image or video is required/i.test(error.message),
  );
});

test("support service stores evidence attachment metadata on ticket messages", async (t) => {
  const createdPayloads = [];
  const restore = patchMethods([
    {
      target: Order,
      key: "findById",
      value: () => ({
        select: async () => ({
          _id: "507f191e810c19729de86081",
          userId: "customer-1",
          storeId: "507f191e810c19729de86082",
          items: [],
          createdAt: new Date(),
        }),
      }),
    },
    {
      target: SupportTicket,
      key: "create",
      value: async (payload) => {
        createdPayloads.push(payload);
        return { _id: "507f191e810c19729de86083" };
      },
    },
    {
      target: SupportTicket,
      key: "findById",
      value: () =>
        createTicketQuery({
          _id: "507f191e810c19729de86083",
          userId: { _id: "customer-1" },
          storeId: "507f191e810c19729de86082",
          category: "order",
          status: "open",
          messages: [],
        }),
    },
  ]);
  t.after(restore);

  await supportService.createTicket(
    { id: "customer-1", role: "customer", email: "customer@example.com" },
    {
      subject: "Order defect",
      message: "Please inspect the attached proof",
      category: "order",
      orderId: "507f191e810c19729de86081",
      attachments: [
        {
          url: "https://example.com/evidence/video.mp4",
          mimeType: "video/mp4",
          name: "video.mp4",
          size: 4096,
        },
      ],
    },
  );

  assert.equal(createdPayloads.length, 1);
  assert.equal(createdPayloads[0].messages[0].attachments.length, 1);
  assert.equal(
    createdPayloads[0].messages[0].attachments[0].url,
    "https://example.com/evidence/video.mp4",
  );
  assert.equal(createdPayloads[0].messages[0].attachments[0].type, "video");
  assert.equal(
    createdPayloads[0].messages[0].attachments[0].mimeType,
    "video/mp4",
  );
});

test("support service rejects warranty ticket for unknown order item", async (t) => {
  const restore = patchMethods([
    {
      target: Order,
      key: "findById",
      value: () => ({
        select: async () => ({
          _id: "507f191e810c19729de86011",
          userId: "customer-1",
          storeId: "507f191e810c19729de86012",
          items: [],
        }),
      }),
    },
  ]);
  t.after(restore);

  await assert.rejects(
    () =>
      supportService.createTicket(
        { id: "customer-1", role: "customer", email: "customer@example.com" },
        {
          subject: "Need warranty support",
          message: "Broken frame",
          category: "warranty",
          orderId: "507f191e810c19729de86011",
          orderItemId: "507f191e810c19729de86013",
        },
      ),
    (error) =>
      error instanceof AppError && /order item not found/i.test(error.message),
  );
});

test("support service reserves unassigned tickets for manager triage", async (t) => {
  const restore = patchMethods([
    {
      target: SupportTicket,
      key: "findById",
      value: () =>
        createTicketQuery({
          _id: "507f191e810c19729de86021",
          userId: { _id: "customer-1" },
          storeId: null,
          category: "general",
          status: "open",
        }),
    },
  ]);
  t.after(restore);

  await assert.rejects(
    () =>
      supportService.getTicketById("507f191e810c19729de86021", {
        id: "sales-1",
        role: "sales",
        storeAccess: { mode: "all" },
      }),
    (error) => error instanceof AppError && error.statusCode === 403,
  );

  const ticket = await supportService.getTicketById("507f191e810c19729de86021", {
    id: "manager-1",
    role: "manager",
    storeAccess: { mode: "selected", storeIds: ["store-1"] },
  });
  assert.equal(ticket._id, "507f191e810c19729de86021");
});

test("support service builds list visibility query by role and store scope", async (t) => {
  const capturedQueries = [];
  const restore = patchMethods([
    {
      target: SupportTicket,
      key: "find",
      value: (query) => createListQuery(capturedQueries, query, []),
    },
    {
      target: SupportTicket,
      key: "countDocuments",
      value: async (query) => {
        capturedQueries.push({ countQuery: query });
        return 0;
      },
    },
  ]);
  t.after(restore);

  await supportService.listTickets({
    id: "sales-1",
    role: "sales",
    storeAccess: { mode: "all" },
  });
  await supportService.listTickets({
    id: "manager-1",
    role: "manager",
    storeAccess: { mode: "selected", storeIds: ["store-1"] },
  });

  assert.deepEqual(capturedQueries[0], { storeId: { $ne: null } });
  assert.deepEqual(capturedQueries[2], {
    $or: [
      { storeId: { $in: ["store-1"] } },
      { storeId: null },
    ],
  });
});

test("support service validates requested store ids for support tickets", async (t) => {
  const restore = patchMethods([
    {
      target: Store,
      key: "exists",
      value: async ({ _id }) => _id === "507f191e810c19729de86031",
    },
    {
      target: Store,
      key: "findOne",
      value: () => ({
        sort: async () => ({ _id: "store-single-1" }),
      }),
    },
  ]);
  t.after(restore);

  const resolved = await resolveRequestedStoreId(
    "507f191e810c19729de86031",
    { id: "customer-1", role: "customer" },
  );
  assert.equal(resolved, "store-single-1");

  await assert.rejects(
    () =>
      resolveRequestedStoreId("507f191e810c19729de86032", {
        id: "customer-1",
        role: "customer",
      }),
    (error) => error instanceof AppError && error.statusCode === 404,
  );
});

test("support service query helper excludes null-store tickets from sales visibility", () => {
  assert.deepEqual(
    buildBusinessTicketVisibilityQuery({
      id: "sales-1",
      role: "sales",
      storeAccess: { mode: "selected", storeIds: ["store-1"] },
    }),
    { storeId: { $in: ["store-1"] } },
  );
});

test("support service adds subject and order search conditions when q is provided", async (t) => {
  const capturedTicketQueries = [];
  const capturedOrderQueries = [];
  const restore = patchMethods([
    {
      target: Order,
      key: "find",
      value: (query) => {
        capturedOrderQueries.push(query);
        return {
          select() {
            return this;
          },
          limit() {
            return Promise.resolve([{ _id: "507f191e810c19729de86041" }]);
          },
        };
      },
    },
    {
      target: SupportTicket,
      key: "find",
      value: (query) => createListQuery(capturedTicketQueries, query, []),
    },
    {
      target: SupportTicket,
      key: "countDocuments",
      value: async () => 0,
    },
  ]);
  t.after(restore);

  await supportService.listTickets(
    {
      id: "sales-1",
      role: "sales",
      storeAccess: { mode: "selected", storeIds: ["507f191e810c19729de86040"] },
    },
    {
      category: "return",
      q: "Alice",
    },
  );

  assert.deepEqual(capturedOrderQueries[0], {
    $or: [
      { paymentCode: { $regex: "Alice", $options: "i" } },
      { "shippingAddress.fullName": { $regex: "Alice", $options: "i" } },
      { "shippingAddress.phone": { $regex: "Alice", $options: "i" } },
    ],
    storeId: { $in: ["507f191e810c19729de86040"] },
  });

  assert.deepEqual(capturedTicketQueries[0], {
    category: "return",
    storeId: { $in: ["507f191e810c19729de86040"] },
    $or: [
      { subject: { $regex: "Alice", $options: "i" } },
      { orderId: { $in: ["507f191e810c19729de86041"] } },
    ],
  });
});

test("support service applies orderId filter after validating accessible order", async (t) => {
  const capturedTicketQueries = [];
  const restore = patchMethods([
    {
      target: Order,
      key: "findById",
      value: () => ({
        select: async () => ({
          _id: "507f191e810c19729de86051",
          userId: "customer-1",
          storeId: "507f191e810c19729de86052",
          items: [],
          shipment: null,
          createdAt: new Date(),
        }),
      }),
    },
    {
      target: SupportTicket,
      key: "find",
      value: (query) => createListQuery(capturedTicketQueries, query, []),
    },
    {
      target: SupportTicket,
      key: "countDocuments",
      value: async () => 0,
    },
  ]);
  t.after(restore);

  await supportService.listWarrantyCases(
    {
      id: "manager-1",
      role: "manager",
      storeAccess: { mode: "selected", storeIds: ["507f191e810c19729de86052"] },
    },
    {
      orderId: "507f191e810c19729de86051",
    },
  );

  assert.equal(
    String(capturedTicketQueries[0].orderId),
    "507f191e810c19729de86051",
  );
  assert.equal(capturedTicketQueries[0].category, "warranty");
});
