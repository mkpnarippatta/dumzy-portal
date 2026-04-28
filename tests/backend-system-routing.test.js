process.env.MOCHA_TEST_MODE = 'true';
process.env.ROUTING_MAX_RETRIES = '3';
process.env.ROUTING_BASE_DELAY_MS = '100';

const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');
const {
  app,
  RoutingService,
  BackendSimulator,
  RetryQueue,
} = require('../src/8-1-backend-system-routing');

// ---------------------------------------------------------------------------
// RoutingService
// ---------------------------------------------------------------------------
describe('RoutingService', () => {
  let router;

  beforeEach(() => {
    router = new RoutingService();
  });

  describe('routeByIntent', () => {
    it('should map bike_rental to bike booking endpoint', () => {
      const config = router.routeByIntent('bike_rental');
      expect(config.system).to.equal('bike_rental');
      expect(config.endpoint).to.equal('/api/bike/booking');
    });

    it('should map hotel to hotel availability endpoint', () => {
      const config = router.routeByIntent('hotel');
      expect(config.system).to.equal('hotel');
      expect(config.endpoint).to.equal('/api/hotel/availability');
    });

    it('should map taxi to taxi booking endpoint', () => {
      const config = router.routeByIntent('taxi');
      expect(config.system).to.equal('taxi');
      expect(config.endpoint).to.equal('/api/taxi/booking');
    });

    it('should map ticketing to ERPNext leads', () => {
      const config = router.routeByIntent('ticketing');
      expect(config.system).to.equal('erpnext');
      expect(config.endpoint).to.equal('/api/erpnext/leads');
    });

    it('should map social_media to ERPNext leads', () => {
      const config = router.routeByIntent('social_media');
      expect(config.system).to.equal('erpnext');
      expect(config.endpoint).to.equal('/api/erpnext/leads');
    });

    it('should throw error for unknown intent', () => {
      expect(() => router.routeByIntent('unknown_intent')).to.throw();
    });
  });

  describe('getRouteConfig', () => {
    it('should return routing configuration with all intents', () => {
      const config = router.getRouteConfig();
      expect(config).to.have.all.keys('bike_rental', 'hotel', 'taxi', 'ticketing', 'social_media', 'tour_packages');
      expect(config.bike_rental.system).to.equal('bike_rental');
    });
  });
});

// ---------------------------------------------------------------------------
// BackendSimulator
// ---------------------------------------------------------------------------
describe('BackendSimulator', () => {
  let simulator;

  beforeEach(() => {
    simulator = new BackendSimulator();
  });

  describe('simulateCall', () => {
    it('should simulate ERPNext CRM lead creation', () => {
      const result = simulator.simulateCall('erpnext_crm', { customer_phone: '+911234567890', vertical: 'taxi' });
      expect(result.success).to.be.true;
      expect(result.system).to.equal('erpnext_crm');
      expect(result).to.have.property('referenceId');
      expect(result.referenceId).to.match(/^erpnext-crm-/);
    });

    it('should simulate ERPNext Rental booking creation', () => {
      const result = simulator.simulateCall('erpnext_rental', { customer_phone: '+911234567890', bike_model: 'Hero' });
      expect(result.success).to.be.true;
      expect(result.system).to.equal('erpnext_rental');
      expect(result.referenceId).to.match(/^erpnext-rental-/);
    });

    it('should simulate PMS availability query', () => {
      const result = simulator.simulateCall('pms', { check_in: '2026-05-10', check_out: '2026-05-12' });
      expect(result.success).to.be.true;
      expect(result.system).to.equal('pms');
      expect(result).to.have.property('availableRooms');
    });

    it('should fail when fail mode is enabled', () => {
      simulator.setFailMode(true);
      const result = simulator.simulateCall('erpnext_crm', { customer_phone: '+911234567890' });
      expect(result.success).to.be.false;
      expect(result.error).to.exist;
    });

    it('should throw for unknown backend system', () => {
      expect(() => simulator.simulateCall('unknown_system', {})).to.throw();
    });
  });

  describe('getStats', () => {
    it('should track total requests', () => {
      simulator.simulateCall('erpnext_crm', {});
      simulator.simulateCall('pms', {});
      const stats = simulator.getStats();
      expect(stats.totalRequests).to.equal(2);
    });

    it('should track success and failure counts', () => {
      simulator.simulateCall('erpnext_crm', {});
      simulator.setFailMode(true);
      simulator.simulateCall('erpnext_crm', {});
      const stats = simulator.getStats();
      expect(stats.successCount).to.equal(1);
      expect(stats.failureCount).to.equal(1);
    });
  });

  describe('reset', () => {
    it('should clear all data and stats', () => {
      simulator.simulateCall('erpnext_crm', { customer_phone: '+911234567890' });
      simulator.reset();
      expect(simulator.getStats().totalRequests).to.equal(0);
    });
  });
});

