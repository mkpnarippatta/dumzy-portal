const request = require('supertest');
const { expect } = require('chai');
const { app, ConversationHistoryService, FlowDataService, ContextAggregationService, HandoffContextService } = require('../src/4-2-context-transfer-to-agent');

// ============================================================================
// TASK 1: TESTS FOR CONVERSATION HISTORY RETRIEVAL
// ============================================================================

describe('Task 1: Conversation History Retrieval', () => {
  let conversationHistoryService;

  beforeEach(() => {
    conversationHistoryService = new ConversationHistoryService();
  });

  describe('getHistoryByPhone', () => {
    it('should return empty array for phone number with no history', () => {
      const result = conversationHistoryService.getHistoryByPhone('+919876543210');

      expect(result.phone_number).to.equal('+919876543210');
      expect(result.messages).to.be.an('array');
      expect(result.messages).to.have.lengthOf(0);
      expect(result.message_count).to.equal(0);
    });

    it('should return all messages for phone number', () => {
      conversationHistoryService.addMessage('+919876543210', 'I want a bike', 'incoming');
      conversationHistoryService.addMessage('+919876543210', 'Sure, what dates?', 'outgoing');
      conversationHistoryService.addMessage('+919876543210', 'Tomorrow', 'incoming');

      const result = conversationHistoryService.getHistoryByPhone('+919876543210');

      expect(result.messages).to.have.lengthOf(3);
      expect(result.message_count).to.equal(3);
      expect(result.messages[0].direction).to.equal('incoming');
      expect(result.messages[1].direction).to.equal('outgoing');
    });

    it('should return messages sorted chronologically', () => {
      const phone = '+919876543210';
      conversationHistoryService.addMessage(phone, 'First message', 'incoming');
      conversationHistoryService.addMessage(phone, 'Second message', 'outgoing');
      conversationHistoryService.addMessage(phone, 'Third message', 'incoming');

      const result = conversationHistoryService.getHistoryByPhone(phone);

      expect(result.messages[0].message).to.equal('First message');
      expect(result.messages[1].message).to.equal('Second message');
      expect(result.messages[2].message).to.equal('Third message');
    });

    it('should include timestamps for each message', () => {
      conversationHistoryService.addMessage('+919876543210', 'Hello', 'incoming');

      const result = conversationHistoryService.getHistoryByPhone('+919876543210');

      expect(result.messages[0]).to.have.property('timestamp');
      expect(result.first_message_time).to.not.be.null;
      expect(result.last_message_time).to.not.be.null;
    });

    it('should return correct first and last message times', () => {
      const phone = '+919876543210';
      conversationHistoryService.addMessage(phone, 'First', 'incoming');
      conversationHistoryService.addMessage(phone, 'Second', 'outgoing');

      const result = conversationHistoryService.getHistoryByPhone(phone);

      expect(result.first_message_time).to.equal(result.messages[0].timestamp);
      expect(result.last_message_time).to.equal(result.messages[1].timestamp);
    });
  });
});

// ============================================================================
// TASK 2: TESTS FOR FLOW DATA CAPTURE AND DISPLAY
// ============================================================================

