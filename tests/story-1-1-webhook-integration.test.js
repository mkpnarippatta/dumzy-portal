const { expect } = require('chai');
const request = require('supertest');
const { app } = require('../src/1-1-whatsapp-webhook-integration');

describe('Story 1.1: WhatsApp Webhook Integration', () => {

  describe('Webhook verification (GET)', () => {
    it('should verify with correct token', async () => {
      const response = await request(app)
        .get('/webhook?hub.mode=subscribe&hub.verify_token=dev-secret&hub.challenge=123456');

      expect(response.status).to.equal(200);
      expect(response.text).to.equal('123456');
    });

    it('should reject incorrect token', async () => {
      const response = await request(app)
        .get('/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123456');

      expect(response.status).to.equal(403);
    });
  });

  describe('Webhook: accepts valid payload', () => {
    it('should accept valid webhook payload', async function() {
      this.timeout(5000);

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
    it('should return 200 for invalid payload (WhatsApp requires 200)', async () => {
      const payload = { From: '+91987654321' }; // Missing required fields

      const response = await request(app)
        .post('/webhook')
        .send(payload);

      expect(response.status).to.equal(200);
    });
  });

  describe('Integration endpoint: processes messages', () => {
    it('should classify and route during business hours', async function() {
      this.timeout(10000);

      const payload = {
        From: '+91987654321',
        ProfileName: 'TestBusiness',
        WaId: '123456',
        Message: 'I want to rent a bike',
        Timestamp: '2026-04-21T14:00:00Z'
      };

      const response = await request(app)
        .post('/webhook/integration')
        .send(payload);

      expect(response.status).to.equal(200);
      expect(response.body.status).to.equal('processed');
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
