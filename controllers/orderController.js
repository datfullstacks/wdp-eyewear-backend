const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/response');
const orderService = require('../services/orderService');

exports.listOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, paymentStatus, userId } = req.query;
  const result = await orderService.listOrders(req.user, {
    page,
    limit,
    status,
    paymentStatus,
    userId
  });

  ApiResponse.paginate(
    res,
    result.orders,
    result.pagination,
    'Orders retrieved successfully'
  );
});

exports.listMyOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, paymentStatus } = req.query;
  const result = await orderService.listOrders(req.user, {
    page,
    limit,
    status,
    paymentStatus
  });

  ApiResponse.paginate(
    res,
    result.orders,
    result.pagination,
    'My orders retrieved successfully'
  );
});

exports.getOrder = asyncHandler(async (req, res) => {
  const order = await orderService.getOrderById(req.params.id, req.user);
  ApiResponse.success(res, order);
});

exports.cancelOrder = asyncHandler(async (req, res) => {
  const order = await orderService.cancelOrder(req.params.id, req.user);
  ApiResponse.success(res, order, 'Order cancelled');
});
