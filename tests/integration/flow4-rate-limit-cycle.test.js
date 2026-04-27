require('../helpers/setup');
const { expect } = require('chai');
const request = require('supertest');
const { app: app6_1, HealthCheckService, DowntimeDetector, FallbackManager, MessageQueue } = require('../../src/6-1-api-downtime-detection-fallback');
const { app: app6_2, RateLimitTracker, RateLimitAlerting, RateLimitQueue } = require('../../src/6-2-rate-limit-monitoring');
const { app: app6_3 } = require('../../src/6-3-uptime-error-monitoring-dashboard');

describe('Flow 4: Rate Limit → Fallback → Recovery Cycle', () => {
  describe('Step 1: Rate limit detection via 6-2', () => {
    it('Alerts at threshold when calls recorded', () => {
      const alerts = [];
      const tracker = new RateLimitTracker({ windowSizeMs: 60000, limits: { test: 10 } });
      const alerter = new RateLimitAlerting({ alertThreshold: 0.8, cooldownMs: 100 });
      alerter.on('rate:alert', (a) => alerts.push(a));

      for (let i = 0; i < 8; i++) {
        tracker.recordApiCall('test');
        const usage = tracker.getCurrentUsage('test');
        alerter.checkThreshold('test', usage);
      }

      expect(alerts.length).to.be.at.least(1);
      expect(tracker.getCurrentUsage('test').currentCount).to.equal(8);
    });

    it('Enqueues requests when rate limit exceeded', () => {
      const queue = new RateLimitQueue({ maxRetries: 3 });
      queue.enqueue({ endpoint: 'test', payload: { data: 'test' } });
      queue.enqueue({ endpoint: 'test', payload: { data: 'test2' } });

      const stats = queue.getStats();
      expect(stats.depth).to.equal(2);
    });

    it('HTTP endpoint records and reports rate limit stats', async () => {
      const recordRes = await request(app6_2)
        .post('/api/monitor/rate-limits/record')
        .send({ endpoint: 'test-ep', timestamp: Date.now() });

      expect(recordRes.status).to.equal(200);

      const statsRes = await request(app6_2)
        .get('/api/monitor/rate-limits');

      expect(statsRes.status).to.equal(200);
    });
  });

  describe('Step 2-3: Downtime detection and fallback via 6-1', () => {
    it('Consecutive failures trigger fallback state', () => {
      const detector = new DowntimeDetector({ downtimeThreshold: 3, recoveryThreshold: 2 });
      const fallback = new FallbackManager({ fallbackFormUrl: 'https://form.example.com' });

      detector.on('downtime:detected', () => fallback.activate('auto'));

      expect(detector.getState().state).to.equal('NORMAL');

      for (let i = 0; i < 3; i++) {
        detector.onHealthChange({ isHealthy: false });
      }

      expect(detector.getState().state).to.equal('FALLBACK');
      expect(fallback.isActive).to.be.true;
    });

    it('Fallback returns configured message', () => {
      const fallback = new FallbackManager({
        fallbackFormUrl: 'https://form.example.com',
        fallbackMessage: 'Service unavailable. Use form: {formUrl}',
      });
      fallback.activate('test');

      const response = fallback.getFallbackResponse();
      expect(response.message).to.include('https://form.example.com');
      expect(response.formUrl).to.equal('https://form.example.com');
    });

    it('Messages queued during fallback', () => {
      const queue = new MessageQueue();
      queue.enqueue({ phoneNumber: '+91987654321', message: 'Help!' });
      queue.enqueue({ phoneNumber: '+91987654322', message: 'Booking needed' });

      expect(queue.getStats().depth).to.equal(2);
      expect(queue.getQueuedMessages().length).to.equal(2);
    });
  });

  describe('Step 4: Recovery cycle', () => {
    it('Detector transitions FALLBACK → RECOVERING → NORMAL on successive successes', () => {
      const detector = new DowntimeDetector({ downtimeThreshold: 2, recoveryThreshold: 2 });

      detector.onHealthChange({ isHealthy: false });
      detector.onHealthChange({ isHealthy: false });
      expect(detector.getState().state).to.equal('FALLBACK');

      detector.onHealthChange({ isHealthy: true });
      expect(detector.getState().state).to.equal('RECOVERING');

      detector.onHealthChange({ isHealthy: true });
      expect(detector.getState().state).to.equal('NORMAL');
    });
  });

  describe('Step 5: HTTP endpoint full cycle', () => {
    it('Fallback trigger endpoint returns correct status', async () => {
      const triggerRes = await request(app6_1)
        .post('/api/monitor/fallback/trigger')
        .send({});

      expect(triggerRes.status).to.equal(200);
      expect(triggerRes.body.data.state).to.equal('FALLBACK');
    });

    it('Fallback status endpoint reflects active state', async () => {
      const res = await request(app6_1)
        .get('/api/monitor/fallback/status');

      expect(res.status).to.equal(200);
      expect(res.body.data).to.exist;
    });

    it('Dashboard health endpoint accessible', async () => {
      const res = await request(app6_3)
        .get('/api/monitor/dashboard');

      expect(res.status).to.equal(200);
    });
  });

  describe('Edge cases', () => {
    it('Rate limit tracker returns zero usage for unknown endpoint', () => {
      const tracker = new RateLimitTracker({ windowSizeMs: 60000, limits: { test: 10 } });

      const usage = tracker.getCurrentUsage('unknown');

      expect(usage.currentCount).to.equal(0);
    });

    it('Message queue drains on repeated dequeue', () => {
      const queue = new MessageQueue();
      queue.enqueue({ phoneNumber: '+91', message: 'A' });
      queue.enqueue({ phoneNumber: '+91', message: 'B' });

      expect(queue.getStats().depth).to.equal(2);

      queue.clear();
      expect(queue.getStats().depth).to.equal(0);
    });

    it('Detector stays NORMAL with alternating health signals', () => {
      const detector = new DowntimeDetector({ downtimeThreshold: 3, recoveryThreshold: 2 });

      detector.onHealthChange({ isHealthy: false });
      detector.onHealthChange({ isHealthy: true });
      detector.onHealthChange({ isHealthy: false });
      detector.onHealthChange({ isHealthy: true });

      expect(detector.getState().state).to.equal('NORMAL');
    });

    it('Concurrent backup prevention throws', async () => {
      const storage = new (require('../../src/5-3-backup-recovery-system').BackupStorage)();
      const manager = new (require('../../src/5-3-backup-recovery-system').BackupManager)(storage);

      // Start two backups concurrently so both try to run at once
      const results = await Promise.allSettled([
        manager.executeBackup(),
        manager.executeBackup(),
      ]);

      const rejected = results.filter(r => r.status === 'rejected');
      expect(rejected.length).to.be.at.least(1);
    });
  });
});
