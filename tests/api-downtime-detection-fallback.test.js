process.env.MOCHA_TEST_MODE = 'true';
process.env.HEALTH_CHECK_INTERVAL_MS = '30000';
process.env.HEALTH_CHECK_TIMEOUT_MS = '10000';
process.env.WHATSAPP_API_ENDPOINT = 'https://graph.facebook.com/v22.0';
process.env.DOWNTIME_THRESHOLD = '3';
process.env.RECOVERY_THRESHOLD = '2';
process.env.FALLBACK_FORM_URL = 'https://forms.example.com/lead-capture';
process.env.FALLBACK_MESSAGE_TEMPLATE = 'Our WhatsApp service is temporarily unavailable. Please fill out this form: {formUrl}';

const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');

const {
  app,
  HealthCheckService,
  DowntimeDetector,
  FallbackManager,
  MessageQueue,
  healthCheckService,
  downtimeDetector,
  fallbackManager,
  messageQueue,
} = require('../src/6-1-api-downtime-detection-fallback');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeHealthStatus(isHealthy, overrides = {}) {
  return { isHealthy, latencyMs: 10, ...overrides };
}

// ---------------------------------------------------------------------------
// HealthCheckService
// ---------------------------------------------------------------------------
describe('HealthCheckService', () => {
  describe('pingApi', () => {
    it('should return success on healthy API', async () => {
      const service = new HealthCheckService({
        makeRequest: async () => ({ success: true, statusCode: 200 }),
      });
      const result = await service.pingApi();
      expect(result.success).to.be.true;
      expect(result.statusCode).to.equal(200);
      expect(result.latencyMs).to.be.a('number');
    });

    it('should return failure on unhealthy API', async () => {
      const service = new HealthCheckService({
        makeRequest: async () => ({ success: false, statusCode: 503, error: 'Service Unavailable' }),
      });
      const result = await service.pingApi();
      expect(result.success).to.be.false;
      expect(result.statusCode).to.equal(503);
    });

    it('should handle request error gracefully', async () => {
      const service = new HealthCheckService({
        makeRequest: async () => { throw new Error('Connection refused'); },
      });
      const result = await service.pingApi();
      expect(result.success).to.be.false;
      expect(result.error).to.equal('Connection refused');
    });

    it('should handle timeout', async () => {
      const service = new HealthCheckService({
        makeRequest: async () => ({ success: false, error: 'Request timeout', statusCode: null }),
      });
      const result = await service.pingApi();
      expect(result.success).to.be.false;
      expect(result.error).to.equal('Request timeout');
    });
  });

  describe('consecutive failures tracking', () => {
    it('should increment consecutiveFailures on failure', async () => {
      const service = new HealthCheckService({
        makeRequest: async () => ({ success: false, error: 'fail', statusCode: 503 }),
      });
      await service.pingApi();
      expect(service.consecutiveFailures).to.equal(1);
      expect(service.isHealthy).to.be.false;
    });

    it('should reset consecutiveFailures on success after failure', async () => {
      const service = new HealthCheckService({
        makeRequest: async () => ({ success: false, error: 'fail', statusCode: 503 }),
      });
      await service.pingApi();
      expect(service.consecutiveFailures).to.equal(1);

      service._makeRequest = async () => ({ success: true, statusCode: 200 });
      await service.pingApi();
      expect(service.consecutiveFailures).to.equal(0);
      expect(service.isHealthy).to.be.true;
    });

    it('should track total checks and failures', async () => {
      const service = new HealthCheckService({
        makeRequest: async () => ({ success: false, error: 'fail', statusCode: 503 }),
      });
      await service.pingApi();
      await service.pingApi();
      await service.pingApi();
      expect(service.totalChecks).to.equal(3);
      expect(service.totalFailures).to.equal(3);

      service._makeRequest = async () => ({ success: true, statusCode: 200 });
      await service.pingApi();
      expect(service.totalChecks).to.equal(4);
      expect(service.totalFailures).to.equal(3);
    });
  });

  describe('startMonitoring / stopMonitoring', () => {
    let clock;
    afterEach(() => {
      if (clock) clock.restore();
    });

    it('should call pingApi at configured interval', async () => {
      const service = new HealthCheckService({
        checkIntervalMs: 50,
        makeRequest: async () => ({ success: true, statusCode: 200 }),
      });
      const pingSpy = sinon.spy(service, 'pingApi');

      service.startMonitoring();
      expect(pingSpy.calledOnce).to.be.true; // immediate check

      await new Promise(resolve => setTimeout(resolve, 120));
      expect(pingSpy.callCount).to.be.at.least(2);

      service.stopMonitoring();
    });

    it('should not start duplicate monitoring', () => {
      const service = new HealthCheckService({
        checkIntervalMs: 1000,
        makeRequest: async () => ({ success: true, statusCode: 200 }),
      });
      const pingSpy = sinon.spy(service, 'pingApi');

      service.startMonitoring();
      service.startMonitoring(); // duplicate
      expect(pingSpy.calledOnce).to.be.true;

      service.stopMonitoring();
    });

    it('should stop monitoring when stopMonitoring is called', async () => {
      const service = new HealthCheckService({
        checkIntervalMs: 20,
        makeRequest: async () => ({ success: true, statusCode: 200 }),
      });
      const pingSpy = sinon.spy(service, 'pingApi');

      service.startMonitoring();
      await new Promise(resolve => setTimeout(resolve, 50));
      const callsAfterStart = pingSpy.callCount;
      expect(callsAfterStart).to.be.at.least(2);

      service.stopMonitoring();
      const callsAfterStop = pingSpy.callCount;

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(pingSpy.callCount).to.equal(callsAfterStop);
    });
  });

  describe('health change events', () => {
    it('should emit health:changed when status transitions to unhealthy', async () => {
      const service = new HealthCheckService({
        makeRequest: async () => ({ success: true, statusCode: 200 }),
      });
      await service.pingApi(); // initial healthy check

      const emitSpy = sinon.spy();
      service.on('health:changed', emitSpy);

      service._makeRequest = async () => ({ success: false, error: 'fail', statusCode: 503 });
      await service.pingApi();

      expect(emitSpy.calledOnce).to.be.true;
      expect(emitSpy.firstCall.args[0].isHealthy).to.be.false;
    });

    it('should emit health:changed when status transitions to healthy', async () => {
      const service = new HealthCheckService({
        makeRequest: async () => ({ success: false, error: 'fail', statusCode: 503 }),
      });
      await service.pingApi(); // initial unhealthy

      const emitSpy = sinon.spy();
      service.on('health:changed', emitSpy);

      service._makeRequest = async () => ({ success: true, statusCode: 200 });
      await service.pingApi();

      expect(emitSpy.calledOnce).to.be.true;
      expect(emitSpy.firstCall.args[0].isHealthy).to.be.true;
    });

    it('should NOT emit health:changed when status remains the same', async () => {
      const service = new HealthCheckService({
        makeRequest: async () => ({ success: false, error: 'fail', statusCode: 503 }),
      });

      const emitSpy = sinon.spy();
      service.on('health:changed', emitSpy);

      await service.pingApi(); // first failure → unhealthy, emits
      await service.pingApi(); // second failure → still unhealthy, should NOT emit again for isHealthy

      expect(emitSpy.calledOnce).to.be.true; // only first transition
    });
  });

  describe('getStatus', () => {
    it('should return current health status', () => {
      const service = new HealthCheckService({
        makeRequest: async () => ({ success: true, statusCode: 200 }),
      });
      const status = service.getStatus();
      expect(status).to.have.property('isHealthy', true);
      expect(status).to.have.property('consecutiveFailures');
      expect(status).to.have.property('lastCheckTime');
      expect(status).to.have.property('lastLatencyMs');
      expect(status).to.have.property('uptimeSince');
      expect(status).to.have.property('totalChecks');
      expect(status).to.have.property('totalFailures');
    });
  });
});

