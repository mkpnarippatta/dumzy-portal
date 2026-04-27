const request = require('supertest');
const { expect } = require('chai');
const { app, HandoffTriggerService, BusinessHoursService, AgentAvailabilityService, HandoffService } = require('../src/4-1-seamless-handoff-trigger');

// ============================================================================
// TASK 1: TESTS FOR HANDOFF TRIGGER CONDITIONS
// ============================================================================

describe('Task 1: Handoff Trigger Conditions', () => {
  let handoffTriggerService;

  beforeEach(() => {
    handoffTriggerService = new HandoffTriggerService();
  });

  describe('shouldTriggerHandoff', () => {
    it('should trigger on low confidence classification (< 80%)', () => {
      const classificationResult = { confidence: 0.75, vertical: 'Bike Rental' };
      const conversationHistory = [];

      const result = handoffTriggerService.shouldTriggerHandoff(classificationResult, conversationHistory);

      expect(result.shouldTrigger).to.be.true;
      expect(result.triggers).to.have.lengthOf(1);
      expect(result.triggers[0]).to.have.property('type', 'LOW_CONFIDENCE');
      expect(result.triggers[0].confidence).to.equal(0.75);
    });

    it('should NOT trigger on high confidence classification (>= 80%)', () => {
      const classificationResult = { confidence: 0.85, vertical: 'Bike Rental' };
      const conversationHistory = [];

      const result = handoffTriggerService.shouldTriggerHandoff(classificationResult, conversationHistory);

      expect(result.shouldTrigger).to.be.false;
      expect(result.triggers).to.have.lengthOf(0);
    });

    it('should trigger on complex query (3+ messages)', () => {
      const classificationResult = { confidence: 0.90, vertical: 'Bike Rental' };
      const conversationHistory = [
        { message: 'I want a bike', timestamp: '2025-04-22T10:00:00Z' },
        { message: 'Also need hotel', timestamp: '2025-04-22T10:01:00Z' },
        { message: 'And taxi too', timestamp: '2025-04-22T10:02:00Z' }
      ];

      const result = handoffTriggerService.shouldTriggerHandoff(classificationResult, conversationHistory);

      expect(result.shouldTrigger).to.be.true;
      expect(result.triggers).to.have.lengthOf(1);
      expect(result.triggers[0]).to.have.property('type', 'COMPLEX_QUERY');
    });

    it('should NOT trigger on simple query (1-2 messages)', () => {
      const classificationResult = { confidence: 0.90, vertical: 'Bike Rental' };
      const conversationHistory = [
        { message: 'I want a bike', timestamp: '2025-04-22T10:00:00Z' }
      ];

      const result = handoffTriggerService.shouldTriggerHandoff(classificationResult, conversationHistory);

      expect(result.shouldTrigger).to.be.false;
    });

    it('should trigger on frustration keywords', () => {
      const classificationResult = { confidence: 0.90, vertical: 'Bike Rental' };
      const conversationHistory = [
        { message: 'I am frustrated with this bot', timestamp: '2025-04-22T10:00:00Z' }
      ];

      const result = handoffTriggerService.shouldTriggerHandoff(classificationResult, conversationHistory);

      expect(result.shouldTrigger).to.be.true;
      expect(result.triggers[0]).to.have.property('type', 'FRUSTRATION_DETECTED');
    });

    it('should trigger on explicit human request', () => {
      const classificationResult = { confidence: 0.90, vertical: 'Bike Rental' };
      const conversationHistory = [
        { message: 'I want to talk to person', timestamp: '2025-04-22T10:00:00Z' }
      ];

      const result = handoffTriggerService.shouldTriggerHandoff(classificationResult, conversationHistory);

      expect(result.shouldTrigger).to.be.true;
      expect(result.triggers[0]).to.have.property('type', 'EXPLICIT_HUMAN_REQUEST');
    });

    it('should identify primary trigger correctly', () => {
      const classificationResult = { confidence: 0.70, vertical: 'Bike Rental' };
      const conversationHistory = [];

      const result = handoffTriggerService.shouldTriggerHandoff(classificationResult, conversationHistory);

      expect(result.primaryTrigger).to.not.be.null;
      expect(result.primaryTrigger).to.have.property('type', 'LOW_CONFIDENCE');
    });
  });

  describe('Trigger configuration', () => {
    it('should use configurable low confidence threshold', () => {
      const service = new HandoffTriggerService({ lowConfidenceThreshold: 0.75 });

      const classificationResult = { confidence: 0.72, vertical: 'Bike Rental' };
      const conversationHistory = [];

      const result = service.shouldTriggerHandoff(classificationResult, conversationHistory);

      expect(result.shouldTrigger).to.be.true;
    });

    it('should NOT trigger when above custom threshold', () => {
      const service = new HandoffTriggerService({ lowConfidenceThreshold: 0.7 });

      const classificationResult = { confidence: 0.75, vertical: 'Bike Rental' };
      const conversationHistory = [];

      const result = service.shouldTriggerHandoff(classificationResult, conversationHistory);

      expect(result.shouldTrigger).to.be.false;
    });
  });
});

