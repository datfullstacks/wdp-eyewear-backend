const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/response');
const cartService = require('../services/cartService');

exports.getMyCart = asyncHandler(async (req, res) => {
  const cart = await cartService.getCart(req.user.id, req.params.cartType);
  ApiResponse.success(res, cart, 'Cart retrieved successfully');
});

exports.upsertMyCartItem = asyncHandler(async (req, res) => {
  const cart = await cartService.upsertItem(req.user.id, req.params.cartType, req.body);
  ApiResponse.success(res, cart, 'Cart item updated successfully');
});

exports.replaceMyCartItems = asyncHandler(async (req, res) => {
  const cart = await cartService.replaceItems(req.user.id, req.params.cartType, req.body.items);
  ApiResponse.success(res, cart, 'Cart replaced successfully');
});

exports.removeMyCartItem = asyncHandler(async (req, res) => {
  const cart = await cartService.removeItem(req.user.id, req.params.cartType, req.params.itemId);
  ApiResponse.success(res, cart, 'Cart item removed successfully');
});

exports.clearMyCart = asyncHandler(async (req, res) => {
  const cart = await cartService.clearCart(req.user.id, req.params.cartType);
  ApiResponse.success(res, cart, 'Cart cleared successfully');
});