// ---------------------------------------------------------------------------
// RetryQueue
// ---------------------------------------------------------------------------
describe('RetryQueue', () => {
  let queue;

  beforeEach(() => {
    queue = new RetryQueue({ maxRetries: 3, baseDelay: 10 });
  });

  describe('enqueue', () => {
    it('should add an item to the queue', () => {
      queue.enqueue({ intent: 'bike_rental', payload: { phoneNumber: '+911234567890' } });
      expect(queue.getQueueStatus().depth).to.equal(1);
    });

    it('should set retryCount to 0', () => {
      queue.enqueue({ intent: 'bike_rental', payload: {} });
      expect(queue.queue[0].retryCount).to.equal(0);
    });

    it('should add timestamp to queued item', () => {
      queue.enqueue({ intent: 'bike_rental', payload: {} });
      expect(queue.queue[0]).to.have.property('timestamp');
    });
  });

  describe('processQueue', () => {
    it('should process items and call the handler', async () => {
      const handler = sinon.stub().resolves({ success: true });
      queue.enqueue({ intent: 'bike_rental', payload: {} });
      await queue.processQueue(handler);
      expect(handler.calledOnce).to.be.true;
      expect(queue.getQueueStatus().depth).to.equal(0);
    });

    it('should retry failed items up to maxRetries', async () => {
      const handler = sinon.stub().rejects(new Error('Backend unavailable'));
      queue.enqueue({ intent: 'bike_rental', payload: {} });
      await queue.processQueue(handler);
      expect(queue.getQueueStatus().depth).to.equal(1);
      expect(queue.queue[0].retryCount).to.equal(1);
      expect(queue.queue[0].lastError).to.equal('Backend unavailable');
    });

    it('should remove items that exceed maxRetries', async () => {
      const handler = sinon.stub().rejects(new Error('Failed'));
      queue.enqueue({ intent: 'bike_rental', payload: {} });
      queue.queue[0].retryCount = 3; // simulate 3 prior retries
      await queue.processQueue(handler);
      expect(queue.getQueueStatus().depth).to.equal(0);
      expect(queue.getQueueStatus().totalFailed).to.equal(1);
    });

    it('should not process concurrently', async () => {
      let concurrent = false;
      const handler = sinon.stub().callsFake(async () => {
        concurrent = queue.processing;
        await new Promise(r => setTimeout(r, 50));
      });
      queue.enqueue({ intent: 'bike_rental', payload: {} });
      queue.enqueue({ intent: 'hotel', payload: {} });
      await queue.processQueue(handler);
      expect(handler.calledTwice).to.be.true;
    });
  });

  describe('getQueueStatus', () => {
    it('should return depth, pending failed counts', () => {
      queue.enqueue({ intent: 'bike_rental', payload: {} });
      queue.enqueue({ intent: 'hotel', payload: {} });
      const status = queue.getQueueStatus();
      expect(status.depth).to.equal(2);
      expect(status.pending).to.equal(2);
      expect(status.totalFailed).to.equal(0);
    });
  });

  describe('clearQueue', () => {
    it('should empty the queue', () => {
      queue.enqueue({ intent: 'bike_rental', payload: {} });
      queue.clearQueue();
      expect(queue.getQueueStatus().depth).to.equal(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------
describe('Integration', () => {
  let simulator;
  let retryQueue;

  beforeEach(() => {
    simulator = new BackendSimulator();
    retryQueue = new RetryQueue({ maxRetries: 2, baseDelay: 10 });
  });

  it('should complete full cycle: route bike_rental → simulate success → verify stats', () => {
    const result = simulator.simulateCall('erpnext_rental', { phoneNumber: '+911234567890', bike_model: 'Hero Splendor' });
    expect(result.success).to.be.true;
    expect(result.referenceId).to.match(/^erpnext-rental-/);

    expect(simulator.getStats().totalRequests).to.equal(1);
    expect(simulator.getStats().successCount).to.equal(1);
  });

  it('should route hotel → backend fails → enqueue → retry succeeds', async () => {
    const payload = { check_in: '2026-05-10', check_out: '2026-05-12', guests: 2 };

    simulator.setFailMode(true);
    const failResult = simulator.simulateCall('pms', payload);
    expect(failResult.success).to.be.false;

    retryQueue.enqueue({ intent: 'hotel', payload, system: 'pms', transformedData: payload });

    simulator.setFailMode(false);
    const retryHandler = async (item) => {
      const result = simulator.simulateCall(item.system, item.transformedData);
      if (!result.success) throw new Error('Backend failed');
      return result;
    };
    await retryQueue.processQueue(retryHandler);

    expect(simulator.getStats().successCount).to.equal(1);
    expect(retryQueue.getQueueStatus().depth).to.equal(0);
  });

  it('should handle unknown intent gracefully', () => {
    const router = new RoutingService();
    expect(() => router.routeByIntent('unknown_intent')).to.throw();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('Edge cases', () => {
  it('should handle empty payload for route', () => {
    const router = new RoutingService();
    expect(() => router.routeByIntent('bike_rental')).to.not.throw();
  });

  it('should handle simulator with empty data', () => {
    const sim = new BackendSimulator();
    const result = sim.simulateCall('pms', {});
    expect(result.success).to.be.true;
    expect(result.availableRooms).to.be.an('array');
  });

  it('should handle retry queue with no items', async () => {
    const queue = new RetryQueue();
    const handler = sinon.stub().resolves({ success: true });
    await queue.processQueue(handler);
    expect(handler.called).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------------
describe('API endpoints', () => {
  describe('POST /api/routing/route', () => {
    it('should route an enquiry by intent (falls back to simulator)', async () => {
      const res = await request(app)
        .post('/api/routing/route')
        .send({
          intent: 'bike_rental',
          payload: { phone_number: '+911234567890', bike_model: 'Hero Splendor', pickup_date: '2026-05-01', return_date: '2026-05-03' },
        });
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.property('intent', 'bike_rental');
      expect(res.body.data).to.have.property('system', 'bike_rental');
      expect(res.body.data).to.have.property('usedSimulator', true);
      expect(res.body.data).to.have.property('backendResult');
    });

    it('should return 400 for unknown intent', async () => {
      const res = await request(app)
        .post('/api/routing/route')
        .send({ intent: 'unknown', payload: { phoneNumber: '+911234567890' } });
      expect(res.status).to.equal(400);
    });

    it('should return 400 for missing intent', async () => {
      const res = await request(app)
        .post('/api/routing/route')
        .send({ payload: { phoneNumber: '+911234567890' } });
      expect(res.status).to.equal(400);
    });
  });

  describe('GET /api/routing/config', () => {
    it('should return routing configuration', async () => {
      const res = await request(app).get('/api/routing/config');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.all.keys('bike_rental', 'hotel', 'taxi', 'ticketing', 'social_media', 'tour_packages');
    });
  });

  describe('GET /api/routing/status', () => {
    it('should return backend health and stats', async () => {
      const res = await request(app).get('/api/routing/status');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.property('stats');
      expect(res.body.data).to.have.property('backends');
    });
  });

  describe('GET /api/routing/queue', () => {
    it('should return retry queue status', async () => {
      const res = await request(app).get('/api/routing/queue');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.property('depth');
      expect(res.body.data).to.have.property('pending');
      expect(res.body.data).to.have.property('totalFailed');
    });
  });

  describe('POST /api/routing/queue/process', () => {
    it('should process the retry queue', async () => {
      const res = await request(app).post('/api/routing/queue/process');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.property('processed');
    });
  });
});
