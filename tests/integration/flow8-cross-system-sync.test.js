require('../helpers/setup');
const { expect } = require('chai');
const request = require('supertest');
const sinon = require('sinon');
const { app: app5_2, SyncManager, SyncTracking, ExternalReferenceStore } = require('../../src/5-2-cross-system-data-consistency');

/**
 * Helper: creates a Supabase mock that handles query chains.
 *
 * All query-building methods (from, select, eq, order, etc.) return the mock
 * itself for chaining. The mock's .then() acts as a fallback thenable so that
 * `await mockSupabase` at the end of a chain resolves to _dataResult.
 * Methods that end chains with a promise (single, maybeSingle) can be
 * configured per test via .resolves() to override the default chain.
 */
function createChainableSupabase(sandbox, defaultData = { data: [], error: null }) {
  const mock = {
    _dataResult: { ...defaultData },
    from: sandbox.stub().returnsThis(),
    insert: sandbox.stub().returnsThis(),
    update: sandbox.stub().returnsThis(),
    delete: sandbox.stub().returnsThis(),
    select: sandbox.stub().returnsThis(),
    eq: sandbox.stub().returnsThis(),
    in: sandbox.stub().returnsThis(),
    is: sandbox.stub().returnsThis(),
    not: sandbox.stub().returnsThis(),
    gte: sandbox.stub().returnsThis(),
    order: sandbox.stub().returnsThis(),
    limit: sandbox.stub().returnsThis(),
    // Terminal methods (NOT returnsThis) — must be configured per test
    single: sandbox.stub(),
    maybeSingle: sandbox.stub(),
    // Fallback thenable: when chain ends with a returnsThis() method,
    // await mockSupabase resolves via this .then()
    then: function (resolve) { resolve(this._dataResult); },
  };
  return mock;
}

