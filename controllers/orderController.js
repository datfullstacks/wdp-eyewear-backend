const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/response');
const orderService = require('../services/orderService');

exports.listOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, paymentStatus, refundStatus, userId } = req.query;
  const result = await orderService.listOrders(req.user, {
    page,
    limit,
    status,
    paymentStatus,
    refundStatus,
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
  const { page = 1, limit = 10, status, paymentStatus, refundStatus } = req.query;
  const result = await orderService.listOrders(req.user, {
    page,
    limit,
    status,
    paymentStatus,
    refundStatus
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
  const order = await orderService.cancelOrder(req.params.id, req.user, req.body);
  ApiResponse.success(res, order, 'Order cancelled');
});

exports.updateOrderItems = asyncHandler(async (req, res) => {
  const order = await orderService.updateOrderItems(req.params.id, req.user, req.body);
  ApiResponse.success(res, order, 'Order items updated');
});

exports.patchOrderItem = asyncHandler(async (req, res) => {
  const result = await orderService.patchOrderItem(
    req.params.id,
    req.params.itemId,
    req.user,
    req.body
  );

  ApiResponse.success(
    res,
    {
      order: result.order,
      updatedItem: result.updatedItem,
      updatedItemIndex: result.updatedItemIndex
    },
    'Order item updated'
  );
});

exports.updateRefundStatus = asyncHandler(async (req, res) => {
  const order = await orderService.updateRefundStatus(req.params.id, req.user, req.body);
  ApiResponse.success(res, order, 'Order refund status updated');
});

exports.updateOrderStatus = asyncHandler(async (req, res) => {
  const order = await orderService.updateOrderStatus(req.params.id, req.user, req.body.status);
  ApiResponse.success(res, order, 'Order status updated');
});