// ============================================================================
// TASK 2: TESTS FOR BUSINESS HOURS CONFIGURATION
// ============================================================================

describe('Task 2: Business Hours Configuration', () => {
  let businessHoursService;

  beforeEach(() => {
    businessHoursService = new BusinessHoursService();
  });

  describe('isWithinBusinessHours', () => {
    it('should return true during business hours on weekday', () => {
      const wednesday = new Date('2025-04-23T10:30:00Z'); // Wednesday 4:00 PM IST
      wednesday.setHours(16, 30); // 4:30 PM IST (within 9 AM - 6 PM)

      const result = businessHoursService.isWithinBusinessHours(wednesday);

      expect(result).to.be.true;
    });

    it('should return false before business hours on weekday', () => {
      const wednesday = new Date('2025-04-23T03:30:00Z'); // Wednesday 9:00 AM IST
      wednesday.setHours(8, 30); // 8:30 AM IST (before 9 AM)

      const result = businessHoursService.isWithinBusinessHours(wednesday);

      expect(result).to.be.false;
    });

    it('should return false after business hours on weekday', () => {
      const wednesday = new Date('2025-04-23T12:30:00Z'); // Wednesday 6:00 PM IST
      wednesday.setHours(18, 30); // 6:30 PM IST (after 6 PM)

      const result = businessHoursService.isWithinBusinessHours(wednesday);

      expect(result).to.be.false;
    });

    it('should return false on weekend (Sunday)', () => {
      const sunday = new Date('2025-04-27T10:30:00Z'); // Sunday 4:00 PM IST

      const result = businessHoursService.isWithinBusinessHours(sunday);

      expect(result).to.be.false;
    });

    it('should return false on weekend (Saturday)', () => {
      const saturday = new Date('2025-04-26T10:30:00Z'); // Saturday 4:00 PM IST

      const result = businessHoursService.isWithinBusinessHours(saturday);

      expect(result).to.be.false;
    });
  });

  describe('getEstimatedResponseTime', () => {
    it('should return configured outside hours message', () => {
      const message = businessHoursService.getEstimatedResponseTime();

      expect(message).to.be.a('string');
      expect(message).to.include('agent');
    });
  });
});

// ============================================================================
// TASK 3: TESTS FOR AGENT AVAILABILITY CHECKING
// ============================================================================