// ---------------------------------------------------------------------------
// DowntimeDetector
// ---------------------------------------------------------------------------
describe('DowntimeDetector', () => {
  describe('state transitions', () => {
    it('should stay NORMAL with 1-2 failures', () => {
      const detector = new DowntimeDetector({ downtimeThreshold: 3 });
      detector.onHealthChange(makeHealthStatus(false));
      expect(detector.state).to.equal('NORMAL');

      detector.onHealthChange(makeHealthStatus(false));
      expect(detector.state).to.equal('NORMAL');
    });

    it('should transition to FALLBACK after 3 consecutive failures', () => {
      const detector = new DowntimeDetector({ downtimeThreshold: 3 });
      detector.onHealthChange(makeHealthStatus(false));
      detector.onHealthChange(makeHealthStatus(false));
      detector.onHealthChange(makeHealthStatus(false));
      expect(detector.state).to.equal('FALLBACK');
      expect(detector.fallbackTriggeredAt).to.not.be.null;
    });

    it('should transition to RECOVERING after 1 success in FALLBACK', () => {
      const detector = new DowntimeDetector({ downtimeThreshold: 2, recoveryThreshold: 2 });
      detector.onHealthChange(makeHealthStatus(false));
      detector.onHealthChange(makeHealthStatus(false));
      expect(detector.state).to.equal('FALLBACK');

      detector.onHealthChange(makeHealthStatus(true));
      expect(detector.state).to.equal('RECOVERING');
    });

    it('should transition to NORMAL after 2 consecutive successes in RECOVERING', () => {
      const detector = new DowntimeDetector({ downtimeThreshold: 2, recoveryThreshold: 2 });
      detector.onHealthChange(makeHealthStatus(false));
      detector.onHealthChange(makeHealthStatus(false));
      expect(detector.state).to.equal('FALLBACK');

      detector.onHealthChange(makeHealthStatus(true));
      expect(detector.state).to.equal('RECOVERING');

      detector.onHealthChange(makeHealthStatus(true));
      expect(detector.state).to.equal('NORMAL');
    });

    it('should go back to FALLBACK if a failure occurs during RECOVERING', () => {
      const detector = new DowntimeDetector({ downtimeThreshold: 2, recoveryThreshold: 2 });
      detector.onHealthChange(makeHealthStatus(false));
      detector.onHealthChange(makeHealthStatus(false));
      expect(detector.state).to.equal('FALLBACK');

      detector.onHealthChange(makeHealthStatus(true));
      expect(detector.state).to.equal('RECOVERING');

      detector.onHealthChange(makeHealthStatus(false));
      expect(detector.state).to.equal('FALLBACK');
    });

    it('should not transition on rapid recovery (need threshold successes)', () => {
      const detector = new DowntimeDetector({ downtimeThreshold: 3, recoveryThreshold: 3 });
      detector.onHealthChange(makeHealthStatus(false));
      detector.onHealthChange(makeHealthStatus(false));
      detector.onHealthChange(makeHealthStatus(false));
      expect(detector.state).to.equal('FALLBACK');

      detector.onHealthChange(makeHealthStatus(true));
      expect(detector.state).to.equal('RECOVERING');
      expect(detector.state).to.not.equal('NORMAL');
    });

    it('should reset consecutiveFailures on health success', () => {
      const detector = new DowntimeDetector({ downtimeThreshold: 3 });
      detector.onHealthChange(makeHealthStatus(false));
      detector.onHealthChange(makeHealthStatus(false));
      expect(detector.consecutiveFailures).to.equal(2);

      detector.onHealthChange(makeHealthStatus(true));
      expect(detector.consecutiveFailures).to.equal(0);
      expect(detector.consecutiveSuccesses).to.equal(1);
    });
  });

  describe('events', () => {
    it('should emit downtime:detected when transitioning to FALLBACK', () => {
      const detector = new DowntimeDetector({ downtimeThreshold: 2 });
      const emitSpy = sinon.spy();
      detector.on('downtime:detected', emitSpy);

      detector.onHealthChange(makeHealthStatus(false));
      detector.onHealthChange(makeHealthStatus(false));
      detector.onHealthChange(makeHealthStatus(false)); // only the transition matters

      expect(emitSpy.calledOnce).to.be.true;
      expect(emitSpy.firstCall.args[0]).to.have.property('newState', 'FALLBACK');
    });

    it('should emit downtime:recovered when transitioning to NORMAL', () => {
      const detector = new DowntimeDetector({ downtimeThreshold: 2, recoveryThreshold: 2 });
      detector.onHealthChange(makeHealthStatus(false));
      detector.onHealthChange(makeHealthStatus(false));
      expect(detector.state).to.equal('FALLBACK');

      const emitSpy = sinon.spy();
      detector.on('downtime:recovered', emitSpy);

      detector.onHealthChange(makeHealthStatus(true));
      detector.onHealthChange(makeHealthStatus(true));

      expect(emitSpy.calledOnce).to.be.true;
      expect(emitSpy.firstCall.args[0]).to.have.property('newState', 'NORMAL');
    });
  });

  describe('configurable thresholds', () => {
    it('should trigger fallback with threshold=1 on single failure', () => {
      const detector = new DowntimeDetector({ downtimeThreshold: 1, recoveryThreshold: 1 });
      detector.onHealthChange(makeHealthStatus(false));
      expect(detector.state).to.equal('FALLBACK');
    });

    it('should recover with threshold=1 on single success', () => {
      const detector = new DowntimeDetector({ downtimeThreshold: 1, recoveryThreshold: 1 });
      detector.onHealthChange(makeHealthStatus(false));
      expect(detector.state).to.equal('FALLBACK');

      detector.onHealthChange(makeHealthStatus(true));
      expect(detector.state).to.equal('NORMAL');
    });

    it('should not trigger fallback with very high threshold', () => {
      const detector = new DowntimeDetector({ downtimeThreshold: 100 });
      for (let i = 0; i < 50; i++) {
        detector.onHealthChange(makeHealthStatus(false));
      }
      expect(detector.state).to.equal('NORMAL');
    });
  });

  describe('forceFallback / forceReset', () => {
    it('should force fallback state', () => {
      const detector = new DowntimeDetector();
      detector.forceFallback();
      expect(detector.state).to.equal('FALLBACK');
      expect(detector.fallbackTriggeredAt).to.not.be.null;
    });

    it('should force reset to NORMAL', () => {
      const detector = new DowntimeDetector();
      detector.forceFallback();
      expect(detector.state).to.equal('FALLBACK');

      detector.forceReset();
      expect(detector.state).to.equal('NORMAL');
      expect(detector.consecutiveFailures).to.equal(0);
      expect(detector.consecutiveSuccesses).to.equal(0);
    });

    it('should emit events on force operations', () => {
      const detector = new DowntimeDetector();
      const detectedSpy = sinon.spy();
      const recoveredSpy = sinon.spy();
      detector.on('downtime:detected', detectedSpy);
      detector.on('downtime:recovered', recoveredSpy);

      detector.forceFallback();
      expect(detectedSpy.calledOnce).to.be.true;

      detector.forceReset();
      expect(recoveredSpy.calledOnce).to.be.true;
    });

    it('forceFallback should include manual source in event', () => {
      const detector = new DowntimeDetector();
      const detectedSpy = sinon.spy();
      detector.on('downtime:detected', detectedSpy);

      detector.forceFallback();
      expect(detectedSpy.firstCall.args[0].source).to.equal('manual');
    });
  });

  describe('getState', () => {
    it('should return current state with metadata', () => {
      const detector = new DowntimeDetector({ downtimeThreshold: 3 });
      const state = detector.getState();
      expect(state).to.have.property('state', 'NORMAL');
      expect(state).to.have.property('downtimeThreshold', 3);
      expect(state).to.have.property('recoveryThreshold', 2);
      expect(state).to.have.property('consecutiveFailures');
      expect(state).to.have.property('consecutiveSuccesses');
      expect(state).to.have.property('fallbackTriggeredAt');
      expect(state).to.have.property('lastStateChange');
    });
  });
});

