require('dotenv').config();
const express = require('express');
const { EventEmitter } = require('events');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// UptimeMonitor — 24/7 uptime tracking
// ---------------------------------------------------------------------------
class UptimeMonitor {
  constructor(options = {}) {
    this.events = [];
    this._sessionStart = new Date().toISOString();
    this.windowSizeMs = options.windowSizeMs
      || (parseInt(process.env.UPTIME_WINDOW_HOURS, 10) || 24) * 60 * 60 * 1000;
  }

  recordUptime(durationMs) {
    this.events.push({ type: 'uptime', timestamp: new Date().toISOString(), duration: durationMs });
  }

  recordDowntime(durationMs) {
    this.events.push({ type: 'downtime', timestamp: new Date().toISOString(), duration: durationMs });
  }

  _getWindowedEvents() {
    const cutoff = Date.now() - this.windowSizeMs;
    return this.events.filter(e => new Date(e.timestamp).getTime() >= cutoff);
  }

  getUptimePercentage() {
    const relevant = this._getWindowedEvents();
    if (relevant.length === 0) return 100;
    const totalUptime = relevant.filter(e => e.type === 'uptime').reduce((s, e) => s + e.duration, 0);
    const totalDowntime = relevant.filter(e => e.type === 'downtime').reduce((s, e) => s + e.duration, 0);
    const total = totalUptime + totalDowntime;
    if (total === 0) return 100;
    return (totalUptime / total) * 100;
  }

  getHealthStatus() {
    const pct = this.getUptimePercentage();
    if (pct >= 99.5) return 'green';
    if (pct >= 99.0) return 'yellow';
    return 'red';
  }

