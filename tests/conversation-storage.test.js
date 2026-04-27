process.env.MOCHA_TEST_MODE = 'true';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_KEY = 'test-key';

const { expect } = require('chai');
const sinon = require('sinon');
const { SupabaseConversationStorage, ConnectionPool } = require('../src/5-1-supabase-conversation-storage');
const { createClient } = require('@supabase/supabase-js');

// ---------------------------------------------------------------------------
// Builder: creates a chainable Supabase query with a configurable final promise
// ---------------------------------------------------------------------------
function makeQueryBuilder(resultPromise) {
  const resolveValue = resultPromise || Promise.resolve({ data: [], error: null, count: 0 });
  const builder = {
    _result: resolveValue,
    insert: sinon.stub(),
    select: sinon.stub(),
    eq: sinon.stub(),
    order: sinon.stub(),
    limit: sinon.stub(),
    range: sinon.stub(),
    gte: sinon.stub(),
    lte: sinon.stub(),
    textSearch: sinon.stub(),
    single: sinon.stub(),
  };

  // Make the builder thenable so `await query` resolves properly
  builder.then = (onFulfilled, onRejected) => resolveValue.then(onFulfilled, onRejected);
  builder.catch = (onRejected) => resolveValue.catch(onRejected);

  // All chainable methods return the builder.
  // skip insert, select, then, catch — these are not chainable in the chain context
  const chainable = ['eq', 'order', 'limit', 'range', 'gte', 'lte', 'textSearch', 'single'];
  chainable.forEach((k) => {
    builder[k].returns(builder);
  });

  // select returns the builder for chaining
  builder.select.returns(builder);

  return builder;
}

// ---------------------------------------------------------------------------
// ConnectionPool
// ---------------------------------------------------------------------------
describe('ConnectionPool', () => {
  let pool;

  beforeEach(() => {
    pool = new ConnectionPool(5);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should create a pool with default max connections', () => {
    const p = new ConnectionPool();
    expect(p.maxConnections).to.equal(5);
  });

  it('should accept custom max connections', () => {
    const p = new ConnectionPool(10);
    expect(p.maxConnections).to.equal(10);
  });

  it('should report pool status', () => {
    const status = pool.getStatus();
    expect(status).to.have.all.keys('available', 'active', 'max', 'waiting');
    expect(status.max).to.equal(5);
    expect(status.active).to.equal(0);
    expect(status.available).to.equal(0);
  });

  it('should throw when creating a connection without env vars', async () => {
    const origUrl = process.env.SUPABASE_URL;
    const origKey = process.env.SUPABASE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_KEY;

    try {
      await pool._createConnection();
      throw new Error('Should have thrown');
    } catch (err) {
      expect(err.message).to.include('SUPABASE_URL and SUPABASE_KEY');
    } finally {
      process.env.SUPABASE_URL = origUrl;
      process.env.SUPABASE_KEY = origKey;
    }
  });

  it('should return and release connections', async () => {
    const mockConn = { from: sinon.stub() };
    // Stub _createConnection but also increment activeConnections
    pool._createConnection = sinon.stub().callsFake(() => {
      pool.activeConnections++;
      return mockConn;
    });

    const conn1 = await pool.getConnection();
    expect(conn1).to.equal(mockConn);
    expect(pool.activeConnections).to.equal(1);

    pool.releaseConnection(conn1);
    expect(pool.connections.length).to.equal(1);
    expect(pool.activeConnections).to.equal(0);
  });

  it('should reuse released connections', async () => {
    const mockConn = { from: sinon.stub() };
    pool._createConnection = sinon.stub().callsFake(() => {
      pool.activeConnections++;
      return mockConn;
    });

    const conn1 = await pool.getConnection();
    pool.releaseConnection(conn1);

    const conn2 = await pool.getConnection();
    expect(conn2).to.equal(mockConn);
    expect(pool._createConnection.calledOnce).to.be.true;
  });

  it('should queue waiters when max connections reached', async () => {
    const mockConn = { from: sinon.stub() };
    pool._createConnection = sinon.stub().callsFake(() => {
      pool.activeConnections++;
      return mockConn;
    });

    // Fill all 5 connections
    const conns = [];
    for (let i = 0; i < 5; i++) {
      conns.push(await pool.getConnection());
    }

    expect(pool.activeConnections).to.equal(5);
    expect(pool.waiting.length).to.equal(0);

    // Next request should queue
    const waitPromise = pool.getConnection();
    expect(pool.waiting.length).to.equal(1);

    // Release one connection
    pool.releaseConnection(conns[0]);

    const releasedConn = await waitPromise;
    expect(releasedConn).to.equal(mockConn);
    expect(pool.waiting.length).to.equal(0);
  });
});

