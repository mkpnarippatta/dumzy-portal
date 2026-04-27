const { expect } = require('chai');
const request = require('supertest');
const { app } = require('../src/1-1-whatsapp-webhook-integration');

describe('Story 1.1: WhatsApp Webhook Integration', () => {

  describe('Webhook: accepts valid payload', () => {
    it('should accept valid webhook payload', async function() {
      this.timeout(5000); // Increase timeout for processing simulation

      const payload = {
        From: '+91987654321',
        ProfileName: 'TestBusiness',
        WaId: '123456',
        Message: 'Hello',
        Timestamp: '2026-04-21T10:00:00Z'
      };

      const response = await request(app)
        .post('/webhook')
        .send(payload);

      expect(response.status).to.equal(200);
    });
  });

  describe('Webhook: rejects invalid payload', () => {
    it('should reject missing required fields', async () => {
      const payload = { From: '+91987654321' }; // Missing required fields

      const response = await request(app)
        .post('/webhook')
        .send(payload);

      expect(response.status).to.equal(400);
      expect(response.body.error.message).to.equal('Invalid webhook payload');
    });
  });

  describe('Webhook: rejects invalid phone format', () => {
    it('should reject invalid phone number format', async () => {
      const payload = {
        From: '123', // Invalid phone format
        ProfileName: 'TestBusiness',
        WaId: '123456',
        Message: 'Hello',
        Timestamp: '2026-04-21T10:00:00Z'
      };

      const response = await request(app)
        .post('/webhook')
        .send(payload);

      expect(response.status).to.equal(400);
    });
  });

  describe('Webhook: queues messages outside business hours', () => {
    it('should queue messages received outside 9 AM - 6 PM', async () => {
      const payload = {
        From: '+91987654321',
        ProfileName: 'TestBusiness',
        WaId: '123456',
        Message: 'I need help',
        Timestamp: '2026-04-21T20:00:00Z' // 8 PM - outside business hours
      };

      const response = await request(app)
        .post('/webhook')
        .send(payload);

      expect(response.status).to.equal(200);
      expect(response.body.status).to.equal('queued');
    });
  });

  describe('Webhook: processes messages during business hours', () => {
    it('should process messages during 9 AM - 6 PM', async function() {
      this.timeout(5000); // Increase timeout for processing simulation

      const payload = {
        From: '+91987654321',
        ProfileName: 'TestBusiness',
        WaId: '123456',
        Message: 'I need help',
        Timestamp: '2026-04-21T14:00:00Z' // 2 PM - during business hours
      };

      const response = await request(app)
        .post('/webhook')
        .send(payload);

      expect(response.status).to.equal(200);
      expect(response.body.status).to.equal('acknowledged');
    });
  });

  describe('Health check endpoint', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.status).to.equal(200);
      expect(response.body.status).to.equal('healthy');
      expect(response.body).to.have.property('uptime');
    });
  });
});
