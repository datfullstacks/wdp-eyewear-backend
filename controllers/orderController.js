const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/response');
const orderService = require('../services/orderService');

exports.getOrder = asyncHandler(async (req, res) => {
  const order = await orderService.getOrderById(req.params.id, req.user);
  ApiResponse.success(res, order);
});

exports.cancelOrder = asyncHandler(async (req, res) => {
  const order = await orderService.cancelOrder(req.params.id, req.user);
  ApiResponse.success(res, order, 'Order cancelled');
});
