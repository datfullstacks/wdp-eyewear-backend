const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/response');
const invoiceService = require('../services/invoiceService');

exports.listInvoices = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, userId, orderId } = req.query;
  const result = await invoiceService.listInvoices(req.user, {
    page,
    limit,
    status,
    userId,
    orderId
  });

  ApiResponse.paginate(res, result.invoices, result.pagination, 'Invoices retrieved successfully');
});

exports.listMyInvoices = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;
  const result = await invoiceService.listInvoices(req.user, {
    page,
    limit,
    status
  });

  ApiResponse.paginate(res, result.invoices, result.pagination, 'My invoices retrieved successfully');
});

exports.getInvoice = asyncHandler(async (req, res) => {
  const invoice = await invoiceService.getInvoiceById(req.params.id, req.user);
  ApiResponse.success(res, invoice, 'Invoice retrieved successfully');
});

exports.getInvoiceByOrder = asyncHandler(async (req, res) => {
  const invoice = await invoiceService.getInvoiceByOrderId(req.params.orderId, req.user);
  ApiResponse.success(res, invoice, 'Invoice retrieved successfully');
});
