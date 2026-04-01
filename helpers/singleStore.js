const Store = require("../models/Store");
const AppError = require("../errors/AppError");

function buildStoreQuery() {
  return {
    status: "active",
  };
}

async function findSingleStore() {
  let store = await Store.findOne(buildStoreQuery()).sort({
    isDefault: -1,
    sortOrder: 1,
    createdAt: 1,
  });

  if (!store) {
    store = await Store.findOne().sort({
      isDefault: -1,
      sortOrder: 1,
      createdAt: 1,
    });
  }

  if (!store) {
    throw new AppError("Single-store mode requires one configured store", 503);
  }

  return store;
}

async function findSingleStoreId() {
  const store = await findSingleStore();
  return String(store._id);
}

module.exports = {
  findSingleStore,
  findSingleStoreId,
};