// ---------------------------------------------------------------------------
// FallbackManager
// ---------------------------------------------------------------------------
describe('FallbackManager', () => {
  describe('getFallbackResponse', () => {
    it('should return configured form URL and message', () => {
      const fb = new FallbackManager({
        fallbackFormUrl: 'https://forms.example.com/capture',
        fallbackMessage: 'Outage, use this form: {formUrl}',
      });
      const response = fb.getFallbackResponse();
      expect(response).to.have.property('formUrl', 'https://forms.example.com/capture');
      expect(response.message).to.include('https://forms.example.com/capture');
      expect(response).to.have.property('timestamp');
    });

    it('should replace {formUrl} placeholder with actual URL', () => {
      const fb = new FallbackManager({
        fallbackFormUrl: 'https://example.com/form',
        fallbackMessage: 'Please use {formUrl} to submit your enquiry',
      });
      const response = fb.getFallbackResponse();
      expect(response.message).to.equal('Please use https://example.com/form to submit your enquiry');
    });

    it('should use defaults from env vars when no options provided', () => {
      const fb = new FallbackManager();
      const response = fb.getFallbackResponse();
      expect(response.formUrl).to.equal('https://forms.example.com/lead-capture');
      expect(response.message).to.include('https://forms.example.com/lead-capture');
    });
  });

  describe('activate / deactivate', () => {
    it('should activate fallback', () => {
      const fb = new FallbackManager();
      fb.activate('auto');
      expect(fb.isActive).to.be.true;
      expect(fb.activatedAt).to.not.be.null;
    });

    it('should deactivate fallback', () => {
      const fb = new FallbackManager();
      fb.activate('auto');
      expect(fb.isActive).to.be.true;

      fb.deactivate('auto');
      expect(fb.isActive).to.be.false;
      expect(fb.deactivatedAt).to.not.be.null;
    });

    it('should not double-activate', () => {
      const fb = new FallbackManager();
      fb.activate('auto');
      fb.activate('auto');
      expect(fb.eventLog.length).to.equal(1);
    });

    it('should not double-deactivate', () => {
      const fb = new FallbackManager();
      fb.activate('auto');
      fb.deactivate('auto');
      const afterFirstDeactivate = fb.eventLog.length;
      fb.deactivate('auto'); // second deactivate is no-op
      expect(fb.eventLog.length).to.equal(afterFirstDeactivate); // count unchanged
    });

    it('should log events with source', () => {
      const fb = new FallbackManager();
      fb.activate('manual');
      expect(fb.eventLog[0].source).to.equal('manual');
      expect(fb.eventLog[0].event).to.equal('triggered');

      fb.deactivate('auto');
      expect(fb.eventLog[1].source).to.equal('auto');
      expect(fb.eventLog[1].event).to.equal('resolved');
    });
  });

  describe('forceTrigger / forceReset', () => {
    it('forceTrigger should activate fallback with manual source', () => {
      const fb = new FallbackManager();
      fb.forceTrigger();
      expect(fb.isActive).to.be.true;
      expect(fb.eventLog[0].source).to.equal('manual');
    });

    it('forceReset should deactivate fallback with manual source', () => {
      const fb = new FallbackManager();
      fb.activate('auto');
      fb.forceReset();
      expect(fb.isActive).to.be.false;
      expect(fb.eventLog[1].source).to.equal('manual');
    });
  });

  describe('getStatus', () => {
    it('should return current fallback status with stats', () => {
      const fb = new FallbackManager({
        fallbackFormUrl: 'https://example.com/form',
      });
      fb.activate('auto');
      fb.getFallbackResponse();
      fb.getFallbackResponse();

      const status = fb.getStatus();
      expect(status).to.have.property('isActive', true);
      expect(status).to.have.property('fallbackFormUrl', 'https://example.com/form');
      expect(status).to.have.property('totalFallbackResponses', 2);
      expect(status).to.have.property('eventLogCount', 1);
    });
  });

  describe('getEventLog', () => {
    it('should return sorted event history (newest first)', async () => {
      const fb = new FallbackManager();
      fb.activate('auto');
      await new Promise(resolve => setTimeout(resolve, 5));
      fb.deactivate('auto');
      await new Promise(resolve => setTimeout(resolve, 5));
      fb.activate('manual');
      await new Promise(resolve => setTimeout(resolve, 5));
      fb.deactivate('manual');

      const log = fb.getEventLog();
      expect(log.length).to.equal(4);
      expect(log[0].event).to.equal('resolved'); // newest first (sorted desc)
      expect(log[0].source).to.equal('manual');
      expect(log[1].event).to.equal('triggered');
      expect(log[1].source).to.equal('manual');
      expect(log[2].event).to.equal('resolved');
      expect(log[2].source).to.equal('auto');
      expect(log[3].event).to.equal('triggered');
      expect(log[3].source).to.equal('auto');
    });
  });
});

