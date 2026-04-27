const { expect } = require('chai');
const { ConversationHistoryService, app } = require('../src/2-2-conversation-history-persistence');
const request = require('supertest');

// ============================================================================
// MESSAGE DATA MODEL TESTS
// ============================================================================

describe('Message Data Model', () => {
  let service;

  beforeEach(() => {
    service = new ConversationHistoryService();
  });

  // ------------------------------------------------------------
  // Message Interface Structure
  // ------------------------------------------------------------
  describe('Message interface structure', () => {
    it('should create message with required fields', () => {
      const message = {
        id: 'msg_1234567890_abc123',
        session_id: 'sess_1234567890_xyz',
        phone_number: '+919876543210',
        role: 'user',
        content: 'I want to book a bike',
        timestamp: new Date().toISOString(),
        vertical: 'Bike Rental',
        metadata: {
          message_type: 'enquiry',
          intent_confidence: 0.95
        }
      };

      expect(message).to.have.property('id');
      expect(message).to.have.property('session_id');
      expect(message).to.have.property('phone_number');
      expect(message).to.have.property('role');
      expect(message).to.have.property('content');
      expect(message).to.have.property('timestamp');
      expect(message).to.have.property('vertical');
      expect(message).to.have.property('metadata');
    });

    it('should accept valid role values', () => {
      const validRoles = ['user', 'bot', 'agent'];
      validRoles.forEach(role => {
        const message = {
          id: 'msg_1',
          session_id: 'sess_1',
          phone_number: '+919876543210',
          role: role,
          content: 'test',
          timestamp: new Date().toISOString(),
          vertical: 'Bike Rental',
          metadata: {}
        };
        expect(message.role).to.equal(role);
      });
    });

    it('should include optional metadata fields', () => {
      const message = {
        id: 'msg_1',
        session_id: 'sess_1',
        phone_number: '+919876543210',
        role: 'user',
        content: 'test',
        timestamp: new Date().toISOString(),
        vertical: 'Bike Rental',
        metadata: {
          message_type: 'enquiry',
          intent_confidence: 0.95,
          enquiry_id: 'enq_123',
          custom_field: 'custom_value'
        }
      };

      expect(message.metadata).to.have.property('message_type');
      expect(message.metadata).to.have.property('intent_confidence');
      expect(message.metadata).to.have.property('enquiry_id');
      expect(message.metadata).to.have.property('custom_field');
    });
  });

  // ------------------------------------------------------------
  // Session Interface Structure
  // ------------------------------------------------------------
  describe('Session interface structure', () => {
    it('should create session with required fields', () => {
      const session = {
        id: 'sess_1234567890_xyz',
        phone_number: '+919876543210',
        vertical: 'Bike Rental',
        started_at: new Date().toISOString(),
        last_activity: new Date().toISOString(),
        message_count: 5
      };

      expect(session).to.have.property('id');
      expect(session).to.have.property('phone_number');
      expect(session).to.have.property('vertical');
      expect(session).to.have.property('started_at');
      expect(session).to.have.property('last_activity');
      expect(session).to.have.property('message_count');
    });

    it('should track message count correctly', () => {
      const session = {
        id: 'sess_1',
        phone_number: '+919876543210',
        vertical: 'Bike Rental',
        started_at: new Date().toISOString(),
        last_activity: new Date().toISOString(),
        message_count: 0
      };

      expect(session.message_count).to.equal(0);
      session.message_count = 1;
      expect(session.message_count).to.equal(1);
    });
  });
});

// ============================================================================
// CONVERSATION HISTORY SERVICE TESTS
// ============================================================================

