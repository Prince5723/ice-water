const config = require('../config');

class Logger {
  log(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    console.log(JSON.stringify({
      timestamp,
      level,
      message,
      ...meta
    }));
  }

  info(message, meta) { this.log('INFO', message, meta); }
  warn(message, meta) { this.log('WARN', message, meta); }
  error(message, meta) { this.log('ERROR', message, meta); }
  debug(message, meta) { 
    if (config.LOG_LEVEL === 'debug') this.log('DEBUG', message, meta); 
  }
}

module.exports = new Logger();