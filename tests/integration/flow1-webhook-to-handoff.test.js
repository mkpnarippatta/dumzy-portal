require('../helpers/setup');
const { expect } = require('chai');
const request = require('supertest');
const { app: app1_1 } = require('../../src/1-1-whatsapp-webhook-integration');
const { app: app1_2 } = require('../../src/1-2-ai-intent-classification-service');
const { app: app1_3 } = require('../../src/1-3-classification-confidence-handling');
const { app: app4_1 } = require('../../src/4-1-seamless-handoff-trigger');
const { app: app4_2 } = require('../../src/4-2-context-transfer-to-agent');
const { app: app4_3 } = require('../../src/4-3-agent-pool-routing');
const { AgentPoolRoutingService } = require('../../src/4-3-agent-pool-routing');
const { validWebhookPayload, ambiguousMessage } = require('../helpers/fixtures');

describe('Flow 1: Incoming Webhook → AI Classification → Handoff', () => {
  it('Step 1: Valid webhook payload accepted by 1-1 webhook service', async () => {
    const payload = validWebhookPayload();
    const res = await request(app1_1)
      .post('/webhook')
      .send(payload);

    expect(res.status).to.equal(200);
    expect(res.body.status).to.be.oneOf(['acknowledged', 'processed', 'queued']);
  });

  it('Step 2: Invalid webhook payload rejected with 400', async () => {
    const res = await request(app1_1)
      .post('/webhook')
      .send({ invalid: true });

    expect(res.status).to.equal(400);
    expect(res.body.error.message).to.equal('Invalid webhook payload');
  });

  it('Step 3: Message classified by 1-2 AI intent service', async () => {
    const res = await request(app1_2)
      .post('/api/intent/classify')
      .send({ message: 'I need to rent a bike in Hyderabad' });

    expect(res.status).to.equal(200);
    expect(res.body.vertical).to.equal('Bike Rental');
    expect(res.body.confidence).to.be.at.least(0.8);
    expect(res.body.requires_human_handoff).to.be.false;
  });

  it('Step 4: Ambiguous message gets lower confidence', async () => {
    const res = await request(app1_2)
      .post('/api/intent/classify')
      .send({ message: ambiguousMessage() });

    expect(res.status).to.equal(200);
    expect(res.body.confidence).to.be.lessThan(0.8);
    expect(res.body.requires_human_handoff).to.be.true;
  });

  it('Step 5: High-confidence classification routes via 1-3', async () => {
    const res = await request(app1_3)
      .post('/api/handoff')
      .send({
        phone_number: '+91987654321',
        enquiry_data: {
          classified_vertical: 'Bike Rental',
          confidence: 0.9,
          conversation_history: [
            { message: 'I want to rent a bike', direction: 'incoming' },
          ],
        },
      });

    expect(res.status).to.equal(200);
    expect(res.body.status).to.equal('handed_off');
    expect(res.body.agent_pool).to.equal('bike-rental-agents');
  });

  it('Step 6: Low-confidence classification triggers handoff via 4-1', async () => {
    const res = await request(app4_1)
      .post('/api/handoff/initiate')
      .send({
        phone_number: '+91987654321',
        classification_confidence: 0.3,
        classification_vertical: 'Unknown',
        conversation_history: [
          { message: 'I need help with something complicated', direction: 'incoming' },
          { message: 'Can you explain more?', direction: 'outgoing' },
          { message: 'I have multiple things I need', direction: 'incoming' },
        ],
      });

    expect(res.status).to.equal(200);
    expect(res.body.data.success).to.be.true;
    expect(res.body.data.status).to.be.oneOf(['transferring', 'queued', 'queued_outside_hours']);
    expect(res.body.data.request_id).to.exist;
  });

  it('Step 7: Handoff context populated and retrievable via 4-2', async () => {
    // Use 4-2's initiate endpoint so the context is stored in 4-2's in-memory store
    const initiateRes = await request(app4_2)
      .post('/api/handoff/initiate')
      .send({
        phone_number: '+91987654322',
        classification_confidence: 0.4,
        classification_vertical: 'Bike Rental',
        conversation_history: [
          { message: 'I want to rent a bike', direction: 'incoming' },
        ],
      });

    expect(initiateRes.status).to.equal(200);
    const requestId = initiateRes.body.data.request_id;

    const contextRes = await request(app4_2)
      .get(`/api/handoff/context/${requestId}`);

    expect(contextRes.status).to.equal(200);
    expect(contextRes.body.data).to.exist;
  });

  it('Step 8: Agent pool routing via 4-3 assigns correct pool', async () => {
    const { AgentPoolConfig, AgentPoolRoutingService } = require('../../src/4-3-agent-pool-routing');
    const config = new AgentPoolConfig();
    config.addAgent('bike-rental-pool', {
      id: 'agent-test', name: 'Test Agent', status: 'available', active_conversations: 0,
    });
    const router = new AgentPoolRoutingService(config);

    const result = router.routeToPool(
      { vertical: 'Bike Rental', confidence: 0.85 },
      { flow_data: { total_submissions: 0, flow_submissions: [] } }
    );

    expect(result.pool_name).to.equal('Bike Rental Agents');
    expect(result.routing_reason).to.equal('VERTICAL_MATCH');
  });

  describe('Edge cases', () => {
    it('Rejects classification with empty message', async () => {
      const res = await request(app1_2)
        .post('/api/intent/classify')
        .send({ message: '' });

      expect(res.status).to.equal(400);
    });

    it('High-confidence unknown vertical routes to generalist', async () => {
      const { AgentPoolConfig, AgentPoolRoutingService } = require('../../src/4-3-agent-pool-routing');
      const config = new AgentPoolConfig();
      config.addAgent('generalist-pool', {
        id: 'agent-g', name: 'Gen Agent', status: 'available', active_conversations: 0,
      });
      const router = new AgentPoolRoutingService(config);

      const result = router.routeToPool(
        { vertical: 'Unknown', confidence: 0.95 },
        { flow_data: { total_submissions: 0, flow_submissions: [] } }
      );

      expect(result.pool_name).to.equal('Generalist Agents');
      expect(result.routing_reason).to.equal('VERTICAL_MATCH');
    });

    it('Low confidence always routes to generalist', async () => {
      const { AgentPoolConfig, AgentPoolRoutingService } = require('../../src/4-3-agent-pool-routing');
      const router = new AgentPoolRoutingService(new AgentPoolConfig());

      const result = router.routeToPool(
        { vertical: 'Bike Rental', confidence: 0.3 },
        { flow_data: { total_submissions: 0, flow_submissions: [] } }
      );

      expect(result.pool_name).to.equal('Generalist Agents');
      expect(result.routing_reason).to.equal('LOW_CONFIDENCE');
    });
  });
});
