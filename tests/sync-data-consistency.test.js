process.env.MOCHA_TEST_MODE = 'true';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_KEY = 'test-key';
process.env.ERPNEXT_API_URL = 'https://odoo.test/api';
process.env.ERPNEXT_API_KEY = 'odoo-key';
process.env.PMS_API_URL = 'https://pms.test/api';
process.env.PMS_API_KEY = 'pms-key';

const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');

const {
  app,
  SyncManager,
  SyncTracking,
  ExternalReferenceStore,
  syncManager,
} = require('../src/5-2-cross-system-data-consistency');

// ---------------------------------------------------------------------------
// Helper: chainable Supabase mock builder
// ---------------------------------------------------------------------------
function makeQueryBuilder(resultPromise) {
  const resolveValue = resultPromise || Promise.resolve({ data: [], error: null, count: 0 });
  const builder = {
    _result: resolveValue,
    insert: sinon.stub(),
    select: sinon.stub(),
    update: sinon.stub(),
    delete: sinon.stub(),
    eq: sinon.stub(),
    order: sinon.stub(),
    limit: sinon.stub(),
    in: sinon.stub(),
    single: sinon.stub(),
    maybeSingle: sinon.stub(),
  };

  builder.then = (onFulfilled, onRejected) => resolveValue.then(onFulfilled, onRejected);
  builder.catch = (onRejected) => resolveValue.catch(onRejected);

  const chainable = ['eq', 'order', 'limit', 'in'];
  chainable.forEach((k) => {
    builder[k].returns(builder);
  });

  builder.insert.returns(builder);
  builder.select.returns(builder);
  builder.update.returns(builder);
  builder.delete.returns(builder);

  return builder;
}

