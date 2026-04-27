const express = require('express');

// ============================================================================
// HANDOFF TRIGGER SERVICE
// ============================================================================

class HandoffTriggerService {
  constructor(options = {}) {
    this.triggerThresholds = {
      lowConfidenceThreshold: options.lowConfidenceThreshold ?? 0.8,
      frustrationKeywords: options.frustrationKeywords ?? ['frustrated', 'angry', 'human', 'agent', 'help'],
      explicitRequestPhrases: options.explicitRequestPhrases ?? ['speak to human', 'talk to person', 'transfer to agent'],
      complexQueryMinMessages: options.complexQueryMinMessages ?? 3
    };
  }

  shouldTriggerHandoff(classificationResult, conversationHistory) {
    const triggers = [];

    // Trigger 1: Low confidence classification
    if (classificationResult.confidence < this.triggerThresholds.lowConfidenceThreshold) {
      triggers.push({
        type: 'LOW_CONFIDENCE',
        confidence: classificationResult.confidence,
        vertical: classificationResult.vertical
      });
    }

    // Trigger 2: Complex query detection (multi-turn, ambiguity)
    const isComplexQuery = this.detectComplexQuery(conversationHistory);
    if (isComplexQuery) {
      triggers.push({
        type: 'COMPLEX_QUERY',
        messageCount: conversationHistory.length
      });
    }

    // Trigger 3: Customer frustration detection
    const hasFrustration = this.detectFrustration(conversationHistory);
    if (hasFrustration) {
      triggers.push({
        type: 'FRUSTRATION_DETECTED',
        matchedKeywords: hasFrustration.matchedKeywords
      });
    }

    // Trigger 4: Explicit human request
    const hasExplicitRequest = this.detectExplicitHumanRequest(conversationHistory);
    if (hasExplicitRequest) {
      triggers.push({
        type: 'EXPLICIT_HUMAN_REQUEST',
        matchedPhrases: hasExplicitRequest.matchedPhrases
      });
    }

    return {
      shouldTrigger: triggers.length > 0,
      triggers: triggers,
      primaryTrigger: triggers[0] || null
    };
  }

  detectComplexQuery(conversationHistory) {
    return conversationHistory.length >= this.triggerThresholds.complexQueryMinMessages;
  }

  detectFrustration(conversationHistory) {
    const matchedKeywords = [];

    for (const msg of conversationHistory) {
      const lowerMsg = msg.message.toLowerCase();
      for (const keyword of this.triggerThresholds.frustrationKeywords) {
        if (lowerMsg.includes(keyword) && !matchedKeywords.includes(keyword)) {
          matchedKeywords.push(keyword);
        }
      }
    }

    return matchedKeywords.length > 0 ? { matchedKeywords } : null;
  }

  detectExplicitHumanRequest(conversationHistory) {
    const matchedPhrases = [];

    for (const msg of conversationHistory) {
      const lowerMsg = msg.message.toLowerCase();
      for (const phrase of this.triggerThresholds.explicitRequestPhrases) {
        if (lowerMsg.includes(phrase) && !matchedPhrases.includes(phrase)) {
          matchedPhrases.push(phrase);
        }
      }
    }

    return matchedPhrases.length > 0 ? { matchedPhrases } : null;
  }
}

// ============================================================================
// BUSINESS HOURS SERVICE
// ============================================================================

class BusinessHoursService {
  constructor(options = {}) {
    this.businessHours = {
      startTime: options.startTime ?? '09:00',
      endTime: options.endTime ?? '18:00',
      daysOfWeek: options.daysOfWeek ?? [1, 2, 3, 4, 5], // MON-FRI
      timezone: options.timezone ?? 'Asia/Kolkata'
    };
    this.outsideHoursMessage = options.outsideHoursMessage ??
      'An agent will respond within 30 minutes when we reopen (9:00 AM - 6:00 PM IST)';
  }

  isWithinBusinessHours(date = new Date()) {
    const dayOfWeek = date.getDay(); // 0-6 (Sunday-Saturday)
    const currentTime = date.getHours() * 60 + date.getMinutes(); // Minutes since midnight

    // Check if current day is within business days
    if (!this.businessHours.daysOfWeek.includes(dayOfWeek)) {
      return false;
    }

    // Parse configured start and end times
    const startMinutes = this.parseTime(this.businessHours.startTime);
    const endMinutes = this.parseTime(this.businessHours.endTime);

    // Check if current time is within business hours
    return currentTime >= startMinutes && currentTime < endMinutes;
  }

