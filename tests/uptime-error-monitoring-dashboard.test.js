process.env.MOCHA_TEST_MODE = 'true';
process.env.UPTIME_WINDOW_HOURS = '24';
process.env.ERROR_RATE_WINDOW_HOURS = '24';
process.env.ERROR_ALERT_THRESHOLD = '5';
process.env.ERROR_ALERT_COOLDOWN_MS = '300000';
process.env.ACTIVE_SESSIONS = '3';

const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');

const {
  app,
  UptimeMonitor,
  ErrorRateTracker,
  ErrorAlerting,
  DashboardService,
  uptimeMonitor,
  errorRateTracker,
  errorAlerting,
  dashboardService,
} = require('../src/6-3-uptime-error-monitoring-dashboard');

// ---------------------------------------------------------------------------
// UptimeMonitor
// ---------------------------------------------------------------------------
describe('UptimeMonitor', () => {
  describe('recordUptime / recordDowntime', () => {
    it('should record uptime events', () => {
      const monitor = new UptimeMonitor({ windowSizeMs: 86400000 });
      monitor.recordUptime(3600000); // 1 hour
      expect(monitor.events.length).to.equal(1);
      expect(monitor.events[0].type).to.equal('uptime');
    });

    it('should record downtime events', () => {
      const monitor = new UptimeMonitor({ windowSizeMs: 86400000 });
      monitor.recordDowntime(60000); // 1 minute
      expect(monitor.events.length).to.equal(1);
      expect(monitor.events[0].type).to.equal('downtime');
    });

    it('should assign timestamps to each event', () => {
      const monitor = new UptimeMonitor({ windowSizeMs: 86400000 });
      monitor.recordUptime(1000);
      expect(monitor.events[0].timestamp).to.not.be.null;
    });
  });

  describe('getUptimePercentage', () => {
    it('should return 100% with no downtime', () => {
      const monitor = new UptimeMonitor({ windowSizeMs: 86400000 });
      monitor.recordUptime(3600000);
      monitor.recordUptime(3600000);
      expect(monitor.getUptimePercentage()).to.equal(100);
    });

    it('should calculate correct uptime percentage', () => {
      const monitor = new UptimeMonitor({ windowSizeMs: 86400000 });
      monitor.recordUptime(99000); // 99s uptime
      monitor.recordDowntime(1000); // 1s downtime
      expect(monitor.getUptimePercentage()).to.equal(99);
    });

    it('should return 100% with zero events (assume healthy)', () => {
      const monitor = new UptimeMonitor({ windowSizeMs: 86400000 });
      expect(monitor.getUptimePercentage()).to.equal(100);
    });

    it('should handle all-downtime scenario', () => {
      const monitor = new UptimeMonitor({ windowSizeMs: 86400000 });
      monitor.recordDowntime(100000);
      expect(monitor.getUptimePercentage()).to.equal(0);
    });
  });

  describe('getHealthStatus', () => {
    it('should return green at 99.5% and above', () => {
      const monitor = new UptimeMonitor({ windowSizeMs: 86400000 });
      monitor.recordUptime(99500);
      monitor.recordDowntime(500);
      expect(monitor.getHealthStatus()).to.equal('green');
    });

    it('should return yellow between 99% and 99.5%', () => {
      const monitor = new UptimeMonitor({ windowSizeMs: 86400000 });
      monitor.recordUptime(99200);
      monitor.recordDowntime(800);
      expect(monitor.getHealthStatus()).to.equal('yellow');
    });

    it('should return red below 99%', () => {
      const monitor = new UptimeMonitor({ windowSizeMs: 86400000 });
      monitor.recordUptime(98000);
      monitor.recordDowntime(2000);
      expect(monitor.getHealthStatus()).to.equal('red');
    });

    it('should return green with no events', () => {
      const monitor = new UptimeMonitor({ windowSizeMs: 86400000 });
      expect(monitor.getHealthStatus()).to.equal('green');
    });
  });

  describe('getSessionUptime', () => {
    it('should return session uptime as a string', () => {
      const monitor = new UptimeMonitor({ windowSizeMs: 86400000 });
      const uptime = monitor.getSessionUptime();
      expect(uptime).to.be.a('string');
    });
  });
});

