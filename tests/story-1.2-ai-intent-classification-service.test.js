const { expect } = require('chai');
const request = require('supertest');
const { app } = require('../src/1-2-ai-intent-classification-service');

describe('Story 1.2: AI Intent Classification Service', () => {

  describe('AI Classify: correctly identifies Bike Rental vertical', () => {
    it('should classify bike rental messages correctly', async () => {
      const message = 'I need to rent a bike for this weekend';

      const response = await request(app)
        .post('/api/intent/classify')
        .send({ message });

      expect(response.status).to.equal(200);
      expect(response.body.vertical).to.equal('Bike Rental');
      expect(response.body.confidence).to.be.at.least(0.8);
      expect(response.body.requires_human_handoff).to.be.false;
    });
  });

  describe('AI Classify: correctly identifies Hotel vertical', () => {
    it('should classify hotel messages correctly', async () => {
      const message = 'Do you have hotel rooms available for this weekend?';

      const response = await request(app)
        .post('/api/intent/classify')
        .send({ message });

      expect(response.status).to.equal(200);
      expect(response.body.vertical).to.equal('Hotel');
      expect(response.body.confidence).to.be.at.least(0.8);
      expect(response.body.requires_human_handoff).to.be.false;
    });
  });

  describe('AI Classify: triggers human handoff below 80% confidence', () => {
    it('should trigger handoff for low confidence', async () => {
      const message = 'I have a complex enquiry about multiple services...';

      const response = await request(app)
        .post('/api/intent/classify')
        .send({ message });

      expect(response.status).to.equal(200);
      expect(response.body.vertical).to.equal('Unknown');
      expect(response.body.confidence).to.be.lessThan(0.8);
      expect(response.body.requires_human_handoff).to.be.true;
    });
  });

  describe('AI Classify: requires message field', () => {
    it('should return 400 for missing message', async () => {
      const response = await request(app)
        .post('/api/intent/classify')
        .send({ });

      expect(response.status).to.equal(400);
      expect(response.body.error.message).to.equal('Message is required');
    });
  });

  describe('Health check endpoint', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/api/health');

      expect(response.status).to.equal(200);
      expect(response.body.status).to.equal('healthy');
      expect(response.body).to.have.property('uptime');
      expect(response.body).to.have.property('deepseek_configured');
    });
  });
});