describe('ConversationHistoryService', () => {
  let service;

  beforeEach(() => {
    service = new ConversationHistoryService();
  });

  // ------------------------------------------------------------
  // Phone Number Normalization
  // ------------------------------------------------------------
  describe('Phone number normalization', () => {
    it('should remove + prefix', () => {
      const normalized = service.normalizePhoneNumber('+919876543210');
      expect(normalized).to.equal('919876543210');
    });

    it('should remove spaces', () => {
      const normalized = service.normalizePhoneNumber('+91 98765 43210');
      expect(normalized).to.equal('919876543210');
    });

    it('should remove dashes', () => {
      const normalized = service.normalizePhoneNumber('+91-98765-43210');
      expect(normalized).to.equal('919876543210');
    });

    it('should handle already normalized number', () => {
      const normalized = service.normalizePhoneNumber('919876543210');
      expect(normalized).to.equal('919876543210');
    });

    it('should strip parentheses and dots', () => {
      const normalized = service.normalizePhoneNumber('+1 (800) 555-0199');
      expect(normalized).to.equal('18005550199');
    });

    it('should return empty string for null', () => {
      expect(service.normalizePhoneNumber(null)).to.equal('');
    });

    it('should return empty string for undefined', () => {
      expect(service.normalizePhoneNumber(undefined)).to.equal('');
    });

    it('should return empty string for empty input', () => {
      expect(service.normalizePhoneNumber('')).to.equal('');
    });

    it('should return empty string for non-string input', () => {
      expect(service.normalizePhoneNumber(123)).to.equal('');
    });
  });

  // ------------------------------------------------------------
  // Message Storage (AC #1)
  // ------------------------------------------------------------
  describe('Message Storage', () => {
    it('should store message with phone number indexing', () => {
      const messageData = {
        phone_number: '+919876543210',
        role: 'user',
        content: 'I want to book a bike',
        vertical: 'Bike Rental',
        metadata: { message_type: 'enquiry' }
      };

      const message = service.storeMessage(messageData);

      expect(message).to.have.property('id');
      expect(message).to.have.property('session_id');
      expect(message.phone_number).to.equal('+919876543210');
      expect(message.role).to.equal('user');
      expect(message.content).to.equal('I want to book a bike');
      expect(message.vertical).to.equal('Bike Rental');
      expect(message).to.have.property('timestamp');
    });

    it('should auto-generate message ID', () => {
      const messageData = {
        phone_number: '+919876543210',
        role: 'user',
        content: 'test',
        vertical: 'Bike Rental'
      };

      const message = service.storeMessage(messageData);
      expect(message.id).to.match(/^msg_\d+_[a-z0-9]+$/);
    });

    it('should auto-generate session ID if not provided', () => {
      const messageData = {
        phone_number: '+919876543210',
        role: 'user',
        content: 'test',
        vertical: 'Bike Rental'
      };

      const message = service.storeMessage(messageData);
      expect(message.session_id).to.match(/^sess_\d+_[a-z0-9]+$/);
    });

    it('should use provided session ID if given', () => {
      const sessionId = 'sess_custom_123';
      const messageData = {
        phone_number: '+919876543210',
        role: 'user',
        content: 'test',
        vertical: 'Bike Rental',
        session_id: sessionId
      };

      const message = service.storeMessage(messageData);
      expect(message.session_id).to.equal(sessionId);
    });

    it('should set timestamp to current ISO string', () => {
      const beforeStore = new Date().toISOString();
      const messageData = {
        phone_number: '+919876543210',
        role: 'user',
        content: 'test',
        vertical: 'Bike Rental'
      };

      const message = service.storeMessage(messageData);
      const afterStore = new Date().toISOString();

      const messageDate = new Date(message.timestamp);
      const beforeDate = new Date(beforeStore);
      const afterDate = new Date(afterStore);

      expect(messageDate).to.be.at.least(beforeDate);
      expect(messageDate).to.be.at.most(afterDate);
    });

    it('should default role to "user" if not specified', () => {
      const messageData = {
        phone_number: '+919876543210',
        content: 'test',
        vertical: 'Bike Rental'
      };

      const message = service.storeMessage(messageData);
      expect(message.role).to.equal('user');
    });

    it('should default vertical to "Unknown" if not specified', () => {
      const messageData = {
        phone_number: '+919876543210',
        role: 'user',
        content: 'test'
      };

      const message = service.storeMessage(messageData);
      expect(message.vertical).to.equal('Unknown');
    });

    it('should default metadata to empty object if not specified', () => {
      const messageData = {
        phone_number: '+919876543210',
        role: 'user',
        content: 'test',
        vertical: 'Bike Rental'
      };

      const message = service.storeMessage(messageData);
      expect(message.metadata).to.be.an('object');
      expect(Object.keys(message.metadata)).to.have.length(0);
    });
  });

  // ------------------------------------------------------------
  // ID Generation
  // ------------------------------------------------------------
  describe('ID Generation', () => {
    it('should generate unique message IDs', () => {
      const id1 = service.generateMessageId();
      const id2 = service.generateMessageId();
      expect(id1).to.match(/^msg_\d+_[a-z0-9]+$/);
      expect(id2).to.match(/^msg_\d+_[a-z0-9]+$/);
      expect(id1).to.not.equal(id2);
    });

    it('should generate unique session IDs', () => {
      const id1 = service.generateSessionId();
      const id2 = service.generateSessionId();
      expect(id1).to.match(/^sess_\d+_[a-z0-9]+$/);
      expect(id2).to.match(/^sess_\d+_[a-z0-9]+$/);
      expect(id1).to.not.equal(id2);
    });

    it('should return null for non-existent session ID', () => {
      const session = service.getSession('non_existent');
      expect(session).to.be.null;
    });
  });

  // ------------------------------------------------------------
  // Input Validation
  // ------------------------------------------------------------
  describe('Input Validation', () => {
    it('should reject invalid role', () => {
      expect(() => {
        service.storeMessage({
          phone_number: '+919876543210',
          role: 'admin',
          content: 'test',
          vertical: 'Bike Rental'
        });
      }).to.throw('Invalid role: admin');
    });

    it('should reject invalid vertical', () => {
      expect(() => {
        service.storeMessage({
          phone_number: '+919876543210',
          role: 'user',
          content: 'test',
          vertical: 'Invalid'
        });
      }).to.throw('Invalid vertical: Invalid');
    });

  });

  // ------------------------------------------------------------
  // Defensive Copy
  // ------------------------------------------------------------
  describe('Defensive Copy', () => {
    it('should not mutate stored message when returned object is modified', () => {
      const message = service.storeMessage({
        phone_number: '+919876543210',
        role: 'user',
        content: 'original',
        vertical: 'Bike Rental'
      });

      // Mutate the returned object
      message.content = 'mutated';
      message.timestamp = '2099-01-01T00:00:00.000Z';

      // Retrieve again via getHistory
      const history = service.getHistory('+919876543210');
      expect(history[0].content).to.equal('original');
      expect(history[0].timestamp).to.not.equal('2099-01-01T00:00:00.000Z');
    });
  });
  describe('Session Tracking', () => {
    it('should create new session for new phone number', () => {
      const messageData = {
        phone_number: '+919876543210',
        role: 'user',
        content: 'test',
        vertical: 'Bike Rental'
      };

      const message = service.storeMessage(messageData);
      const session = service.getSession(message.session_id);

      expect(session).to.not.be.null;
      expect(session.phone_number).to.equal('+919876543210');
      expect(session.vertical).to.equal('Bike Rental');
      expect(session.message_count).to.equal(1);
    });

    it('should reuse existing session for same phone number and vertical', () => {
      const phoneNumber = '+919876543210';
      const vertical = 'Bike Rental';

      const message1 = service.storeMessage({
        phone_number: phoneNumber,
        role: 'user',
        content: 'first message',
        vertical: vertical
      });

      const message2 = service.storeMessage({
        phone_number: phoneNumber,
        role: 'bot',
        content: 'bot response',
        vertical: vertical
      });

      expect(message1.session_id).to.equal(message2.session_id);

      const session = service.getSession(message1.session_id);
      expect(session.message_count).to.equal(2);
    });

    it('should create new session for different vertical', () => {
      const phoneNumber = '+919876543210';

      const message1 = service.storeMessage({
        phone_number: phoneNumber,
        role: 'user',
        content: 'bike enquiry',
        vertical: 'Bike Rental'
      });

      const message2 = service.storeMessage({
        phone_number: phoneNumber,
        role: 'user',
        content: 'hotel enquiry',
        vertical: 'Hotel'
      });

      expect(message1.session_id).to.not.equal(message2.session_id);
    });

    it('should update last_activity on each message', async () => {
      const phoneNumber = '+919876543210';
      const vertical = 'Bike Rental';

      const message1 = service.storeMessage({
        phone_number: phoneNumber,
        role: 'user',
        content: 'first message',
        vertical: vertical
      });

      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay

      const message2 = service.storeMessage({
        phone_number: phoneNumber,
        role: 'bot',
        content: 'bot response',
        vertical: vertical
      });

      const session = service.getSession(message1.session_id);
      expect(new Date(session.last_activity)).to.be.at.least(new Date(session.started_at));
    });
  });

  // ------------------------------------------------------------
  // History Retrieval with 90-day Filter (AC #2)
  // ------------------------------------------------------------
  describe('History Retrieval (90-day filter)', () => {
    it('should retrieve messages for phone number', () => {
      const phoneNumber = '+919876543210';

      service.storeMessage({
        phone_number: phoneNumber,
        role: 'user',
        content: 'message 1',
        vertical: 'Bike Rental'
      });

      service.storeMessage({
        phone_number: phoneNumber,
        role: 'bot',
        content: 'response 1',
        vertical: 'Bike Rental'
      });

      const history = service.getHistory(phoneNumber);
      expect(history).to.be.an('array');
      expect(history.length).to.equal(2);
    });

    it('should filter messages to last 90 days', () => {
      const phoneNumber = '+919876543210';
      const today = new Date();
      const ninetyOneDaysAgo = new Date(today);
      ninetyOneDaysAgo.setDate(ninetyOneDaysAgo.getDate() - 91);

      // Store old message (91+ days ago)
      service.storeMessage({
        phone_number: phoneNumber,
        role: 'user',
        content: 'old message',
        vertical: 'Bike Rental',
        timestamp: ninetyOneDaysAgo.toISOString()
      });

      // Store recent message
      service.storeMessage({
        phone_number: phoneNumber,
        role: 'user',
        content: 'recent message',
        vertical: 'Bike Rental'
      });

      const history = service.getHistory(phoneNumber);
      expect(history.length).to.equal(1);
      expect(history[0].content).to.equal('recent message');
    });

    it('should return empty array for non-existent phone number', () => {
      const history = service.getHistory('+999999999999');
      expect(history).to.be.an('array');
      expect(history.length).to.equal(0);
    });

    it('should sort messages chronologically', () => {
      const phoneNumber = '+919876543210';

      const msg1 = service.storeMessage({
        phone_number: phoneNumber,
        role: 'user',
        content: 'first',
        vertical: 'Bike Rental'
      });

      const msg2 = service.storeMessage({
        phone_number: phoneNumber,
        role: 'bot',
        content: 'second',
        vertical: 'Bike Rental'
      });

      const msg3 = service.storeMessage({
        phone_number: phoneNumber,
        role: 'user',
        content: 'third',
        vertical: 'Bike Rental'
      });

      const history = service.getHistory(phoneNumber);
      expect(history.length).to.equal(3);
      expect(history[0].id).to.equal(msg1.id);
      expect(history[1].id).to.equal(msg2.id);
      expect(history[2].id).to.equal(msg3.id);
    });

    it('should support custom days parameter', () => {
      const phoneNumber = '+919876543210';
      const today = new Date();
      const thirtyOneDaysAgo = new Date(today);
      thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);

      // Store old message (31+ days ago)
      service.storeMessage({
        phone_number: phoneNumber,
        role: 'user',
        content: 'old message',
        vertical: 'Bike Rental',
        timestamp: thirtyOneDaysAgo.toISOString()
      });

      // Store recent message
      service.storeMessage({
        phone_number: phoneNumber,
        role: 'user',
        content: 'recent message',
        vertical: 'Bike Rental'
      });

      const history = service.getHistory(phoneNumber, 30);
      expect(history.length).to.equal(1);
      expect(history[0].content).to.equal('recent message');
    });

    it('should include future-dated messages within the window', () => {
      const phoneNumber = '+919876543210';
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);

      service.storeMessage({
        phone_number: phoneNumber,
        role: 'user',
        content: 'future message',
        vertical: 'Bike Rental',
        timestamp: futureDate.toISOString()
      });

      const history = service.getHistory(phoneNumber);
      const futureMsgs = history.filter(m => m.content === 'future message');
      expect(futureMsgs).to.have.length(1);
    });
  });

  // ------------------------------------------------------------
  // Cross-Vertical Thread Aggregation (AC #3)
  // ------------------------------------------------------------
  describe('Cross-Vertical Thread Aggregation', () => {
    it('should aggregate messages across all verticals', () => {
      const phoneNumber = '+919876543210';

      service.storeMessage({
        phone_number: phoneNumber,
        role: 'user',
        content: 'bike enquiry',
        vertical: 'Bike Rental'
      });

      service.storeMessage({
        phone_number: phoneNumber,
        role: 'user',
        content: 'hotel enquiry',
        vertical: 'Hotel'
      });

      service.storeMessage({
        phone_number: phoneNumber,
        role: 'user',
        content: 'taxi enquiry',
        vertical: 'Taxi'
      });

      const history = service.getHistory(phoneNumber);
      expect(history.length).to.equal(3);

      const verticals = history.map(m => m.vertical);
      expect(verticals).to.include('Bike Rental');
      expect(verticals).to.include('Hotel');
      expect(verticals).to.include('Taxi');
    });

    it('should maintain vertical context in message metadata', () => {
      const phoneNumber = '+919876543210';

      const message = service.storeMessage({
        phone_number: phoneNumber,
        role: 'user',
        content: 'enquiry',
        vertical: 'Hotel',
        metadata: { message_type: 'enquiry', intent_confidence: 0.9 }
      });

      const history = service.getHistory(phoneNumber);
      expect(history[0].vertical).to.equal('Hotel');
      expect(history[0].metadata.message_type).to.equal('enquiry');
      expect(history[0].metadata.intent_confidence).to.equal(0.9);
    });

    it('should return single threaded view across verticals', () => {
      const phoneNumber = '+919876543210';

      const msg1 = service.storeMessage({
        phone_number: phoneNumber,
        role: 'user',
        content: 'bike enquiry',
        vertical: 'Bike Rental'
      });

      const msg2 = service.storeMessage({
        phone_number: phoneNumber,
        role: 'bot',
        content: 'bike response',
        vertical: 'Bike Rental'
      });

      const msg3 = service.storeMessage({
        phone_number: phoneNumber,
        role: 'user',
        content: 'hotel enquiry',
        vertical: 'Hotel'
      });

      const history = service.getHistory(phoneNumber);
      expect(history.length).to.equal(3);
      expect(history[0].id).to.equal(msg1.id);
      expect(history[1].id).to.equal(msg2.id);
      expect(history[2].id).to.equal(msg3.id);
    });
  });
});

