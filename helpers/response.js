class ApiResponse {
  static success(res, data, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data
    });
  }

  static created(res, data, message = 'Created successfully') {
    return this.success(res, data, message, 201);
  }

  static noContent(res) {
    return res.status(204).send();
  }

  static error(res, message = 'Error occurred', statusCode = 500, errors = null) {
    const response = {
      success: false,
      message
    };
    
    if (errors) {
      response.errors = errors;
    }

    return res.status(statusCode).json(response);
  }

  static notFound(res, message = 'Resource not found') {
    return this.error(res, message, 404);
  }

  static badRequest(res, message = 'Bad request', errors = null) {
    return this.error(res, message, 400, errors);
  }

  static unauthorized(res, message = 'Unauthorized') {
    return this.error(res, message, 401);
  }

  static forbidden(res, message = 'Forbidden') {
    return this.error(res, message, 403);
  }

  static conflict(res, message = 'Resource already exists') {
    return this.error(res, message, 409);
  }

  static unprocessableEntity(res, message = 'Validation failed', errors = null) {
    return this.error(res, message, 422, errors);
  }

  static tooManyRequests(res, message = 'Too many requests') {
    return this.error(res, message, 429);
  }

  static internalError(res, message = 'Internal server error') {
    return this.error(res, message, 500);
  }

  static serviceUnavailable(res, message = 'Service temporarily unavailable') {
    return this.error(res, message, 503);
  }

  static paginate(res, data, pagination, message = 'Success') {
    return res.status(200).json({
      success: true,
      message,
      data,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        totalPages: Math.ceil(pagination.total / pagination.limit)
      }
    });
  }
}

module.exports = ApiResponse;