  getEstimatedResponseTime() {
    return this.outsideHoursMessage;
  }

  parseTime(timeString) {
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours * 60 + minutes;
  }
}

// ============================================================================
// AGENT AVAILABILITY SERVICE
// ============================================================================

class AgentAvailabilityService {
  constructor() {
    this.agentPools = new Map([
      ['Bike Rental', { agents: [], available: 0, total: 0 }],
      ['Hotel', { agents: [], available: 0, total: 0 }],
      ['Taxi', { agents: [], available: 0, total: 0 }],
      ['Ticketing', { agents: [], available: 0, total: 0 }],
      ['Social Media', { agents: [], available: 0, total: 0 }],
      ['Generalist', { agents: [], available: 0, total: 0 }]
    ]);
  }

  addAgent(vertical, agent) {
    const pool = this.agentPools.get(vertical);
    if (pool) {
      pool.agents.push(agent);
      pool.total++;
      if (agent.status === 'available') {
        pool.available++;
      }
    }
  }

  checkAgentAvailability(vertical) {
    const pool = this.agentPools.get(vertical) || this.agentPools.get('Generalist');
    const availableAgent = pool.agents.find(agent => agent.status === 'available');

    if (availableAgent) {
      return {
        available: true,
        agent: availableAgent,
        estimatedWaitTime: 0,
        queuePosition: 0
      };
    }

    // Calculate queue position and estimated wait time (busy agents are ahead in queue)
    const busyAgents = pool.agents.filter(a => a.status === 'busy');
    const queuePosition = busyAgents.length + 1;
    const estimatedWaitTime = queuePosition * 5; // 5 minutes per person in queue

    return {
      available: false,
      agent: null,
      estimatedWaitTime,
      queuePosition
    };
  }

  getAgentPools() {
    const pools = {};
    for (const [name, pool] of this.agentPools) {
      pools[name] = {
        total: pool.total,
        available: pool.available,
        busy: pool.agents.filter(a => a.status === 'busy').length,
        offline: pool.agents.filter(a => a.status === 'offline').length,
        queued: pool.agents.filter(a => a.status === 'queued').length
      };
    }
    return pools;
  }
}

// ============================================================================
// HANDOFF SERVICE
// ============================================================================

class HandoffService {
  constructor(handoffTriggerService, businessHoursService, agentAvailabilityService) {
    this.handoffTriggerService = handoffTriggerService;
    this.businessHoursService = businessHoursService;
    this.agentAvailabilityService = agentAvailabilityService;
    this.handoffRequests = new Map();
    this.requestCounter = 0;
  }

  initiateHandoff(phoneNumber, classificationResult, conversationHistory, date = new Date()) {
    const triggerResult = this.handoffTriggerService.shouldTriggerHandoff(
      classificationResult,
      conversationHistory
    );

    if (!triggerResult.shouldTrigger) {
      return {
        success: false,
        reason: 'No handoff trigger conditions met'
      };
    }

    // Record handoff request timestamp for 5-second messaging requirement
    const requestTime = date.getTime();

    // Check if within business hours
    const isBusinessHours = this.businessHoursService.isWithinBusinessHours(date);

    let handoffResult;

    if (isBusinessHours) {
      // Check agent availability and initiate transfer
      const availability = this.agentAvailabilityService.checkAgentAvailability(
        classificationResult.vertical
      );

      handoffResult = this.initiateBusinessHoursHandoff(phoneNumber, availability, triggerResult);
    } else {
      // Queue for outside-hours
      handoffResult = this.initiateOutsideHoursHandoff(phoneNumber, triggerResult);
    }

    // Store handoff request record
    const requestId = this.generateRequestId();
    const handoffRecord = {
      id: requestId,
      phone_number: phoneNumber,
      trigger: triggerResult.primaryTrigger,
      is_business_hours: isBusinessHours,
      created_at: requestTime,
      status: handoffResult.status,
      estimated_wait_time: handoffResult.estimatedWaitTime ?? handoffResult.estimatedResponseTime
    };

    this.handoffRequests.set(requestId, handoffRecord);

    return {
      success: true,
      request_id: requestId,
      ...handoffResult
    };
  }