describe('Task 2: Flow Data Capture and Display', () => {
  let flowDataService;

  beforeEach(() => {
    flowDataService = new FlowDataService();
  });

  describe('getFlowDataByPhone', () => {
    it('should return empty submissions for phone number with no flows', () => {
      const result = flowDataService.getFlowDataByPhone('+919876543210');

      expect(result.phone_number).to.equal('+919876543210');
      expect(result.flow_submissions).to.be.an('array');
      expect(result.flow_submissions).to.have.lengthOf(0);
      expect(result.total_submissions).to.equal(0);
    });

    it('should return all Flow submissions for phone number', () => {
      const phone = '+919876543210';
      flowDataService.addFlowSubmission(phone, {
        flowName: 'Bike Rental Booking',
        flowType: 'booking',
        vertical: 'Bike Rental',
        fields: {
          pickup_date: '2025-04-23',
          return_date: '2025-04-25',
          bike_type: 'Mountain'
        }
      });

      const result = flowDataService.getFlowDataByPhone(phone);

      expect(result.flow_submissions).to.have.lengthOf(1);
      expect(result.total_submissions).to.equal(1);
      expect(result.flow_submissions[0].flow_name).to.equal('Bike Rental Booking');
      expect(result.flow_submissions[0].vertical).to.equal('Bike Rental');
    });

    it('should return multiple Flow submissions', () => {
      const phone = '+919876543210';
      flowDataService.addFlowSubmission(phone, {
        flowName: 'Bike Rental Booking',
        flowType: 'booking',
        vertical: 'Bike Rental',
        fields: { pickup_date: '2025-04-23' }
      });
      flowDataService.addFlowSubmission(phone, {
        flowName: 'Taxi Booking',
        flowType: 'booking',
        vertical: 'Taxi',
        fields: { pickup_time: '2025-04-23T10:00:00Z' }
      });

      const result = flowDataService.getFlowDataByPhone(phone);

      expect(result.flow_submissions).to.have.lengthOf(2);
      expect(result.total_submissions).to.equal(2);
    });

    it('should include all fields in submission', () => {
      const phone = '+919876543210';
      flowDataService.addFlowSubmission(phone, {
        flowName: 'Bike Rental Booking',
        flowType: 'booking',
        vertical: 'Bike Rental',
        fields: {
          pickup_date: '2025-04-23',
          return_date: '2025-04-25',
          bike_type: 'Mountain',
          location: 'Hyderabad'
        }
      });

      const result = flowDataService.getFlowDataByPhone(phone);
      const submission = result.flow_submissions[0];

      expect(submission.fields).to.have.property('pickup_date');
      expect(submission.fields).to.have.property('return_date');
      expect(submission.fields).to.have.property('bike_type');
      expect(submission.fields).to.have.property('location');
    });

    it('should include submission timestamp', () => {
      const phone = '+919876543210';
      flowDataService.addFlowSubmission(phone, {
        flowName: 'Bike Rental Booking',
        flowType: 'booking',
        vertical: 'Bike Rental',
        fields: { pickup_date: '2025-04-23' }
      });

      const result = flowDataService.getFlowDataByPhone(phone);

      expect(result.flow_submissions[0]).to.have.property('submitted_at');
      expect(result.flow_submissions[0].submitted_at).to.not.be.null;
    });
  });
});

// ============================================================================
// TASK 3: TESTS FOR CROSS-VERTICAL CONTEXT AGGREGATION
// ============================================================================

describe('Task 3: Cross-Vertical Context Aggregation', () => {
  let conversationHistoryService, flowDataService, contextAggregationService;

  beforeEach(() => {
    conversationHistoryService = new ConversationHistoryService();
    flowDataService = new FlowDataService();
    contextAggregationService = new ContextAggregationService(conversationHistoryService, flowDataService);
  });

  describe('getCustomerContext', () => {
    it('should aggregate conversation history and Flow data', () => {
      const phone = '+919876543210';
      conversationHistoryService.addMessage(phone, 'I want a bike', 'incoming');
      flowDataService.addFlowSubmission(phone, {
        flowName: 'Bike Rental Booking',
        flowType: 'booking',
        vertical: 'Bike Rental',
        fields: { pickup_date: '2025-04-23' }
      });

      const result = contextAggregationService.getCustomerContext(phone);

      expect(result).to.have.property('phone_number');
      expect(result).to.have.property('conversation_history');
      expect(result).to.have.property('flow_data');
      expect(result).to.have.property('summary');
      expect(result).to.have.property('current_intent');
      expect(result).to.have.property('last_activity');
    });

    it('should generate context summary', () => {
      const phone = '+919876543210';
      conversationHistoryService.addMessage(phone, 'Hello', 'incoming');
      flowDataService.addFlowSubmission(phone, {
        flowName: 'Bike Rental Booking',
        flowType: 'booking',
        vertical: 'Bike Rental',
        fields: { pickup_date: '2025-04-23' }
      });

      const result = contextAggregationService.getCustomerContext(phone);

      expect(result.summary).to.have.property('total_messages');
      expect(result.summary).to.have.property('active_flows');
      expect(result.summary).to.have.property('primary_vertical');
      expect(result.summary).to.have.property('has_booking_data');
      expect(result.summary.total_messages).to.equal(1);
      expect(result.summary.active_flows).to.equal(1);
      expect(result.summary.has_booking_data).to.be.true;
    });

    it('should identify current intent', () => {
      const phone = '+919876543210';
      conversationHistoryService.addMessage(phone, 'I want a bike', 'incoming');

      const result = contextAggregationService.getCustomerContext(phone);

      expect(result.current_intent).to.have.property('vertical');
      expect(result.current_intent).to.have.property('confidence');
      expect(result.current_intent).to.have.property('intent_description');
    });

    it('should handle cross-vertical conversations', () => {
      const phone = '+919876543210';
      conversationHistoryService.addMessage(phone, 'I want a bike', 'incoming');
      flowDataService.addFlowSubmission(phone, {
        flowName: 'Bike Rental Booking',
        flowType: 'booking',
        vertical: 'Bike Rental',
        fields: { pickup_date: '2025-04-23' }
      });
      flowDataService.addFlowSubmission(phone, {
        flowName: 'Taxi Booking',
        flowType: 'booking',
        vertical: 'Taxi',
        fields: { pickup_time: '2025-04-23T10:00:00Z' }
      });

      const result = contextAggregationService.getCustomerContext(phone);

      expect(result.flow_data.total_submissions).to.equal(2);
      expect(result.summary.active_flows).to.equal(2);
    });

    it('should return last activity timestamp', () => {
      const phone = '+919876543210';
      conversationHistoryService.addMessage(phone, 'Hello', 'incoming');

      const result = contextAggregationService.getCustomerContext(phone);

      expect(result.last_activity).to.not.be.null;
    });
  });
});

