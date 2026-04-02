const test = require("node:test");
const assert = require("node:assert/strict");
const { validationResult } = require("express-validator");

const {
  listSupportTicketRules,
  createSupportTicketRules,
  replySupportTicketRules,
  updateSupportTicketStatusRules,
} = require("../validators/supportValidator");

async function runRules(rules, req) {
  for (const rule of rules) {
    await rule.run(req);
  }

  return validationResult(req).array();
}

test("support validator accepts a generic support ticket payload", async () => {
  const errors = await runRules(createSupportTicketRules, {
    body: {
      subject: "Need support",
      message: "I need help with my order",
      category: "general",
      priority: "normal",
    },
  });

  assert.deepEqual(errors, []);
});

test("support validator requires evidence for after-sales order tickets", async () => {
  const errors = await runRules(createSupportTicketRules, {
    body: {
      subject: "Order issue",
      message: "The lens arrived scratched",
      category: "order",
      orderId: "507f191e810c19729de86001",
    },
  });

  assert.ok(
    errors.some((error) => /image or video is required/i.test(error.msg)),
  );
});

test("support validator accepts image and video attachments", async () => {
  const errors = await runRules(createSupportTicketRules, {
    body: {
      subject: "Warranty evidence",
      message: "Please review the attached proof",
      category: "warranty",
      orderId: "507f191e810c19729de86001",
      orderItemId: "507f191e810c19729de86002",
      attachments: [
        {
          url: "https://example.com/evidence/photo.jpg",
          type: "image",
          mimeType: "image/jpeg",
          size: 1024,
        },
        {
          url: "https://example.com/evidence/video.mp4",
          type: "video",
          mimeType: "video/mp4",
          size: 2048,
        },
      ],
    },
  });

  assert.deepEqual(errors, []);
});

test("support validator requires orderId and orderItemId for warranty tickets", async () => {
  const errors = await runRules(createSupportTicketRules, {
    body: {
      subject: "Warranty case",
      message: "Frame issue",
      category: "warranty",
      orderId: "507f191e810c19729de86001",
    },
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0].msg, /orderItemId is required/i);
});

test("support validator rejects invalid list filters", async () => {
  const errors = await runRules(listSupportTicketRules, {
    query: {
      category: "invalid-category",
      eligibility: "unsupported",
    },
  });

  assert.equal(errors.length, 2);
});

test("support validator accepts q and orderId list filters when valid", async () => {
  const errors = await runRules(listSupportTicketRules, {
    query: {
      q: "Alice",
      orderId: "507f191e810c19729de86001",
      category: "warranty",
    },
  });

  assert.deepEqual(errors, []);
});

test("support validator requires non-empty reply messages", async () => {
  const errors = await runRules(replySupportTicketRules, {
    body: {
      message: "   ",
    },
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0].msg, /message is required/i);
});

test("support validator requires status updates to provide a supported status", async () => {
  const errors = await runRules(updateSupportTicketStatusRules, {
    body: {
      decisionNote: "Approved after inspection",
    },
  });

  assert.ok(errors.length >= 1);
  assert.ok(errors.some((error) => /status is required/i.test(error.msg)));
});