// ---------------------------------------------------------------------------
// MessageQueue
// ---------------------------------------------------------------------------
describe('MessageQueue', () => {
  describe('enqueue', () => {
    it('should queue a message with correct metadata', () => {
      const mq = new MessageQueue();
      const entry = mq.enqueue({ phoneNumber: '+911234567890', message: 'Hello', direction: 'incoming' });
      expect(entry).to.have.property('phoneNumber', '+911234567890');
      expect(entry).to.have.property('message', 'Hello');
      expect(entry).to.have.property('direction', 'incoming');
      expect(entry).to.have.property('timestamp');
      expect(entry.id).to.match(/^msg-/);
    });

    it('should default direction to incoming', () => {
      const mq = new MessageQueue();
      const entry = mq.enqueue({ phoneNumber: '+911234567890', message: 'Hi' });
      expect(entry.direction).to.equal('incoming');
    });

    it('should increment enqueueCount', () => {
      const mq = new MessageQueue();
      mq.enqueue({ phoneNumber: '+911', message: 'a' });
      mq.enqueue({ phoneNumber: '+912', message: 'b' });
      mq.enqueue({ phoneNumber: '+913', message: 'c' });
      expect(mq.enqueueCount).to.equal(3);
    });
  });

  describe('getQueuedMessages', () => {
    it('should return all messages in order', () => {
      const mq = new MessageQueue();
      mq.enqueue({ phoneNumber: '+911', message: 'first' });
      mq.enqueue({ phoneNumber: '+912', message: 'second' });

      const messages = mq.getQueuedMessages();
      expect(messages.length).to.equal(2);
      expect(messages[0].message).to.equal('first');
      expect(messages[1].message).to.equal('second');
    });

    it('should return a copy of the queue', () => {
      const mq = new MessageQueue();
      mq.enqueue({ phoneNumber: '+911', message: 'test' });

      const messages = mq.getQueuedMessages();
      messages.length = 0; // mutate returned array
      expect(mq.getQueuedMessages().length).to.equal(1); // original unchanged
    });
  });

  describe('clear', () => {
    it('should empty the queue', () => {
      const mq = new MessageQueue();
      mq.enqueue({ phoneNumber: '+911', message: 'test' });
      expect(mq.getQueuedMessages().length).to.equal(1);

      mq.clear();
      expect(mq.getQueuedMessages().length).to.equal(0);
    });
  });

  describe('getStats', () => {
    it('should return depth and enqueue count', () => {
      const mq = new MessageQueue();
      mq.enqueue({ phoneNumber: '+911', message: 'a' });
      mq.enqueue({ phoneNumber: '+912', message: 'b' });

      const stats = mq.getStats();
      expect(stats.depth).to.equal(2);
      expect(stats.totalEnqueued).to.equal(2);
      expect(stats.oldestTimestamp).to.not.be.null;
      expect(stats.newestTimestamp).to.not.be.null;
    });

    it('should return zero depth for empty queue', () => {
      const mq = new MessageQueue();
      const stats = mq.getStats();
      expect(stats.depth).to.equal(0);
      expect(stats.totalEnqueued).to.equal(0);
      expect(stats.oldestTimestamp).to.be.null;
    });
  });
});