// ---------------------------------------------------------------------------
// ErrorRateTracker
// ---------------------------------------------------------------------------
describe('ErrorRateTracker', () => {
  describe('recordSuccess / recordError', () => {
    it('should record success events', () => {
      const tracker = new ErrorRateTracker({ windowSizeMs: 86400000 });
      tracker.recordSuccess('whatsapp-api', 100);
      expect(tracker.getTotalRequests('whatsapp-api')).to.equal(1);
      expect(tracker.getErrorRate('whatsapp-api')).to.equal(0);
    });

    it('should record error events', () => {
      const tracker = new ErrorRateTracker({ windowSizeMs: 86400000 });
      tracker.recordError('whatsapp-api', 100);
      expect(tracker.getTotalRequests('whatsapp-api')).to.equal(1);
      expect(tracker.getErrorRate('whatsapp-api')).to.equal(100);
    });

    it('should handle multiple endpoints independently', () => {
      const tracker = new ErrorRateTracker({ windowSizeMs: 86400000 });
      tracker.recordSuccess('whatsapp-api', 100);
      tracker.recordSuccess('erpnext-api', 200);
      tracker.recordError('erpnext-api', 300);

      expect(tracker.getErrorRate('whatsapp-api')).to.equal(0);
      expect(tracker.getErrorRate('erpnext-api')).to.equal(50);
    });
  });

  describe('getErrorRate', () => {
    it('should calculate correct percentage', () => {
      const tracker = new ErrorRateTracker({ windowSizeMs: 86400000 });
      tracker.recordSuccess('test', 100);
      tracker.recordSuccess('test', 100);
      tracker.recordSuccess('test', 100);
      tracker.recordError('test', 100);
      expect(tracker.getErrorRate('test')).to.equal(25);
    });

    it('should return 0 for unknown endpoint', () => {
      const tracker = new ErrorRateTracker({ windowSizeMs: 86400000 });
      expect(tracker.getErrorRate('nonexistent')).to.equal(0);
    });

    it('should handle zero requests (division by zero)', () => {
      const tracker = new ErrorRateTracker({ windowSizeMs: 86400000 });
      tracker.recordSuccess('test', 100);
      expect(tracker.getErrorRate('test')).to.equal(0);
    });
  });

  describe('getResponseTimePercentiles', () => {
    it('should compute correct P50, P95, P99', () => {
      const tracker = new ErrorRateTracker({ windowSizeMs: 86400000 });
      // Add 100 requests with latencies 1..100
      for (let i = 1; i <= 100; i++) {
        tracker.recordSuccess('test', i);
      }
      const p = tracker.getResponseTimePercentiles('test');
      expect(p.p50).to.equal(50); // median
      expect(p.p95).to.equal(95); // 95th percentile
      expect(p.p99).to.equal(99); // 99th percentile
    });

    it('should return zeros for endpoint with no data', () => {
      const tracker = new ErrorRateTracker({ windowSizeMs: 86400000 });
      const p = tracker.getResponseTimePercentiles('nonexistent');
      expect(p.p50).to.equal(0);
      expect(p.p95).to.equal(0);
      expect(p.p99).to.equal(0);
    });

    it('should handle single data point', () => {
      const tracker = new ErrorRateTracker({ windowSizeMs: 86400000 });
      tracker.recordSuccess('test', 42);
      const p = tracker.getResponseTimePercentiles('test');
      expect(p.p50).to.equal(42);
      expect(p.p95).to.equal(42);
      expect(p.p99).to.equal(42);
    });
  });

  describe('getAllErrorRates', () => {
    it('should return error rates for all tracked endpoints', () => {
      const tracker = new ErrorRateTracker({ windowSizeMs: 86400000 });
      tracker.recordSuccess('a', 100);
      tracker.recordError('b', 100);
      tracker.recordError('c', 100);

      const rates = tracker.getAllErrorRates();
      expect(rates).to.have.property('a');
      expect(rates).to.have.property('b');
      expect(rates).to.have.property('c');
      expect(rates.a.errorRate).to.equal(0);
      expect(rates.b.errorRate).to.equal(100);
    });
  });
});