// ============================================================================
// TASK 4: TESTS FOR HANDOFF CONTEXT INCLUSION
// ============================================================================

describe('Task 4: Handoff Context Inclusion', () => {
  let conversationHistoryService, flowDataService, contextAggregationService, handoffContextService;

  beforeEach(() => {
    conversationHistoryService = new ConversationHistoryService();
    flowDataService = new FlowDataService();
    contextAggregationService = new ContextAggregationService(conversationHistoryService, flowDataService);
    handoffContextService = new HandoffContextService(conversationHistoryService, flowDataService, contextAggregationService);
  });

  describe('initiateHandoffWithContext', () => {
    it('should include context in successful handoff', async () => {
      const phone = '+919876543210';
      handoffContextService.addMessage(phone, 'I want a bike', 'incoming');

      const classificationResult = { confidence: 0.75, vertical: 'Bike Rental' };
      const result = handoffContextService.initiateHandoffWithContext(
        phone,
        classificationResult,
        []
      );

      expect(result.success).to.be.true;
      expect(result).to.have.property('context');
      expect(result.context).to.have.property('phone_number');
      expect(result.context).to.have.property('conversation_history');
      expect(result.context).to.have.property('flow_data');
      expect(result.context).to.have.property('summary');
    });

    it('should not include context on failed handoff', async () => {
      const phone = '+919876543210';
      const classificationResult = { confidence: 0.90, vertical: 'Bike Rental' };
      const result = handoffContextService.initiateHandoffWithContext(
        phone,
        classificationResult,
        []
      );

      expect(result.success).to.be.false;
      expect(result).to.not.have.property('context');
    });

    it('should store context with request_id', async () => {
      const phone = '+919876543210';
      handoffContextService.addMessage(phone, 'Hello', 'incoming');

      const classificationResult = { confidence: 0.75, vertical: 'Bike Rental' };
      const result = handoffContextService.initiateHandoffWithContext(
        phone,
        classificationResult,
        []
      );

      expect(result.request_id).to.be.a('string');
      const storedContext = handoffContextService.getContextForAgent(result.request_id);
      expect(storedContext).to.not.be.null;
      expect(storedContext.phone_number).to.equal(phone);
    });
  });
});

// ============================================================================
// TASK 5: API ENDPOINTS
// ============================================================================

