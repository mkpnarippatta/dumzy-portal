require('dotenv').config();
const express = require('express');
const { EventEmitter } = require('events');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// RateLimitTracker — sliding window counter for API call tracking
// ---------------------------------------------------------------------------
class RateLimitTracker extends EventEmitter {
  constructor(options = {}) {
    super();
    this.windowSizeMs = options.windowSizeMs || parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000;
    this.limits = {
      'whatsapp-api': parseInt(process.env.RATE_LIMIT_WHATSAPP, 10) || 1000,
      'erpnext-api': parseInt(process.env.RATE_LIMIT_ERPNEXT, 10) || 500,
      ...options.limits,
    };
    this._counters = {}; // endpoint → { timestamps: [] }
    this._defaultLimit = options.defaultLimit || 1000;
  }

  recordApiCall(endpoint) {
    if (!this._counters[endpoint]) {
      this._counters[endpoint] = { timestamps: [] };
    }
    this._slideWindow(endpoint);
    this._counters[endpoint].timestamps.push(Date.now());
    this.emit('call:recorded', { endpoint, timestamp: Date.now() });
  }

  getCurrentUsage(endpoint) {
    if (!this._counters[endpoint]) {
      return {
        endpoint,
        currentCount: 0,
        limit: this.limits[endpoint] || this._defaultLimit,
        percentage: 0,
        windowStart: null,
        windowEnd: null,
      };
    }
    this._slideWindow(endpoint);
    const timestamps = this._counters[endpoint].timestamps;
    const limit = this.limits[endpoint] || this._defaultLimit;
    const now = Date.now();
    return {
      endpoint,
      currentCount: timestamps.length,
      limit,
      percentage: limit > 0 ? Math.round((timestamps.length / limit) * 10000) / 100 : 0,
      windowStart: new Date(now - this.windowSizeMs).toISOString(),
      windowEnd: new Date(now).toISOString(),
    };
  }

  getAllUsage() {
    const endpoints = new Set([
      ...Object.keys(this.limits),
      ...Object.keys(this._counters),
    ]);
    const usage = {};
    for (const ep of endpoints) {
      usage[ep] = this.getCurrentUsage(ep);
    }
    return usage;
  }

  _slideWindow(endpoint) {
    const counter = this._counters[endpoint];
    if (!counter) return;
    const cutoff = Date.now() - this.windowSizeMs;
    counter.timestamps = counter.timestamps.filter(t => t >= cutoff);
  }
}

// ---------------------------------------------------------------------------
// RateLimitAlerting — threshold monitoring with cooldown
// ---------------------------------------------------------------------------
class RateLimitAlerting extends EventEmitter {
  constructor(options = {}) {
    super();
    this.alertThreshold = options.alertThreshold !== undefined
      ? options.alertThreshold
      : parseFloat(process.env.ALERT_THRESHOLD) || 0.8;
    this.cooldownMs = options.cooldownMs || parseInt(process.env.ALERT_COOLDOWN_MS, 10) || 300000;
    this.alerts = [];
    this._lastAlertTime = {};
    this._alertCounter = 0;
  }

  checkThreshold(endpoint, usage) {
    if (usage.limit <= 0) return;

    const percentage = usage.percentage;
    const isExceeded = percentage >= 100;
    const isAboveThreshold = percentage >= this.alertThreshold * 100;

    if (!isAboveThreshold && !isExceeded) return;

    // Check cooldown — but always allow alert if exceeded
    const lastTime = this._lastAlertTime[endpoint];
    const now = Date.now();
    if (!isExceeded && lastTime && (now - lastTime) < this.cooldownMs) return;

    this._lastAlertTime[endpoint] = now;

    const alert = this._createAlert(endpoint, usage, percentage);

    if (isAboveThreshold) {
      this.emit('rate:alert', alert);
    }
    if (isExceeded) {
      this.emit('rate:exceeded', alert);
    }
  }

