require('dotenv').config();
const express = require('express');
const https = require('https');
const http = require('http');
const { EventEmitter } = require('events');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// HealthCheckService — pings WhatsApp API endpoint at configured intervals
// ---------------------------------------------------------------------------
class HealthCheckService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.checkIntervalMs = options.checkIntervalMs || parseInt(process.env.HEALTH_CHECK_INTERVAL_MS, 10) || 30000;
    this.apiEndpoint = options.apiEndpoint || process.env.WHATSAPP_API_ENDPOINT || 'https://graph.facebook.com/v22.0';
    this.timeoutMs = options.timeoutMs || parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS, 10) || 10000;
    this.consecutiveFailures = 0;
    this.lastCheckTime = null;
    this.lastLatencyMs = null;
    this.isHealthy = true;
    this._timer = null;
    this._running = false;
    this.uptimeSince = null;
    this.totalChecks = 0;
    this.totalFailures = 0;
    this._makeRequest = options.makeRequest || this._defaultMakeRequest.bind(this);
  }

  async pingApi() {
    const startTime = Date.now();
    try {
      const result = await this._makeRequest(this.apiEndpoint, this.timeoutMs);
      return this._processResult(result, startTime);
    } catch (error) {
      return this._processError(error.message, startTime);
    }
  }

  _processResult(result, startTime) {
    const latencyMs = Date.now() - startTime;
    this.lastCheckTime = new Date().toISOString();
    this.lastLatencyMs = latencyMs;
    this.totalChecks++;

    if (result.success) {
      const wasUnhealthy = !this.isHealthy;
      this.consecutiveFailures = 0;
      this.isHealthy = true;
      if (!this.uptimeSince) this.uptimeSince = new Date().toISOString();
      if (wasUnhealthy) {
        this.emit('health:changed', { isHealthy: true, consecutiveFailures: 0, latencyMs });
      }
      return { success: true, latencyMs, statusCode: result.statusCode };
    }

    this.consecutiveFailures++;
    this.totalFailures++;
    const wasHealthy = this.isHealthy;
    this.isHealthy = false;
    if (wasHealthy) {
      this.emit('health:changed', {
        isHealthy: false, consecutiveFailures: this.consecutiveFailures, latencyMs, error: result.error,
      });
    }
    return { success: false, latencyMs, error: result.error, statusCode: result.statusCode };
  }

  _processError(errorMessage, startTime) {
    const latencyMs = Date.now() - startTime;
    this.lastCheckTime = new Date().toISOString();
    this.lastLatencyMs = latencyMs;
    this.consecutiveFailures++;
    this.totalFailures++;
    this.totalChecks++;
    const wasHealthy = this.isHealthy;
    this.isHealthy = false;
    if (wasHealthy) {
      this.emit('health:changed', {
        isHealthy: false, consecutiveFailures: this.consecutiveFailures, latencyMs, error: errorMessage,
      });
    }
    return { success: false, latencyMs, error: errorMessage };
  }

  async _defaultMakeRequest(url, timeout) {
    return new Promise((resolve) => {
      const protocol = url.startsWith('https') ? https : http;
      const req = protocol.get(url, { timeout }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({ success: res.statusCode >= 200 && res.statusCode < 400, statusCode: res.statusCode, data });
        });
      });
      req.on('error', (err) => {
        resolve({ success: false, error: err.message, statusCode: null });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Request timeout', statusCode: null });
      });
    });
  }

  startMonitoring() {
    if (this._running) return;
    this._running = true;
    this.uptimeSince = new Date().toISOString();
    this.pingApi().catch(() => {});
    this._timer = setInterval(() => {
      this.pingApi().catch(() => {});
    }, this.checkIntervalMs);
  }

  stopMonitoring() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  getStatus() {
    return {
      isHealthy: this.isHealthy,
      consecutiveFailures: this.consecutiveFailures,
      lastCheckTime: this.lastCheckTime,
      lastLatencyMs: this.lastLatencyMs,
      uptimeSince: this.uptimeSince,
      totalChecks: this.totalChecks,
      totalFailures: this.totalFailures,
    };
  }
}