// ---------------------------------------------------------------------------
// SupabaseConversationStorage
// ---------------------------------------------------------------------------
describe('SupabaseConversationStorage', () => {
  let storage;
  let mockClient;
  let mockQueryBuilder;

  beforeEach(() => {
    mockClient = { from: sinon.stub(), rpc: sinon.stub() };
    storage = new SupabaseConversationStorage(mockClient);
  });

  afterEach(() => {
    sinon.restore();
  });

  // ---- insertMessage ----
  describe('insertMessage', () => {
    it('should insert a message and return the result', async () => {
      const fakeResult = {
        id: 'abc-123',
        phone_number: '+919999999999',
        message: 'Hello',
        direction: 'incoming',
        timestamp: '2026-04-24T10:00:00Z',
        vertical_tag: null,
      };
      const builder = makeQueryBuilder();
      builder.insert.returns(builder);
      builder.select.resolves({ data: [fakeResult], error: null });
      mockClient.from.returns(builder);

      const result = await storage.insertMessage({
        phoneNumber: '+919999999999',
        message: 'Hello',
        direction: 'incoming',
      });

      expect(result.phone_number).to.equal('+919999999999');
      expect(result.id).to.equal('abc-123');
    });

    it('should handle metadata payload correctly', async () => {
      const builder = makeQueryBuilder();
      builder.insert.returns(builder);
      builder.select.resolves({ data: [{ id: '1', metadata: { source: 'whatsapp' } }], error: null });
      mockClient.from.returns(builder);

      await storage.insertMessage({
        phoneNumber: '+919999999999',
        message: 'Test',
        metadata: { source: 'whatsapp', campaign: 'launch' },
        verticalTag: 'hotel',
        classificationId: 'cls-001',
      });

      const payload = builder.insert.firstCall.args[0];
      expect(payload.metadata.source).to.equal('whatsapp');
      expect(payload.metadata.campaign).to.equal('launch');
      expect(payload.vertical_tag).to.equal('hotel');
      expect(payload.classification_id).to.equal('cls-001');
    });

    it('should default direction to incoming', async () => {
      const builder = makeQueryBuilder();
      builder.insert.returns(builder);
      builder.select.resolves({ data: [{ id: '1' }], error: null });
      mockClient.from.returns(builder);

      await storage.insertMessage({
        phoneNumber: '+919999999999',
        message: 'Test',
      });

      const payload = builder.insert.firstCall.args[0];
      expect(payload.direction).to.equal('incoming');
    });
  });

  // ---- insertMessages (batch) ----
  describe('insertMessages (batch)', () => {
    it('should insert multiple messages', async () => {
      const fakeResults = [
        { id: '1', phone_number: '+919999999999', message: 'Msg 1' },
        { id: '2', phone_number: '+919999999999', message: 'Msg 2' },
      ];
      const builder = makeQueryBuilder();
      builder.insert.returns(builder);
      builder.select.resolves({ data: fakeResults, error: null });
      mockClient.from.returns(builder);

      const results = await storage.insertMessages([
        { phoneNumber: '+919999999999', message: 'Msg 1' },
        { phoneNumber: '+919999999999', message: 'Msg 2' },
      ]);

      expect(results).to.have.length(2);
      expect(results[0].id).to.equal('1');
    });

    it('should handle empty array', async () => {
      // When inserting empty, Supabase returns error, but our code should still work
      const builder = makeQueryBuilder();
      builder.insert.returns(builder);
      builder.select.resolves({ data: [], error: null });
      mockClient.from.returns(builder);

      const results = await storage.insertMessages([]);
      expect(results).to.deep.equal([]);
    });
  });

  // ---- getConversationsByPhone ----
  describe('getConversationsByPhone', () => {
    it('should return conversations for a phone number', async () => {
      const fakeMessages = [
        { id: '1', phone_number: '+919999999999', message: 'Hi', timestamp: '2026-04-24T10:00:00Z' },
        { id: '2', phone_number: '+919999999999', message: 'Hello', timestamp: '2026-04-24T10:01:00Z' },
      ];
      const resultPromise = Promise.resolve({ data: fakeMessages, error: null, count: 2 });
      const builder = makeQueryBuilder(resultPromise);
      mockClient.from.returns(builder);

      const result = await storage.getConversationsByPhone('+919999999999');

      expect(result.phone_number).to.equal('+919999999999');
      expect(result.messages).to.have.length(2);
      expect(result.total_count).to.equal(2);
      expect(result.has_more).to.be.false;
    });

    it('should apply pagination options', async () => {
      const fakeMessages = [
        { id: '1', phone_number: '+919999999999', message: 'A' },
        { id: '2', phone_number: '+919999999999', message: 'B' },
      ];
      const resultPromise = Promise.resolve({ data: fakeMessages, error: null, count: 2 });
      const builder = makeQueryBuilder(resultPromise);
      mockClient.from.returns(builder);

      const result = await storage.getConversationsByPhone('+919999999999', {
        limit: 10,
        offset: 0,
        after: '2026-01-01T00:00:00Z',
        before: '2026-12-31T23:59:59Z',
      });

      expect(result.messages).to.have.length(2);
    });

    it('should filter by vertical', async () => {
      const resultPromise = Promise.resolve({ data: [], error: null, count: 0 });
      const builder = makeQueryBuilder(resultPromise);
      mockClient.from.returns(builder);

      await storage.getConversationsByPhone('+919999999999', { vertical: 'hotel' });

      const eqCalls = builder.eq.getCalls();
      const verticalCall = eqCalls.find((c) => c.args[0] === 'vertical_tag');
      expect(verticalCall).to.exist;
      expect(verticalCall.args[1]).to.equal('hotel');
    });

    it('should return empty result for unknown number', async () => {
      const resultPromise = Promise.resolve({ data: [], error: null, count: 0 });
      const builder = makeQueryBuilder(resultPromise);
      mockClient.from.returns(builder);

      const result = await storage.getConversationsByPhone('+910000000000');
      expect(result.messages).to.have.length(0);
      expect(result.total_count).to.equal(0);
    });
  });

  // ---- searchMessages ----
  describe('searchMessages', () => {
    it('should return search results', async () => {
      const fakeMessages = [
        { id: '1', message: 'bike rental available?' },
      ];
      const resultPromise = Promise.resolve({ data: fakeMessages, error: null, count: 1 });
      const builder = makeQueryBuilder(resultPromise);
      mockClient.from.returns(builder);

      const result = await storage.searchMessages('bike rental');
      expect(result.messages).to.have.length(1);
      expect(result.search_term).to.equal('bike rental');
    });

    it('should accept limit and vertical filter', async () => {
      const resultPromise = Promise.resolve({ data: [], error: null, count: 0 });
      const builder = makeQueryBuilder(resultPromise);
      mockClient.from.returns(builder);

      await storage.searchMessages('hotel', { limit: 5, vertical: 'hotel' });

      expect(builder.limit.calledWith(5)).to.be.true;
      expect(builder.eq.calledWith('vertical_tag', 'hotel')).to.be.true;
    });
  });

  // ---- Index Health ----
  describe('getIndexHealth', () => {
    it('should return unknown status if RPC not available', async () => {
      mockClient.rpc.resolves({ data: null, error: new Error('function not found') });
      mockClient.from.returns({ select: sinon.stub().returnsThis(), limit: sinon.stub().resolves({ data: [], error: null }) });

      const result = await storage.getIndexHealth();
      expect(result.status).to.equal('unknown');
    });

    it('should return health data from RPC', async () => {
      const healthData = { indexes: ['idx_conversations_phone', 'idx_conversations_timestamp'] };
      mockClient.rpc.resolves({ data: healthData, error: null });

      const result = await storage.getIndexHealth();
      expect(result.indexes).to.include('idx_conversations_phone');
    });
  });

  // ---- generateMessageId ----
  describe('generateMessageId', () => {
    it('should generate a unique message ID', () => {
      const id1 = storage.generateMessageId();
      const id2 = storage.generateMessageId();
      expect(id1).to.not.equal(id2);
      expect(id1).to.match(/^msg-/);
    });
  });

  // ---- Query Timings ----
  describe('getQueryTimings', () => {
    it('should return zero stats when no queries recorded', () => {
      const timings = storage.getQueryTimings();
      expect(timings.avgDurationMs).to.equal(0);
      expect(timings.count).to.equal(0);
    });

    it('should record and return query timings', () => {
      storage._recordTiming('insertMessage', 50);
      storage._recordTiming('insertMessage', 150);

      const timings = storage.getQueryTimings();
      expect(timings.count).to.equal(2);
      expect(timings.avgDurationMs).to.equal(100);
    });
  });

  // ---- Edge Cases ----
  describe('edge cases', () => {
    it('should handle Supabase error during insert', async () => {
      const builder = makeQueryBuilder();
      builder.insert.returns(builder);
      builder.select.rejects(new Error('insert failed: invalid input'));
      mockClient.from.returns(builder);

      try {
        await storage.insertMessage({ phoneNumber: null, message: '' });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.message).to.include('insert failed');
      }
    });

    it('should handle duplicate messages', async () => {
      const builder = makeQueryBuilder();
      builder.insert.returns(builder);
      builder.select.resolves({ data: [{ id: 'dup-1' }], error: null });
      mockClient.from.returns(builder);

      const r1 = await storage.insertMessage({ phoneNumber: '+919999999999', message: 'Hello' });
      const r2 = await storage.insertMessage({ phoneNumber: '+919999999999', message: 'Hello' });

      expect(r1.id).to.equal('dup-1');
      expect(r2.id).to.equal('dup-1');
    });

    it('should handle empty conversation history', async () => {
      const resultPromise = Promise.resolve({ data: [], error: null, count: 0 });
      const builder = makeQueryBuilder(resultPromise);
      mockClient.from.returns(builder);

      const result = await storage.getConversationsByPhone('+910000000000');
      expect(result.messages).to.have.length(0);
      expect(result.has_more).to.be.false;
    });

    it('should handle database connection failure', async () => {
      mockClient.from.throws(new Error('Connection refused'));

      try {
        await storage.insertMessage({ phoneNumber: '+919999999999', message: 'Test' });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.message).to.include('Connection refused');
      }
    });
  });
});
