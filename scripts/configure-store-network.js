const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

const ROOT_DIR = path.join(__dirname, "..");
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const Store = require(path.join(ROOT_DIR, "models", "Store"));
const User = require(path.join(ROOT_DIR, "models", "User"));
const Product = require(path.join(ROOT_DIR, "models", "Product"));
const Order = require(path.join(ROOT_DIR, "models", "Order"));
const ghnService = require(path.join(ROOT_DIR, "services", "ghnService"));
const { BASE_STORES } = require(path.join(ROOT_DIR, "scripts", "seed-store-network"));

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");

const DEFAULT_STORE_CODE = "WDP-HQ";
const WAREHOUSE_STORE_CODE = "WDP-WH-SOUTH";

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

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

function normalizeScope(scope = {}) {
  const mode =
    String(scope?.mode || "all").trim().toLowerCase() === "selected"
      ? "selected"
      : "all";
  const primaryStoreId = normalizeId(scope?.primaryStoreId);
  const requestedStoreIds = dedupeIds([primaryStoreId, ...(scope?.storeIds || [])]);
  if (mode !== "selected" || requestedStoreIds.length === 0) {
    return {
      mode: "all",
      primaryStoreId: null,
      storeIds: [],
      note: String(scope?.note || "").trim(),
    };
  }

  return {
    mode: "selected",
    primaryStoreId: requestedStoreIds[0] || null,
    storeIds: requestedStoreIds,
    note: String(scope?.note || "").trim(),
  };
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

function buildSelectedScope(primaryStoreId, storeIds, note = "") {
  const normalizedStoreIds = dedupeIds([primaryStoreId, ...(storeIds || [])]);
  return {
    mode: "selected",
    primaryStoreId: normalizedStoreIds[0] || null,
    storeIds: normalizedStoreIds,
    note: String(note || "").trim(),
  };
}

function remoteShopToLocalGhn(remoteShop = {}, fallback = {}) {
  return {
    shopId: Number(remoteShop?._id || remoteShop?.shop_id || fallback.shopId || 0) || null,
    clientId:
      Number(remoteShop?.client_id || remoteShop?.clientId || fallback.clientId || 0) ||
      null,
    provinceId:
      Number(remoteShop?.province_id_v2 || remoteShop?.province_id || fallback.provinceId || 0) ||
      fallback.provinceId ||
      null,
    provinceName: String(fallback.provinceName || "").trim(),
    districtId:
      Number(remoteShop?.district_id || remoteShop?.districtId || fallback.districtId || 0) ||
      fallback.districtId ||
      null,
    districtName: String(fallback.districtName || "").trim(),
    wardCode: String(remoteShop?.ward_code || remoteShop?.wardCode || fallback.wardCode || "").trim(),
    wardName: String(fallback.wardName || "").trim(),
    address: String(remoteShop?.address_v2 || remoteShop?.address || fallback.address || "").trim(),
    syncedAt: new Date(),
    lastSyncError: "",
  };
}

function matchRemoteShop(remoteShops = [], storePlan = {}, currentStore = {}) {
  const existingShopId = Number(currentStore?.ghn?.shopId || storePlan?.ghn?.shopId || 0);
  if (existingShopId > 0) {
    const byId = remoteShops.find((shop) => Number(shop?._id || 0) === existingShopId);
    if (byId) return byId;
  }

  const normalizedPhone = normalizeText(currentStore?.phone || storePlan?.phone);
  const normalizedAddress = normalizeText(
    currentStore?.ghn?.address ||
      storePlan?.ghn?.address ||
      currentStore?.addressLine1 ||
      storePlan?.addressLine1,
  );
  const normalizedName = normalizeText(currentStore?.name || storePlan?.name);

  return (
    remoteShops.find((shop) => {
      const shopPhone = normalizeText(shop?.phone);
      const shopAddress = normalizeText(shop?.address_v2 || shop?.address);
      const shopName = normalizeText(shop?.name);
      return (
        normalizedAddress &&
        shopAddress === normalizedAddress &&
        ((normalizedPhone && shopPhone === normalizedPhone) ||
          (normalizedName && shopName === normalizedName))
      );
    }) || null
  );
}

async function loadRemoteShops() {
  const payload = await ghnService.getStores({ offset: 0, limit: 100 });
  return Array.isArray(payload?.data?.shops) ? payload.data.shops : [];
}

function applyStorePlanFields(store, plan) {
  const mutableFields = [
    "name",
    "status",
    "type",
    "phone",
    "email",
    "addressLine1",
    "ward",
    "district",
    "city",
    "openingHours",
    "note",
    "supportsTryOn",
    "supportsPickup",
    "isDefault",
    "sortOrder",
  ];

  let changed = false;
  for (const field of mutableFields) {
    const nextValue = plan[field];
    if (nextValue !== undefined && JSON.stringify(store[field]) !== JSON.stringify(nextValue)) {
      store[field] = nextValue;
      changed = true;
    }
  }
  return changed;
}

function applyGhnFields(store, nextGhn) {
  const fields = [
    "shopId",
    "clientId",
    "provinceId",
    "provinceName",
    "districtId",
    "districtName",
    "wardCode",
    "wardName",
    "address",
    "syncedAt",
    "lastSyncError",
  ];

  let changed = false;
  for (const field of fields) {
    const nextValue = nextGhn[field] ?? (field === "lastSyncError" ? "" : null);
    if (JSON.stringify(store.ghn?.[field]) !== JSON.stringify(nextValue)) {
      store.ghn[field] = nextValue;
      changed = true;
    }
  }
  return changed;
}

async function ensureRemoteShop(store, plan, remoteShops, summary) {
  const matchedRemote = matchRemoteShop(remoteShops, plan, store);
  if (matchedRemote) {
    summary.ghn.reused += 1;
    return remoteShopToLocalGhn(matchedRemote, plan.ghn);
  }

  if (!APPLY) {
    summary.ghn.toCreate += 1;
    return remoteShopToLocalGhn({}, plan.ghn);
  }

  const response = await ghnService.createStore({
    district_id: plan.ghn.districtId,
    ward_code: plan.ghn.wardCode,
    name: plan.name,
    phone: plan.phone,
    address: plan.ghn.address,
  });

  const createdShop = {
    _id: Number(response?.data?.shop_id || response?.data?.shopId || 0) || null,
    client_id: Number(response?.data?.client_id || response?.data?.clientId || 0) || null,
    name: plan.name,
    phone: plan.phone,
    address: plan.ghn.address,
    address_v2: plan.ghn.address,
    district_id: plan.ghn.districtId,
    ward_code: plan.ghn.wardCode,
    province_id_v2: plan.ghn.provinceId,
  };
  remoteShops.push(createdShop);
  summary.ghn.created += 1;
  summary.ghn.createdStoreCodes.push(plan.code);
  return remoteShopToLocalGhn(createdShop, plan.ghn);
}

async function syncStores(summary) {
  const remoteShops = await loadRemoteShops();
  const plansByCode = new Map(BASE_STORES.map((store) => [store.code, store]));
  const stores = await Store.find().sort({ sortOrder: 1, name: 1 });

  for (const store of stores) {
    const plan = plansByCode.get(store.code);
    if (!plan) continue;

    let changed = applyStorePlanFields(store, plan);
    const nextGhn = await ensureRemoteShop(store, plan, remoteShops, summary);
    changed = applyGhnFields(store, nextGhn) || changed;

    if (changed) {
      summary.stores.updated += 1;
      summary.stores.updatedCodes.push(store.code);
      if (APPLY) {
        await store.save();
      }
    }
  }

  return stores;
}

async function syncUsers(summary, stores) {
  const storesByCode = new Map(stores.map((store) => [store.code, store]));
  const defaultStoreId = normalizeId(storesByCode.get(DEFAULT_STORE_CODE)?._id);
  const warehouseStoreId = normalizeId(storesByCode.get(WAREHOUSE_STORE_CODE)?._id);
  const allActiveStoreIds = stores
    .filter((store) => store.status === "active")
    .map((store) => String(store._id));
  const retailStoreIds = stores
    .filter((store) => store.status === "active" && store.type !== "warehouse")
    .map((store) => String(store._id));

  const users = await User.find({ role: { $in: ["manager", "sales", "operations"] } });
  for (const user of users) {
    let desiredScope = user.storeAccess || {};
    let note = "";

    if (user.role === "manager") {
      note = "Chain-wide business manager scope";
      desiredScope = buildSelectedScope(defaultStoreId, allActiveStoreIds, note);
    } else if (user.role === "operations") {
      note = "Operations scope across stores, primary warehouse";
      desiredScope = buildSelectedScope(
        warehouseStoreId || defaultStoreId,
        allActiveStoreIds,
        note,
      );
    } else if (user.role === "sales") {
      note = "Retail sales scope across customer-facing branches";
      desiredScope = buildSelectedScope(defaultStoreId, retailStoreIds, note);
    }

    if (!scopesEqual(user.storeAccess, desiredScope)) {
      summary.users.updated += 1;
      summary.users.byRole[user.role] = (summary.users.byRole[user.role] || 0) + 1;
      summary.users.updatedEmails.push(user.email);
      if (APPLY) {
        user.storeAccess = desiredScope;
        await user.save();
      }
    }
  }

  return {
    defaultStoreId,
    retailStoreIds,
  };
}

async function syncProducts(summary, context) {
  const desiredScope = buildSelectedScope(
    context.defaultStoreId,
    context.retailStoreIds,
    "Retail assortment available across customer-facing stores",
  );

  const cursor = Product.find().select("_id slug storeScope").cursor();
  for await (const product of cursor) {
    if (!scopesEqual(product.storeScope, desiredScope)) {
      summary.products.updated += 1;
      if (summary.products.sampleSlugs.length < 12) {
        summary.products.sampleSlugs.push(product.slug);
      }
      if (APPLY) {
        await Product.updateOne({ _id: product._id }, { $set: { storeScope: desiredScope } });
      }
    }
  }
}

async function collectSnapshot() {
  const [stores, users, orders, products, selectedProducts] = await Promise.all([
    Store.find()
      .sort({ sortOrder: 1, name: 1 })
      .select("code name type isDefault ghn.shopId ghn.districtId ghn.wardCode"),
    User.find({ role: { $in: ["manager", "sales", "operations"] } })
      .sort({ role: 1, email: 1 })
      .select("email role storeAccess"),
    Order.countDocuments({ storeId: { $ne: null } }),
    Product.countDocuments(),
    Product.countDocuments({ "storeScope.mode": "selected" }),
  ]);

  return {
    stores,
    users,
    orderCountWithStoreId: orders,
    productCount: products,
    productCountSelectedScope: selectedProducts,
  };
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("Missing MONGODB_URI in environment");
  }

  const summary = {
    apply: APPLY,
    ghn: {
      reused: 0,
      created: 0,
      toCreate: 0,
      createdStoreCodes: [],
    },
    stores: {
      updated: 0,
      updatedCodes: [],
    },
    users: {
      updated: 0,
      byRole: {},
      updatedEmails: [],
    },
    products: {
      updated: 0,
      sampleSlugs: [],
    },
    before: null,
    after: null,
  };

  await mongoose.connect(process.env.MONGODB_URI);
  try {
    summary.before = await collectSnapshot();
    const stores = await syncStores(summary);
    const context = await syncUsers(summary, stores);
    await syncProducts(summary, context);
    summary.after = APPLY ? await collectSnapshot() : summary.before;

    console.log(
      JSON.stringify(
        {
          status: APPLY ? "applied" : "dry-run",
          summary,
          next: APPLY
            ? "Store network configuration completed."
            : "Re-run with --apply to persist the changes.",
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
        upstream: error?.upstream || null,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
