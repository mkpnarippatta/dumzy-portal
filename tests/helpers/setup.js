process.env.MOCHA_TEST_MODE = 'true';

process.env.RATE_LIMIT_WINDOW_MS = process.env.RATE_LIMIT_WINDOW_MS || '60000';
process.env.ALERT_COOLDOWN_MS = process.env.ALERT_COOLDOWN_MS || '100';
process.env.QUEUE_MAX_RETRIES = process.env.QUEUE_MAX_RETRIES || '3';

if (!process.env.VERBOSE) {
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
}

const { expect } = require('chai');

module.exports = { expect };