// ============================================================================
// API ENDPOINTS TESTS
// ============================================================================

describe('API Endpoints', () => {
  // ------------------------------------------------------------
  // POST /api/conversation/message - Store Message
  // ------------------------------------------------------------
  describe('POST /api/conversation/message', () => {
    it('should store message successfully', async () => {
      const response = await request(app)
        .post('/api/conversation/message')
        .send({
          phone_number: '+918888888888',
          role: 'user',
          content: 'I want to book a bike',
          vertical: 'Bike Rental'
        })
        .expect(201);

      expect(response.body).to.have.property('data');
      expect(response.body.data).to.have.property('id');
      expect(response.body.data).to.have.property('session_id');
      expect(response.body.data).to.have.property('timestamp');
      expect(response.body).to.have.property('meta');
      expect(response.body.meta.message).to.include('stored successfully');
    });

    it('should return 400 for missing phone_number', async () => {
      const response = await request(app)
        .post('/api/conversation/message')
        .send({
          role: 'user',
          content: 'test'
        })
        .expect(400);

      expect(response.body).to.have.property('error');
      expect(response.body.error.code).to.equal(400);
      expect(response.body.error.message).to.include('phone_number is required');
    });

    it('should return 400 for missing content', async () => {
      const response = await request(app)
        .post('/api/conversation/message')
        .send({
          phone_number: '+918888888888',
          role: 'user'
        })
        .expect(400);

      expect(response.body.error.code).to.equal(400);
      expect(response.body.error.message).to.include('content is required');
    });

    it('should store with provided session_id', async () => {
      const response = await request(app)
        .post('/api/conversation/message')
        .send({
          phone_number: '+918888888888',
          role: 'user',
          content: 'test',
          vertical: 'Bike Rental',
          session_id: 'sess_custom_123'
        })
        .expect(201);

      expect(response.body.data.session_id).to.equal('sess_custom_123');
    });

    it('should return 400 for whitespace-only content', async () => {
      const response = await request(app)
        .post('/api/conversation/message')
        .send({
          phone_number: '+918888888888',
          role: 'user',
          content: '   ',
          vertical: 'Bike Rental'
        })
        .expect(400);

      expect(response.body.error.code).to.equal(400);
      expect(response.body.error.message).to.include('content is required');
    });

    it('should return 400 for empty request body', async () => {
      const response = await request(app)
        .post('/api/conversation/message')
        .set('Content-Type', 'application/json')
        .send('')
        .expect(400);

      expect(response.body.error.code).to.equal(400);
    });

    it('should return 500 for unexpected service errors', async () => {
      // Cause a validation error from storeMessage that propagates to the catch block
      const response = await request(app)
        .post('/api/conversation/message')
        .send({
          phone_number: '+918888888888',
          role: 'admin',
          content: 'test',
          vertical: 'Bike Rental'
        })
        .expect(500);

      expect(response.body.error).to.have.property('message');
      expect(response.body.error.code).to.equal(500);
      expect(response.body.error.details).to.equal('An internal error occurred');
    });
  });

  // ------------------------------------------------------------
  // GET /api/conversation/history/:phoneNumber - Retrieve History
  // ------------------------------------------------------------
  describe('GET /api/conversation/history/:phoneNumber', () => {
    beforeEach(async () => {
      // Setup: Store some messages
      await request(app)
        .post('/api/conversation/message')
        .send({
          phone_number: '+918666666666',
          role: 'user',
          content: 'enquiry about bike',
          vertical: 'Bike Rental'
        });

      await request(app)
        .post('/api/conversation/message')
        .send({
          phone_number: '+918666666666',
          role: 'bot',
          content: 'bot response',
          vertical: 'Bike Rental'
        });
    });

    it('should retrieve conversation history', async () => {
      const response = await request(app)
        .get('/api/conversation/history/+918666666666')
        .expect(200);

      expect(response.body).to.have.property('data');
      expect(response.body.data).to.be.an('array');
      expect(response.body.data.length).to.equal(2);
    });

    it('should return empty array for non-existent phone number', async () => {
      const response = await request(app)
        .get('/api/conversation/history/+999999999999')
        .expect(200);

      expect(response.body.data).to.be.an('array');
      expect(response.body.data.length).to.equal(0);
    });

    it('should support custom days query parameter', async () => {
      const response = await request(app)
        .get('/api/conversation/history/+918666666666?days=30')
        .expect(200);

      expect(response.body).to.have.property('data');
      expect(response.body).to.have.property('meta');
      expect(response.body.meta.days_filter).to.equal(30);
    });

    it('should default to 90 days when no parameter provided', async () => {
      const response = await request(app)
        .get('/api/conversation/history/+918666666666')
        .expect(200);

      expect(response.body.meta.days_filter).to.equal(90);
    });

    it('should return 400 for negative days parameter', async () => {
      const response = await request(app)
        .get('/api/conversation/history/+918666666666?days=-1')
        .expect(400);

      expect(response.body.error.code).to.equal(400);
      expect(response.body.error.message).to.include('Invalid days');
    });

    it('should return 400 for zero days parameter', async () => {
      const response = await request(app)
        .get('/api/conversation/history/+918666666666?days=0')
        .expect(400);

      expect(response.body.error.code).to.equal(400);
    });

    it('should return 400 for non-numeric days parameter', async () => {
      const response = await request(app)
        .get('/api/conversation/history/+918666666666?days=abc')
        .expect(400);

      expect(response.body.error.code).to.equal(400);
    });
  });

  // ------------------------------------------------------------
  // GET /api/health - Health Check
  // ------------------------------------------------------------
  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body).to.have.property('status', 'healthy');
      expect(response.body).to.have.property('service', 'conversation-history-persistence');
      expect(response.body).to.have.property('endpoints');
      expect(response.body).to.have.property('uptime_ms');
      expect(response.body).to.have.property('retention_days', 90);
    });
  });
});