  getSessionUptime() {
    const diff = Date.now() - new Date(this._sessionStart).getTime();
    const totalSec = Math.floor(diff / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h}h ${m}m ${s}s`;
  }
}

// ---------------------------------------------------------------------------
// ErrorRateTracker — per-endpoint error rate and response time tracking
// ---------------------------------------------------------------------------
class ErrorRateTracker extends EventEmitter {
  constructor(options = {}) {
    super();
    this.windowSizeMs = options.windowSizeMs
      || (parseInt(process.env.ERROR_RATE_WINDOW_HOURS, 10) || 24) * 60 * 60 * 1000;
    this._records = {}; // endpoint -> { timestamps: [], latencies: [], errors: [] }
  }

  _initEndpoint(endpoint) {
    if (!this._records[endpoint]) {
      this._records[endpoint] = { timestamps: [], latencies: [], errors: [] };
    }
  }

  _getWindowed(endpoint) {
    const rec = this._records[endpoint];
    if (!rec) return null;
    const cutoff = Date.now() - this.windowSizeMs;
    const result = { timestamps: [], latencies: [], errors: [] };
    for (let i = 0; i < rec.timestamps.length; i++) {
      if (rec.timestamps[i] >= cutoff) {
        result.timestamps.push(rec.timestamps[i]);
        result.latencies.push(rec.latencies[i]);
        result.errors.push(rec.errors[i]);
      }
    }
    return result;
  }

  recordSuccess(endpoint, latencyMs) {
    this._initEndpoint(endpoint);
    this._records[endpoint].timestamps.push(Date.now());
    this._records[endpoint].latencies.push(latencyMs);
    this._records[endpoint].errors.push(false);
    this.emit('request:recorded', { endpoint, latencyMs, success: true });
  }

  recordError(endpoint, latencyMs) {
    this._initEndpoint(endpoint);
    this._records[endpoint].timestamps.push(Date.now());
    this._records[endpoint].latencies.push(latencyMs);
    this._records[endpoint].errors.push(true);
    this.emit('request:recorded', { endpoint, latencyMs, success: false });
  }

  getTotalRequests(endpoint) {
    const rec = this._getWindowed(endpoint);
    if (!rec) return 0;
    return rec.timestamps.length;
  }

  getErrorRate(endpoint) {
    const rec = this._getWindowed(endpoint);
    if (!rec || rec.timestamps.length === 0) return 0;
    const errorCount = rec.errors.filter(e => e).length;
    return (errorCount / rec.timestamps.length) * 100;
  }

  getResponseTimePercentiles(endpoint) {
    const rec = this._getWindowed(endpoint);
    if (!rec || rec.latencies.length === 0) {
      return { p50: 0, p95: 0, p99: 0 };
    }
    const sorted = [...rec.latencies].sort((a, b) => a - b);
    const len = sorted.length;
    return {
      p50: sorted[Math.max(0, Math.ceil(0.50 * len) - 1)],
      p95: sorted[Math.max(0, Math.ceil(0.95 * len) - 1)],
      p99: sorted[Math.max(0, Math.ceil(0.99 * len) - 1)],
    };
  }

  getAllErrorRates() {
    const result = {};
    for (const ep of Object.keys(this._records)) {
      const rec = this._getWindowed(ep);
      if (!rec) continue;
      const total = rec.timestamps.length;
      const errorCount = rec.errors.filter(e => e).length;
      result[ep] = {
        errorRate: total > 0 ? (errorCount / total) * 100 : 0,
        totalRequests: total,
        errors: errorCount,
      };
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// ErrorAlerting — threshold monitoring with cooldown
// ---------------------------------------------------------------------------
class ErrorAlerting extends EventEmitter {
  constructor(options = {}) {
    super();
    this.errorThreshold = options.errorThreshold !== undefined
      ? options.errorThreshold
      : parseFloat(process.env.ERROR_ALERT_THRESHOLD) || 5;
    this.cooldownMs = options.cooldownMs
      || parseInt(process.env.ERROR_ALERT_COOLDOWN_MS, 10) || 300000;
    this._alerts = [];
    this._lastAlertTime = {};
    this._alertCounter = 0;
  }

  checkThreshold(endpoint, data) {
    if (data.errorRate < this.errorThreshold) return;

    const now = Date.now();
    const lastTime = this._lastAlertTime[endpoint];
    if (lastTime && (now - lastTime) < this.cooldownMs) return;

    this._lastAlertTime[endpoint] = now;
    this._alertCounter++;

    const alert = {
      id: `alert-${now}-${this._alertCounter}`,
      endpoint,
      errorRate: data.errorRate,
      threshold: this.errorThreshold,
      totalRequests: data.totalRequests,
      errors: data.errors,
      timestamp: new Date().toISOString(),
      acknowledged: false,
      acknowledgedAt: null,
    };
    this._alerts.push(alert);
    this.emit('error:alert', alert);
  }

  acknowledgeAlert(alertId) {
    const alert = this._alerts.find(a => a.id === alertId);
    if (!alert) return false;
    alert.acknowledged = true;
    alert.acknowledgedAt = new Date().toISOString();
    return true;
  }

  getAlerts(endpoint) {
    let filtered = this._alerts;
    if (endpoint) {
      filtered = filtered.filter(a => a.endpoint === endpoint);
    }
    return [...filtered].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }
}

// ---------------------------------------------------------------------------
// DashboardService — aggregates uptime, error rates, and alerts
// ---------------------------------------------------------------------------
class DashboardService {
  constructor(uptimeMonitor, errorRateTracker, errorAlerting, options = {}) {
    this.uptimeMonitor = uptimeMonitor;
    this.errorTracker = errorRateTracker;
    this.errorAlerting = errorAlerting;
    this.activeSessions = options.activeSessions !== undefined
      ? options.activeSessions
      : parseInt(process.env.ACTIVE_SESSIONS, 10) || 3;
  }

  getDashboard() {
    const uptime = {
      percentage24h: this.uptimeMonitor.getUptimePercentage(),
      healthStatus: this.uptimeMonitor.getHealthStatus(),
      sessionStart: this.uptimeMonitor._sessionStart,
      totalEvents: this.uptimeMonitor.events.length,
      uptimeEvents: this.uptimeMonitor.events.filter(e => e.type === 'uptime').length,
      downtimeEvents: this.uptimeMonitor.events.filter(e => e.type === 'downtime').length,
    };

    const errorRates = this.errorTracker.getAllErrorRates();

    const responseTimes = {};
    for (const ep of Object.keys(this.errorTracker._records || {})) {
      responseTimes[ep] = this.errorTracker.getResponseTimePercentiles(ep);
    }

    const allAlerts = this.errorAlerting.getAlerts();
    const activeAlerts = allAlerts.filter(a => !a.acknowledged);

    return {
      uptime,
      errorRates,
      responseTimes,
      alerts: {
        active: activeAlerts,
        total: allAlerts.length,
      },
      activeSessions: this.activeSessions,
    };
  }
}

// ---------------------------------------------------------------------------
// Module-level instances
// ---------------------------------------------------------------------------
const uptimeMonitor = new UptimeMonitor();
const errorRateTracker = new ErrorRateTracker();
const errorAlerting = new ErrorAlerting();
const dashboardService = new DashboardService(uptimeMonitor, errorRateTracker, errorAlerting);

// ---------------------------------------------------------------------------
// Express API Routes
// ---------------------------------------------------------------------------

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    data: {
      status: 'ok',
      service: 'uptime-error-monitoring-dashboard',
      timestamp: new Date().toISOString(),
    },
    meta: { timestamp: Date.now() },
  });
});

// GET /api/monitor/dashboard — complete dashboard view
app.get('/api/monitor/dashboard', (req, res) => {
  try {
    const dashboard = dashboardService.getDashboard();
    res.json({
      data: dashboard,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get dashboard', code: 500, details: error.message },
    });
  }
});

// GET /api/monitor/uptime — uptime status and history
app.get('/api/monitor/uptime', (req, res) => {
  try {
    res.json({
      data: {
        percentage24h: uptimeMonitor.getUptimePercentage(),
        healthStatus: uptimeMonitor.getHealthStatus(),
        sessionStart: uptimeMonitor._sessionStart,
        totalEvents: uptimeMonitor.events.length,
        uptimeEvents: uptimeMonitor.events.filter(e => e.type === 'uptime').length,
        downtimeEvents: uptimeMonitor.events.filter(e => e.type === 'downtime').length,
      },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get uptime', code: 500, details: error.message },
    });
  }
});

// GET /api/monitor/errors — error rates for all endpoints
app.get('/api/monitor/errors', (req, res) => {
  try {
    const rates = errorRateTracker.getAllErrorRates();
    res.json({
      data: { endpoints: rates },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get error rates', code: 500, details: error.message },
    });
  }
});

// GET /api/monitor/errors/alerts — alert history (MUST be before :endpoint route)
app.get('/api/monitor/errors/alerts', (req, res) => {
  try {
    const alerts = errorAlerting.getAlerts();
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

// POST /api/monitor/errors/alerts/:id/acknowledge — acknowledge an alert
app.post('/api/monitor/errors/alerts/:id/acknowledge', (req, res) => {
  try {
    const { id } = req.params;
    const result = errorAlerting.acknowledgeAlert(id);
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

// GET /api/monitor/errors/:endpoint — error rate for specific endpoint
app.get('/api/monitor/errors/:endpoint', (req, res) => {
  try {
    const { endpoint } = req.params;
    const knownEndpoints = Object.keys(errorRateTracker._records || {});
    if (!knownEndpoints.includes(endpoint)) {
      return res.status(404).json({
        error: { message: `Unknown endpoint: ${endpoint}`, code: 404 },
      });
    }
    res.json({
      data: {
        endpoint,
        errorRate: errorRateTracker.getErrorRate(endpoint),
        totalRequests: errorRateTracker.getTotalRequests(endpoint),
        errors: errorRateTracker.getAllErrorRates()[endpoint]?.errors || 0,
      },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get endpoint error rate', code: 500, details: error.message },
    });
  }
});

// POST /api/monitor/events/uptime — record an uptime event
app.post('/api/monitor/events/uptime', (req, res) => {
  try {
    const { durationMs } = req.body;
    if (durationMs === undefined || durationMs === null) {
      return res.status(400).json({
        error: { message: 'durationMs is required', code: 400 },
      });
    }
    uptimeMonitor.recordUptime(durationMs);
    res.json({
      data: { recorded: true, durationMs, type: 'uptime' },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to record uptime event', code: 500, details: error.message },
    });
  }
});

// POST /api/monitor/events/downtime — record a downtime event
app.post('/api/monitor/events/downtime', (req, res) => {
  try {
    const { durationMs } = req.body;
    if (durationMs === undefined || durationMs === null) {
      return res.status(400).json({
        error: { message: 'durationMs is required', code: 400 },
      });
    }
    uptimeMonitor.recordDowntime(durationMs);
    res.json({
      data: { recorded: true, durationMs, type: 'downtime' },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to record downtime event', code: 500, details: error.message },
    });
  }
});

// POST /api/monitor/events/request — record a request with latency and success/failure
app.post('/api/monitor/events/request', (req, res) => {
  try {
    const { endpoint, latencyMs, success } = req.body;
    if (!endpoint) {
      return res.status(400).json({
        error: { message: 'endpoint is required', code: 400 },
      });
    }
    if (success) {
      errorRateTracker.recordSuccess(endpoint, latencyMs || 0);
    } else {
      errorRateTracker.recordError(endpoint, latencyMs || 0);
    }
    res.json({
      data: { endpoint, success, latencyMs: latencyMs || 0 },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to record request', code: 500, details: error.message },
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
const PORT = process.env.PORT || 3008;
if (process.env.MOCHA_TEST_MODE !== 'true') {
  app.listen(PORT, () => {
    console.log(`Uptime & Error Monitoring Dashboard running on port ${PORT}`);
  });
}

module.exports = {
  app,
  UptimeMonitor,
  ErrorRateTracker,
  ErrorAlerting,
  DashboardService,
  uptimeMonitor,
  errorRateTracker,
  errorAlerting,
  dashboardService,
};
