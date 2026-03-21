const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

const ROOT_DIR = path.join(__dirname, "..");
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const Store = require(path.join(ROOT_DIR, "models", "Store"));
const User = require(path.join(ROOT_DIR, "models", "User"));
const Order = require(path.join(ROOT_DIR, "models", "Order"));
const Product = require(path.join(ROOT_DIR, "models", "Product"));
const { buildCanonicalStores } = require(path.join(
  ROOT_DIR,
  "scripts",
  "seed-store-network",
));

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

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("Missing MONGODB_URI in environment");
  }

  const canonicalStores = await buildCanonicalStores();
  const defaultStorePayload =
    canonicalStores.find((store) => store.isDefault) || canonicalStores[0];
  if (!defaultStorePayload) {
    throw new Error("Canonical store list is empty");
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const session = await mongoose.startSession();
  try {
    const summary = {
      oldStoreCount: 0,
      created: 0,
      remappedUsers: 0,
      remappedOrders: 0,
      remappedProducts: 0,
      deletedStores: 0,
      defaultStore: null,
    };

    await session.withTransaction(async () => {
      const existingStores = await Store.find()
        .session(session)
        .select("_id code isDefault")
        .lean();
      summary.oldStoreCount = existingStores.length;

      const oldStoreById = new Map(
        existingStores.map((store) => [String(store._id), store]),
      );

      const deleteResult = await Store.deleteMany(
        { _id: { $in: existingStores.map((store) => store._id) } },
        { session },
      );
      summary.deletedStores = Number(deleteResult.deletedCount || 0);

      const createdStores = await Store.insertMany(canonicalStores, { session });
      summary.created = createdStores.length;

      const newStoreByCode = new Map(
        createdStores.map((store) => [String(store.code || "").trim().toUpperCase(), store]),
      );
      const defaultStore =
        newStoreByCode.get(String(defaultStorePayload.code || "").trim().toUpperCase()) ||
        createdStores[0];
      summary.defaultStore = {
        id: String(defaultStore._id),
        code: defaultStore.code,
        name: defaultStore.name,
      };

      const remapStoreId = (oldId) => {
        const normalizedOldId = normalizeId(oldId);
        if (!normalizedOldId) return String(defaultStore._id);
        const oldStore = oldStoreById.get(normalizedOldId);
        const byCode = oldStore
          ? newStoreByCode.get(String(oldStore.code || "").trim().toUpperCase())
          : null;
        return String((byCode || defaultStore)._id);
      };

      const users = await User.find()
        .session(session)
        .select("_id storeAccess");
      for (const user of users) {
        const currentPrimary = normalizeId(user?.storeAccess?.primaryStoreId);
        const currentStoreIds = dedupeIds(user?.storeAccess?.storeIds);
        if (!currentPrimary && currentStoreIds.length === 0) {
          continue;
        }
        user.storeAccess.primaryStoreId = remapStoreId(currentPrimary || currentStoreIds[0]);
        user.storeAccess.storeIds = dedupeIds(currentStoreIds.map(remapStoreId));
        if (user.storeAccess.mode === "selected" && user.storeAccess.storeIds.length === 0) {
          user.storeAccess.storeIds = [String(defaultStore._id)];
        }
        if (user.storeAccess.mode === "selected" && !user.storeAccess.primaryStoreId) {
          user.storeAccess.primaryStoreId = String(defaultStore._id);
        }
        await user.save({ session });
        summary.remappedUsers += 1;
      }

      const orderResult = await Order.updateMany(
        { storeId: { $in: existingStores.map((store) => store._id) } },
        { $set: { storeId: defaultStore._id } },
        { session },
      );
      summary.remappedOrders = Number(orderResult.modifiedCount || 0);

      const products = await Product.find()
        .session(session)
        .select("_id storeScope");
      for (const product of products) {
        const currentPrimary = normalizeId(product?.storeScope?.primaryStoreId);
        const currentStoreIds = dedupeIds(product?.storeScope?.storeIds);
        if (!currentPrimary && currentStoreIds.length === 0) {
          continue;
        }
        product.storeScope.primaryStoreId = currentPrimary
          ? remapStoreId(currentPrimary)
          : null;
        product.storeScope.storeIds = dedupeIds(currentStoreIds.map(remapStoreId));
        await product.save({ session });
        summary.remappedProducts += 1;
      }
    });

    console.log(
      JSON.stringify(
        {
          status: "ok",
          summary,
        },
        null,
        2,
      ),
    );
  } finally {
    await session.endSession();
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
