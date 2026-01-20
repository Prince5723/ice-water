// Handles environment variables
const defaults = {
  PORT: 3000,
  LOG_LEVEL: 'info',
  MAX_ROOMS: 50,
  CORS_ORIGIN: '*'
};

module.exports = {
  PORT: process.env.PORT || defaults.PORT,
  LOG_LEVEL: process.env.LOG_LEVEL || defaults.LOG_LEVEL,
  MAX_ROOMS: parseInt(process.env.MAX_ROOMS) || defaults.MAX_ROOMS,
  CORS_ORIGIN: process.env.CORS_ORIGIN || defaults.CORS_ORIGIN,
  TICK_RATE: require('./constants').TICK_RATE
};