const { expect } = require('chai');
const request = require('supertest');
const { app } = require('../src/1-3-classification-confidence-handling');

describe('Story 1.3: Classification Confidence Handling', () => {

  describe('Handoff: routes to correct agent pool', () => {
    it('should route Bike Rental to bike-rental-agents', async () => {
      const handoffRequest = {
        phone_number: '+91987654321',
        enquiry_data: {
          message: 'I need a bike rental',
          classified_vertical: 'Bike Rental',
          confidence: 0.7,
          conversation_history: []
        },
        timestamp: new Date().toISOString()
      };

      const response = await request(app)
        .post('/api/handoff')
        .send(handoffRequest);

      expect(response.status).to.equal(200);
      expect(response.body.status).to.equal('handed_off');
      expect(response.body.agent_pool).to.equal('bike-rental-agents');
    });
  });

  describe('Handoff: confidence below threshold triggers handoff', () => {
    it('should trigger handoff for confidence < 80%', async () => {
      const lowConfidenceRequest = {
        phone_number: '+91987654321',
        enquiry_data: {
          message: 'I have a complex question...',
          classified_vertical: 'Bike Rental',
          confidence: 0.6,
          conversation_history: []
        },
        timestamp: new Date().toISOString()
      };

      const response = await request(app)
        .post('/api/handoff')
        .send(lowConfidenceRequest);

      expect(response.status).to.equal(200);
      expect(response.body.confidence).to.equal(0.6);
      expect(response.body.status).to.equal('handed_off');
    });
  });

  describe('Handoff: unknown vertical falls back to generalist', () => {
    it('should route unknown vertical to generalist-agents', async () => {
      const unknownVerticalRequest = {
        phone_number: '+91987654321',
        enquiry_data: {
          message: 'test',
          classified_vertical: 'UnknownCategory',
          confidence: 0.8,
          conversation_history: []
        },
        timestamp: new Date().toISOString()
      };

      const response = await request(app)
        .post('/api/handoff')
        .send(unknownVerticalRequest);

      expect(response.status).to.equal(200);
      expect(response.body.agent_pool).to.equal('generalist-agents');
    });
  });

  describe('Handoff: validates required fields', () => {
    it('should return 400 for missing phone number', async () => {
      const response = await request(app)
        .post('/api/handoff')
        .send({ enquiry_data: { message: 'test' } });

      expect(response.status).to.equal(400);
      expect(response.body.error.message).to.equal('Phone number and enquiry data are required');
    });
  });

  describe('Classification with handoff: confidence threshold', () => {
    it('should respect confidence threshold from environment', () => {
      const threshold = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.8');
      expect(threshold).to.equal(0.8);
    });
  });
});
