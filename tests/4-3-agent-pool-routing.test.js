const request = require('supertest');
const { expect } = require('chai');
const { app, AgentPoolConfig, AgentPoolRoutingService, HandoffRoutingService } = require('../src/4-3-agent-pool-routing');

// ============================================================================
// TASK 1: TESTS FOR AGENT POOL CONFIGURATION
// ============================================================================

describe('Task 1: Agent Pool Configuration', () => {
  let agentPoolConfig;

  beforeEach(() => {
    agentPoolConfig = new AgentPoolConfig();
  });

  describe('getPoolForVertical', () => {
    it('should return Bike Rental pool for bike rental vertical', () => {
      const pool = agentPoolConfig.getPoolForVertical('Bike Rental');

      expect(pool).to.not.be.null;
      expect(pool.id).to.equal('bike-rental-pool');
      expect(pool.name).to.equal('Bike Rental Agents');
      expect(pool.vertical).to.equal('Bike Rental');
    });

    it('should return Hotel pool for hotel vertical', () => {
      const pool = agentPoolConfig.getPoolForVertical('Hotel');

      expect(pool).to.not.be.null;
      expect(pool.id).to.equal('hotel-pool');
      expect(pool.name).to.equal('Hotel Agents');
      expect(pool.vertical).to.equal('Hotel');
    });

    it('should return Taxi pool for taxi vertical', () => {
      const pool = agentPoolConfig.getPoolForVertical('Taxi');

      expect(pool).to.not.be.null;
      expect(pool.id).to.equal('taxi-pool');
      expect(pool.name).to.equal('Taxi Agents');
      expect(pool.vertical).to.equal('Taxi');
    });

    it('should fallback to Generalist pool for unknown vertical', () => {
      const pool = agentPoolConfig.getPoolForVertical('Unknown');

      expect(pool).to.not.be.null;
      expect(pool.id).to.equal('generalist-pool');
      expect(pool.name).to.equal('Generalist Agents');
    });

    it('should return pool with capacity limit', () => {
      const pool = agentPoolConfig.getPoolForVertical('Bike Rental');

      expect(pool).to.have.property('capacity');
      expect(pool.capacity).to.equal(10);
    });

    it('should return pool with priority', () => {
      const pool = agentPoolConfig.getPoolForVertical('Bike Rental');

      expect(pool).to.have.property('priority');
      expect(pool.priority).to.equal(1);
    });
  });

  describe('addAgent', () => {
    beforeEach(() => {
      // Clear all pools before each test
      agentPoolConfig = new AgentPoolConfig();
    });

    it('should add agent to correct pool', () => {
      agentPoolConfig.addAgent('bike-rental-pool', {
        id: 'agent-1',
        name: 'John Doe',
        status: 'available'
      });

      const pool = agentPoolConfig.getPoolForVertical('Bike Rental');
      expect(pool.agents).to.have.lengthOf(1);
      expect(pool.agents[0].id).to.equal('agent-1');
    });

    it('should add multiple agents to pool', () => {
      agentPoolConfig.addAgent('hotel-pool', {
        id: 'agent-1',
        name: 'Agent 1',
        status: 'available'
      });
      agentPoolConfig.addAgent('hotel-pool', {
        id: 'agent-2',
        name: 'Agent 2',
        status: 'busy'
      });

      const pool = agentPoolConfig.getPoolForVertical('Hotel');
      expect(pool.agents).to.have.lengthOf(2);
    });
  });
});

// ============================================================================
// TASK 2: TESTS FOR INTENT-BASED ROUTING
// ============================================================================