// ---------------------------------------------------------------------------
// ErrorAlerting
// ---------------------------------------------------------------------------
describe('ErrorAlerting', () => {
  describe('checkThreshold', () => {
    it('should trigger alert when error rate exceeds 5%', () => {
      const alerting = new ErrorAlerting({ errorThreshold: 5, cooldownMs: 5000 });
      const spy = sinon.spy();
      alerting.on('error:alert', spy);

      alerting.checkThreshold('whatsapp-api', { errorRate: 5.1, totalRequests: 1000, errors: 51 });
      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0].endpoint).to.equal('whatsapp-api');
      expect(spy.firstCall.args[0].errorRate).to.equal(5.1);
    });

    it('should not trigger alert below threshold', () => {
      const alerting = new ErrorAlerting({ errorThreshold: 5, cooldownMs: 5000 });
      const spy = sinon.spy();
      alerting.on('error:alert', spy);

      alerting.checkThreshold('whatsapp-api', { errorRate: 4.9, totalRequests: 1000, errors: 49 });
      expect(spy.notCalled).to.be.true;
    });

    it('should trigger at exact threshold boundary', () => {
      const alerting = new ErrorAlerting({ errorThreshold: 5, cooldownMs: 5000 });
      const spy = sinon.spy();
      alerting.on('error:alert', spy);

      alerting.checkThreshold('whatsapp-api', { errorRate: 5.0, totalRequests: 1000, errors: 50 });
      expect(spy.calledOnce).to.be.true;
    });

    it('should include endpoint, errorRate, threshold, and timestamp in alert', () => {
      const alerting = new ErrorAlerting({ errorThreshold: 5, cooldownMs: 5000 });
      const spy = sinon.spy();
      alerting.on('error:alert', spy);

      alerting.checkThreshold('whatsapp-api', { errorRate: 6.0, totalRequests: 500, errors: 30 });
      const alert = spy.firstCall.args[0];
      expect(alert).to.have.property('endpoint', 'whatsapp-api');
      expect(alert).to.have.property('errorRate', 6.0);
      expect(alert).to.have.property('threshold', 5);
      expect(alert).to.have.property('totalRequests', 500);
      expect(alert).to.have.property('errors', 30);
      expect(alert).to.have.property('timestamp');
      expect(alert).to.have.property('acknowledged', false);
    });
  });

  describe('cooldown', () => {
    it('should not create duplicate alerts within cooldown window', () => {
      const alerting = new ErrorAlerting({ errorThreshold: 5, cooldownMs: 5000 });
      const spy = sinon.spy();
      alerting.on('error:alert', spy);

      alerting.checkThreshold('test', { errorRate: 6, totalRequests: 100, errors: 6 });
      alerting.checkThreshold('test', { errorRate: 7, totalRequests: 100, errors: 7 });
      expect(spy.calledOnce).to.be.true;
    });

    it('should handle different endpoints independently', () => {
      const alerting = new ErrorAlerting({ errorThreshold: 5, cooldownMs: 5000 });
      const spy = sinon.spy();
      alerting.on('error:alert', spy);

      alerting.checkThreshold('ep1', { errorRate: 6, totalRequests: 100, errors: 6 });
      alerting.checkThreshold('ep2', { errorRate: 6, totalRequests: 100, errors: 6 });
      expect(spy.callCount).to.equal(2);
    });

    it('should create new alert after cooldown expires', () => {
      const alerting = new ErrorAlerting({ errorThreshold: 5, cooldownMs: 100 });
      const spy = sinon.spy();
      alerting.on('error:alert', spy);

      alerting.checkThreshold('test', { errorRate: 6, totalRequests: 100, errors: 6 });
      expect(spy.callCount).to.equal(1);

      return new Promise(resolve => setTimeout(resolve, 150)).then(() => {
        alerting.checkThreshold('test', { errorRate: 7, totalRequests: 100, errors: 7 });
        expect(spy.callCount).to.equal(2);
      });
    });
  });

  describe('acknowledgeAlert', () => {
    it('should mark alert as acknowledged', () => {
      const alerting = new ErrorAlerting({ errorThreshold: 5, cooldownMs: 5000 });
      const spy = sinon.spy();
      alerting.on('error:alert', spy);

      alerting.checkThreshold('test', { errorRate: 6, totalRequests: 100, errors: 6 });
      const alert = spy.firstCall.args[0];

      const result = alerting.acknowledgeAlert(alert.id);
      expect(result).to.be.true;
      expect(alerting.getAlerts()[0].acknowledged).to.be.true;
    });

    it('should return false for unknown alert ID', () => {
      const alerting = new ErrorAlerting();
      expect(alerting.acknowledgeAlert('nonexistent')).to.be.false;
    });
  });

  describe('getAlerts', () => {
    it('should return sorted alerts (newest first)', async () => {
      const alerting = new ErrorAlerting({ errorThreshold: 5, cooldownMs: 10 });
      alerting.checkThreshold('ep1', { errorRate: 6, totalRequests: 100, errors: 6 });
      await new Promise(resolve => setTimeout(resolve, 20));
      alerting.checkThreshold('ep2', { errorRate: 6, totalRequests: 100, errors: 6 });

      const alerts = alerting.getAlerts();
      expect(alerts.length).to.equal(2);
      expect(alerts[0].endpoint).to.equal('ep2');
    });
  });
});

