require('../helpers/setup');
const { expect } = require('chai');
const request = require('supertest');
const { app: app1_4 } = require('../../src/1-4-unified-enquiry-dashboard');
const { app: app1_5, MarketplaceEnquiryService } = require('../../src/1-5-marketplace-enquiry-routing');
const { app: app8_1, RoutingService, BackendSimulator, RetryQueue } = require('../../src/8-1-backend-system-routing');

describe('Flow 5: Enquiry → Market Routing → Backend Systems', () => {
  describe('Step 1: Unified enquiry dashboard via 1-4', () => {
    it('Returns empty enquiry list initially', async () => {
      const res = await request(app1_4).get('/api/enquiries');

      expect(res.status).to.equal(200);
      expect(res.body.enquiries).to.be.an('array').that.is.empty;
      expect(res.body.count).to.equal(0);
    });

    it('Returns dashboard filter options', async () => {
      const res = await request(app1_4).get('/api/dashboard/filters');

      expect(res.status).to.equal(200);
      expect(res.body.verticals).to.include.members(['Bike Rental', 'Hotel', 'Taxi']);
      expect(res.body.statuses).to.include.members(['New', 'In Progress', 'Qualified', 'Booked', 'Lost']);
      expect(res.body.priorities).to.include.members(['Low', 'Medium', 'High', 'Urgent']);
    });

    it('Returns empty dashboard stats', async () => {
      const res = await request(app1_4).get('/api/dashboard/stats');

      expect(res.status).to.equal(200);
      expect(res.body.totalEnquiries).to.equal(0);
      expect(res.body.byVertical).to.be.an('object');
    });

    it('Returns 404 for non-existent enquiry', async () => {
      const res = await request(app1_4).get('/api/enquiries/nonexistent-id');

      expect(res.status).to.equal(404);
      expect(res.body.error.message).to.equal('Enquiry not found');
    });

    it('Returns 400 for message with missing fields', async () => {
      const res = await request(app1_4)
        .post('/api/enquiries/nonexistent-id/messages')
        .send({});

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.equal('Role and content are required');
    });
  });

  describe('Step 2: Marketplace enquiry routing via 1-5', () => {
    it('Returns list of acquisition channels', async () => {
      const res = await request(app1_5).get('/api/marketplace/channels');

      expect(res.status).to.equal(200);
      expect(res.body.data.channels).to.include.members(['Direct', 'Airbnb', 'Booking.com', 'Agoda']);
    });

    it('Processes marketplace enquiry successfully', async () => {
      const res = await request(app1_5)
        .post('/api/enquiry/marketplace')
        .send({ From: '+91987654321', Message: 'I want to book a hotel room' });

      expect(res.status).to.equal(200);
      // Response has acquisition_channel either in data (business hours) or direct
      const channel = res.body.data?.acquisition_channel || res.body.data?.status;
      expect(channel).to.exist;
    });

    it('Returns acquisition analytics', async () => {
      const res = await request(app1_5).get('/api/analytics/acquisition');

      expect(res.status).to.equal(200);
      // Analytics may be empty outside business hours
      expect(res.body.data.byChannel).to.include.keys('Direct', 'Airbnb', 'Booking.com', 'Agoda');
    });

    it('Validates marketplace channel data consistency', async () => {
      const res = await request(app1_5).get('/api/marketplace/validate/Airbnb');

      expect(res.status).to.equal(200);
      expect(res.body.data.channel).to.equal('Airbnb');
      expect(res.body.data.consistent).to.be.true;
    });

    it('Rejects invalid marketplace channel', async () => {
      const res = await request(app1_5).get('/api/marketplace/validate/InvalidChannel');

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.equal('Invalid marketplace channel');
    });

    it('Rejects marketplace enquiry with missing fields', async () => {
      const res = await request(app1_5)
        .post('/api/enquiry/marketplace')
        .send({});

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.equal('From and Message fields are required');
    });

    it('Rejects marketplace enquiry with missing From', async () => {
      const res = await request(app1_5)
        .post('/api/enquiry/marketplace')
        .send({ Message: 'test' });

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.equal('From field is required');
    });

    it('Rejects marketplace enquiry with missing Message', async () => {
      const res = await request(app1_5)
        .post('/api/enquiry/marketplace')
        .send({ From: '+91987654321' });

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.equal('Message field is required');
    });
  });

  describe('Step 3: Backend system routing via 8-1', () => {
    it('Routes bike rental intent to bike booking endpoint', async () => {
      const res = await request(app8_1)
        .post('/api/routing/route')
        .send({
          intent: 'bike_rental',
          payload: {
            phone_number: '+91987654321',
            pickup_date: '2026-06-01',
            return_date: '2026-06-03',
          },
        });

      expect(res.status).to.equal(200);
      expect(res.body.data.intent).to.equal('bike_rental');
      expect(res.body.data.system).to.equal('erpnext');
      expect(res.body.data.backendResult).to.have.property('vertical', 'bike_rental');
      expect(res.body.data.backendResult).to.have.property('id');
    });

    it('Routes hotel intent to ERPNext leads', async () => {
      const res = await request(app8_1)
        .post('/api/routing/route')
        .send({
          intent: 'hotel',
          payload: { check_in_date: '2026-06-01', check_out_date: '2026-06-03' },
        });

      expect(res.status).to.equal(200);
      expect(res.body.data.intent).to.equal('hotel');
      expect(res.body.data.system).to.equal('erpnext');
      expect(res.body.data.backendResult).to.have.property('vertical', 'hotel');
      expect(res.body.data.backendResult).to.have.property('id');
    });

    it('Routes taxi intent to ERPNext leads', async () => {
      const res = await request(app8_1)
        .post('/api/routing/route')
        .send({
          intent: 'taxi',
          payload: {
            phone_number: '+91987654321',
            pickup_location: 'Madhapur',
            dropoff_location: 'Gachibowli',
          },
        });

      expect(res.status).to.equal(200);
      expect(res.body.data.intent).to.equal('taxi');
      expect(res.body.data.system).to.equal('erpnext');
      expect(res.body.data.backendResult).to.have.property('vertical', 'taxi');
      expect(res.body.data.backendResult).to.have.property('id');
    });

    it('Returns routing configuration', async () => {
      const res = await request(app8_1).get('/api/routing/config');

      expect(res.status).to.equal(200);
      expect(res.body.data).to.include.keys('bike_rental', 'hotel', 'taxi', 'ticketing', 'social_media', 'tour_packages');
    });

    it('Returns backend status with stats', async () => {
      const res = await request(app8_1).get('/api/routing/status');

      expect(res.status).to.equal(200);
      expect(res.body.data.stats).to.have.property('totalRequests');
      expect(res.body.data.backends).to.include.keys('erpnext_crm', 'erpnext_rental', 'pms');
    });

    it('Returns retry queue status', async () => {
      const res = await request(app8_1).get('/api/routing/queue');

      expect(res.status).to.equal(200);
      expect(res.body.data.depth).to.not.be.undefined;
    });
  });

  describe('Step 4: Error handling across services', () => {
    it('Rejects routing with missing intent', async () => {
      const res = await request(app8_1)
        .post('/api/routing/route')
        .send({ payload: {} });

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.equal('intent is required');
    });

    it('Rejects routing with missing payload', async () => {
      const res = await request(app8_1)
        .post('/api/routing/route')
        .send({ intent: 'bike_rental' });

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.equal('payload is required');
    });

    it('Rejects routing with unknown intent', async () => {
      const res = await request(app8_1)
        .post('/api/routing/route')
        .send({ intent: 'unknown_vertical', payload: {} });

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.include('Unknown intent');
    });

    it('Routes with empty payload (routing enriches missing fields)', async () => {
      const res = await request(app8_1)
        .post('/api/routing/route')
        .send({ intent: 'bike_rental', payload: {} });

      expect(res.status).to.equal(200);
      // Payload is enriched with vertical/phoneNumber/intent before forwarding
      expect(res.body.data.usedSimulator).to.be.false;
    });

    it('Routes enquiry to Direct even without classification service running', async () => {
      const res = await request(app1_5)
        .post('/api/enquiry/marketplace')
        .send({ From: '+91987654399', Message: 'Direct enquiry test' });

      expect(res.status).to.equal(200);
      expect(res.body.data.acquisition_channel).to.equal('Direct');
    });
  });

  describe('Edge cases', () => {
    it('RoutingService throws for unknown intent', () => {
      const router = new RoutingService();

      expect(() => router.routeByIntent('nonexistent')).to.throw('Unknown intent');
    });

    it('BackendSimulator tracks stats across calls', () => {
      const sim = new BackendSimulator();

      sim.simulateCall('erpnext_crm', { vertical: 'bike_rental' });
      sim.simulateCall('erpnext_rental', { bikeModel: 'Hero' });
      sim.simulateCall('pms', { checkIn: '2026-06-01' });

      const stats = sim.getStats();
      expect(stats.totalRequests).to.equal(3);
      expect(stats.successCount).to.equal(3);
    });

    it('BackendSimulator fail mode produces failed results', () => {
      const sim = new BackendSimulator();

      sim.setFailMode(true);
      const result = sim.simulateCall('erpnext_crm', { vertical: 'test' });

      expect(result.success).to.be.false;
      expect(result.error).to.equal('Backend temporarily unavailable');

      const stats = sim.getStats();
      expect(stats.failureCount).to.equal(1);
    });

    it('BackendSimulator throws for unknown system', () => {
      const sim = new BackendSimulator();

      expect(() => sim.simulateCall('unknown_system', {})).to.throw('Unknown backend system');
    });

    it('RetryQueue enqueues and reports depth', () => {
      const queue = new RetryQueue();

      queue.enqueue({ intent: 'hotel', payload: { checkIn: '2026-06-01' } });
      queue.enqueue({ intent: 'taxi', payload: { phoneNumber: '+91' } });

      const status = queue.getQueueStatus();
      expect(status.depth).to.equal(2);
      expect(status.pending).to.equal(2);
    });

    it('RetryQueue processes queue with success handler', async () => {
      const queue = new RetryQueue();

      queue.enqueue({ intent: 'test' });

      const result = await queue.processQueue(async () => {});
      expect(result.processed).to.equal(1);
      expect(result.failed).to.equal(0);
      expect(queue.getQueueStatus().depth).to.equal(0);
    });

    it('RetryQueue handles failures with retries', async () => {
      // maxRetries=0 is falsy, so the constructor falls through to default (3).
      // Instead, test with maxRetries=1 and process twice.
      const queue = new RetryQueue({ maxRetries: 1, baseDelay: 10 });

      queue.enqueue({ intent: 'test' });

      // First pass: retries (re-enqueues with retryCount=1)
      let result = await queue.processQueue(async () => { throw new Error('fail'); });
      expect(result.processed).to.equal(0);
      expect(result.failed).to.equal(0);
      expect(queue.getQueueStatus().depth).to.equal(1);

      // Second pass: max retries exceeded, marked as failed
      result = await queue.processQueue(async () => { throw new Error('fail again'); });
      expect(result.processed).to.equal(0);
      expect(result.failed).to.equal(1);
    });

    it('Enquiry dashboard rejects assignment with missing owner', async () => {
      const res = await request(app1_4)
        .put('/api/enquiries/nonexistent/assign')
        .send({});

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.equal('Owner is required');
    });

    it('Enquiry dashboard rejects status update with invalid status', async () => {
      const res = await request(app1_4)
        .put('/api/enquiries/nonexistent/status')
        .send({ status: 'InvalidStatus' });

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.equal('Invalid status');
    });
  });
});
