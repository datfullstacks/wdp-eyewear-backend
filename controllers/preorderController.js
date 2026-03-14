const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/response');
const preorderService = require('../services/preorderService');

exports.listBatches = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, supplier, search } = req.query;
  const result = await preorderService.listBatches({
    page,
    limit,
    status,
    supplier,
    search
  });

  ApiResponse.paginate(
    res,
    result.batches,
    result.pagination,
    'Preorder batches retrieved successfully'
  );
});

exports.getBatchById = asyncHandler(async (req, res) => {
  const batch = await preorderService.getBatchById(req.params.id);
  ApiResponse.success(res, batch, 'Preorder batch retrieved successfully');
});

exports.createBatch = asyncHandler(async (req, res) => {
  const batch = await preorderService.createBatch(req.body, req.user);
  ApiResponse.created(res, batch, 'Preorder batch created successfully');
});

exports.receiveBatch = asyncHandler(async (req, res) => {
  const batch = await preorderService.receiveBatch(req.params.id, req.body, req.user);
  ApiResponse.success(res, batch, 'Preorder receipt confirmed successfully');
});

exports.updateBatchStatus = asyncHandler(async (req, res) => {
  const batch = await preorderService.updateBatchStatus(req.params.id, req.body.status, req.user);
  ApiResponse.success(res, batch, 'Preorder batch status updated successfully');
});