describe('Task 3: Agent Availability Checking', () => {
  let agentService;

  beforeEach(() => {
    agentService = new AgentAvailabilityService();
  });

  describe('checkAgentAvailability', () => {
    it('should return available when agent is free', () => {
      agentService.addAgent('Bike Rental', {
        id: 'agent-1',
        name: 'John Doe',
        status: 'available'
      });

      const result = agentService.checkAgentAvailability('Bike Rental');

      expect(result.available).to.be.true;
      expect(result.agent).to.not.be.null;
      expect(result.estimatedWaitTime).to.equal(0);
      expect(result.queuePosition).to.equal(0);
    });

    it('should return queued when all agents are busy', () => {
      agentService.addAgent('Bike Rental', { id: 'agent-1', name: 'John Doe', status: 'busy' });
      agentService.addAgent('Bike Rental', { id: 'agent-2', name: 'Jane Smith', status: 'busy' });

      const result = agentService.checkAgentAvailability('Bike Rental');

      expect(result.available).to.be.false;
      expect(result.estimatedWaitTime).to.be.greaterThan(0);
      expect(result.queuePosition).to.be.greaterThan(0);
    });

    it('should fallback to Generalist pool when vertical pool unavailable', () => {
      agentService.addAgent('Generalist', {
        id: 'agent-g1',
        name: 'General Agent',
        status: 'available'
      });

      const result = agentService.checkAgentAvailability('Unknown Vertical');

      expect(result.available).to.be.true;
      expect(result.agent.name).to.include('General');
    });

    it('should calculate estimated wait time based on queue', () => {
      agentService.addAgent('Bike Rental', { id: 'agent-1', name: 'John', status: 'busy' });
      agentService.addAgent('Bike Rental', { id: 'agent-2', name: 'Jane', status: 'busy' });
      agentService.addAgent('Bike Rental', { id: 'agent-3', name: 'Bob', status: 'queued' });
      agentService.addAgent('Bike Rental', { id: 'agent-4', name: 'Alice', status: 'queued' });
      agentService.addAgent('Bike Rental', { id: 'agent-5', name: 'Charlie', status: 'queued' });

      const result = agentService.checkAgentAvailability('Bike Rental');

      expect(result.queuePosition).to.equal(4); // 3 queued + 1 new
      expect(result.estimatedWaitTime).to.equal(20); // 4 * 5 minutes
    });
  });
});

// ============================================================================
// TASK 4: TESTS FOR HANDOFF INITIATION AND MESSAGING
// ============================================================================

describe('Task 4: Handoff Initiation and Messaging', () => {
  let handoffTriggerService, businessHoursService, agentAvailabilityService, handoffService;

  beforeEach(() => {
    handoffTriggerService = new HandoffTriggerService();
    businessHoursService = new BusinessHoursService();
    agentAvailabilityService = new AgentAvailabilityService();
    handoffService = new HandoffService(
      handoffTriggerService,
      businessHoursService,
      agentAvailabilityService
    );
  });

  describe('initiateHandoff', () => {
    it('should NOT initiate handoff when no triggers met', () => {
      const classificationResult = { confidence: 0.90, vertical: 'Bike Rental' };
      const conversationHistory = [];

      const result = handoffService.initiateHandoff('+919876543210', classificationResult, conversationHistory);

      expect(result.success).to.be.false;
      expect(result.reason).to.equal('No handoff trigger conditions met');
    });

    function businessHoursDate() {
      const d = new Date();
      d.setHours(10, 0, 0, 0);
      if (d.getDay() === 0) d.setDate(d.getDate() + 1);
      if (d.getDay() === 6) d.setDate(d.getDate() + 2);
      return d;
    }

    it('should initiate handoff with low confidence trigger', () => {
      agentAvailabilityService.addAgent('Bike Rental', {
        id: 'agent-1',
        name: 'John Doe',
        status: 'available'
      });

      const classificationResult = { confidence: 0.75, vertical: 'Bike Rental' };
      const conversationHistory = [];

      const result = handoffService.initiateHandoff('+919876543210', classificationResult, conversationHistory, businessHoursDate());

      expect(result.success).to.be.true;
      expect(result.status).to.equal('transferring');
      expect(result.message).to.include('transferring you to an agent');
      expect(result).to.have.property('request_id');
    });

    it('should queue when no agent available', () => {
      agentAvailabilityService.addAgent('Bike Rental', {
        id: 'agent-1',
        name: 'John Doe',
        status: 'busy'
      });

      const classificationResult = { confidence: 0.75, vertical: 'Bike Rental' };
      const conversationHistory = [];

      const result = handoffService.initiateHandoff('+919876543210', classificationResult, conversationHistory, businessHoursDate());

      expect(result.success).to.be.true;
      expect(result.status).to.equal('queued');
      expect(result.message).to.include('queue');
      expect(result.estimatedWaitTime).to.be.greaterThan(0);
    });

    it('should queue for outside-hours', () => {
      const outsideHoursDate = new Date('2025-04-27T06:00:00Z'); // Sunday outside hours

      const classificationResult = { confidence: 0.75, vertical: 'Bike Rental' };
      const conversationHistory = [];

      const result = handoffService.initiateHandoff('+919876543210', classificationResult, conversationHistory, outsideHoursDate);

      expect(result.success).to.be.true;
      expect(result.status).to.equal('queued_outside_hours');
      expect(result.message).to.include('agent');
      expect(result.estimatedResponseTime).to.equal('next business day');
    });

    it('should store handoff request record', () => {
      agentAvailabilityService.addAgent('Bike Rental', {
        id: 'agent-1',
        name: 'John Doe',
        status: 'available'
      });

      const classificationResult = { confidence: 0.75, vertical: 'Bike Rental' };
      const conversationHistory = [];

      const result = handoffService.initiateHandoff('+919876543210', classificationResult, conversationHistory);

      expect(result.request_id).to.be.a('string');

      const storedRequest = handoffService.getHandoffRequest(result.request_id);
      expect(storedRequest).to.not.be.null;
      expect(storedRequest.phone_number).to.equal('+919876543210');
      expect(storedRequest.trigger).to.have.property('type', 'LOW_CONFIDENCE');
    });
  });
});

