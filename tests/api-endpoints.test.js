process.env.MOCHA_TEST_MODE = 'true';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_KEY = 'test-key';

const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');

// Mock the storage module before requiring app
const mockInsertMessage = sinon.stub();
const mockInsertMessages = sinon.stub();
const mockGetConversationsByPhone = sinon.stub();
const mockSearchMessages = sinon.stub();
const mockGetIndexHealth = sinon.stub();
const mockGetQueryTimings = sinon.stub().returns({ avgDurationMs: 0, count: 0 });
const mockGetStatus = sinon.stub().returns({ available: 0, active: 1, max: 5, waiting: 0 });

const mockConversationStorage = {
  insertMessage: mockInsertMessage,
  insertMessages: mockInsertMessages,
  getConversationsByPhone: mockGetConversationsByPhone,
  searchMessages: mockSearchMessages,
  getIndexHealth: mockGetIndexHealth,
  getQueryTimings: mockGetQueryTimings,
  generateMessageId: () => 'msg-test-123',
};

// Monkey-patch before requiring the app
const storageModule = require('../src/5-1-supabase-conversation-storage');

// We need to get the app from the module
const { app } = storageModule;

// Override the module-level conversationStorage
// Since the app uses a module-scoped `conversationStorage`, we need to stub its methods
// We'll use sinon to stub the prototype methods

const SupabaseConversationStorage = storageModule.SupabaseConversationStorage;

