process.env.MOCHA_TEST_MODE = 'true';
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_WHATSAPP = '1000';
process.env.RATE_LIMIT_ERPNEXT = '500';
process.env.ALERT_THRESHOLD = '0.8';
process.env.ALERT_COOLDOWN_MS = '300000';
process.env.QUEUE_MAX_RETRIES = '3';
process.env.QUEUE_BASE_DELAY_MS = '1000';

const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');

const {
  app,
  RateLimitTracker,
  RateLimitAlerting,
  RateLimitQueue,
  rateLimitTracker,
  rateLimitAlerting,
  rateLimitQueue,
} = require('../src/6-2-rate-limit-monitoring');

// ---------------------------------------------------------------------------
// RateLimitTracker
// ---------------------------------------------------------------------------
describe('RateLimitTracker', () => {
  describe('recordApiCall', () => {
    it('should increment counter for an endpoint', () => {
      const tracker = new RateLimitTracker({ windowSizeMs: 60000, limits: { test: 100 } });
      tracker.recordApiCall('test');
      const usage = tracker.getCurrentUsage('test');
      expect(usage.currentCount).to.equal(1);
      expect(usage.endpoint).to.equal('test');
    });

    it('should handle multiple endpoints independently', () => {
      const tracker = new RateLimitTracker({ windowSizeMs: 60000, limits: { a: 100, b: 50 } });
      tracker.recordApiCall('a');
      tracker.recordApiCall('a');
      tracker.recordApiCall('b');

      expect(tracker.getCurrentUsage('a').currentCount).to.equal(2);
      expect(tracker.getCurrentUsage('b').currentCount).to.equal(1);
    });

    it('should auto-create counter for unknown endpoint with default limit', () => {
      const tracker = new RateLimitTracker({ windowSizeMs: 60000, limits: {} });
      tracker.recordApiCall('unknown-ep');
      const usage = tracker.getCurrentUsage('unknown-ep');
      expect(usage.currentCount).to.equal(1);
      expect(usage.limit).to.be.a('number');
    });
  });

  describe('getCurrentUsage', () => {
    it('should return correct percentage', () => {
      const tracker = new RateLimitTracker({ windowSizeMs: 60000, limits: { test: 100 } });
      for (let i = 0; i < 80; i++) {
        tracker.recordApiCall('test');
      }
      const usage = tracker.getCurrentUsage('test');
      expect(usage.currentCount).to.equal(80);
      expect(usage.limit).to.equal(100);
      expect(usage.percentage).to.equal(80);
    });

    it('should return zero usage for unrecorded endpoint', () => {
      const tracker = new RateLimitTracker({ windowSizeMs: 60000, limits: { test: 100 } });
      const usage = tracker.getCurrentUsage('test');
      expect(usage.currentCount).to.equal(0);
      expect(usage.percentage).to.equal(0);
    });

    it('should report 100% when at limit', () => {
      const tracker = new RateLimitTracker({ windowSizeMs: 60000, limits: { test: 50 } });
      for (let i = 0; i < 50; i++) {
        tracker.recordApiCall('test');
      }
      expect(tracker.getCurrentUsage('test').percentage).to.equal(100);
    });

    it('should report over 100% when exceeding limit', () => {
      const tracker = new RateLimitTracker({ windowSizeMs: 60000, limits: { test: 10 } });
      for (let i = 0; i < 15; i++) {
        tracker.recordApiCall('test');
      }
      expect(tracker.getCurrentUsage('test').percentage).to.be.greaterThan(100);
    });
  });

  describe('sliding window', () => {
    let clock;
    afterEach(() => { if (clock) clock.restore(); });

    it('should expire old calls outside the window', () => {
      clock = sinon.useFakeTimers();
      const tracker = new RateLimitTracker({ windowSizeMs: 1000, limits: { test: 100 } });

      tracker.recordApiCall('test');
      tracker.recordApiCall('test');
      expect(tracker.getCurrentUsage('test').currentCount).to.equal(2);

      clock.tick(1001); // advance past window
      expect(tracker.getCurrentUsage('test').currentCount).to.equal(0);
    });

    it('should keep calls within window', () => {
      clock = sinon.useFakeTimers();
      const tracker = new RateLimitTracker({ windowSizeMs: 1000, limits: { test: 100 } });

      tracker.recordApiCall('test');
      clock.tick(500);
      tracker.recordApiCall('test');
      clock.tick(400);
      expect(tracker.getCurrentUsage('test').currentCount).to.equal(2);
    });

    it('should partially expire calls', () => {
      clock = sinon.useFakeTimers();
      const tracker = new RateLimitTracker({ windowSizeMs: 1000, limits: { test: 100 } });

      tracker.recordApiCall('test'); // t=0
      clock.tick(200);
      tracker.recordApiCall('test'); // t=200
      clock.tick(900); // t=1100 — first call expired, second not
      expect(tracker.getCurrentUsage('test').currentCount).to.equal(1);
    });
  });

  describe('getAllUsage', () => {
    it('should return usage for all endpoints', () => {
      const tracker = new RateLimitTracker({ windowSizeMs: 60000, limits: { a: 100, b: 200 }, defaultLimit: 100 });
      tracker.recordApiCall('a');
      tracker.recordApiCall('a');
      tracker.recordApiCall('b');

      const allUsage = tracker.getAllUsage();
      expect(allUsage).to.have.property('a');
      expect(allUsage).to.have.property('b');
      expect(allUsage.a.currentCount).to.equal(2);
      expect(allUsage.b.currentCount).to.equal(1);
    });
  });

  describe('events', () => {
    it('should emit call:recorded on recordApiCall', () => {
      const tracker = new RateLimitTracker({ windowSizeMs: 60000, limits: { test: 100 } });
      const spy = sinon.spy();
      tracker.on('call:recorded', spy);

      tracker.recordApiCall('test');
      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0].endpoint).to.equal('test');
    });
  });
});