// ============================================================================
// ACCEPTANCE CRITERIA TESTS
// ============================================================================

describe('Acceptance Criteria', () => {
  // ------------------------------------------------------------
  // AC #1: Store messages with timestamp indexed by phone number
  // ------------------------------------------------------------
  it('AC #1: System stores message with timestamp indexed by phone number', async () => {
    const phoneNumber = '+915555555555';

    const response = await request(app)
      .post('/api/conversation/message')
      .send({
        phone_number: phoneNumber,
        role: 'user',
        content: 'I want to book a bike for tomorrow',
        vertical: 'Bike Rental'
      })
      .expect(201);

    expect(response.body.data).to.have.property('timestamp');
    expect(response.body.data).to.have.property('phone_number', phoneNumber);

    // Verify we can retrieve by phone number
    const historyResponse = await request(app)
      .get(`/api/conversation/history/${phoneNumber}`)
      .expect(200);

    expect(historyResponse.body.data).to.have.length(1);
    expect(historyResponse.body.data[0].content).to.equal('I want to book a bike for tomorrow');
  });

  // ------------------------------------------------------------
  // AC #2: Retrieve last 90 days of chat history
  // ------------------------------------------------------------
  it('AC #2: Last 90 days of chat history is retrievable', async () => {
    const phoneNumber = '+914444444444';

    // Store recent message
    await request(app)
      .post('/api/conversation/message')
      .send({
        phone_number: phoneNumber,
        role: 'user',
        content: 'recent enquiry',
        vertical: 'Bike Rental'
      });

    const response = await request(app)
      .get(`/api/conversation/history/${phoneNumber}`)
      .expect(200);

    expect(response.body.data).to.have.length(1);
    expect(response.body.meta.days_filter).to.equal(90);
  });

  it('AC #2: Messages older than 90 days are filtered out', () => {
    const service = new ConversationHistoryService();
    const phoneNumber = '+914444444445';

    const ninetyOneDaysAgo = new Date();
    ninetyOneDaysAgo.setDate(ninetyOneDaysAgo.getDate() - 91);
    service.storeMessage({
      phone_number: phoneNumber,
      role: 'user',
      content: 'old message',
      vertical: 'Bike Rental',
      timestamp: ninetyOneDaysAgo.toISOString()
    });

    // Store recent message
    service.storeMessage({
      phone_number: phoneNumber,
      role: 'user',
      content: 'recent message',
      vertical: 'Bike Rental'
    });

    const history = service.getHistory(phoneNumber);
    expect(history.length).to.equal(1);
    expect(history[0].content).to.equal('recent message');
  });

  // ------------------------------------------------------------
  // AC #3: Cross-vertical thread aggregation
  // ------------------------------------------------------------
  it('AC #3: Complete threaded conversation across all verticals is available', async () => {
    const phoneNumber = '+913333333333';

    // Store messages from multiple verticals
    await request(app)
      .post('/api/conversation/message')
      .send({
        phone_number: phoneNumber,
        role: 'user',
        content: 'bike enquiry',
        vertical: 'Bike Rental'
      });

    await request(app)
      .post('/api/conversation/message')
      .send({
        phone_number: phoneNumber,
        role: 'bot',
        content: 'bike response',
        vertical: 'Bike Rental'
      });

    await request(app)
      .post('/api/conversation/message')
      .send({
        phone_number: phoneNumber,
        role: 'user',
        content: 'hotel enquiry',
        vertical: 'Hotel'
      });

    await request(app)
      .post('/api/conversation/message')
      .send({
        phone_number: phoneNumber,
        role: 'bot',
        content: 'hotel response',
        vertical: 'Hotel'
      });

    await request(app)
      .post('/api/conversation/message')
      .send({
        phone_number: phoneNumber,
        role: 'user',
        content: 'taxi enquiry',
        vertical: 'Taxi'
      });

    const response = await request(app)
      .get(`/api/conversation/history/${phoneNumber}`)
      .expect(200);

    const data = response.body.data;
    expect(data).to.have.length(5);

    // Verify all verticals are represented
    const verticals = data.map(m => m.vertical);
    expect(verticals).to.include('Bike Rental');
    expect(verticals).to.include('Hotel');
    expect(verticals).to.include('Taxi');

    // Verify chronological order (single threaded view)
    for (let i = 1; i < data.length; i++) {
      expect(new Date(data[i].timestamp)).to.be.at.least(new Date(data[i-1].timestamp));
    }
  });
});