  initiateBusinessHoursHandoff(phoneNumber, agentAvailability, triggerResult) {
    if (agentAvailability.available) {
      return {
        status: 'transferring',
        message: "I'm transferring you to an agent who can help with this",
        agent: agentAvailability.agent,
        estimatedWaitTime: 0
      };
    } else {
      return {
        status: 'queued',
        message: `I'm connecting you to an agent. You're currently #${agentAvailability.queuePosition} in queue.`,
        queuePosition: agentAvailability.queuePosition,
        estimatedWaitTime: agentAvailability.estimatedWaitTime
      };
    }
  }

  initiateOutsideHoursHandoff(phoneNumber, triggerResult) {
    const responseMessage = this.businessHoursService.getEstimatedResponseTime();

    return {
      status: 'queued_outside_hours',
      message: responseMessage,
      estimatedResponseTime: 'next business day'
    };
  }

  getHandoffRequest(requestId) {
    return this.handoffRequests.get(requestId) || null;
  }

  generateRequestId() {
    this.requestCounter++;
    return `hdf-${Date.now()}-${this.requestCounter}`;
  }
}

// ============================================================================
// EXPRESS APP
// ============================================================================

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize services
const handoffTriggerService = new HandoffTriggerService();
const businessHoursService = new BusinessHoursService();
const agentAvailabilityService = new AgentAvailabilityService();
const handoffService = new HandoffService(
  handoffTriggerService,
  businessHoursService,
  agentAvailabilityService
);

// Add some mock agents for testing
agentAvailabilityService.addAgent('Bike Rental', { id: 'agent-1', name: 'John Doe', status: 'available' });
agentAvailabilityService.addAgent('Bike Rental', { id: 'agent-2', name: 'Jane Smith', status: 'busy' });
agentAvailabilityService.addAgent('Generalist', { id: 'agent-g1', name: 'General Agent', status: 'available' });

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString()
    },
    meta: {
      timestamp: Date.now()
    }
  });
});

// Handoff initiation endpoint
app.post('/api/handoff/initiate', (req, res) => {
  const { phone_number, classification_confidence, classification_vertical, conversation_history } = req.body;

  // Validation
  if (!phone_number) {
    return res.status(400).json({
      error: {
        message: 'phone_number is required',
        code: 'MISSING_REQUIRED_FIELD'
      }
    });
  }

  const classificationResult = {
    confidence: classification_confidence,
    vertical: classification_vertical
  };

  const result = handoffService.initiateHandoff(
    phone_number,
    classificationResult,
    conversation_history || []
  );

  if (!result.success) {
    return res.status(400).json({
      error: {
        message: result.reason,
        code: 'NO_HANDOFF_TRIGGER'
      },
    });
  }

  res.json({
    data: result,
    meta: {
      timestamp: Date.now()
    }
  });
});

// Handoff status endpoint
app.get('/api/handoff/status/:id', (req, res) => {
  const { id } = req.params;
  const request = handoffService.getHandoffRequest(id);

  if (!request) {
    return res.status(404).json({
      error: {
        message: 'Handoff request not found',
        code: 'NOT_FOUND'
      }
    });
  }

  // Add request_id for API consistency
  const response = {
    ...request,
    request_id: request.id
  };

  res.json({
    data: response,
    meta: {
      timestamp: Date.now()
    }
  });
});

// Agent pools endpoint
app.get('/api/handoff/agent-pools', (req, res) => {
  const pools = agentAvailabilityService.getAgentPools();

  res.json({
    data: Object.entries(pools).map(([name, stats]) => ({
      name,
      ...stats
    })),
    meta: {
      timestamp: Date.now()
    }
  });
});

// Export for testing
if (process.env.MOCHA_TEST_MODE !== 'true') {
  const port = process.env.PORT || 3004;
  app.listen(port, () => {
    console.log(`Handoff Service running on port ${port}`);
  });
}

module.exports = {  app,
  HandoffTriggerService,
  BusinessHoursService,
  AgentAvailabilityService,
  HandoffService
};