// ---------------------------------------------------------------------------
// DowntimeDetector — state machine for downtime detection and recovery
// ---------------------------------------------------------------------------
class DowntimeDetector extends EventEmitter {
  constructor(options = {}) {
    super();
    this.downtimeThreshold = options.downtimeThreshold || parseInt(process.env.DOWNTIME_THRESHOLD, 10) || 3;
    this.recoveryThreshold = options.recoveryThreshold || parseInt(process.env.RECOVERY_THRESHOLD, 10) || 2;
    this.state = 'NORMAL'; // NORMAL | FALLBACK | RECOVERING
    this.fallbackTriggeredAt = null;
    this.lastStateChange = null;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
  }

  onHealthChange(healthStatus) {
    const { isHealthy } = healthStatus;

    if (isHealthy) {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses++;

      if (this.state === 'FALLBACK') {
        if (this.consecutiveSuccesses >= this.recoveryThreshold) {
          this.state = 'NORMAL';
          this.lastStateChange = new Date().toISOString();
          this.emit('downtime:recovered', {
            previousState: 'FALLBACK', newState: 'NORMAL', consecutiveSuccesses: this.consecutiveSuccesses,
          });
        } else {
          this.state = 'RECOVERING';
          this.lastStateChange = new Date().toISOString();
        }
      } else if (this.state === 'RECOVERING' && this.consecutiveSuccesses >= this.recoveryThreshold) {
        this.state = 'NORMAL';
        this.lastStateChange = new Date().toISOString();
        this.emit('downtime:recovered', {
          previousState: 'RECOVERING', newState: 'NORMAL', consecutiveSuccesses: this.consecutiveSuccesses,
        });
      }
    } else {
      this.consecutiveSuccesses = 0;
      this.consecutiveFailures++;

      if (this.state === 'NORMAL' && this.consecutiveFailures >= this.downtimeThreshold) {
        this.state = 'FALLBACK';
        this.fallbackTriggeredAt = new Date().toISOString();
        this.lastStateChange = new Date().toISOString();
        this.emit('downtime:detected', {
          previousState: 'NORMAL', newState: 'FALLBACK', consecutiveFailures: this.consecutiveFailures,
        });
      } else if (this.state === 'RECOVERING') {
        this.state = 'FALLBACK';
        this.fallbackTriggeredAt = new Date().toISOString();
        this.lastStateChange = new Date().toISOString();
        this.emit('downtime:detected', {
          previousState: 'RECOVERING', newState: 'FALLBACK', consecutiveFailures: this.consecutiveFailures,
        });
      }
    }
  }

  getState() {
    return {
      state: this.state,
      fallbackTriggeredAt: this.fallbackTriggeredAt,
      lastStateChange: this.lastStateChange,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      downtimeThreshold: this.downtimeThreshold,
      recoveryThreshold: this.recoveryThreshold,
    };
  }

  forceFallback() {
    const previousState = this.state;
    this.state = 'FALLBACK';
    this.fallbackTriggeredAt = new Date().toISOString();
    this.lastStateChange = new Date().toISOString();
    this.emit('downtime:detected', {
      previousState, newState: 'FALLBACK', source: 'manual',
    });
  }

  forceReset() {
    const previousState = this.state;
    this.state = 'NORMAL';
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastStateChange = new Date().toISOString();
    this.emit('downtime:recovered', {
      previousState, newState: 'NORMAL', source: 'manual',
    });
  }
}