  _createAlert(endpoint, usage, percentage) {
    this._alertCounter++;
    // Estimate time to limit based on current rate
    const elapsedMs = usage.windowStart && usage.windowEnd
      ? new Date(usage.windowEnd).getTime() - new Date(usage.windowStart).getTime()
      : this.cooldownMs;
    const ratePerMs = elapsedMs > 0 ? usage.currentCount / elapsedMs : 0;
    const remaining = Math.max(0, usage.limit - usage.currentCount);
    const estimatedTimeToLimit = ratePerMs > 0 ? Math.ceil(remaining / ratePerMs) : null;

    const alert = {
      id: `alert-${Date.now()}-${this._alertCounter}`,
      type: percentage >= 100 ? 'rate_limit_exceeded' : 'rate_limit_warning',
      endpoint,
      usagePercent: percentage,
      limit: usage.limit,
      currentCount: usage.currentCount,
      estimatedTimeToLimit,
      threshold: this.alertThreshold,
      timestamp: new Date().toISOString(),
      acknowledged: false,
      acknowledgedAt: null,
    };
    this.alerts.push(alert);
    return alert;
  }

  acknowledgeAlert(alertId) {
    const alert = this.alerts.find(a => a.id === alertId);
    if (!alert) return false;
    alert.acknowledged = true;
    alert.acknowledgedAt = new Date().toISOString();
    return true;
  }

  getAlerts(endpoint) {
    let filtered = this.alerts;
    if (endpoint) {
      filtered = filtered.filter(a => a.endpoint === endpoint);
    }
    return [...filtered].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }
}

// ---------------------------------------------------------------------------
// RateLimitQueue — queues requests for retry when rate resets
// ---------------------------------------------------------------------------
class RateLimitQueue {
  constructor(options = {}) {
    this.queue = [];
    this.maxRetries = options.maxRetries || parseInt(process.env.QUEUE_MAX_RETRIES, 10) || 3;
    this.baseRetryDelayMs = options.baseRetryDelayMs || parseInt(process.env.QUEUE_BASE_DELAY_MS, 10) || 1000;
    this.processedCount = 0;
    this.failedCount = 0;
    this._enqueueCounter = 0;
  }

  enqueue(request) {
    this._enqueueCounter++;
    const entry = {
      id: `rq-${Date.now()}-${this._enqueueCounter}`,
      endpoint: request.endpoint,
      payload: request.payload,
      timestamp: new Date().toISOString(),
      retryCount: 0,
      lastError: null,
    };
    this.queue.push(entry);
    return entry;
  }

  async processQueue(processorFn) {
    const items = [...this.queue];
    this.queue = [];

    for (const item of items) {
      let success = false;
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          await processorFn(item);
          this.processedCount++;
          success = true;
          break;
        } catch (err) {
          item.retryCount = attempt + 1;
          item.lastError = err.message;
          if (attempt < this.maxRetries) {
            await this._delay(this.baseRetryDelayMs * Math.pow(2, attempt));
          }
        }
      }
      if (!success) {
        this.failedCount++;
      }
    }
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getQueuedItems() {
    return [...this.queue];
  }

  clear() {
    this.queue = [];
  }

  getStats() {
    const timestamps = this.queue.map(e => new Date(e.timestamp).getTime()).filter(t => !isNaN(t));
    return {
      depth: this.queue.length,
      processedCount: this.processedCount,
      failedCount: this.failedCount,
      maxRetries: this.maxRetries,
      oldestTimestamp: timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : null,
      newestTimestamp: timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null,
    };
  }
}

// ---------------------------------------------------------------------------
// Module-level instances and wiring
// ---------------------------------------------------------------------------
const rateLimitTracker = new RateLimitTracker();
const rateLimitAlerting = new RateLimitAlerting();
const rateLimitQueue = new RateLimitQueue();

// Wire tracker → alerting
rateLimitTracker.on('call:recorded', (data) => {
  const usage = rateLimitTracker.getCurrentUsage(data.endpoint);
  rateLimitAlerting.checkThreshold(data.endpoint, usage);
});

