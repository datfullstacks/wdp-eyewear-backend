const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

const ROOT_DIR = path.join(__dirname, "..");
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const Store = require(path.join(ROOT_DIR, "models", "Store"));
const User = require(path.join(ROOT_DIR, "models", "User"));
const Order = require(path.join(ROOT_DIR, "models", "Order"));
const Product = require(path.join(ROOT_DIR, "models", "Product"));

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const BUSINESS_MODE =
  (argv.find((arg) => arg.startsWith("--business-mode=")) || "")
    .split("=")[1]
    ?.trim()
    .toLowerCase() === "all"
    ? "all"
    : "selected";
const DEFAULT_STORE_NAME =
  (argv.find((arg) => arg.startsWith("--store-name=")) || "")
    .split("=")
    .slice(1)
    .join("=")
    .trim() || "WDP Flagship Store";
const DEFAULT_STORE_CODE = (
  (argv.find((arg) => arg.startsWith("--store-code=")) || "")
    .split("=")[1]
    ?.trim() || "WDP-HQ"
)
  .toUpperCase()
  .replace(/[^A-Z0-9-]/g, "")
  .slice(0, 32);

const STORE_SCOPED_ROLES = new Set(["manager", "sales", "operations"]);
const ALL_SCOPE = Object.freeze({
  mode: "all",
  primaryStoreId: null,
  storeIds: [],
  note: "",
});

function normalizeId(value) {
  const candidate =
    value && typeof value === "object" ? value._id || value.id || "" : value;
  const normalized = String(candidate || "").trim();
  return normalized || "";
}

function dedupeIds(values = []) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => normalizeId(value))
        .filter(Boolean),
    ),
  ];
}