// ============================================================================
// TASK 5: API ENDPOINTS
// ============================================================================

describe('API Endpoints', () => {
  describe('POST /api/handoff/initiate', () => {
    it('should initiate handoff with valid data', async () => {
      const response = request(app)
        .post('/api/handoff/initiate')
        .send({
          phone_number: '+919876543210',
          classification_confidence: 0.75,
          classification_vertical: 'Bike Rental',
          conversation_history: []
        })
        .then(response => {
          expect(response.status).to.equal(200);
          expect(response.body).to.have.property('success', true);
          expect(response.body).to.have.property('request_id');
        });

      response;
    });

    it('should reject handoff without phone_number', async () => {
      const response = request(app)
        .post('/api/handoff/initiate')
        .send({
          classification_confidence: 0.75,
          classification_vertical: 'Bike Rental',
          conversation_history: []
        })
        .then(response => {
          expect(response.status).to.equal(400);
          expect(response.body).to.have.property('error');
        });

      response;
    });

    it('should return false when no trigger conditions met', async () => {
      const response = request(app)
        .post('/api/handoff/initiate')
        .send({
          phone_number: '+919876543210',
          classification_confidence: 0.90,
          classification_vertical: 'Bike Rental',
          conversation_history: []
        })
        .then(response => {
          expect(response.status).to.equal(400);
          expect(response.body).to.have.property('success', false);
        });

      response;
    });
  });

  describe('GET /api/handoff/status/:id', () => {
    it('should retrieve handoff request status', async () => {
      // First create a handoff request
      const createResult = await request(app)
        .post('/api/handoff/initiate')
        .send({
          phone_number: '+919876543210',
          classification_confidence: 0.75,
          classification_vertical: 'Bike Rental',
          conversation_history: []
        });

      const requestId = createResult.body.data.request_id;

      // Then retrieve status
      const response = await request(app).get(`/api/handoff/status/${requestId}`);

      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('data').that.is.an('object');
      expect(response.body.data).to.have.property('request_id', requestId);
    });

    it('should return 404 for non-existent request', async () => {
      const response = await request(app).get('/api/handoff/status/non-existent');

      expect(response.status).to.equal(404);
      expect(response.body).to.have.property('error');
    });
  });

  describe('GET /api/handoff/agent-pools', () => {
    it('should return all agent pools', async () => {
      const response = await request(app).get('/api/handoff/agent-pools');

      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('data').that.is.an('array');
      expect(response.body.data).to.have.length.greaterThan(0);
    });
  });
});