// Wire alerting → queue
rateLimitAlerting.on('rate:exceeded', (alert) => {
  rateLimitQueue.enqueue({ endpoint: alert.endpoint, payload: { alertId: alert.id } });
});

// ---------------------------------------------------------------------------
// Express API Routes
// ---------------------------------------------------------------------------

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    data: {
      status: 'ok',
      service: 'rate-limit-monitoring',
      timestamp: new Date().toISOString(),
    },
    meta: { timestamp: Date.now() },
  });
});

// GET /api/monitor/rate-limits — current usage for all endpoints
app.get('/api/monitor/rate-limits', (req, res) => {
  try {
    const usage = rateLimitTracker.getAllUsage();
    res.json({
      data: { endpoints: usage },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get rate limits', code: 500, details: error.message },
    });
  }
});

// GET /api/monitor/rate-limits/alerts — alert history (MUST be before :endpoint route)
app.get('/api/monitor/rate-limits/alerts', (req, res) => {
  try {
    const { endpoint } = req.query;
    const alerts = rateLimitAlerting.getAlerts(endpoint);
    res.json({
      data: { alerts, total: alerts.length },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get alerts', code: 500, details: error.message },
    });
  }
});

// POST /api/monitor/rate-limits/alerts/:id/acknowledge — acknowledge alert
app.post('/api/monitor/rate-limits/alerts/:id/acknowledge', (req, res) => {
  try {
    const { id } = req.params;
    const result = rateLimitAlerting.acknowledgeAlert(id);
    if (!result) {
      return res.status(404).json({
        error: { message: `Alert not found: ${id}`, code: 404 },
      });
    }
    res.json({
      data: { alertId: id, acknowledged: true, acknowledgedAt: new Date().toISOString() },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to acknowledge alert', code: 500, details: error.message },
    });
  }
});

// GET /api/monitor/rate-limits/queue — queued requests status (MUST be before :endpoint route)
app.get('/api/monitor/rate-limits/queue', (req, res) => {
  try {
    const items = rateLimitQueue.getQueuedItems();
    const stats = rateLimitQueue.getStats();
    res.json({
      data: { items, stats },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get queue', code: 500, details: error.message },
    });
  }
});

// POST /api/monitor/rate-limits/record — record an API call
app.post('/api/monitor/rate-limits/record', (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(400).json({
        error: { message: 'endpoint is required', code: 400 },
      });
    }
    rateLimitTracker.recordApiCall(endpoint);
    const usage = rateLimitTracker.getCurrentUsage(endpoint);
    res.json({
      data: {
        endpoint,
        currentCount: usage.currentCount,
        limit: usage.limit,
        percentage: usage.percentage,
      },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to record API call', code: 500, details: error.message },
    });
  }
});

// GET /api/monitor/rate-limits/:endpoint — usage for specific endpoint
app.get('/api/monitor/rate-limits/:endpoint', (req, res) => {
  try {
    const { endpoint } = req.params;
    const knownEndpoints = new Set([
      ...Object.keys(rateLimitTracker.limits),
      ...Object.keys(rateLimitTracker._counters),
    ]);
    if (!knownEndpoints.has(endpoint)) {
      return res.status(404).json({
        error: { message: `Unknown endpoint: ${endpoint}`, code: 404 },
      });
    }
    const usage = rateLimitTracker.getCurrentUsage(endpoint);
    res.json({
      data: usage,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get endpoint usage', code: 500, details: error.message },
    });
  }
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: { message: 'Internal server error', code: 500 },
  });
});

// Start server only if not in test mode
const PORT = process.env.PORT || 3007;
if (process.env.MOCHA_TEST_MODE !== 'true') {
  app.listen(PORT, () => {
    console.log(`Rate Limit Monitoring service running on port ${PORT}`);
  });
}

module.exports = {
  app,
  RateLimitTracker,
  RateLimitAlerting,
  RateLimitQueue,
  rateLimitTracker,
  rateLimitAlerting,
  rateLimitQueue,
};
