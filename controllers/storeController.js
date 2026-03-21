const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/response');
const storeService = require('../services/storeService');

exports.listStores = asyncHandler(async (req, res) => {
  const result = await storeService.listStores(req.query);
  ApiResponse.paginate(res, result.stores, result.pagination, 'Stores retrieved successfully');
});

exports.getStoreById = asyncHandler(async (req, res) => {
  const store = await storeService.getStoreById(req.params.id);
  ApiResponse.success(res, store);
});

exports.createStore = asyncHandler(async (req, res) => {
  const store = await storeService.createStore(req.body);
  ApiResponse.created(res, store, 'Store created successfully');
});

exports.updateStore = asyncHandler(async (req, res) => {
  const store = await storeService.updateStore(req.params.id, req.body);
  ApiResponse.success(res, store, 'Store updated successfully');
});

exports.deleteStore = asyncHandler(async (req, res) => {
  await storeService.deleteStore(req.params.id);
  ApiResponse.success(res, null, 'Store deleted successfully');
});