// ---------------------------------------------------------------------------
// RateLimitAlerting
// ---------------------------------------------------------------------------
describe('RateLimitAlerting', () => {
  describe('checkThreshold', () => {
    it('should trigger alert when usage exceeds threshold', () => {
      const alerting = new RateLimitAlerting({ alertThreshold: 0.8, cooldownMs: 5000 });
      const spy = sinon.spy();
      alerting.on('rate:alert', spy);

      alerting.checkThreshold('whatsapp-api', { currentCount: 80, limit: 100, percentage: 80 });
      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0].endpoint).to.equal('whatsapp-api');
      expect(spy.firstCall.args[0].usagePercent).to.equal(80);
    });

    it('should not trigger alert below threshold', () => {
      const alerting = new RateLimitAlerting({ alertThreshold: 0.8, cooldownMs: 5000 });
      const spy = sinon.spy();
      alerting.on('rate:alert', spy);

      alerting.checkThreshold('whatsapp-api', { currentCount: 79, limit: 100, percentage: 79 });
      expect(spy.notCalled).to.be.true;
    });

    it('should trigger at exact threshold boundary', () => {
      const alerting = new RateLimitAlerting({ alertThreshold: 0.8, cooldownMs: 5000 });
      const spy = sinon.spy();
      alerting.on('rate:alert', spy);

      alerting.checkThreshold('whatsapp-api', { currentCount: 80, limit: 100, percentage: 80 });
      expect(spy.calledOnce).to.be.true;
    });

    it('should emit rate:exceeded when usage is at or above 100%', () => {
      const alerting = new RateLimitAlerting({ alertThreshold: 0.8, cooldownMs: 5000 });
      const exceededSpy = sinon.spy();
      alerting.on('rate:exceeded', exceededSpy);

      alerting.checkThreshold('whatsapp-api', { currentCount: 100, limit: 100, percentage: 100 });
      expect(exceededSpy.calledOnce).to.be.true;
    });

    it('should include alert metadata: usagePercent, limit, estimated time', () => {
      const alerting = new RateLimitAlerting({ alertThreshold: 0.8, cooldownMs: 5000 });
      const spy = sinon.spy();
      alerting.on('rate:alert', spy);

      alerting.checkThreshold('whatsapp-api', { currentCount: 80, limit: 100, percentage: 80 });
      const alert = spy.firstCall.args[0];
      expect(alert).to.have.property('usagePercent', 80);
      expect(alert).to.have.property('limit', 100);
      expect(alert).to.have.property('currentCount', 80);
      expect(alert).to.have.property('estimatedTimeToLimit');
      expect(alert).to.have.property('timestamp');
      expect(alert).to.have.property('acknowledged', false);
    });
  });

  describe('cooldown', () => {
    it('should not create duplicate alerts within cooldown window', () => {
      const alerting = new RateLimitAlerting({ alertThreshold: 0.8, cooldownMs: 5000 });
      const spy = sinon.spy();
      alerting.on('rate:alert', spy);

      alerting.checkThreshold('whatsapp-api', { currentCount: 85, limit: 100, percentage: 85 });
      alerting.checkThreshold('whatsapp-api', { currentCount: 90, limit: 100, percentage: 90 }); // still in cooldown
      expect(spy.calledOnce).to.be.true;
    });

    it('should create new alert after cooldown expires', () => {
      const alerting = new RateLimitAlerting({ alertThreshold: 0.8, cooldownMs: 100 });
      const spy = sinon.spy();
      alerting.on('rate:alert', spy);

      alerting.checkThreshold('whatsapp-api', { currentCount: 85, limit: 100, percentage: 85 });
      expect(spy.callCount).to.equal(1);

      // After cooldown, a new alert should fire
      return new Promise(resolve => setTimeout(resolve, 150)).then(() => {
        alerting.checkThreshold('whatsapp-api', { currentCount: 90, limit: 100, percentage: 90 });
        expect(spy.callCount).to.equal(2);
      });
    });

    it('should handle different endpoints independently', () => {
      const alerting = new RateLimitAlerting({ alertThreshold: 0.8, cooldownMs: 5000 });
      const spy = sinon.spy();
      alerting.on('rate:alert', spy);

      alerting.checkThreshold('whatsapp-api', { currentCount: 85, limit: 100, percentage: 85 });
      alerting.checkThreshold('erpnext-api', { currentCount: 85, limit: 100, percentage: 85 });
      expect(spy.callCount).to.equal(2); // different endpoints, both should alert
    });

    it('should fire alert at 100%+ even during cooldown (critical override)', () => {
      const alerting = new RateLimitAlerting({ alertThreshold: 0.8, cooldownMs: 5000 });
      const alertSpy = sinon.spy();
      const exceededSpy = sinon.spy();
      alerting.on('rate:alert', alertSpy);
      alerting.on('rate:exceeded', exceededSpy);

      alerting.checkThreshold('whatsapp-api', { currentCount: 80, limit: 100, percentage: 80 });
      expect(alertSpy.callCount).to.equal(1);

      // 100% during cooldown should still fire alert + exceeded
      alerting.checkThreshold('whatsapp-api', { currentCount: 100, limit: 100, percentage: 100 });
      expect(alertSpy.callCount).to.equal(2);
      expect(exceededSpy.calledOnce).to.be.true;
    });
  });

  describe('acknowledgeAlert', () => {
    it('should mark alert as acknowledged', () => {
      const alerting = new RateLimitAlerting({ alertThreshold: 0.8, cooldownMs: 5000 });
      const spy = sinon.spy();
      alerting.on('rate:alert', spy);

      alerting.checkThreshold('whatsapp-api', { currentCount: 80, limit: 100, percentage: 80 });
      const alert = spy.firstCall.args[0];

      const result = alerting.acknowledgeAlert(alert.id);
      expect(result).to.be.true;
      expect(alerting.getAlerts()[0].acknowledged).to.be.true;
    });

    it('should return false for unknown alert ID', () => {
      const alerting = new RateLimitAlerting({ alertThreshold: 0.8 });
      expect(alerting.acknowledgeAlert('nonexistent')).to.be.false;
    });
  });

  describe('getAlerts', () => {
    it('should return sorted alerts (newest first)', async () => {
      const alerting = new RateLimitAlerting({ alertThreshold: 0.8, cooldownMs: 10 });

      // Wait between alerts to get different timestamps
      alerting.checkThreshold('ep1', { currentCount: 80, limit: 100, percentage: 80 });
      await new Promise(resolve => setTimeout(resolve, 20));
      alerting.checkThreshold('ep2', { currentCount: 80, limit: 100, percentage: 80 });

      const alerts = alerting.getAlerts();
      expect(alerts.length).to.equal(2);
      expect(alerts[0].endpoint).to.equal('ep2'); // newest first
    });

    it('should filter by endpoint when specified', () => {
      const alerting = new RateLimitAlerting({ alertThreshold: 0.8, cooldownMs: 10 });
      alerting.checkThreshold('whatsapp-api', { currentCount: 80, limit: 100, percentage: 80 });
      alerting.checkThreshold('erpnext-api', { currentCount: 80, limit: 100, percentage: 80 });

      const filtered = alerting.getAlerts('whatsapp-api');
      expect(filtered.length).to.equal(1);
      expect(filtered[0].endpoint).to.equal('whatsapp-api');
    });
  });
});

