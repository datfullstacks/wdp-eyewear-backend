const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/response');
const inventoryService = require('../services/inventoryService');

exports.listReceipts = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, supplier, receiptCode, fromDate, toDate } = req.query;
  const result = await inventoryService.listStockReceipts({
    page,
    limit,
    supplier,
    receiptCode,
    fromDate,
    toDate
  });

  ApiResponse.paginate(
    res,
    result.receipts,
    result.pagination,
    'Stock receipts retrieved successfully'
  );
});

exports.getReceiptById = asyncHandler(async (req, res) => {
  const receipt = await inventoryService.getStockReceiptById(req.params.id);
  ApiResponse.success(res, receipt, 'Stock receipt retrieved successfully');
});

exports.createReceipt = asyncHandler(async (req, res) => {
  const receipt = await inventoryService.createStockReceipt(req.body, req.user);
  ApiResponse.created(res, receipt, 'Stock receipt created successfully');
});
