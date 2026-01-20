const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  logger.error(message, { 
    stack: err.stack, 
    path: req.path, 
    method: req.method 
  });

  res.status(statusCode).json({
    success: false,
    error: {
      code: statusCode,
      message: message
    }
  });
};

module.exports = errorHandler;