// ---------------------------------------------------------------------------
// RateLimitQueue
// ---------------------------------------------------------------------------
describe('RateLimitQueue', () => {
  describe('enqueue', () => {
    it('should add a request to the queue', () => {
      const queue = new RateLimitQueue();
      const entry = queue.enqueue({ endpoint: 'whatsapp-api', payload: { message: 'hello' } });
      expect(queue.getStats().depth).to.equal(1);
      expect(entry.endpoint).to.equal('whatsapp-api');
      expect(entry.retryCount).to.equal(0);
    });

    it('should assign unique IDs to each entry', () => {
      const queue = new RateLimitQueue();
      const e1 = queue.enqueue({ endpoint: 'a' });
      const e2 = queue.enqueue({ endpoint: 'a' });
      expect(e1.id).to.not.equal(e2.id);
    });
  });

  describe('processQueue', () => {
    it('should process all items with the processor function', async () => {
      const queue = new RateLimitQueue({ maxRetries: 3, baseRetryDelayMs: 10 });
      queue.enqueue({ endpoint: 'a', payload: 1 });
      queue.enqueue({ endpoint: 'a', payload: 2 });
      queue.enqueue({ endpoint: 'a', payload: 3 });

      const results = [];
      await queue.processQueue(async (item) => {
        results.push(item.payload);
      });

      expect(results).to.deep.equal([1, 2, 3]);
      expect(queue.getStats().depth).to.equal(0);
      expect(queue.getStats().processedCount).to.equal(3);
    });

    it('should retry on failure up to maxRetries', async () => {
      const queue = new RateLimitQueue({ maxRetries: 2, baseRetryDelayMs: 10 });
      queue.enqueue({ endpoint: 'a', payload: 'will-fail' });

      let attempts = 0;
      await queue.processQueue(async () => {
        attempts++;
        throw new Error('fail');
      });

      expect(attempts).to.equal(3); // 1 initial + 2 retries
      expect(queue.getStats().failedCount).to.equal(1);
      expect(queue.getStats().depth).to.equal(0);
    });

    it('should not process when queue is empty', async () => {
      const queue = new RateLimitQueue();
      const spy = sinon.spy();
      await queue.processQueue(spy);
      expect(spy.notCalled).to.be.true;
    });

    it('should track retry counts', async () => {
      const queue = new RateLimitQueue({ maxRetries: 2, baseRetryDelayMs: 10 });
      queue.enqueue({ endpoint: 'a', payload: 'fail' });

      await queue.processQueue(async (item) => {
        throw new Error('fail');
      });

      const stats = queue.getStats();
      expect(stats.failedCount).to.equal(1);
      // After max retries, the item is removed from queue
      expect(stats.depth).to.equal(0);
    });
  });

  describe('clear', () => {
    it('should empty the queue', () => {
      const queue = new RateLimitQueue();
      queue.enqueue({ endpoint: 'a' });
      queue.enqueue({ endpoint: 'b' });
      expect(queue.getStats().depth).to.equal(2);

      queue.clear();
      expect(queue.getStats().depth).to.equal(0);
    });
  });

  describe('getStats', () => {
    it('should return queue statistics', () => {
      const queue = new RateLimitQueue({ maxRetries: 3 });
      queue.enqueue({ endpoint: 'a', payload: 1 });
      queue.enqueue({ endpoint: 'a', payload: 2 });

      const stats = queue.getStats();
      expect(stats).to.have.property('depth', 2);
      expect(stats).to.have.property('processedCount', 0);
      expect(stats).to.have.property('failedCount', 0);
      expect(stats).to.have.property('maxRetries', 3);
      expect(stats).to.have.property('oldestTimestamp');
    });

    it('should return zero depth for empty queue', () => {
      const queue = new RateLimitQueue();
      expect(queue.getStats().depth).to.equal(0);
    });
  });

  describe('getQueuedItems', () => {
    it('should return all queued items', () => {
      const queue = new RateLimitQueue();
      queue.enqueue({ endpoint: 'a' });
      queue.enqueue({ endpoint: 'b' });

      const items = queue.getQueuedItems();
      expect(items.length).to.equal(2);
      expect(items[0].endpoint).to.equal('a');
    });

    it('should return a copy', () => {
      const queue = new RateLimitQueue();
      queue.enqueue({ endpoint: 'a' });

      const items = queue.getQueuedItems();
      items.length = 0;
      expect(queue.getStats().depth).to.equal(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------
describe('Integration: Rate Limit Monitoring', () => {
  it('should complete full cycle: record → threshold breached → alert → queue', () => {
    const tracker = new RateLimitTracker({ windowSizeMs: 60000, limits: { test: 100 } });
    const alerting = new RateLimitAlerting({ alertThreshold: 0.8, cooldownMs: 50000 });
    const queue = new RateLimitQueue({ maxRetries: 3 });

    // Wire events
    tracker.on('call:recorded', (data) => {
      const usage = tracker.getCurrentUsage(data.endpoint);
      alerting.checkThreshold(data.endpoint, usage);
    });
    alerting.on('rate:exceeded', () => {
      queue.enqueue({ endpoint: 'test', payload: { msg: 'queued' } });
    });

    const alertSpy = sinon.spy();
    alerting.on('rate:alert', alertSpy);

    // Record 80 calls (80% of 100)
    for (let i = 0; i < 80; i++) {
      tracker.recordApiCall('test');
    }
    expect(alertSpy.calledOnce).to.be.true;
    expect(alertSpy.firstCall.args[0].usagePercent).to.equal(80);

    // Record 20 more (100% = exceeded)
    for (let i = 0; i < 20; i++) {
      tracker.recordApiCall('test');
    }

    // Should have alert for 100% and queue should have entry
    expect(queue.getStats().depth).to.equal(1);
    expect(tracker.getCurrentUsage('test').percentage).to.equal(100);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('Edge cases', () => {
  describe('RateLimitTracker', () => {
    it('should handle zero calls gracefully', () => {
      const tracker = new RateLimitTracker({ windowSizeMs: 60000, limits: { test: 100 } });
      const usage = tracker.getCurrentUsage('test');
      expect(usage.currentCount).to.equal(0);
      expect(usage.percentage).to.equal(0);
      expect(usage.limit).to.equal(100);
    });

    it('should handle very high number of calls', () => {
      const tracker = new RateLimitTracker({ windowSizeMs: 60000, limits: { test: 1000 } });
      for (let i = 0; i < 10000; i++) {
        tracker.recordApiCall('test');
      }
      expect(tracker.getCurrentUsage('test').currentCount).to.equal(10000);
    });
  });

  describe('RateLimitAlerting', () => {
    it('should handle threshold=1.0 (100%)', () => {
      const alerting = new RateLimitAlerting({ alertThreshold: 1.0, cooldownMs: 5000 });
      const alertSpy = sinon.spy();
      alerting.on('rate:alert', alertSpy);

      alerting.checkThreshold('test', { currentCount: 99, limit: 100, percentage: 99 });
      expect(alertSpy.notCalled).to.be.true;

      alerting.checkThreshold('test', { currentCount: 100, limit: 100, percentage: 100 });
      expect(alertSpy.calledOnce).to.be.true;
    });

    it('should handle threshold=0 (always alert)', () => {
      const alerting = new RateLimitAlerting({ alertThreshold: 0, cooldownMs: 10 });
      const alertSpy = sinon.spy();
      alerting.on('rate:alert', alertSpy);

      alerting.checkThreshold('test', { currentCount: 1, limit: 100, percentage: 1 });
      expect(alertSpy.calledOnce).to.be.true;
    });

    it('should handle zero limit gracefully (division by zero)', () => {
      const alerting = new RateLimitAlerting({ alertThreshold: 0.8, cooldownMs: 5000 });
      const alertSpy = sinon.spy();
      alerting.on('rate:alert', alertSpy);

      alerting.checkThreshold('test', { currentCount: 0, limit: 0, percentage: 0 });
      expect(alertSpy.notCalled).to.be.true;
    });
  });

  describe('RateLimitQueue', () => {
    it('should handle thousands of queued items', () => {
      const queue = new RateLimitQueue();
      for (let i = 0; i < 5000; i++) {
        queue.enqueue({ endpoint: 'test', payload: i });
      }
      expect(queue.getStats().depth).to.equal(5000);
    });

    it('should preserve enqueue order', () => {
      const queue = new RateLimitQueue();
      queue.enqueue({ endpoint: 'a', payload: 1 });
      queue.enqueue({ endpoint: 'b', payload: 2 });
      queue.enqueue({ endpoint: 'c', payload: 3 });

      const items = queue.getQueuedItems();
      expect(items[0].payload).to.equal(1);
      expect(items[1].payload).to.equal(2);
      expect(items[2].payload).to.equal(3);
    });

    it('should handle empty processor function', async () => {
      const queue = new RateLimitQueue();
      queue.enqueue({ endpoint: 'test' });
      await queue.processQueue(async () => {}); // should not throw
      expect(queue.getStats().processedCount).to.equal(1);
    });
  });
});

// ---------------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------------
describe('API endpoints', () => {
  beforeEach(() => {
    // Reset state
    rateLimitQueue.clear();
    rateLimitTracker._counters = {};
  });

  describe('GET /api/health', () => {
    it('should return health ok', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).to.equal(200);
      expect(res.body.data.status).to.equal('ok');
    });
  });

  describe('GET /api/monitor/rate-limits', () => {
    it('should return current usage for all endpoints', async () => {
      rateLimitTracker.recordApiCall('whatsapp-api');
      rateLimitTracker.recordApiCall('whatsapp-api');
      rateLimitTracker.recordApiCall('erpnext-api');

      const res = await request(app).get('/api/monitor/rate-limits');
      expect(res.status).to.equal(200);
      expect(res.body.data.endpoints).to.be.an('object');
      expect(res.body.data.endpoints['whatsapp-api'].currentCount).to.equal(2);
      expect(res.body.data.endpoints['erpnext-api'].currentCount).to.equal(1);
    });
  });

  describe('GET /api/monitor/rate-limits/:endpoint', () => {
    it('should return usage for specific endpoint', async () => {
      rateLimitTracker.recordApiCall('whatsapp-api');

      const res = await request(app).get('/api/monitor/rate-limits/whatsapp-api');
      expect(res.status).to.equal(200);
      expect(res.body.data.currentCount).to.equal(1);
    });

    it('should return 404 for unknown endpoint', async () => {
      const res = await request(app).get('/api/monitor/rate-limits/nonexistent');
      expect(res.status).to.equal(404);
    });
  });

  describe('GET /api/monitor/rate-limits/alerts', () => {
    it('should return alert history', async () => {
      const res = await request(app).get('/api/monitor/rate-limits/alerts');
      expect(res.status).to.equal(200);
      expect(res.body.data.alerts).to.be.an('array');
      expect(res.body.data).to.have.property('total');
    });
  });

  describe('POST /api/monitor/rate-limits/alerts/:id/acknowledge', () => {
    it('should acknowledge an alert', async () => {
      // Create an alert
      rateLimitAlerting.checkThreshold('test', { currentCount: 80, limit: 100, percentage: 80 });
      const alert = rateLimitAlerting.getAlerts()[0];

      const res = await request(app)
        .post(`/api/monitor/rate-limits/alerts/${alert.id}/acknowledge`)
        .send({});
      expect(res.status).to.equal(200);
      expect(res.body.data.acknowledged).to.be.true;
    });

    it('should return 404 for unknown alert ID', async () => {
      const res = await request(app)
        .post('/api/monitor/rate-limits/alerts/nonexistent/acknowledge')
        .send({});
      expect(res.status).to.equal(404);
    });
  });

  describe('GET /api/monitor/rate-limits/queue', () => {
    it('should return queue status', async () => {
      rateLimitQueue.enqueue({ endpoint: 'test' });
      rateLimitQueue.enqueue({ endpoint: 'test' });

      const res = await request(app).get('/api/monitor/rate-limits/queue');
      expect(res.status).to.equal(200);
      expect(res.body.data.stats.depth).to.equal(2);
      expect(res.body.data.items).to.be.an('array').with.length(2);
    });
  });

  describe('POST /api/monitor/rate-limits/record', () => {
    it('should record an API call', async () => {
      const res = await request(app)
        .post('/api/monitor/rate-limits/record')
        .send({ endpoint: 'whatsapp-api' });
      expect(res.status).to.equal(200);
      expect(res.body.data.endpoint).to.equal('whatsapp-api');
      expect(res.body.data.currentCount).to.equal(1);
    });

    it('should return 400 without endpoint', async () => {
      const res = await request(app)
        .post('/api/monitor/rate-limits/record')
        .send({});
      expect(res.status).to.equal(400);
    });
  });

  describe('Error handling', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await request(app).get('/api/monitor/nonexistent');
      expect(res.status).to.equal(404);
    });
  });
});