describe('Task 2: Intent-Based Routing', () => {
  let agentPoolConfig, agentPoolRoutingService;

  beforeEach(() => {
    agentPoolConfig = new AgentPoolConfig();
    agentPoolConfig.addAgent('bike-rental-pool', { id: 'br-1', name: 'Bike 1', status: 'available', active_conversations: 0 });
    agentPoolConfig.addAgent('hotel-pool', { id: 'h-1', name: 'Hotel 1', status: 'available', active_conversations: 0 });
    agentPoolConfig.addAgent('taxi-pool', { id: 't-1', name: 'Taxi 1', status: 'available', active_conversations: 0 });
    agentPoolConfig.addAgent('generalist-pool', { id: 'g-1', name: 'Gen 1', status: 'available', active_conversations: 0 });
    agentPoolRoutingService = new AgentPoolRoutingService(agentPoolConfig);
  });

  describe('routeToPool', () => {
    it('should route to Bike Rental pool for bike rental intent', () => {
      const classificationResult = { confidence: 0.90, vertical: 'Bike Rental' };
      const conversationContext = { flow_data: { total_submissions: 0 } };

      const result = agentPoolRoutingService.routeToPool(classificationResult, conversationContext);

      expect(result.pool_id).to.equal('bike-rental-pool');
      expect(result.vertical).to.equal('Bike Rental');
      expect(result.routing_reason).to.equal('VERTICAL_MATCH');
    });

    it('should route to Hotel pool for hotel intent', () => {
      const classificationResult = { confidence: 0.85, vertical: 'Hotel' };
      const conversationContext = { flow_data: { total_submissions: 0 } };

      const result = agentPoolRoutingService.routeToPool(classificationResult, conversationContext);

      expect(result.pool_id).to.equal('hotel-pool');
      expect(result.vertical).to.equal('Hotel');
      expect(result.routing_reason).to.equal('VERTICAL_MATCH');
    });

    it('should route to Taxi pool for taxi intent', () => {
      const classificationResult = { confidence: 0.88, vertical: 'Taxi' };
      const conversationContext = { flow_data: { total_submissions: 0 } };

      const result = agentPoolRoutingService.routeToPool(classificationResult, conversationContext);

      expect(result.pool_id).to.equal('taxi-pool');
      expect(result.vertical).to.equal('Taxi');
    });

    it('should route to Generalist pool for low confidence', () => {
      const classificationResult = { confidence: 0.55, vertical: 'Bike Rental' };
      const conversationContext = { flow_data: { total_submissions: 0 } };

      const result = agentPoolRoutingService.routeToPool(classificationResult, conversationContext);

      expect(result.pool_id).to.equal('generalist-pool');
      expect(result.routing_reason).to.equal('LOW_CONFIDENCE');
      expect(result.original_vertical).to.equal('Bike Rental');
    });
  });
});

// ============================================================================
// TASK 3: TESTS FOR CROSS-VERTICAL ROUTING
// ============================================================================

describe('Task 3: Cross-Vertical Routing', () => {
  let agentPoolConfig, agentPoolRoutingService;

  beforeEach(() => {
    agentPoolConfig = new AgentPoolConfig();
    agentPoolRoutingService = new AgentPoolRoutingService(agentPoolConfig);
  });

  describe('detectMultiVertical', () => {
    it('should detect single vertical conversation', () => {
      const conversationContext = {
        flow_data: {
          total_submissions: 1,
          flow_submissions: [{ vertical: 'Bike Rental' }]
        }
      };

      const isMultiVertical = agentPoolRoutingService.detectMultiVertical(conversationContext);

      expect(isMultiVertical).to.be.false;
    });

    it('should detect multi-vertical conversation', () => {
      const conversationContext = {
        flow_data: {
          total_submissions: 2,
          flow_submissions: [
            { vertical: 'Bike Rental' },
            { vertical: 'Hotel' }
          ]
        }
      };

      const isMultiVertical = agentPoolRoutingService.detectMultiVertical(conversationContext);

      expect(isMultiVertical).to.be.true;
    });

    it('should route to Generalist for multi-vertical conversation', () => {
      const classificationResult = { confidence: 0.85, vertical: 'Bike Rental' };
      const conversationContext = {
        flow_data: {
          total_submissions: 2,
          flow_submissions: [
            { vertical: 'Bike Rental' },
            { vertical: 'Taxi' }
          ]
        }
      };

      const result = agentPoolRoutingService.routeToPool(classificationResult, conversationContext);

      expect(result.pool_id).to.equal('generalist-pool');
      expect(result.routing_reason).to.equal('MULTI_VERTICAL');
    });
  });
});

// ============================================================================
// TASK 4: TESTS FOR LOAD BALANCING
// ============================================================================