// ---------------------------------------------------------------------------
// SyncTracking
// ---------------------------------------------------------------------------
describe('SyncTracking', () => {
  let tracking;
  let mockClient;

  beforeEach(() => {
    mockClient = { from: sinon.stub() };
    tracking = new SyncTracking(mockClient);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('createEvent', () => {
    it('should create a sync event and return it', async () => {
      const fakeEvent = {
        id: 'evt-1',
        source_system: 'supabase',
        target_system: 'erpnext',
        entity_type: 'customer',
        entity_id: 'cust-1',
        status: 'pending',
      };
      const builder = makeQueryBuilder();
      builder.insert.returns(builder);
      builder.select.returns(builder);
      builder.single.resolves({ data: fakeEvent, error: null });
      mockClient.from.returns(builder);

      const result = await tracking.createEvent({
        sourceSystem: 'supabase',
        targetSystem: 'erpnext',
        entityType: 'customer',
        entityId: 'cust-1',
        requestPayload: { ref: 'cust-1' },
      });

      expect(result.id).to.equal('evt-1');
      expect(result.status).to.equal('pending');
      expect(mockClient.from.calledWith('sync_tracking')).to.be.true;
    });
  });

  describe('updateEvent', () => {
    it('should update an event and return it', async () => {
      const fakeEvent = { id: 'evt-1', status: 'completed' };
      const builder = makeQueryBuilder();
      builder.update.returns(builder);
      builder.eq.returns(builder);
      builder.select.returns(builder);
      builder.single.resolves({ data: fakeEvent, error: null });
      mockClient.from.returns(builder);

      const result = await tracking.updateEvent('evt-1', { status: 'completed' });
      expect(result.status).to.equal('completed');
    });
  });

  describe('markCompleted', () => {
    it('should mark event as completed with external id', async () => {
      const fakeEvent = { id: 'evt-1', status: 'completed', external_id: 'ext-1' };
      const builder = makeQueryBuilder();
      builder.update.returns(builder);
      builder.eq.returns(builder);
      builder.select.returns(builder);
      builder.single.resolves({ data: fakeEvent, error: null });
      mockClient.from.returns(builder);

      const result = await tracking.markCompleted('evt-1', 'ext-1', { ok: true });
      expect(result.status).to.equal('completed');
      expect(result.external_id).to.equal('ext-1');
    });
  });

  describe('markFailed', () => {
    it('should mark event as failed and increment attempt count', async () => {
      const existingEvent = { id: 'evt-1', attempt_count: 1 };
      const failedEvent = { id: 'evt-1', status: 'failed', attempt_count: 2 };

      // Stub getEvent
      sinon.stub(tracking, 'getEvent').resolves(existingEvent);
      sinon.stub(tracking, 'updateEvent').resolves(failedEvent);

      const result = await tracking.markFailed('evt-1', 'Something went wrong');
      expect(result.status).to.equal('failed');
      expect(result.attempt_count).to.equal(2);
    });
  });

  describe('markConflict', () => {
    it('should mark event as conflict', async () => {
      sinon.stub(tracking, 'updateEvent').resolves({ id: 'evt-1', status: 'conflict' });

      const result = await tracking.markConflict('evt-1', 'Conflict detected');
      expect(result.status).to.equal('conflict');
      expect(tracking.updateEvent.calledWith('evt-1', sinon.match({ status: 'conflict' }))).to.be.true;
    });
  });

  describe('getEvent', () => {
    it('should return event by id', async () => {
      const fakeEvent = { id: 'evt-1', status: 'pending' };
      const builder = makeQueryBuilder();
      builder.select.returns(builder);
      builder.eq.returns(builder);
      builder.single.resolves({ data: fakeEvent, error: null });
      mockClient.from.returns(builder);

      const result = await tracking.getEvent('evt-1');
      expect(result.id).to.equal('evt-1');
    });
  });

  describe('getEventsByEntity', () => {
    it('should return events for an entity sorted by created_at desc', async () => {
      const events = [
        { id: 'evt-2', entity_type: 'customer', created_at: '2026-04-24T10:01:00Z' },
        { id: 'evt-1', entity_type: 'customer', created_at: '2026-04-24T10:00:00Z' },
      ];
      const builder = makeQueryBuilder(Promise.resolve({ data: events, error: null }));
      mockClient.from.returns(builder);

      const result = await tracking.getEventsByEntity('customer', 'cust-1');
      expect(result).to.have.length(2);
      expect(result[0].id).to.equal('evt-2');
      expect(mockClient.from.calledWith('sync_tracking')).to.be.true;
    });

    it('should return empty array when no events', async () => {
      const builder = makeQueryBuilder(Promise.resolve({ data: [], error: null }));
      mockClient.from.returns(builder);

      const result = await tracking.getEventsByEntity('customer', 'nonexistent');
      expect(result).to.deep.equal([]);
    });
  });

  describe('getPendingSyncs', () => {
    it('should return pending and failed syncs', async () => {
      const events = [{ id: 'evt-1', status: 'pending' }];
      const resultPromise = Promise.resolve({ data: events, error: null });
      const builder = makeQueryBuilder(resultPromise);
      // Override in to return builder for chaining
      builder.in.returns(builder);
      builder.order.returns(builder);
      builder.limit.returns(resultPromise);
      mockClient.from.returns(builder);

      const result = await tracking.getPendingSyncs();
      expect(result.events).to.have.length(1);
      expect(result.count).to.equal(1);
    });
  });

  describe('getFailedSyncs', () => {
    it('should return failed syncs', async () => {
      const events = [{ id: 'evt-1', status: 'failed' }];
      const resultPromise = Promise.resolve({ data: events, error: null });
      const builder = makeQueryBuilder(resultPromise);
      builder.eq.returns(builder);
      builder.order.returns(resultPromise);
      mockClient.from.returns(builder);

      const result = await tracking.getFailedSyncs();
      expect(result.events).to.have.length(1);
    });
  });

  describe('getConflicts', () => {
    it('should return conflict events', async () => {
      const conflicts = [{ id: 'evt-1', status: 'conflict' }];
      const resultPromise = Promise.resolve({ data: conflicts, error: null });
      const builder = makeQueryBuilder(resultPromise);
      builder.eq.returns(builder);
      builder.order.returns(resultPromise);
      mockClient.from.returns(builder);

      const result = await tracking.getConflicts();
      expect(result.conflicts).to.have.length(1);
    });
  });

  describe('getSyncSummary', () => {
    it('should return summary counts', async () => {
      const events = [
        { status: 'completed' },
        { status: 'completed' },
        { status: 'failed' },
        { status: 'pending' },
        { status: 'conflict' },
      ];
      const builder = makeQueryBuilder(Promise.resolve({ data: events, error: null }));
      mockClient.from.returns(builder);

      const result = await tracking.getSyncSummary();
      expect(result.total).to.equal(5);
      expect(result.completed).to.equal(2);
      expect(result.failed).to.equal(1);
      expect(result.pending).to.equal(1);
      expect(result.conflict).to.equal(1);
    });

    it('should handle empty events', async () => {
      const builder = makeQueryBuilder(Promise.resolve({ data: [], error: null }));
      mockClient.from.returns(builder);

      const result = await tracking.getSyncSummary();
      expect(result.total).to.equal(0);
      expect(result.completed).to.equal(0);
    });
  });
});

// ---------------------------------------------------------------------------
// ExternalReferenceStore
// ---------------------------------------------------------------------------
describe('ExternalReferenceStore', () => {
  let store;
  let mockClient;

  beforeEach(() => {
    mockClient = { from: sinon.stub() };
    store = new ExternalReferenceStore(mockClient);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('createReference', () => {
    it('should create and return an external reference', async () => {
      const fakeRef = {
        id: 'ref-1',
        supabase_entity_type: 'customer',
        supabase_entity_id: 'cust-1',
        target_system: 'erpnext',
        target_entity_id: '456',
      };
      const builder = makeQueryBuilder();
      builder.insert.returns(builder);
      builder.select.returns(builder);
      builder.single.resolves({ data: fakeRef, error: null });
      mockClient.from.returns(builder);

      const result = await store.createReference({
        entityType: 'customer',
        entityId: 'cust-1',
        targetSystem: 'erpnext',
        targetEntityId: '456',
        targetEntityType: 'partner',
      });

      expect(result.target_entity_id).to.equal('456');
      expect(result.target_system).to.equal('erpnext');
    });
  });

  describe('getReference', () => {
    it('should return reference by entity type, id, and target system', async () => {
      const fakeRef = { id: 'ref-1', target_system: 'erpnext', target_entity_id: '456' };
      const builder = makeQueryBuilder();
      builder.select.returns(builder);
      builder.eq.returns(builder);
      builder.maybeSingle.resolves({ data: fakeRef, error: null });
      mockClient.from.returns(builder);

      const result = await store.getReference('customer', 'cust-1', 'erpnext');
      expect(result.target_entity_id).to.equal('456');
    });

    it('should return null when no reference exists', async () => {
      const builder = makeQueryBuilder();
      builder.select.returns(builder);
      builder.eq.returns(builder);
      builder.maybeSingle.resolves({ data: null, error: null });
      mockClient.from.returns(builder);

      const result = await store.getReference('customer', 'nonexistent', 'erpnext');
      expect(result).to.be.null;
    });
  });

  describe('getReferencesByEntity', () => {
    it('should return all references for an entity', async () => {
      const refs = [
        { target_system: 'erpnext', target_entity_id: '456' },
        { target_system: 'pms', target_entity_id: '789' },
      ];
      const builder = makeQueryBuilder(Promise.resolve({ data: refs, error: null }));
      mockClient.from.returns(builder);

      const result = await store.getReferencesByEntity('customer', 'cust-1');
      expect(result).to.have.length(2);
    });

    it('should return empty array when no references', async () => {
      const builder = makeQueryBuilder(Promise.resolve({ data: [], error: null }));
      mockClient.from.returns(builder);

      const result = await store.getReferencesByEntity('customer', 'nonexistent');
      expect(result).to.deep.equal([]);
    });
  });

  describe('findByExternalId', () => {
    it('should find reference by target system and id', async () => {
      const fakeRef = { target_system: 'erpnext', target_entity_id: '456', supabase_entity_id: 'cust-1' };
      const builder = makeQueryBuilder();
      builder.select.returns(builder);
      builder.eq.returns(builder);
      builder.maybeSingle.resolves({ data: fakeRef, error: null });
      mockClient.from.returns(builder);

      const result = await store.findByExternalId('erpnext', '456');
      expect(result.supabase_entity_id).to.equal('cust-1');
    });
  });

  describe('removeReference', () => {
    it('should delete a reference', async () => {
      const builder = makeQueryBuilder();
      builder.delete.returns(builder);
      builder.eq.returns(builder);
      mockClient.from.returns(builder);

      await store.removeReference('customer', 'cust-1', 'erpnext');
      expect(mockClient.from.calledWith('external_references')).to.be.true;
    });
  });
});

// ---------------------------------------------------------------------------
// SyncManager
// ---------------------------------------------------------------------------
describe('SyncManager', () => {
  let manager;
  let mockClient;

  beforeEach(() => {
    mockClient = { from: sinon.stub() };
    manager = new SyncManager(mockClient, {
      maxRetries: 3,
      backoffMs: 100,
      driftThreshold: 0.1,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  // ---- syncProfile ----
  describe('syncProfile', () => {
    it('should sync customer to ERPNext and PMS', async () => {
      const odooResult = { referenceId: '456', cached: false };
      const pmsResult = { referenceId: '789', cached: false };

      sinon.stub(manager, '_syncToExternalSystem')
        .withArgs(sinon.match({ targetSystem: 'erpnext' })).resolves(odooResult)
        .withArgs(sinon.match({ targetSystem: 'pms' })).resolves(pmsResult);

      const result = await manager.syncProfile('cust-1');

      expect(result.erpnext.referenceId).to.equal('456');
      expect(result.pms.referenceId).to.equal('789');
      expect(result.errors).to.deep.equal([]);
    });

    it('should skip systems without API URL configured', async () => {
      const managerLocal = new SyncManager(mockClient);
      // Don't set env vars — they fall through to skip
      delete process.env.ERPNEXT_API_URL;
      delete process.env.PMS_API_URL;

      const result = await managerLocal.syncProfile('cust-1');

      expect(result.erpnext).to.be.null;
      expect(result.pms).to.be.null;
      expect(result.errors).to.deep.equal([]);

      // Restore for other tests
      process.env.ERPNEXT_API_URL = 'https://odoo.test/api';
      process.env.PMS_API_URL = 'https://pms.test/api';
    });

    it('should collect partial errors', async () => {
      sinon.stub(manager, '_syncToExternalSystem')
        .withArgs(sinon.match({ targetSystem: 'erpnext' }))
        .rejects(new Error('ERPNext timeout'))
        .withArgs(sinon.match({ targetSystem: 'pms' }))
        .resolves({ referenceId: '789', cached: false });

      const result = await manager.syncProfile('cust-1');

      expect(result.pms.referenceId).to.equal('789');
      expect(result.errors).to.have.length(1);
      expect(result.errors[0].error).to.include('ERPNext timeout');
    });
  });

  // ---- syncBooking ----
  describe('syncBooking', () => {
    it('should sync booking to ERPNext', async () => {
      sinon.stub(manager, '_syncToExternalSystem')
        .resolves({ referenceId: 'so-456', cached: false });

      const result = await manager.syncBooking('booking-1');

      expect(result.erpnext.referenceId).to.equal('so-456');
      expect(result.errors).to.deep.equal([]);
    });

    it('should handle ERPNext errors gracefully', async () => {
      sinon.stub(manager, '_syncToExternalSystem')
        .rejects(new Error('ERPNext unavailable'));

      const result = await manager.syncBooking('booking-1');

      expect(result.erpnext).to.be.null;
      expect(result.errors).to.have.length(1);
      expect(result.errors[0].error).to.include('ERPNext unavailable');
    });
  });

  // ---- _syncToExternalSystem ----
  describe('_syncToExternalSystem', () => {
    it('should return cached reference if already synced', async () => {
      sinon.stub(manager.syncTracking, 'createEvent').resolves({ id: 'evt-1' });
      sinon.stub(manager.externalRefs, 'getReference').resolves({
        id: 'ref-1',
        target_entity_id: '456',
      });
      sinon.stub(manager.syncTracking, 'markCompleted').resolves({});

      const result = await manager._syncToExternalSystem({
        entityType: 'customer',
        entityId: 'cust-1',
        targetSystem: 'erpnext',
        targetEntityType: 'partner',
        buildPayload: () => ({ ref: 'cust-1' }),
        apiEndpoint: 'https://odoo.test/api/partners',
        apiKey: 'key',
      });

      expect(result.cached).to.be.true;
      expect(result.referenceId).to.equal('456');
    });

    it('should call external API and store reference on success', async () => {
      sinon.stub(manager.syncTracking, 'createEvent').resolves({ id: 'evt-1' });
      sinon.stub(manager.externalRefs, 'getReference').resolves(null);
      sinon.stub(manager, '_callExternalApi').resolves({ id: 'ext-456' });
      sinon.stub(manager.externalRefs, 'createReference').resolves({});
      sinon.stub(manager.syncTracking, 'markCompleted').resolves({});

      const result = await manager._syncToExternalSystem({
        entityType: 'customer',
        entityId: 'cust-1',
        targetSystem: 'erpnext',
        targetEntityType: 'partner',
        buildPayload: () => ({ ref: 'cust-1' }),
        apiEndpoint: 'https://odoo.test/api/partners',
        apiKey: 'key',
      });

      expect(result.cached).to.be.false;
      expect(result.referenceId).to.equal('ext-456');
      expect(manager.externalRefs.createReference.calledOnce).to.be.true;
    });

    it('should retry with exponential backoff on failure', async () => {
      const clock = sinon.useFakeTimers();
      sinon.stub(manager.syncTracking, 'createEvent').resolves({ id: 'evt-1' });
      sinon.stub(manager.externalRefs, 'getReference').resolves(null);
      sinon.stub(manager.syncTracking, 'updateEvent').resolves({});

      const apiStub = sinon.stub(manager, '_callExternalApi');
      apiStub.onFirstCall().rejects(new Error('Network error'));
      apiStub.onSecondCall().rejects(new Error('Still failing'));
      apiStub.onThirdCall().resolves({ id: 'ext-456' });

      sinon.stub(manager.externalRefs, 'createReference').resolves({});
      sinon.stub(manager.syncTracking, 'markCompleted').resolves({});

      // Start the call in background
      const promise = manager._syncToExternalSystem({
        entityType: 'customer',
        entityId: 'cust-1',
        targetSystem: 'erpnext',
        targetEntityType: 'partner',
        buildPayload: () => ({ ref: 'cust-1' }),
        apiEndpoint: 'https://odoo.test/api/partners',
        apiKey: 'key',
      });

      // Advance through backoff delays: 100ms, 200ms
      await clock.tickAsync(100);
      await clock.tickAsync(200);
      // Third attempt succeeds
      await clock.runAllAsync();

      const result = await promise;
      expect(result.referenceId).to.equal('ext-456');
      expect(apiStub.calledThrice).to.be.true;
      clock.restore();
    });

    it('should mark failed and throw after max retries', async () => {
      sinon.stub(manager.syncTracking, 'createEvent').resolves({ id: 'evt-1' });
      sinon.stub(manager.externalRefs, 'getReference').resolves(null);
      sinon.stub(manager, '_callExternalApi').rejects(new Error('Always fails'));
      sinon.stub(manager.syncTracking, 'updateEvent').resolves({});
      const markFailedStub = sinon.stub(manager.syncTracking, 'markFailed').resolves({});

      try {
        await manager._syncToExternalSystem({
          entityType: 'customer',
          entityId: 'cust-1',
          targetSystem: 'erpnext',
          targetEntityType: 'partner',
          buildPayload: () => ({ ref: 'cust-1' }),
          apiEndpoint: 'https://odoo.test/api/partners',
          apiKey: 'key',
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.message).to.include('failed after 3 retries');
        expect(markFailedStub.calledOnce).to.be.true;
      }
    });
  });

  // ---- _callExternalApi ----
  describe('_callExternalApi', () => {
    it('should make HTTP POST request and return JSON', async () => {
      const responseData = { id: 'ext-456' };
      const mockResponse = {
        ok: true,
        json: sinon.stub().resolves(responseData),
      };
      sinon.stub(global, 'fetch').resolves(mockResponse);

      const result = await manager._callExternalApi('https://api.test', 'api-key', { data: 'test' });
      expect(result.id).to.equal('ext-456');
      expect(global.fetch.calledWithMatch('https://api.test', sinon.match({ method: 'POST' }))).to.be.true;
    });

    it('should throw on non-ok response', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        text: sinon.stub().resolves('Internal Server Error'),
      };
      sinon.stub(global, 'fetch').resolves(mockResponse);

      try {
        await manager._callExternalApi('https://api.test', 'key', {});
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.message).to.include('HTTP 500');
      }
    });
  });

  // ---- detectConflicts ----
  describe('detectConflicts', () => {
    it('should return empty conflicts when no references exist', async () => {
      const builder = makeQueryBuilder(Promise.resolve({ data: null, error: null }));
      mockClient.from.returns(builder);

      const result = await manager.detectConflicts();
      expect(result.conflicts).to.have.length(0);
      expect(result.count).to.equal(0);
    });

    it('should detect conflicts for stale references with high drift', async () => {
      // Mock external_references
      const refs = [
        { id: 'ref-1', supabase_entity_type: 'customer', supabase_entity_id: 'cust-1', target_system: 'erpnext' },
      ];
      const refsBuilder = makeQueryBuilder(Promise.resolve({ data: refs, error: null }));
      mockClient.from.returns(refsBuilder);

      // Mock getEventsByEntity to return a very old completed event
      sinon.stub(manager.syncTracking, 'getEventsByEntity').resolves([
        { id: 'evt-1', status: 'completed', created_at: '2025-01-01T00:00:00Z' },
      ]);

      // Mock _calculateDrift to exceed threshold
      sinon.stub(manager, '_calculateDrift').resolves(0.5);

      // Mock createEvent and markConflict for the conflict detection
      sinon.stub(manager.syncTracking, 'createEvent').resolves({ id: 'conflict-evt' });
      sinon.stub(manager.syncTracking, 'markConflict').resolves({});

      const result = await manager.detectConflicts();
      expect(result.conflicts).to.have.length(1);
      expect(result.conflicts[0].drift).to.equal(50);
    });
  });

  // ---- resolveConflict ----
  describe('resolveConflict', () => {
    it('should resolve a conflict event', async () => {
      const conflictEvent = {
        id: 'conflict-1',
        status: 'conflict',
        entity_type: 'customer',
        entity_id: 'cust-1',
        target_system: 'erpnext',
        external_id: 'ext-456',
      };

      sinon.stub(manager.syncTracking, 'getEvent').resolves(conflictEvent);
      sinon.stub(manager, '_fetchEntityData').resolves({ id: 'cust-1', name: 'Test' });
      sinon.stub(manager, '_callExternalApi').resolves({ ok: true });
      sinon.stub(manager.syncTracking, 'markCompleted').resolves({});

      const result = await manager.resolveConflict('conflict-1');
      expect(result.resolved).to.be.true;
    });

    it('should throw if event is not in conflict status', async () => {
      sinon.stub(manager.syncTracking, 'getEvent').resolves({
        id: 'evt-1',
        status: 'completed',
      });

      try {
        await manager.resolveConflict('evt-1');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.message).to.include('not in conflict status');
      }
    });
  });

  // ---- getDriftReport ----
  describe('getDriftReport', () => {
    it('should return drift report for customer and booking', async () => {
      sinon.stub(manager, '_calculateDrift')
        .withArgs('customer').resolves(0.05)
        .withArgs('booking').resolves(0);

      const result = await manager.getDriftReport();

      expect(result.customer_drift).to.equal(5);
      expect(result.booking_drift).to.equal(0);
      expect(result.healthy).to.be.true;
      expect(result.generated_at).to.exist;
    });

    it('should report unhealthy when drift exceeds threshold', async () => {
      sinon.stub(manager, '_calculateDrift')
        .withArgs('customer').resolves(0.5)
        .withArgs('booking').resolves(0);

      const result = await manager.getDriftReport();
      expect(result.healthy).to.be.false;
    });
  });

  // ---- getSyncStatus ----
  describe('getSyncStatus', () => {
    it('should return combined sync status for an entity', async () => {
      const events = [
        { id: 'evt-2', target_system: 'erpnext', status: 'completed', attempt_count: 1, last_attempt_at: '2026-04-24T10:01:00Z', created_at: '2026-04-24T10:00:00Z' },
      ];
      const refs = [
        { target_system: 'erpnext', target_entity_id: '456', target_entity_type: 'partner' },
      ];

      sinon.stub(manager.syncTracking, 'getEventsByEntity').resolves(events);
      sinon.stub(manager.externalRefs, 'getReferencesByEntity').resolves(refs);

      const result = await manager.getSyncStatus('customer', 'cust-1');
      expect(result.entity_type).to.equal('customer');
      expect(result.total_syncs).to.equal(1);
      expect(result.latest_status).to.equal('completed');
      expect(result.external_references).to.have.length(1);
    });
  });

  // ---- _calculateDrift ----
  describe('_calculateDrift', () => {
    it('should return drift percentage', async () => {
      // First call: count customers — 100
      // Second call: count references for customer — 90
      const customerBuilder = makeQueryBuilder(Promise.resolve({ data: null, error: null, count: 100 }));
      const refBuilder = makeQueryBuilder(Promise.resolve({ data: null, error: null, count: 90 }));
      mockClient.from.onFirstCall().returns(customerBuilder);
      mockClient.from.onSecondCall().returns(refBuilder);
      // Make eq chainable for the ref query
      refBuilder.eq.returns(refBuilder);
      refBuilder.select.returns(refBuilder);

      const drift = await manager._calculateDrift('customer');
      expect(drift).to.equal(0.1); // (100 - 90) / 100
    });

    it('should return 0 when supabase count is 0', async () => {
      const builder = makeQueryBuilder(Promise.resolve({ data: null, error: null, count: 0 }));
      mockClient.from.returns(builder);

      const drift = await manager._calculateDrift('customer');
      expect(drift).to.equal(0);
    });

    it('should return 0 on error', async () => {
      const builder = makeQueryBuilder(Promise.resolve({ data: null, error: new Error('DB error'), count: 0 }));
      mockClient.from.returns(builder);

      const drift = await manager._calculateDrift('customer');
      expect(drift).to.equal(0);
    });
  });

  // ---- Polling ----
  describe('startPolling / stopPolling', () => {
    it('should start and stop polling', () => {
      manager.startPolling(1000);
      expect(manager._pollInterval).to.exist;

      manager.stopPolling();
      expect(manager._pollInterval).to.be.null;
    });
  });

  describe('_processPendingSyncs', () => {
    it('should process pending sync events', async () => {
      sinon.stub(manager.syncTracking, 'getPendingSyncs').resolves({
        events: [
          { id: 'evt-1', target_system: 'erpnext', request_payload: { ref: 'cust-1' }, attempt_count: 0 },
        ],
        count: 1,
      });
      sinon.stub(manager, '_callExternalApi').resolves({ id: 'ext-456' });
      sinon.stub(manager.syncTracking, 'markCompleted').resolves({});

      await manager._processPendingSyncs();
      expect(manager._callExternalApi.calledOnce).to.be.true;
    });

    it('should handle errors gracefully during processing', async () => {
      sinon.stub(manager.syncTracking, 'getPendingSyncs').resolves({
        events: [
          { id: 'evt-1', target_system: 'erpnext', request_payload: {}, attempt_count: 0 },
        ],
        count: 1,
      });
      sinon.stub(manager, '_callExternalApi').rejects(new Error('API error'));
      sinon.stub(manager.syncTracking, 'updateEvent').resolves({});

      await manager._processPendingSyncs();
      expect(manager.syncTracking.updateEvent.calledOnce).to.be.true;
    });
  });

  // ---- getMonitorData ----
  describe('getMonitorData', () => {
    it('should return combined monitoring data', async () => {
      sinon.stub(manager.syncTracking, 'getSyncSummary').resolves({ total: 10, completed: 8, failed: 1, pending: 1, conflict: 0 });
      sinon.stub(manager, 'getDriftReport').resolves({ customer_drift: 5, booking_drift: 0, healthy: true });
      sinon.stub(manager.syncTracking, 'getPendingSyncs').resolves({ events: [], count: 0 });

      const result = await manager.getMonitorData();
      expect(result.sync_summary.total).to.equal(10);
      expect(result.drift.healthy).to.be.true;
      expect(result.pending_queue).to.equal(0);
      expect(result.timestamp).to.exist;
    });
  });
});

// ---------------------------------------------------------------------------
// API Endpoints
// ---------------------------------------------------------------------------
describe('Sync API Endpoints', () => {
  let sandbox;

  before(() => {
    sandbox = sinon.createSandbox();
    // Stub syncManager methods for API tests
    sandbox.stub(syncManager, 'syncProfile').resolves({
      customerId: 'cust-1',
      erpnext: { referenceId: '456', cached: false },
      pms: { referenceId: '789', cached: false },
      errors: [],
    });
    sandbox.stub(syncManager, 'syncBooking').resolves({
      bookingId: 'booking-1',
      erpnext: { referenceId: 'so-456', cached: false },
      errors: [],
    });
    sandbox.stub(syncManager, 'getSyncStatus').resolves({
      entity_type: 'customer',
      entity_id: 'cust-1',
      total_syncs: 1,
      latest_status: 'completed',
      external_references: [],
      events: [],
    });
    sandbox.stub(syncManager.syncTracking, 'getConflicts').resolves({
      conflicts: [],
      count: 0,
    });
    sandbox.stub(syncManager, 'resolveConflict').resolves({
      resolved: true,
      eventId: 'conflict-1',
    });
    sandbox.stub(syncManager, 'getMonitorData').resolves({
      sync_summary: { total: 10, completed: 8, failed: 1, pending: 1, conflict: 0 },
      drift: { customer_drift: 5, booking_drift: 0, healthy: true },
      pending_queue: 1,
      timestamp: new Date().toISOString(),
    });
  });

  after(() => {
    sandbox.restore();
  });

  // ---- Health ----
  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).to.equal(200);
      expect(res.body.data.status).to.equal('ok');
      expect(res.body.data.service).to.equal('cross-system-data-consistency');
    });
  });

  // ---- POST /api/sync/profile ----
  describe('POST /api/sync/profile', () => {
    it('should trigger profile sync and return 201', async () => {
      const res = await request(app)
        .post('/api/sync/profile')
        .send({ customer_id: 'cust-1' })
        .set('Content-Type', 'application/json');

      expect(res.status).to.equal(201);
      expect(res.body.data.customer_id).to.equal('cust-1');
      expect(res.body.data.erpnext_ref).to.equal('456');
      expect(res.body.data.pms_ref).to.equal('789');
    });

    it('should return 400 when customer_id is missing', async () => {
      const res = await request(app)
        .post('/api/sync/profile')
        .send({})
        .set('Content-Type', 'application/json');

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.include('customer_id');
    });

    it('should return 207 when partial errors occur', async () => {
      syncManager.syncProfile.resolves({
        customerId: 'cust-1',
        erpnext: null,
        pms: { referenceId: '789', cached: false },
        errors: [{ system: 'erpnext', error: 'ERPNext timeout' }],
      });

      const res = await request(app)
        .post('/api/sync/profile')
        .send({ customer_id: 'cust-1' })
        .set('Content-Type', 'application/json');

      expect(res.status).to.equal(207);
      expect(res.body.data.errors).to.have.length(1);
    });
  });

  // ---- POST /api/sync/booking ----
  describe('POST /api/sync/booking', () => {
    it('should trigger booking sync and return 201', async () => {
      const res = await request(app)
        .post('/api/sync/booking')
        .send({ booking_id: 'booking-1' })
        .set('Content-Type', 'application/json');

      expect(res.status).to.equal(201);
      expect(res.body.data.booking_id).to.equal('booking-1');
      expect(res.body.data.erpnext_ref).to.equal('so-456');
    });

    it('should return 400 when booking_id is missing', async () => {
      const res = await request(app)
        .post('/api/sync/booking')
        .send({})
        .set('Content-Type', 'application/json');

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.include('booking_id');
    });
  });

  // ---- GET /api/sync/status/:entityType/:entityId ----
  describe('GET /api/sync/status/:entityType/:entityId', () => {
    it('should return sync status for an entity', async () => {
      const res = await request(app).get('/api/sync/status/customer/cust-1');

      expect(res.status).to.equal(200);
      expect(res.body.data.entity_type).to.equal('customer');
      expect(res.body.data.entity_id).to.equal('cust-1');
    });

    it('should return 400 for invalid entity type', async () => {
      const res = await request(app).get('/api/sync/status/invalid/123');

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.include('entityType');
    });
  });

  // ---- GET /api/sync/conflicts ----
  describe('GET /api/sync/conflicts', () => {
    it('should return list of conflicts', async () => {
      const res = await request(app).get('/api/sync/conflicts');

      expect(res.status).to.equal(200);
      expect(res.body.data.conflicts).to.exist;
    });
  });

  // ---- POST /api/sync/conflicts/:id/resolve ----
  describe('POST /api/sync/conflicts/:id/resolve', () => {
    it('should resolve a conflict', async () => {
      const res = await request(app)
        .post('/api/sync/conflicts/conflict-1/resolve')
        .set('Content-Type', 'application/json');

      expect(res.status).to.equal(200);
      expect(res.body.data.resolved).to.be.true;
    });
  });

  // ---- GET /api/sync/monitor ----
  describe('GET /api/sync/monitor', () => {
    it('should return monitoring data', async () => {
      const res = await request(app).get('/api/sync/monitor');

      expect(res.status).to.equal(200);
      expect(res.body.data.sync_summary).to.exist;
      expect(res.body.data.drift).to.exist;
      expect(res.body.data.pending_queue).to.equal(1);
    });
  });
});
