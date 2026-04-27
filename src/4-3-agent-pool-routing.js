const express = require('express');

class AgentPoolConfig {
  constructor() {
    this.pools = new Map();
    this.pools.set('Bike Rental', {
      id: 'bike-rental-pool',
      name: 'Bike Rental Agents',
      vertical: 'Bike Rental',
      agents: [],
      capacity: 10,
      priority: 1
    });
    this.pools.set('Hotel', {
      id: 'hotel-pool',
      name: 'Hotel Agents',
      vertical: 'Hotel',
      agents: [],
      capacity: 10,
      priority: 2
    });
    this.pools.set('Taxi', {
      id: 'taxi-pool',
      name: 'Taxi Agents',
      vertical: 'Taxi',
      agents: [],
      capacity: 10,
      priority: 3
    });
    this.pools.set('Ticketing', {
      id: 'ticketing-pool',
      name: 'Ticketing Agents',
      vertical: 'Ticketing',
      agents: [],
      capacity: 10,
      priority: 4
    });
    this.pools.set('Social Media', {
      id: 'social-media-pool',
      name: 'Social Media Agents',
      vertical: 'Social Media',
      agents: [],
      capacity: 10,
      priority: 5
    });
    this.pools.set('Generalist', {
      id: 'generalist-pool',
      name: 'Generalist Agents',
      vertical: 'General',
      agents: [],
      capacity: 20,
      priority: 99,
      supportsAllVerticals: true
    });
  }

  getPoolForVertical(vertical) {
    return this.pools.get(vertical) || this.pools.get('Generalist');
  }

  addAgent(poolId, agent) {
    for (const pool of this.pools.values()) {
      if (pool.id === poolId) {
        pool.agents.push(agent);
        break;
      }
    }
  }

  getAllPools() {
    return Array.from(this.pools.values()).map(pool => ({
      id: pool.id,
      name: pool.name,
      vertical: pool.vertical,
      capacity: pool.capacity,
      priority: pool.priority,
      agents: pool.agents.map(a => ({
        id: a.id,
        name: a.name,
        status: a.status,
        active_conversations: a.active_conversations || 0
      }))
    }));
  }
}

class AgentPoolRoutingService {
  constructor(agentPoolConfig) {
    this.agentPoolConfig = agentPoolConfig;
    this.loadBalancingStrategy = process.env.LOAD_BALANCING_STRATEGY || 'least-busy';
    this.roundRobinIndex = 0;
  }

  routeToPool(classificationResult, conversationContext) {
    if (classificationResult.confidence < 0.6) {
      return this.routeToGeneralist(classificationResult, 'LOW_CONFIDENCE');
    }

    const isMultiVertical = this.detectMultiVertical(conversationContext);
    if (isMultiVertical) {
      return this.routeToGeneralist(classificationResult, 'MULTI_VERTICAL');
    }

    const targetPool = this.agentPoolConfig.getPoolForVertical(classificationResult.vertical);
    const selectedAgent = this.selectAgent(targetPool);

    if (!selectedAgent) {
      return this.routeToGeneralist(classificationResult, 'POOL_EXHAUSTED');
    }

    return {
      pool_id: targetPool.id,
      pool_name: targetPool.name,
      vertical: targetPool.vertical,
      agent: selectedAgent,
      routing_reason: 'VERTICAL_MATCH'
    };
  }

  routeToGeneralist(classificationResult, reason) {
    const generalistPool = this.agentPoolConfig.getPoolForVertical('Generalist');
    const selectedAgent = this.selectAgent(generalistPool);

    return {
      pool_id: generalistPool.id,
      pool_name: generalistPool.name,
      vertical: 'Generalist',
      agent: selectedAgent,
      routing_reason: reason,
      original_vertical: classificationResult.vertical
    };
  }

  selectAgent(pool) {
    const availableAgents = pool.agents.filter(a => a.status === 'available');
    if (availableAgents.length === 0) return null;

    if (this.loadBalancingStrategy === 'round-robin') {
      return this.roundRobinSelection(availableAgents);
    }
    return this.leastBusySelection(availableAgents);
  }

  roundRobinSelection(agents) {
    const selected = agents[this.roundRobinIndex % agents.length];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % agents.length;
    return selected;
  }

  leastBusySelection(agents) {
    return agents.reduce((min, a) => {
      return (a.active_conversations || 0) < (min.active_conversations || 0) ? a : min;
    }, agents[0]);
  }