// ---------------------------------------------------------------------------
// Integration: full cycle
// ---------------------------------------------------------------------------
describe('Integration: Detection → Fallback → Recovery', () => {
  it('should complete full cycle: health failure → fallback → recovery → normal', () => {
    const detector = new DowntimeDetector({ downtimeThreshold: 3, recoveryThreshold: 2 });
    const fb = new FallbackManager({ fallbackFormUrl: 'https://example.com/form' });

    // Wire detector → fallback
    detector.on('downtime:detected', () => fb.activate('auto'));
    detector.on('downtime:recovered', () => fb.deactivate('auto'));

    // Phase 1: Fail health checks → fallback triggered
    detector.onHealthChange(makeHealthStatus(false));
    detector.onHealthChange(makeHealthStatus(false));
    expect(detector.state).to.equal('NORMAL');
    expect(fb.isActive).to.be.false;

    detector.onHealthChange(makeHealthStatus(false));
    expect(detector.state).to.equal('FALLBACK');
    expect(fb.isActive).to.be.true;

    // Phase 2: Fallback serves response
    const response = fb.getFallbackResponse();
    expect(response.formUrl).to.equal('https://example.com/form');
    expect(fb.totalFallbackResponses).to.equal(1);

    // Phase 3: Recovery
    detector.onHealthChange(makeHealthStatus(true));
    expect(detector.state).to.equal('RECOVERING');
    expect(fb.isActive).to.be.true; // still active during recovery

    detector.onHealthChange(makeHealthStatus(true));
    expect(detector.state).to.equal('NORMAL');
    expect(fb.isActive).to.be.false;
  });

  it('should queue messages during fallback and retain after recovery', () => {
    const detector = new DowntimeDetector({ downtimeThreshold: 2, recoveryThreshold: 2 });
    const fb = new FallbackManager();
    const mq = new MessageQueue();

    detector.on('downtime:detected', () => fb.activate('auto'));
    detector.on('downtime:recovered', () => {
      fb.deactivate('auto');
      // NOT clearing queue automatically — kept for audit
    });

    // Trigger fallback
    detector.onHealthChange(makeHealthStatus(false));
    detector.onHealthChange(makeHealthStatus(false));
    expect(detector.state).to.equal('FALLBACK');

    // Queue messages during fallback
    mq.enqueue({ phoneNumber: '+911', message: 'Need help' });
    mq.enqueue({ phoneNumber: '+912', message: 'Book a bike' });
    expect(mq.getStats().depth).to.equal(2);

    // Recover
    detector.onHealthChange(makeHealthStatus(true));
    detector.onHealthChange(makeHealthStatus(true));
    expect(detector.state).to.equal('NORMAL');

    // Queue is retained after recovery (not auto-cleared)
    expect(mq.getStats().depth).to.equal(2);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('Edge cases', () => {
  it('should handle already failing when monitoring starts', () => {
    const detector = new DowntimeDetector({ downtimeThreshold: 2 });

    // Already has 1 failure before we start
    detector.onHealthChange(makeHealthStatus(false));
    expect(detector.consecutiveFailures).to.equal(1);

    // First check after starting fails → triggers fallback
    detector.onHealthChange(makeHealthStatus(false));
    expect(detector.state).to.equal('FALLBACK');
  });

  it('should not change state when fallback already active and more failures occur', () => {
    const detector = new DowntimeDetector({ downtimeThreshold: 2 });
    detector.onHealthChange(makeHealthStatus(false));
    detector.onHealthChange(makeHealthStatus(false));
    expect(detector.state).to.equal('FALLBACK');

    // More failures while in fallback — state should stay FALLBACK
    detector.onHealthChange(makeHealthStatus(false));
    expect(detector.state).to.equal('FALLBACK');
    expect(detector.consecutiveFailures).to.equal(3); // counter keeps going though
  });

  it('should handle rapid alternating success/failure without false triggers', () => {
    const detector = new DowntimeDetector({ downtimeThreshold: 3, recoveryThreshold: 2 });

    // Alternating — never builds enough consecutive failures
    detector.onHealthChange(makeHealthStatus(false));
    detector.onHealthChange(makeHealthStatus(true));
    detector.onHealthChange(makeHealthStatus(false));
    detector.onHealthChange(makeHealthStatus(true));
    detector.onHealthChange(makeHealthStatus(false));
    detector.onHealthChange(makeHealthStatus(true));

    expect(detector.state).to.equal('NORMAL');
    expect(detector.consecutiveFailures).to.equal(0); // reset on each success
    expect(detector.consecutiveSuccesses).to.equal(1);
  });

  it('should handle empty fallback form URL gracefully', () => {
    const fb = new FallbackManager({ fallbackFormUrl: '', fallbackMessage: 'No form available' });
    const response = fb.getFallbackResponse();
    expect(response.message).to.equal('No form available');
    expect(response.formUrl).to.equal('');
  });

  it('should handle many queued messages', () => {
    const mq = new MessageQueue();
    for (let i = 0; i < 1000; i++) {
      mq.enqueue({ phoneNumber: `+91${i}`, message: `msg-${i}` });
    }
    expect(mq.getStats().depth).to.equal(1000);
    expect(mq.getStats().totalEnqueued).to.equal(1000);

    const allMessages = mq.getQueuedMessages();
    expect(allMessages.length).to.equal(1000);
    expect(allMessages[0].message).to.equal('msg-0');
    expect(allMessages[999].message).to.equal('msg-999');
  });
});

// ---------------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------------
describe('API endpoints', () => {
  // Reset state for API tests — use fresh module-level instances
  beforeEach(async () => {
    // Stop monitoring if running
    healthCheckService.stopMonitoring();
    // Reset detector to NORMAL
    if (downtimeDetector.state !== 'NORMAL') {
      downtimeDetector.forceReset();
    }
    // Deactivate fallback
    if (fallbackManager.isActive) {
      fallbackManager.deactivate('manual');
    }
    // Clear message queue
    messageQueue.clear();
  });

  // Health check
  describe('GET /api/health', () => {
    it('should return health ok', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).to.equal(200);
      expect(res.body.data.status).to.equal('ok');
    });
  });

  // GET /api/monitor/health
  describe('GET /api/monitor/health', () => {
    it('should return current health status', async () => {
      const res = await request(app).get('/api/monitor/health');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.property('isHealthy');
      expect(res.body.data).to.have.property('consecutiveFailures');
      expect(res.body.data).to.have.property('totalChecks');
      expect(res.body).to.have.property('meta');
    });
  });

  // GET /api/monitor/fallback/status
  describe('GET /api/monitor/fallback/status', () => {
    it('should return fallback status', async () => {
      const res = await request(app).get('/api/monitor/fallback/status');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.property('state');
      expect(res.body.data).to.have.property('isActive');
      expect(res.body.data).to.have.property('fallbackFormUrl');
      expect(res.body.data).to.have.property('totalFallbackResponses');
    });
  });

  // POST /api/monitor/fallback/trigger
  describe('POST /api/monitor/fallback/trigger', () => {
    it('should manually trigger fallback', async () => {
      const res = await request(app)
        .post('/api/monitor/fallback/trigger')
        .send({});
      expect(res.status).to.equal(200);
      expect(res.body.data.state).to.equal('FALLBACK');
    });

    it('should return 409 if fallback already active', async () => {
      await request(app).post('/api/monitor/fallback/trigger');
      const res = await request(app).post('/api/monitor/fallback/trigger');
      expect(res.status).to.equal(409);
      expect(res.body.error.code).to.equal(409);
    });
  });

  // POST /api/monitor/fallback/reset
  describe('POST /api/monitor/fallback/reset', () => {
    it('should manually reset fallback', async () => {
      await request(app).post('/api/monitor/fallback/trigger');
      const res = await request(app).post('/api/monitor/fallback/reset');
      expect(res.status).to.equal(200);
      expect(res.body.data.state).to.equal('NORMAL');
    });

    it('should return 409 if already in normal mode', async () => {
      const res = await request(app).post('/api/monitor/fallback/reset');
      expect(res.status).to.equal(409);
      expect(res.body.error.code).to.equal(409);
    });
  });

  // GET /api/monitor/fallback/queue
  describe('GET /api/monitor/fallback/queue', () => {
    it('should return empty queue when no messages', async () => {
      const res = await request(app).get('/api/monitor/fallback/queue');
      expect(res.status).to.equal(200);
      expect(res.body.data.messages).to.be.an('array').that.is.empty;
      expect(res.body.data.total).to.equal(0);
    });

    it('should return queued messages', async () => {
      messageQueue.enqueue({ phoneNumber: '+911', message: 'Help' });
      messageQueue.enqueue({ phoneNumber: '+912', message: 'Book' });

      const res = await request(app).get('/api/monitor/fallback/queue');
      expect(res.status).to.equal(200);
      expect(res.body.data.total).to.equal(2);
      expect(res.body.data.messages[0].message).to.equal('Help');
    });
  });

  // GET /api/monitor/fallback/log
  describe('GET /api/monitor/fallback/log', () => {
    it('should return fallback event log', async () => {
      const res = await request(app).get('/api/monitor/fallback/log');
      expect(res.status).to.equal(200);
      expect(res.body.data.events).to.be.an('array');
      expect(res.body.data).to.have.property('total');
    });
  });

  // Error handler
  describe('Error handling', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await request(app).get('/api/monitor/nonexistent');
      expect(res.status).to.equal(404);
    });
  });
});