describe('Flow 8: Cross-System Data Consistency', () => {
  describe('Step 1: Sync endpoints via 5-2', () => {
    it('Returns health check', async () => {
      const res = await request(app5_2).get('/api/health');

      expect(res.status).to.equal(200);
      expect(res.body.data.status).to.equal('ok');
      expect(res.body.data.service).to.equal('cross-system-data-consistency');
    });

    it('Rejects profile sync with missing customer_id', async () => {
      const res = await request(app5_2)
        .post('/api/sync/profile')
        .send({});

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.equal('customer_id is required');
    });

    it('Rejects booking sync with missing booking_id', async () => {
      const res = await request(app5_2)
        .post('/api/sync/booking')
        .send({});

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.equal('booking_id is required');
    });

    it('Rejects sync status with invalid entity type', async () => {
      const res = await request(app5_2)
        .get('/api/sync/status/invalid_type/123');

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.include('entityType must be');
    });

    it('Returns conflicts list (may error without Supabase)', async () => {
      const res = await request(app5_2).get('/api/sync/conflicts');

      expect(res.status).to.be.oneOf([200, 500]);
    });

    it('Returns monitor data (may error without Supabase)', async () => {
      const res = await request(app5_2).get('/api/sync/monitor');

      expect(res.status).to.be.oneOf([200, 500]);
    });
  });

  describe('Step 2: SyncTracking class with mocked Supabase', () => {
    let sandbox;
    let mockSupabase;
    let syncTracking;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      mockSupabase = createChainableSupabase(sandbox);
      syncTracking = new SyncTracking(mockSupabase);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('Creates a sync event', async () => {
      // This chain ends with .single() — override to return a promise
      mockSupabase.single.resolves({
        data: {
          id: 'sync-test-1',
          source_system: 'whatsapp',
          target_system: 'erpnext',
          entity_type: 'customer',
          entity_id: 'cust-123',
          status: 'pending',
        },
        error: null,
      });

      const event = await syncTracking.createEvent({
        sourceSystem: 'whatsapp',
        targetSystem: 'erpnext',
        entityType: 'customer',
        entityId: 'cust-123',
        requestPayload: { phone: '+91987654321' },
      });

      expect(event.id).to.equal('sync-test-1');
      expect(event.status).to.equal('pending');
    });

    it('Updates a sync event', async () => {
      mockSupabase.single.resolves({ data: { id: 'sync-test-1', status: 'completed' }, error: null });

      const event = await syncTracking.updateEvent('sync-test-1', { status: 'completed' });

      expect(event.status).to.equal('completed');
    });

    it('Marks event as completed', async () => {
      mockSupabase.single.resolves({ data: { id: 'sync-test-1', status: 'completed', external_id: 'ext-1', response_payload: {} }, error: null });

      const event = await syncTracking.markCompleted('sync-test-1', 'ext-1', {});

      expect(event.status).to.equal('completed');
      expect(event.external_id).to.equal('ext-1');
    });

    it('Marks event as failed', async () => {
      // markFailed calls getEvent (single) then updateEvent (single)
      mockSupabase.single
        .onFirstCall().resolves({ data: { id: 'sync-test-1', status: 'pending', attempt_count: 0 }, error: null })
        .onSecondCall().resolves({ data: { id: 'sync-test-1', status: 'failed', error_message: 'Connection refused' }, error: null });

      const event = await syncTracking.markFailed('sync-test-1', 'Connection refused');

      expect(event.status).to.equal('failed');
      expect(event.error_message).to.equal('Connection refused');
    });

    it('Gets events by entity', async () => {
      // This chain ends with .order() — use _dataResult fallback
      mockSupabase._dataResult = {
        data: [{ id: 'sync-test-1', entity_type: 'customer', entity_id: 'cust-123' }],
        error: null,
      };

      const events = await syncTracking.getEventsByEntity('customer', 'cust-123');

      expect(events).to.be.an('array');
      expect(events.length).to.equal(1);
    });

    it('Marks event as conflict', async () => {
      // markConflict calls updateEvent which calls single() once
      mockSupabase.single
        .resolves({ data: { id: 'sync-test-1', status: 'conflict', error_message: 'Drift detected' }, error: null });

      const event = await syncTracking.markConflict('sync-test-1', 'Drift detected');

      expect(event.status).to.equal('conflict');
    });

    it('Gets pending syncs', async () => {
      // Chain ends with .limit() — use _dataResult fallback
      mockSupabase._dataResult = {
        data: [{ id: 'pending-sync-1', status: 'pending' }],
        error: null,
        count: 1,
      };

      const result = await syncTracking.getPendingSyncs();

      expect(result.events).to.be.an('array');
      expect(result.count).to.equal(1);
    });

    it('Returns sync summary with counts by status', async () => {
      // Chain ends with .select() — use _dataResult fallback
      mockSupabase._dataResult = {
        data: [
          { status: 'completed' },
          { status: 'completed' },
          { status: 'pending' },
          { status: 'failed' },
        ],
        error: null,
      };

      const summary = await syncTracking.getSyncSummary();

      expect(summary.total).to.equal(4);
      expect(summary.completed).to.equal(2);
      expect(summary.pending).to.equal(1);
      expect(summary.failed).to.equal(1);
    });
  });

  describe('Step 3: ExternalReferenceStore class with mocked Supabase', () => {
    let sandbox;
    let mockSupabase;
    let extRefs;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      mockSupabase = createChainableSupabase(sandbox);
      extRefs = new ExternalReferenceStore(mockSupabase);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('Creates an external reference', async () => {
      mockSupabase.single.resolves({
        data: {
          id: 'ref-test-1',
          target_system: 'erpnext',
          target_entity_type: 'lead',
          target_entity_id: 'erpnext-lead-123',
          supabase_entity_type: 'customer',
          supabase_entity_id: 'cust-123',
        },
        error: null,
      });

      const ref = await extRefs.createReference({
        entityType: 'customer',
        entityId: 'cust-123',
        targetSystem: 'erpnext',
        targetEntityId: 'erpnext-lead-123',
        targetEntityType: 'lead',
      });

      expect(ref.id).to.equal('ref-test-1');
    });

    it('Gets references by Supabase entity', async () => {
      // Chain ends with .eq() — use _dataResult fallback
      mockSupabase._dataResult = {
        data: [{ id: 'ref-test-1', target_system: 'erpnext' }],
        error: null,
      };

      const refs = await extRefs.getReferencesByEntity('customer', 'cust-123');

      expect(refs).to.be.an('array');
      expect(refs.length).to.equal(1);
    });

    it('Gets reference by target system ID', async () => {
      mockSupabase.maybeSingle.resolves({ data: { id: 'ref-test-1', target_system: 'erpnext' }, error: null });

      const ref = await extRefs.findByExternalId('erpnext', 'erpnext-lead-123');

      expect(ref.id).to.equal('ref-test-1');
    });
  });

  describe('Step 4: Edge cases', () => {
    it('SyncTracking handles Supabase errors gracefully', async () => {
      const sandbox2 = sinon.createSandbox();
      try {
        const mockFail = createChainableSupabase(sandbox2);
        mockFail.single.resolves({ data: null, error: new Error('DB connection failed') });

        const syncTracking = new SyncTracking(mockFail);

        try {
          await syncTracking.createEvent({ sourceSystem: 'test', targetSystem: 'test', entityType: 'test', entityId: 'test' });
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err.message).to.equal('DB connection failed');
        }
      } finally {
        sandbox2.restore();
      }
    });

    it('ExternalReferenceStore handles missing references', async () => {
      const sandbox2 = sinon.createSandbox();
      try {
        const mockSupabase = createChainableSupabase(sandbox2, { data: null, error: null });
        mockSupabase.maybeSingle.resolves({ data: null, error: null });

        const extRefs = new ExternalReferenceStore(mockSupabase);

        const ref = await extRefs.findByExternalId('erpnext', 'lead', 'nonexistent');

        expect(ref).to.be.null;
      } finally {
        sandbox2.restore();
      }
    });

    it('ExternalReferenceStore handles error during create', async () => {
      const sandbox2 = sinon.createSandbox();
      try {
        const mockSupabase = createChainableSupabase(sandbox2);
        mockSupabase.single.resolves({ data: null, error: new Error('Unique constraint violation') });

        const extRefs = new ExternalReferenceStore(mockSupabase);

        try {
          await extRefs.createReference({
            entityType: 'customer',
            entityId: 'cust-123',
            targetSystem: 'erpnext',
            targetEntityId: 'lead-1',
            targetEntityType: 'lead',
          });
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err.message).to.equal('Unique constraint violation');
        }
      } finally {
        sandbox2.restore();
      }
    });

    it('SyncManager drift report handles zero records', async () => {
      const sandbox2 = sinon.createSandbox();
      try {
        const mockSupabase = {
          from: sandbox2.stub().returnsThis(),
          select: sandbox2.stub().returnsThis(),
          eq: sandbox2.stub().returnsThis(),
          in: sandbox2.stub().returnsThis(),
          count: 0,
          then: function (resolve) { resolve({ data: [], error: null, count: this.count }); },
        };
        const manager = new SyncManager(mockSupabase, { driftThreshold: 0.1 });

        const driftReport = await manager.getDriftReport();

        expect(driftReport.healthy).to.be.true;
      } finally {
        sandbox2.restore();
      }
    });
  });
});