function normalizeScope(input = {}, validStoreIdSet = null) {
  const mode =
    String(input?.mode || "all").trim().toLowerCase() === "selected"
      ? "selected"
      : "all";
  const requestedPrimaryStoreId = normalizeId(input?.primaryStoreId);
  const requestedStoreIds = dedupeIds([
    requestedPrimaryStoreId,
    ...(Array.isArray(input?.storeIds) ? input.storeIds : []),
  ]);
  const filteredStoreIds =
    validStoreIdSet instanceof Set
      ? requestedStoreIds.filter((storeId) => validStoreIdSet.has(storeId))
      : requestedStoreIds;
  const primaryStoreId =
    filteredStoreIds.find((storeId) => storeId === requestedPrimaryStoreId) ||
    filteredStoreIds[0] ||
    null;

  if (mode !== "selected" || filteredStoreIds.length === 0) {
    return {
      mode: "all",
      primaryStoreId: null,
      storeIds: [],
      note: String(input?.note || "").trim(),
    };
  }

  return {
    mode: "selected",
    primaryStoreId,
    storeIds: filteredStoreIds,
    note: String(input?.note || "").trim(),
  };
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function scopesEqual(left, right) {
  const normalizedLeft = normalizeScope(left);
  const normalizedRight = normalizeScope(right);
  return (
    normalizedLeft.mode === normalizedRight.mode &&
    normalizeId(normalizedLeft.primaryStoreId) ===
      normalizeId(normalizedRight.primaryStoreId) &&
    JSON.stringify(dedupeIds(normalizedLeft.storeIds)) ===
      JSON.stringify(dedupeIds(normalizedRight.storeIds)) &&
    String(normalizedLeft.note || "") === String(normalizedRight.note || "")
  );
}

function buildScopedAccess(storeId, note = "") {
  if (!storeId) {
    return { ...ALL_SCOPE, note: String(note || "").trim() };
  }
  return {
    mode: "selected",
    primaryStoreId: storeId,
    storeIds: [storeId],
    note: String(note || "").trim(),
  };
}

async function ensureDefaultStore(summary) {
  const stores = await Store.find()
    .select("_id name code status type isDefault sortOrder")
    .sort({ isDefault: -1, sortOrder: 1, name: 1 })
    .lean();

  if (stores.length === 0) {
    const payload = {
      name: DEFAULT_STORE_NAME,
      code: DEFAULT_STORE_CODE || "WDP-HQ",
      status: "active",
      type: "flagship",
      supportsTryOn: true,
      supportsPickup: true,
      isDefault: true,
      sortOrder: 0,
      note: "Backfilled by store network migration",
    };

    if (APPLY) {
      const created = await Store.create(payload);
      summary.store.created = 1;
      summary.store.selected = {
        id: String(created._id),
        name: created.name,
        code: created.code,
      };
      return created.toObject();
    }

    const simulatedId = new mongoose.Types.ObjectId();
    summary.store.created = 1;
    summary.store.selected = {
      id: String(simulatedId),
      name: payload.name,
      code: payload.code,
    };
    return { _id: simulatedId, ...payload };
  }

  const currentDefaultStores = stores.filter((store) => store.isDefault);
  const selectedStore = currentDefaultStores[0] || stores[0];

  if (currentDefaultStores.length === 0 && APPLY) {
    await Store.updateOne({ _id: selectedStore._id }, { $set: { isDefault: true } });
    summary.store.markedDefault = 1;
  } else if (currentDefaultStores.length > 1 && APPLY) {
    const extraDefaultIds = currentDefaultStores
      .slice(1)
      .map((store) => store._id);
    if (extraDefaultIds.length > 0) {
      await Store.updateMany(
        { _id: { $in: extraDefaultIds } },
        { $set: { isDefault: false } },
      );
      summary.store.fixedDuplicateDefaults = extraDefaultIds.length;
    }
  } else if (currentDefaultStores.length === 0) {
    summary.store.markedDefault = 1;
  } else if (currentDefaultStores.length > 1) {
    summary.store.fixedDuplicateDefaults = currentDefaultStores.length - 1;
  }

  summary.store.selected = {
    id: String(selectedStore._id),
    name: selectedStore.name,
    code: selectedStore.code,
  };
  return selectedStore;
}

async function backfillProducts(validStoreIdSet, summary) {
  const cursor = Product.find()
    .select("_id storeScope")
    .lean()
    .cursor();

  for await (const product of cursor) {
    const hasPersistedScope = hasOwn(product, "storeScope");
    const currentScope = normalizeScope(product.storeScope, validStoreIdSet);
    let desiredScope = currentScope;

    if (!hasPersistedScope) {
      desiredScope = { ...ALL_SCOPE };
    } else if (
      String(product?.storeScope?.mode || "").trim().toLowerCase() === "selected" &&
      currentScope.mode !== "selected"
    ) {
      desiredScope = { ...ALL_SCOPE };
    }

    if (!hasPersistedScope || !scopesEqual(product.storeScope, desiredScope)) {
      summary.products.updated += 1;
      if (APPLY) {
        await Product.updateOne({ _id: product._id }, { $set: { storeScope: desiredScope } });
      }
    }
  }
}

function resolveDesiredUserAccess(user, defaultStoreId, validStoreIdSet) {
  const role = String(user?.role || "").trim().toLowerCase();
  const hasPersistedAccess = hasOwn(user, "storeAccess");
  const currentAccess = normalizeScope(user.storeAccess, validStoreIdSet);

  if (role === "admin") {
    return { ...ALL_SCOPE, note: currentAccess.note };
  }

  if (hasPersistedAccess && currentAccess.mode === "selected") {
    return currentAccess;
  }

  if (hasPersistedAccess && currentAccess.mode === "all") {
    return currentAccess;
  }

  if (STORE_SCOPED_ROLES.has(role) && BUSINESS_MODE === "selected") {
    return buildScopedAccess(defaultStoreId, currentAccess.note);
  }

  return { ...ALL_SCOPE, note: currentAccess.note };
}

async function backfillUsers(defaultStoreId, validStoreIdSet, summary) {
  const cursor = User.find()
    .select("_id role storeAccess")
    .lean()
    .cursor();

  for await (const user of cursor) {
    const desiredAccess = resolveDesiredUserAccess(
      user,
      defaultStoreId,
      validStoreIdSet,
    );
    if (!hasOwn(user, "storeAccess") || !scopesEqual(user.storeAccess, desiredAccess)) {
      summary.users.updated += 1;
      summary.users.byRole[user.role] = (summary.users.byRole[user.role] || 0) + 1;
      if (APPLY) {
        await User.updateOne(
          { _id: user._id },
          { $set: { storeAccess: desiredAccess } },
        );
      }
    }
  }
}

async function backfillOrders(defaultStoreId, summary) {
  if (!defaultStoreId) {
    return;
  }

  const query = {
    $or: [{ storeId: null }, { storeId: { $exists: false } }],
  };
  const count = await Order.countDocuments(query);
  summary.orders.updated = count;

  if (APPLY && count > 0) {
    await Order.updateMany(query, { $set: { storeId: defaultStoreId } });
  }
}

async function collectSnapshot() {
  const [stores, products, productsSelected, users, orders, ordersWithStoreId] =
    await Promise.all([
      Store.countDocuments(),
      Product.countDocuments(),
      Product.countDocuments({ "storeScope.mode": "selected" }),
      User.countDocuments(),
      Order.countDocuments(),
      Order.countDocuments({ storeId: { $ne: null } }),
    ]);

  return {
    stores,
    products,
    productsSelected,
    users,
    orders,
    ordersWithStoreId,
  };
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("Missing MONGODB_URI in environment");
  }

  const summary = {
    apply: APPLY,
    businessMode: BUSINESS_MODE,
    store: {
      created: 0,
      markedDefault: 0,
      fixedDuplicateDefaults: 0,
      selected: null,
    },
    products: { updated: 0 },
    users: { updated: 0, byRole: {} },
    orders: { updated: 0 },
    before: null,
    after: null,
  };

  await mongoose.connect(process.env.MONGODB_URI);
  try {
    summary.before = await collectSnapshot();

    const defaultStore = await ensureDefaultStore(summary);
    const allStores = await Store.find().select("_id").lean();
    const validStoreIdSet = new Set(
      (allStores.length > 0
        ? allStores
        : defaultStore?._id
          ? [{ _id: defaultStore._id }]
          : []
      ).map((store) => String(store._id)),
    );
    const defaultStoreId = normalizeId(defaultStore?._id);

    await backfillProducts(validStoreIdSet, summary);
    await backfillUsers(defaultStoreId, validStoreIdSet, summary);
    await backfillOrders(defaultStoreId, summary);

    summary.after = APPLY ? await collectSnapshot() : summary.before;

    console.log(
      JSON.stringify(
        {
          status: APPLY ? "applied" : "dry-run",
          summary,
          next: APPLY
            ? "Store network backfill completed."
            : "Re-run with --apply to write these changes.",
        },
        null,
        2,
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "failed",
        message: error?.message || "Unknown error",
        stack: error?.stack || "",
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