describe('Task 4: Load Balancing', () => {
  let agentPoolConfig, agentPoolRoutingService;

  beforeEach(() => {
    agentPoolConfig = new AgentPoolConfig();
    agentPoolConfig.addAgent('bike-rental-pool', {
      id: 'agent-1',
      name: 'Agent 1',
      status: 'available',
      active_conversations: 2
    });
    agentPoolConfig.addAgent('bike-rental-pool', {
      id: 'agent-2',
      name: 'Agent 2',
      status: 'available',
      active_conversations: 0
    });
    agentPoolConfig.addAgent('bike-rental-pool', {
      id: 'agent-3',
      name: 'Agent 3',
      status: 'available',
      active_conversations: 1
    });

    agentPoolRoutingService = new AgentPoolRoutingService(agentPoolConfig);
  });

  describe('selectAgent', () => {
    it('should select least-busy agent by default', () => {
      const pool = agentPoolConfig.getPoolForVertical('Bike Rental');
      const selectedAgent = agentPoolRoutingService.selectAgent(pool);

      expect(selectedAgent).to.not.be.null;
      expect(selectedAgent.id).to.equal('agent-2'); // Has 0 active conversations
    });

    it('should select agent with lowest active_conversations', () => {
      const pool = agentPoolConfig.getPoolForVertical('Bike Rental');
      const selectedAgent = agentPoolRoutingService.selectAgent(pool);

      expect(selectedAgent.active_conversations).to.equal(0);
    });
  });
});

// ============================================================================
// TASK 5: API ENDPOINTS
// ============================================================================

describe('API Endpoints', () => {
  describe('POST /api/handoff/route', () => {
    it('should route to appropriate pool and return agent', async () => {
      const classificationResult = { confidence: 0.90, vertical: 'Bike Rental' };
      const conversationContext = {
        flow_data: { total_submissions: 0, flow_submissions: [] }
      };

      const response = await request(app)
        .post('/api/handoff/route')
        .send({
          phone_number: '+919876543210',
          classification_result: classificationResult,
          conversation_context: conversationContext
        });

      expect(response.status).to.equal(200);
      expect(response.body.data).to.have.property('success', true);
      expect(response.body.data).to.have.property('routing');
      expect(response.body.data.routing).to.have.property('pool_id');
      expect(response.body.data.routing).to.have.property('agent');
    });

    it('should route to Generalist for low confidence', async () => {
      const classificationResult = { confidence: 0.55, vertical: 'Bike Rental' };
      const conversationContext = {
        flow_data: { total_submissions: 0, flow_submissions: [] }
      };

      const response = await request(app)
        .post('/api/handoff/route')
        .send({
          phone_number: '+919876543210',
          classification_result: classificationResult,
          conversation_context: conversationContext
        });

      expect(response.status).to.equal(200);
      expect(response.body.data.routing.pool_id).to.equal('generalist-pool');
      expect(response.body.data.routing.routing_reason).to.equal('LOW_CONFIDENCE');
    });

    it('should reject without phone_number', async () => {
      const response = await request(app)
        .post('/api/handoff/route')
        .send({
          classification_result: { confidence: 0.90, vertical: 'Bike Rental' },
          conversation_context: { flow_data: { total_submissions: 0 } }
        });

      expect(response.status).to.equal(400);
      expect(response.body).to.have.property('error');
    });
  });

  describe('GET /api/agent-pools', () => {
    it('should return all agent pools', async () => {
      const response = await request(app).get('/api/agent-pools');

      expect(response.status).to.equal(200);
      expect(response.body.data).to.be.an('array');
      expect(response.body.data.length).to.be.greaterThan(0);
    });

    it('should include pool details', async () => {
      const response = await request(app).get('/api/agent-pools');

      const pool = response.body.data[0];
      expect(pool).to.have.property('id');
      expect(pool).to.have.property('name');
      expect(pool).to.have.property('vertical');
      expect(pool).to.have.property('capacity');
      expect(pool).to.have.property('priority');
      expect(pool).to.have.property('agents');
    });
  });

  describe('POST /api/agent-pools/:poolId/agents', () => {
    it('should add agent to pool', async () => {
      const response = await request(app)
        .post('/api/agent-pools/bike-rental-pool/agents')
        .send({
          id: 'agent-new',
          name: 'New Agent',
          status: 'available',
          active_conversations: 0
        });

      expect(response.status).to.equal(200);
      expect(response.body.data).to.have.property('success', true);
    });
  });
});