// ---------------------------------------------------------------------------
// FallbackManager — manages fallback state and responses
// ---------------------------------------------------------------------------
class FallbackManager {
  constructor(options = {}) {
    this.fallbackFormUrl = options.fallbackFormUrl !== undefined
      ? options.fallbackFormUrl
      : (process.env.FALLBACK_FORM_URL || '');
    const template = options.fallbackMessage !== undefined
      ? options.fallbackMessage
      : (process.env.FALLBACK_MESSAGE_TEMPLATE || 'Our WhatsApp service is temporarily unavailable. Please fill out this form: {formUrl}');
    this.fallbackMessage = template.replace('{formUrl}', this.fallbackFormUrl);
    this.isActive = false;
    this.activatedAt = null;
    this.deactivatedAt = null;
    this.totalFallbackResponses = 0;
    this.eventLog = [];
  }

  getFallbackResponse() {
    this.totalFallbackResponses++;
    return {
      message: this.fallbackMessage,
      formUrl: this.fallbackFormUrl,
      timestamp: new Date().toISOString(),
    };
  }

  activate(source = 'auto') {
    if (this.isActive) return;
    this.isActive = true;
    this.activatedAt = new Date().toISOString();
    this._logEvent('triggered', source);
  }

  deactivate(source = 'auto') {
    if (!this.isActive) return;
    this.isActive = false;
    this.deactivatedAt = new Date().toISOString();
    this._logEvent('resolved', source);
  }