describe('API Endpoints', () => {
  let sandbox;

  before(() => {
    sandbox = sinon.createSandbox();
    // Stub the instance methods on the prototype
    sandbox.stub(SupabaseConversationStorage.prototype, 'insertMessage').callsFake(mockInsertMessage);
    sandbox.stub(SupabaseConversationStorage.prototype, 'insertMessages').callsFake(mockInsertMessages);
    sandbox.stub(SupabaseConversationStorage.prototype, 'getConversationsByPhone').callsFake(mockGetConversationsByPhone);
    sandbox.stub(SupabaseConversationStorage.prototype, 'searchMessages').callsFake(mockSearchMessages);
    sandbox.stub(SupabaseConversationStorage.prototype, 'getIndexHealth').callsFake(mockGetIndexHealth);
    sandbox.stub(SupabaseConversationStorage.prototype, 'getQueryTimings').callsFake(mockGetQueryTimings);
  });

  after(() => {
    sandbox.restore();
  });

  beforeEach(() => {
    mockInsertMessage.reset();
    mockInsertMessages.reset();
    mockGetConversationsByPhone.reset();
    mockSearchMessages.reset();
    mockGetIndexHealth.reset();
  });

  // ---- Health Check ----
  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).to.equal(200);
      expect(res.body.data.status).to.equal('ok');
      expect(res.body.data.service).to.equal('conversation-storage');
      expect(res.body.meta).to.have.property('timestamp');
    });
  });

  // ---- POST /api/conversations ----
  describe('POST /api/conversations', () => {
    const validBody = {
      phone_number: '+919999999999',
      message: 'Hello, I need a bike rental',
      direction: 'incoming',
    };

    it('should create a message and return 201', async () => {
      mockInsertMessage.resolves({
        id: 'new-id',
        phone_number: '+919999999999',
        message: 'Hello, I need a bike rental',
        direction: 'incoming',
        timestamp: '2026-04-24T10:00:00Z',
        vertical_tag: null,
      });

      const res = await request(app)
        .post('/api/conversations')
        .send(validBody)
        .set('Content-Type', 'application/json');

      expect(res.status).to.equal(201);
      expect(res.body.data.id).to.equal('new-id');
      expect(res.body.data.phone_number).to.equal('+919999999999');
      expect(res.body.meta).to.have.property('timestamp');
    });

    it('should return 400 when phone_number is missing', async () => {
      const res = await request(app)
        .post('/api/conversations')
        .send({ message: 'Hello' })
        .set('Content-Type', 'application/json');

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.include('phone_number');
    });

    it('should return 400 when message is missing', async () => {
      const res = await request(app)
        .post('/api/conversations')
        .send({ phone_number: '+919999999999' })
        .set('Content-Type', 'application/json');

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.include('message');
    });

    it('should return 500 on storage failure', async () => {
      mockInsertMessage.rejects(new Error('DB connection lost'));

      const res = await request(app)
        .post('/api/conversations')
        .send(validBody)
        .set('Content-Type', 'application/json');

      expect(res.status).to.equal(500);
      expect(res.body.error.message).to.equal('Failed to store message');
    });
  });

  // ---- POST /api/conversations/batch ----
  describe('POST /api/conversations/batch', () => {
    it('should batch insert messages and return 201', async () => {
      mockInsertMessages.resolves([
        { id: '1', phone_number: '+919999999999', timestamp: '2026-04-24T10:00:00Z' },
        { id: '2', phone_number: '+919999999998', timestamp: '2026-04-24T10:01:00Z' },
      ]);

      const res = await request(app)
        .post('/api/conversations/batch')
        .send({
          messages: [
            { phone_number: '+919999999999', message: 'Hi' },
            { phone_number: '+919999999998', message: 'Hello' },
          ],
        })
        .set('Content-Type', 'application/json');

      expect(res.status).to.equal(201);
      expect(res.body.data.inserted).to.equal(2);
    });

    it('should return 400 when messages array is empty', async () => {
      const res = await request(app)
        .post('/api/conversations/batch')
        .send({ messages: [] })
        .set('Content-Type', 'application/json');

      expect(res.status).to.equal(400);
    });

    it('should return 400 when messages field is missing', async () => {
      const res = await request(app)
        .post('/api/conversations/batch')
        .send({})
        .set('Content-Type', 'application/json');

      expect(res.status).to.equal(400);
    });

    it('should reject batches larger than 100', async () => {
      const messages = Array.from({ length: 101 }, (_, i) => ({
        phone_number: `+919999999${String(i).padStart(3, '0')}`,
        message: `Message ${i}`,
      }));

      const res = await request(app)
        .post('/api/conversations/batch')
        .send({ messages })
        .set('Content-Type', 'application/json');

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.include('100');
    });
  });

  // ---- GET /api/conversations/:phone ----
  describe('GET /api/conversations/:phone', () => {
    it('should return conversations for a phone number', async () => {
      mockGetConversationsByPhone.resolves({
        phone_number: '+919999999999',
        messages: [{ id: '1', message: 'Hi', timestamp: '2026-04-24T10:00:00Z' }],
        total_count: 1,
        has_more: false,
      });

      const res = await request(app).get('/api/conversations/+919999999999');

      expect(res.status).to.equal(200);
      expect(res.body.data.messages).to.have.length(1);
      expect(res.body.data.phone_number).to.equal('+919999999999');
    });

    it('should return 404 when no conversations found', async () => {
      mockGetConversationsByPhone.resolves({
        phone_number: '+910000000000',
        messages: [],
        total_count: 0,
        has_more: false,
      });

      const res = await request(app).get('/api/conversations/+910000000000');

      expect(res.status).to.equal(404);
      expect(res.body.error.message).to.include('No conversations found');
    });
  });

  // ---- GET /api/conversations/search ----
  describe('GET /api/conversations/search', () => {
    it('should return search results', async () => {
      mockSearchMessages.resolves({
        messages: [{ id: '1', message: 'bike rental available?' }],
        total_count: 1,
        search_term: 'bike rental',
      });

      const res = await request(app)
        .get('/api/conversations/search')
        .query({ q: 'bike rental' });

      expect(res.status).to.equal(200);
      expect(res.body.data.messages).to.have.length(1);
      expect(res.body.data.search_term).to.equal('bike rental');
    });

    it('should return 400 when query param is missing', async () => {
      const res = await request(app).get('/api/conversations/search');

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.include('Search query');
    });
  });

  // ---- Performance Monitoring ----
  describe('GET /api/conversations/monitor/performance', () => {
    it('should return performance metrics', async () => {
      const res = await request(app).get('/api/conversations/monitor/performance');

      expect(res.status).to.equal(200);
      expect(res.body.data.query_performance).to.exist;
      expect(res.body.data.connection_pool).to.exist;
    });
  });

  // ---- Index Health ----
  describe('GET /api/conversations/monitor/index-health', () => {
    it('should return index health status', async () => {
      mockGetIndexHealth.resolves({ status: 'healthy', indexes: [] });

      const res = await request(app).get('/api/conversations/monitor/index-health');

      expect(res.status).to.equal(200);
      expect(res.body.data).to.exist;
    });
  });
});