describe('API Endpoints', () => {
  describe('POST /api/handoff/initiate', () => {
    it('should include context in handoff response', async () => {
      const phone = '+919876543210';

      // First add some conversation history
      await request(app)
        .post('/api/context/messages')
        .send({
          phone_number: phone,
          message: 'I want a bike',
          direction: 'incoming'
        });

      const response = await request(app)
        .post('/api/handoff/initiate')
        .send({
          phone_number: phone,
          classification_confidence: 0.75,
          classification_vertical: 'Bike Rental',
          conversation_history: []
        });

      expect(response.status).to.equal(200);
      expect(response.body.data).to.have.property('success', true);
      expect(response.body.data).to.have.property('context');
      expect(response.body.data.context).to.have.property('phone_number');
      expect(response.body.data.context).to.have.property('conversation_history');
    });

    it('should reject without phone_number', async () => {
      const response = await request(app)
        .post('/api/handoff/initiate')
        .send({
          classification_confidence: 0.75,
          classification_vertical: 'Bike Rental',
          conversation_history: []
        });

      expect(response.status).to.equal(400);
      expect(response.body).to.have.property('error');
    });
  });

  describe('POST /api/context/messages', () => {
    it('should add message to conversation history', async () => {
      const response = await request(app)
        .post('/api/context/messages')
        .send({
          phone_number: '+919876543210',
          message: 'Hello there',
          direction: 'incoming'
        });

      expect(response.status).to.equal(200);
      expect(response.body.data).to.have.property('message_id');
    });

    it('should reject without phone_number', async () => {
      const response = await request(app)
        .post('/api/context/messages')
        .send({
          message: 'Hello',
          direction: 'incoming'
        });

      expect(response.status).to.equal(400);
      expect(response.body).to.have.property('error');
    });
  });

  describe('POST /api/context/flow-submissions', () => {
    it('should add Flow submission', async () => {
      const response = await request(app)
        .post('/api/context/flow-submissions')
        .send({
          phone_number: '+919876543210',
          flow_name: 'Bike Rental Booking',
          flow_type: 'booking',
          vertical: 'Bike Rental',
          fields: {
            pickup_date: '2025-04-23',
            return_date: '2025-04-25'
          }
        });

      expect(response.status).to.equal(200);
      expect(response.body.data).to.have.property('submission_id');
    });

    it('should reject without phone_number', async () => {
      const response = await request(app)
        .post('/api/context/flow-submissions')
        .send({
          flow_name: 'Bike Rental Booking',
          fields: {}
        });

      expect(response.status).to.equal(400);
      expect(response.body).to.have.property('error');
    });
  });

  describe('GET /api/context/:phone', () => {
    it('should retrieve customer context', async () => {
      const phone = '+919876543210';

      await request(app)
        .post('/api/context/messages')
        .send({
          phone_number: phone,
          message: 'Hello',
          direction: 'incoming'
        });

      const response = await request(app).get(`/api/context/${encodeURIComponent(phone)}`);

      expect(response.status).to.equal(200);
      expect(response.body.data).to.have.property('phone_number');
      expect(response.body.data).to.have.property('conversation_history');
      expect(response.body.data).to.have.property('flow_data');
      expect(response.body.data).to.have.property('summary');
    });

    it('should return empty context for new phone number', async () => {
      const response = await request(app).get('/api/context/+919876543219');

      expect(response.status).to.equal(200);
      expect(response.body.data.phone_number).to.equal('+919876543219');
      expect(response.body.data.conversation_history.message_count).to.equal(0);
      expect(response.body.data.flow_data.total_submissions).to.equal(0);
    });
  });

  describe('GET /api/handoff/context/:id', () => {
    it('should retrieve context for handoff request', async () => {
      const phone = '+919876543210';

      await request(app)
        .post('/api/context/messages')
        .send({
          phone_number: phone,
          message: 'Hello',
          direction: 'incoming'
        });

      const createResponse = await request(app)
        .post('/api/handoff/initiate')
        .send({
          phone_number: phone,
          classification_confidence: 0.75,
          classification_vertical: 'Bike Rental',
          conversation_history: []
        });

      const requestId = createResponse.body.data.request_id;
      const contextResponse = await request(app).get(`/api/handoff/context/${requestId}`);

      expect(contextResponse.status).to.equal(200);
      expect(contextResponse.body.data).to.have.property('phone_number');
      expect(contextResponse.body.data).to.have.property('conversation_history');
    });

    it('should return 404 for non-existent request', async () => {
      const response = await request(app).get('/api/handoff/context/non-existent');

      expect(response.status).to.equal(404);
      expect(response.body).to.have.property('error');
    });
  });
});