  _logEvent(event, source) {
    this.eventLog.push({
      id: `fl-ev-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      event,
      source,
      previousState: event === 'triggered' ? 'NORMAL' : 'FALLBACK',
      newState: event === 'triggered' ? 'FALLBACK' : 'NORMAL',
      timestamp: new Date().toISOString(),
    });
  }

  forceTrigger() {
    this.activate('manual');
  }

  forceReset() {
    this.deactivate('manual');
  }

  getStatus() {
    return {
      isActive: this.isActive,
      activatedAt: this.activatedAt,
      deactivatedAt: this.deactivatedAt,
      fallbackFormUrl: this.fallbackFormUrl,
      fallbackMessage: this.fallbackMessage,
      totalFallbackResponses: this.totalFallbackResponses,
      eventLogCount: this.eventLog.length,
    };
  }

  getEventLog() {
    return [...this.eventLog].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }
}

// ---------------------------------------------------------------------------
// MessageQueue — buffers incoming messages during fallback
// ---------------------------------------------------------------------------
class MessageQueue {
  constructor() {
    this.queue = [];
    this.enqueueCount = 0;
  }

  enqueue(message) {
    const entry = {
      id: `msg-${Date.now()}-${this.enqueueCount}`,
      phoneNumber: message.phoneNumber,
      message: message.message,
      direction: message.direction || 'incoming',
      timestamp: new Date().toISOString(),
    };
    this.queue.push(entry);
    this.enqueueCount++;
    return entry;
  }

  getQueuedMessages() {
    return [...this.queue];
  }

  clear() {
    this.queue = [];
  }

  getStats() {
    const timestamps = this.queue.map(m => new Date(m.timestamp).getTime()).filter(t => !isNaN(t));
    return {
      depth: this.queue.length,
      oldestTimestamp: timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : null,
      newestTimestamp: timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null,
      totalEnqueued: this.enqueueCount,
    };
  }
}

// ---------------------------------------------------------------------------
// Module-level instances and wiring
// ---------------------------------------------------------------------------
const healthCheckService = new HealthCheckService();
const downtimeDetector = new DowntimeDetector();
const fallbackManager = new FallbackManager();
const messageQueue = new MessageQueue();

// Wire HealthCheckService → DowntimeDetector
healthCheckService.on('health:changed', (status) => {
  downtimeDetector.onHealthChange(status);
});

// Wire DowntimeDetector → FallbackManager
downtimeDetector.on('downtime:detected', () => {
  fallbackManager.activate('auto');
});

downtimeDetector.on('downtime:recovered', () => {
  fallbackManager.deactivate('auto');
});

// ---------------------------------------------------------------------------
// Express API Routes
// ---------------------------------------------------------------------------

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    data: {
      status: 'ok',
      service: 'api-downtime-detection-fallback',
      timestamp: new Date().toISOString(),
    },
    meta: { timestamp: Date.now() },
  });
});

// GET /api/monitor/health — current health status
app.get('/api/monitor/health', (req, res) => {
  try {
    const status = healthCheckService.getStatus();
    res.json({
      data: {
        isHealthy: status.isHealthy,
        consecutiveFailures: status.consecutiveFailures,
        lastCheckTime: status.lastCheckTime,
        lastLatencyMs: status.lastLatencyMs,
        uptimeSince: status.uptimeSince,
        totalChecks: status.totalChecks,
        totalFailures: status.totalFailures,
      },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get health status', code: 500, details: error.message },
    });
  }
});

// GET /api/monitor/fallback/status — current fallback state
app.get('/api/monitor/fallback/status', (req, res) => {
  try {
    const detectorState = downtimeDetector.getState();
    const fbStatus = fallbackManager.getStatus();

    res.json({
      data: {
        state: detectorState.state,
        isActive: fbStatus.isActive,
        fallbackTriggeredAt: detectorState.fallbackTriggeredAt,
        lastStateChange: detectorState.lastStateChange,
        fallbackFormUrl: fbStatus.fallbackFormUrl,
        fallbackMessage: fbStatus.fallbackMessage,
        totalFallbackResponses: fbStatus.totalFallbackResponses,
        consecutiveFailures: detectorState.consecutiveFailures,
        consecutiveSuccesses: detectorState.consecutiveSuccesses,
      },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get fallback status', code: 500, details: error.message },
    });
  }
});

// POST /api/monitor/fallback/trigger — manually trigger fallback
app.post('/api/monitor/fallback/trigger', (req, res) => {
  try {
    const currentState = downtimeDetector.getState().state;
    if (currentState === 'FALLBACK') {
      return res.status(409).json({
        error: { message: 'Fallback is already active', code: 409 },
      });
    }

    downtimeDetector.forceFallback();
    fallbackManager.activate('manual');

    res.json({
      data: {
        message: 'Fallback manually triggered',
        state: 'FALLBACK',
        timestamp: new Date().toISOString(),
      },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to trigger fallback', code: 500, details: error.message },
    });
  }
});

// POST /api/monitor/fallback/reset — manually reset to normal mode
app.post('/api/monitor/fallback/reset', (req, res) => {
  try {
    const currentState = downtimeDetector.getState().state;
    if (currentState === 'NORMAL') {
      return res.status(409).json({
        error: { message: 'System is already in normal mode', code: 409 },
      });
    }

    downtimeDetector.forceReset();
    fallbackManager.deactivate('manual');

    res.json({
      data: {
        message: 'Fallback manually reset',
        state: 'NORMAL',
        timestamp: new Date().toISOString(),
      },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to reset fallback', code: 500, details: error.message },
    });
  }
});

// GET /api/monitor/fallback/queue — view queued messages
app.get('/api/monitor/fallback/queue', (req, res) => {
  try {
    const messages = messageQueue.getQueuedMessages();
    const stats = messageQueue.getStats();

    res.json({
      data: {
        messages,
        total: messages.length,
        stats,
      },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get queued messages', code: 500, details: error.message },
    });
  }
});

// GET /api/monitor/fallback/log — view fallback event history
app.get('/api/monitor/fallback/log', (req, res) => {
  try {
    const events = fallbackManager.getEventLog();

    res.json({
      data: {
        events,
        total: events.length,
      },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get fallback event log', code: 500, details: error.message },
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
const PORT = process.env.PORT || 3023;
if (process.env.MOCHA_TEST_MODE !== 'true') {
  app.listen(PORT, () => {
    console.log(`API Downtime Detection & Fallback service running on port ${PORT}`);
  });
}

module.exports = {
  app,
  HealthCheckService,
  DowntimeDetector,
  FallbackManager,
  MessageQueue,
  healthCheckService,
  downtimeDetector,
  fallbackManager,
  messageQueue,
};