// ---------------------------------------------------------------------------
// DashboardService
// ---------------------------------------------------------------------------
describe('DashboardService', () => {
  it('should return dashboard with all expected metrics', () => {
    const monitor = new UptimeMonitor({ windowSizeMs: 86400000 });
    const tracker = new ErrorRateTracker({ windowSizeMs: 86400000 });
    const alerting = new ErrorAlerting({ errorThreshold: 5, cooldownMs: 50000 });
    const dashboard = new DashboardService(monitor, tracker, alerting, { activeSessions: 5 });

    monitor.recordUptime(3600000);
    monitor.recordDowntime(1000);
    tracker.recordSuccess('whatsapp-api', 100);
    tracker.recordError('erpnext-api', 200);

    const data = dashboard.getDashboard();
    expect(data).to.have.property('uptime');
    expect(data.uptime).to.have.property('percentage24h');
    expect(data.uptime).to.have.property('healthStatus');
    expect(data).to.have.property('errorRates');
    expect(data).to.have.property('responseTimes');
    expect(data).to.have.property('alerts');
    expect(data).to.have.property('activeSessions', 5);
  });

  it('should handle empty state (no events)', () => {
    const monitor = new UptimeMonitor({ windowSizeMs: 86400000 });
    const tracker = new ErrorRateTracker({ windowSizeMs: 86400000 });
    const alerting = new ErrorAlerting();
    const dashboard = new DashboardService(monitor, tracker, alerting);

    const data = dashboard.getDashboard();
    expect(data.uptime.percentage24h).to.equal(100);
    expect(data.uptime.healthStatus).to.equal('green');
    expect(data.alerts.total).to.equal(0);
  });

  it('should reflect error rates in dashboard', () => {
    const monitor = new UptimeMonitor({ windowSizeMs: 86400000 });
    const tracker = new ErrorRateTracker({ windowSizeMs: 86400000 });
    const alerting = new ErrorAlerting({ errorThreshold: 5, cooldownMs: 50000 });
    const dashboard = new DashboardService(monitor, tracker, alerting);

    tracker.recordError('whatsapp-api', 100);
    tracker.recordError('whatsapp-api', 100);
    tracker.recordSuccess('whatsapp-api', 100);

    const data = dashboard.getDashboard();
    expect(data.errorRates['whatsapp-api'].errorRate).to.be.closeTo(66.67, 0.1);
  });

  it('should reflect response time percentiles', () => {
    const monitor = new UptimeMonitor({ windowSizeMs: 86400000 });
    const tracker = new ErrorRateTracker({ windowSizeMs: 86400000 });
    const alerting = new ErrorAlerting();
    const dashboard = new DashboardService(monitor, tracker, alerting);

    for (let i = 0; i <= 100; i++) {
      tracker.recordSuccess('test', i);
    }

    const data = dashboard.getDashboard();
    expect(data.responseTimes.test.p50).to.equal(50);
    expect(data.responseTimes.test.p99).to.equal(99);
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------
describe('Integration: Error Alerting Cycle', () => {
  it('should complete full cycle: errors → threshold breached → alert → acknowledge', () => {
    const tracker = new ErrorRateTracker({ windowSizeMs: 86400000 });
    const alerting = new ErrorAlerting({ errorThreshold: 5, cooldownMs: 50000 });

    tracker.on('request:recorded', (data) => {
      const rate = tracker.getErrorRate(data.endpoint);
      if (rate > 0) {
        alerting.checkThreshold(data.endpoint, {
          errorRate: rate, totalRequests: tracker.getTotalRequests(data.endpoint),
          errors: Math.round(rate / 100 * tracker.getTotalRequests(data.endpoint)),
        });
      }
    });

    const alertSpy = sinon.spy();
    alerting.on('error:alert', alertSpy);

    // Record 100 requests with 10 errors (10% error rate > 5%)
    // The alert fires progressively — 5th error triggers threshold at 5/95 ≈ 5.26%
    for (let i = 0; i < 90; i++) {
      tracker.recordSuccess('whatsapp-api', 100);
    }
    for (let i = 0; i < 10; i++) {
      tracker.recordError('whatsapp-api', 100);
    }

    expect(alertSpy.calledOnce).to.be.true;
    // Alert fires at threshold breach point (5th error: 5 / 95 ≈ 5.26%)
    expect(alertSpy.firstCall.args[0].errorRate).to.be.closeTo(5.26, 0.5);

    // Acknowledge the alert
    const result = alerting.acknowledgeAlert(alertSpy.firstCall.args[0].id);
    expect(result).to.be.true;
    expect(alerting.getAlerts()[0].acknowledged).to.be.true;
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('Edge cases', () => {
  it('should handle 100% error rate', () => {
    const tracker = new ErrorRateTracker({ windowSizeMs: 86400000 });
    tracker.recordError('test', 100);
    tracker.recordError('test', 100);
    expect(tracker.getErrorRate('test')).to.equal(100);
  });

  it('should handle rapid alternating success/failure', () => {
    const tracker = new ErrorRateTracker({ windowSizeMs: 86400000 });
    for (let i = 0; i < 100; i++) {
      tracker.recordSuccess('test', i);
      tracker.recordError('test', i);
    }
    expect(tracker.getErrorRate('test')).to.equal(50);
  });

  it('should handle threshold=0 (alert on any error)', () => {
    const alerting = new ErrorAlerting({ errorThreshold: 0, cooldownMs: 10 });
    const spy = sinon.spy();
    alerting.on('error:alert', spy);

    alerting.checkThreshold('test', { errorRate: 0.1, totalRequests: 1000, errors: 1 });
    expect(spy.calledOnce).to.be.true;
  });

  it('should handle 100% uptime with many events', () => {
    const monitor = new UptimeMonitor({ windowSizeMs: 86400000 });
    for (let i = 0; i < 1000; i++) {
      monitor.recordUptime(60000);
    }
    expect(monitor.getUptimePercentage()).to.equal(100);
    expect(monitor.getHealthStatus()).to.equal('green');
  });

  it('should handle zero downtime gracefully', () => {
    const monitor = new UptimeMonitor({ windowSizeMs: 86400000 });
    monitor.recordUptime(86400000); // 24h uptime
    expect(monitor.getUptimePercentage()).to.equal(100);
  });
});

// ---------------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------------
describe('API endpoints', () => {
  beforeEach(() => {
    // Reset state for clean tests
    uptimeMonitor.events = [];
    uptimeMonitor._sessionStart = new Date().toISOString();
    errorRateTracker._records = {};
    errorAlerting._alerts = [];
    errorAlerting._lastAlertTime = {};
  });

  describe('GET /api/health', () => {
    it('should return health ok', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).to.equal(200);
      expect(res.body.data.status).to.equal('ok');
    });
  });

  describe('GET /api/monitor/dashboard', () => {
    it('should return complete dashboard view', async () => {
      const res = await request(app).get('/api/monitor/dashboard');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.property('uptime');
      expect(res.body.data).to.have.property('errorRates');
      expect(res.body.data).to.have.property('responseTimes');
      expect(res.body.data).to.have.property('alerts');
      expect(res.body.data).to.have.property('activeSessions');
    });
  });

  describe('GET /api/monitor/uptime', () => {
    it('should return uptime status', async () => {
      const res = await request(app).get('/api/monitor/uptime');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.property('percentage24h');
      expect(res.body.data).to.have.property('healthStatus');
      expect(res.body.data).to.have.property('sessionStart');
    });
  });

  describe('GET /api/monitor/errors', () => {
    it('should return error rates for all endpoints', async () => {
      const res = await request(app).get('/api/monitor/errors');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.property('endpoints');
    });
  });

  describe('GET /api/monitor/errors/:endpoint', () => {
    it('should return error rate for specific endpoint', async () => {
      errorRateTracker.recordSuccess('whatsapp-api', 100);

      const res = await request(app).get('/api/monitor/errors/whatsapp-api');
      expect(res.status).to.equal(200);
      expect(res.body.data.endpoint).to.equal('whatsapp-api');
    });

    it('should return 404 for unknown endpoint', async () => {
      const res = await request(app).get('/api/monitor/errors/nonexistent');
      expect(res.status).to.equal(404);
    });
  });

  describe('POST /api/monitor/events/uptime', () => {
    it('should record an uptime event', async () => {
      const res = await request(app)
        .post('/api/monitor/events/uptime')
        .send({ durationMs: 3600000 });
      expect(res.status).to.equal(200);
      expect(res.body.data.recorded).to.be.true;
    });

    it('should return 400 without durationMs', async () => {
      const res = await request(app)
        .post('/api/monitor/events/uptime')
        .send({});
      expect(res.status).to.equal(400);
    });
  });

  describe('POST /api/monitor/events/downtime', () => {
    it('should record a downtime event', async () => {
      const res = await request(app)
        .post('/api/monitor/events/downtime')
        .send({ durationMs: 60000 });
      expect(res.status).to.equal(200);
      expect(res.body.data.recorded).to.be.true;
    });
  });

  describe('POST /api/monitor/events/request', () => {
    it('should record a successful request', async () => {
      const res = await request(app)
        .post('/api/monitor/events/request')
        .send({ endpoint: 'whatsapp-api', latencyMs: 100, success: true });
      expect(res.status).to.equal(200);
      expect(res.body.data.endpoint).to.equal('whatsapp-api');
    });

    it('should record a failed request', async () => {
      const res = await request(app)
        .post('/api/monitor/events/request')
        .send({ endpoint: 'whatsapp-api', latencyMs: 200, success: false });
      expect(res.status).to.equal(200);
      expect(res.body.data.success).to.be.false;
    });

    it('should return 400 without endpoint', async () => {
      const res = await request(app)
        .post('/api/monitor/events/request')
        .send({ latencyMs: 100, success: true });
      expect(res.status).to.equal(400);
    });
  });

  describe('GET /api/monitor/errors/alerts', () => {
    it('should return error alert history', async () => {
      const res = await request(app).get('/api/monitor/errors/alerts');
      expect(res.status).to.equal(200);
      expect(res.body.data.alerts).to.be.an('array');
    });
  });

  describe('POST /api/monitor/errors/alerts/:id/acknowledge', () => {
    it('should acknowledge an alert', async () => {
      errorAlerting.checkThreshold('test', { errorRate: 6, totalRequests: 100, errors: 6 });
      const alert = errorAlerting.getAlerts()[0];

      const res = await request(app)
        .post(`/api/monitor/errors/alerts/${alert.id}/acknowledge`)
        .send({});
      expect(res.status).to.equal(200);
      expect(res.body.data.acknowledged).to.be.true;
    });

    it('should return 404 for unknown alert', async () => {
      const res = await request(app)
        .post('/api/monitor/errors/alerts/nonexistent/acknowledge')
        .send({});
      expect(res.status).to.equal(404);
    });
  });
});