  detectMultiVertical(conversationContext) {
    if (conversationContext.flow_data && conversationContext.flow_data.total_submissions > 1) {
      const verticals = new Set();
      conversationContext.flow_data.flow_submissions.forEach(sub => {
        verticals.add(sub.vertical);
      });
      return verticals.size > 1;
    }
    return false;
  }
}

class HandoffRoutingService {
  constructor(agentPoolConfig, agentPoolRoutingService) {
    this.agentPoolConfig = agentPoolConfig;
    this.agentPoolRoutingService = agentPoolRoutingService;
    this.handoffRequests = new Map();
    this.requestCounter = 0;
  }

  initiateHandoffWithRouting(phoneNumber, classificationResult, conversationContext) {
    const routingResult = this.agentPoolRoutingService.routeToPool(
      classificationResult,
      conversationContext
    );

    const requestId = this.generateRequestId();
    const handoffRecord = {
      id: requestId,
      phone_number: phoneNumber,
      routing: routingResult,
      context: conversationContext,
      created_at: new Date().getTime(),
      status: routingResult.agent ? 'connected' : 'queued'
    };

    this.handoffRequests.set(requestId, handoffRecord);

    return {
      success: true,
      request_id: requestId,
      status: handoffRecord.status,
      routing: routingResult,
      message: this.generateRoutingMessage(routingResult)
    };
  }

  generateRoutingMessage(routingResult) {
    if (routingResult.agent) {
      return 'Connecting you with a ' + routingResult.pool_name + ' agent';
    } else {
      return 'All agents busy. You are in queue for ' + routingResult.pool_name + '. Estimated wait: 5 minutes';
    }
  }

  addAgent(poolId, agent) {
    this.agentPoolConfig.addAgent(poolId, agent);
  }

  generateRequestId() {
    this.requestCounter++;
    return 'hdf-' + Date.now() + '-' + this.requestCounter;
  }
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const agentPoolConfig = new AgentPoolConfig();
const agentPoolRoutingService = new AgentPoolRoutingService(agentPoolConfig);
const handoffRoutingService = new HandoffRoutingService(agentPoolConfig, agentPoolRoutingService);

// Add mock agents for API tests
agentPoolConfig.addAgent('bike-rental-pool', {
  id: 'agent-br-1', name: 'Bike Agent 1', status: 'available', active_conversations: 0
});
agentPoolConfig.addAgent('hotel-pool', {
  id: 'agent-h-1', name: 'Hotel Agent 1', status: 'available', active_conversations: 0
});
agentPoolConfig.addAgent('taxi-pool', {
  id: 'agent-t-1', name: 'Taxi Agent 1', status: 'available', active_conversations: 0
});
agentPoolConfig.addAgent('generalist-pool', {
  id: 'agent-g-1', name: 'Generalist Agent 1', status: 'available', active_conversations: 0
});

app.get('/api/health', (req, res) => {
  res.json({ data: { status: 'healthy', timestamp: new Date().toISOString() }, meta: { timestamp: Date.now() } });
});

app.post('/api/handoff/route', (req, res) => {
  const { phone_number, classification_result, conversation_context } = req.body;

  if (!phone_number) {
    return res.status(400).json({ error: { message: 'phone_number is required', code: 'MISSING_REQUIRED_FIELD' } });
  }

  const result = handoffRoutingService.initiateHandoffWithRouting(
    phone_number,
    classification_result || {},
    conversation_context || {}
  );

  res.json({ data: result, meta: { timestamp: Date.now() } });
});

app.get('/api/agent-pools', (req, res) => {
  const pools = agentPoolConfig.getAllPools();
  res.json({ data: pools, meta: { timestamp: Date.now() } });
});

app.post('/api/agent-pools/:poolId/agents', (req, res) => {
  const { poolId } = req.params;
  const { id, name, status, active_conversations } = req.body;

  if (!id || !name) {
    return res.status(400).json({ error: { message: 'id and name are required', code: 'MISSING_REQUIRED_FIELD' } });
  }

  const agent = { id, name, status: status || 'available', active_conversations: active_conversations || 0 };
  handoffRoutingService.addAgent(poolId, agent);

  res.json({ data: { success: true, message: 'Agent added to pool', pool_id: poolId, agent }, meta: { timestamp: Date.now() } });
});

if (process.env.MOCHA_TEST_MODE !== 'true') {
  const port = process.env.PORT || 3006;
  app.listen(port, () => {
    console.log('Agent Pool Routing Service running on port ' + port);
  });
}

module.exports = { app, AgentPoolConfig, AgentPoolRoutingService, HandoffRoutingService };


