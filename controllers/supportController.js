const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/response');
const supportService = require('../services/supportService');

exports.listTickets = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, userId } = req.query;
  const result = await supportService.listTickets(req.user, {
    page,
    limit,
    status,
    userId
  });

  ApiResponse.paginate(
    res,
    result.tickets,
    result.pagination,
    'Support tickets retrieved successfully'
  );
});

exports.getTicket = asyncHandler(async (req, res) => {
  const ticket = await supportService.getTicketById(req.params.id, req.user);
  ApiResponse.success(res, ticket, 'Support ticket retrieved successfully');
});

exports.createTicket = asyncHandler(async (req, res) => {
  const ticket = await supportService.createTicket(req.user, req.body);
  ApiResponse.created(res, ticket, 'Support ticket created successfully');
});

exports.replyTicket = asyncHandler(async (req, res) => {
  const ticket = await supportService.addReply(req.params.id, req.user, req.body);
  ApiResponse.success(res, ticket, 'Reply sent successfully');
});

exports.updateTicketStatus = asyncHandler(async (req, res) => {
  const ticket = await supportService.updateStatus(req.params.id, req.user, req.body.status);
  ApiResponse.success(res, ticket, 'Support ticket status updated successfully');
});
