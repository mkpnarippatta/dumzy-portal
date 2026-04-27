require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Sync Tracking
// ---------------------------------------------------------------------------
class SyncTracking {
  constructor(supabase) {
    this.supabase = supabase;
  }

  async createEvent({ sourceSystem, targetSystem, entityType, entityId, requestPayload }) {
    const { data, error } = await this.supabase
      .from('sync_tracking')
      .insert({
        source_system: sourceSystem,
        target_system: targetSystem,
        entity_type: entityType,
        entity_id: entityId,
        status: 'pending',
        request_payload: requestPayload || {},
        attempt_count: 0,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async updateEvent(eventId, updates) {
    const { data, error } = await this.supabase
      .from('sync_tracking')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', eventId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async markCompleted(eventId, externalId, responsePayload) {
    return this.updateEvent(eventId, {
      status: 'completed',
      external_id: externalId,
      response_payload: responsePayload,
      last_attempt_at: new Date().toISOString(),
    });
  }

  async markFailed(eventId, errorMessage) {
    const event = await this.getEvent(eventId);
    return this.updateEvent(eventId, {
      status: 'failed',
      error_message: errorMessage,
      attempt_count: (event.attempt_count || 0) + 1,
      last_attempt_at: new Date().toISOString(),
    });
  }

  async markConflict(eventId, errorMessage) {
    return this.updateEvent(eventId, {
      status: 'conflict',
      error_message: errorMessage,
      last_attempt_at: new Date().toISOString(),
    });
  }

  async getEvent(eventId) {
    const { data, error } = await this.supabase
      .from('sync_tracking')
      .select('*')
      .eq('id', eventId)
      .single();

    if (error) throw error;
    return data;
  }

  async getEventsByEntity(entityType, entityId) {
    const { data, error } = await this.supabase
      .from('sync_tracking')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async getPendingSyncs() {
    const { data, error } = await this.supabase
      .from('sync_tracking')
      .select('*', { count: 'exact' })
      .in('status', ['pending', 'failed'])
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) throw error;
    return { events: data || [], count: data ? data.length : 0 };
  }

  async getFailedSyncs() {
    const { data, error } = await this.supabase
      .from('sync_tracking')
      .select('*', { count: 'exact' })
      .eq('status', 'failed')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { events: data || [], count: data ? data.length : 0 };
  }

  async getConflicts() {
    const { data, error } = await this.supabase
      .from('sync_tracking')
      .select('*', { count: 'exact' })
      .eq('status', 'conflict')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { conflicts: data || [], count: data ? data.length : 0 };
  }

  async getSyncSummary() {
    const { data, error } = await this.supabase
      .from('sync_tracking')
      .select('status');

    if (error) throw error;
    const events = data || [];
    return {
      total: events.length,
      pending: events.filter((e) => e.status === 'pending').length,
      in_progress: events.filter((e) => e.status === 'in_progress').length,
      completed: events.filter((e) => e.status === 'completed').length,
      failed: events.filter((e) => e.status === 'failed').length,
      conflict: events.filter((e) => e.status === 'conflict').length,
    };
  }
}

// ---------------------------------------------------------------------------
// External Reference Store
// ---------------------------------------------------------------------------
class ExternalReferenceStore {
  constructor(supabase) {
    this.supabase = supabase;
  }

  async createReference({ entityType, entityId, targetSystem, targetEntityId, targetEntityType }) {
    const { data, error } = await this.supabase
      .from('external_references')
      .insert({
        supabase_entity_type: entityType,
        supabase_entity_id: entityId,
        target_system: targetSystem,
        target_entity_id: targetEntityId,
        target_entity_type: targetEntityType,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getReference(entityType, entityId, targetSystem) {
    const { data, error } = await this.supabase
      .from('external_references')
      .select('*')
      .eq('supabase_entity_type', entityType)
      .eq('supabase_entity_id', entityId)
      .eq('target_system', targetSystem)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async getReferencesByEntity(entityType, entityId) {
    const { data, error } = await this.supabase
      .from('external_references')
      .select('*')
      .eq('supabase_entity_type', entityType)
      .eq('supabase_entity_id', entityId);

    if (error) throw error;
    return data || [];
  }

  async findByExternalId(targetSystem, targetEntityId) {
    const { data, error } = await this.supabase
      .from('external_references')
      .select('*')
      .eq('target_system', targetSystem)
      .eq('target_entity_id', targetEntityId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async removeReference(entityType, entityId, targetSystem) {
    const { error } = await this.supabase
      .from('external_references')
      .delete()
      .eq('supabase_entity_type', entityType)
      .eq('supabase_entity_id', entityId)
      .eq('target_system', targetSystem);

    if (error) throw error;
  }
}

// ---------------------------------------------------------------------------
// Sync Manager
// ---------------------------------------------------------------------------
class SyncManager {
  constructor(supabaseClient, options = {}) {
    this.supabase = supabaseClient;
    this.syncTracking = new SyncTracking(supabaseClient);
    this.externalRefs = new ExternalReferenceStore(supabaseClient);
    this.maxRetries = options.maxRetries || 3;
    this.backoffMs = options.backoffMs || 1000;
    this.driftThreshold = options.driftThreshold || 0.1;
  }

  // ---- Profile Sync ----
  async syncProfile(customerId) {
    const results = {
      customerId,
      erpnext: null,
      pms: null,
      errors: [],
    };

    if (process.env.ERPNEXT_API_URL) {
      try {
        results.erpnext = await this._syncToExternalSystem({
          entityType: 'customer',
          entityId: customerId,
          targetSystem: 'erpnext',
          targetEntityType: 'partner',
          buildPayload: () => ({ ref: customerId }),
          apiEndpoint: `${process.env.ERPNEXT_API_URL}/api/partners`,
          apiKey: process.env.ERPNEXT_API_KEY,
        });
      } catch (err) {
        results.errors.push({ system: 'erpnext', error: err.message });
      }
    }

    if (process.env.PMS_API_URL) {
      try {
        results.pms = await this._syncToExternalSystem({
          entityType: 'customer',
          entityId: customerId,
          targetSystem: 'pms',
          targetEntityType: 'guest',
          buildPayload: () => ({ ref: customerId }),
          apiEndpoint: `${process.env.PMS_API_URL}/api/guests`,
          apiKey: process.env.PMS_API_KEY,
        });
      } catch (err) {
        results.errors.push({ system: 'pms', error: err.message });
      }
    }

    return results;
  }

  // ---- Booking Sync ----
  async syncBooking(bookingId) {
    const results = { bookingId, erpnext: null, errors: [] };

    if (process.env.ERPNEXT_API_URL) {
      try {
        results.erpnext = await this._syncToExternalSystem({
          entityType: 'booking',
          entityId: bookingId,
          targetSystem: 'erpnext',
          targetEntityType: 'sale_order',
          buildPayload: () => ({ ref: bookingId }),
          apiEndpoint: `${process.env.ERPNEXT_API_URL}/api/sale-orders`,
          apiKey: process.env.ERPNEXT_API_KEY,
        });
      } catch (err) {
        results.errors.push({ system: 'erpnext', error: err.message });
      }
    }

    return results;
  }

  // ---- External System Sync (with retry and tracking) ----
  async _syncToExternalSystem({ entityType, entityId, targetSystem, targetEntityType, buildPayload, apiEndpoint, apiKey }) {
    // Create tracking event
    const event = await this.syncTracking.createEvent({
      sourceSystem: 'supabase',
      targetSystem,
      entityType,
      entityId,
      requestPayload: buildPayload(),
    });

    // Check if reference already exists
    const existingRef = await this.externalRefs.getReference(entityType, entityId, targetSystem);
    if (existingRef) {
      await this.syncTracking.markCompleted(event.id, existingRef.target_entity_id, { cached: true });
      return { referenceId: existingRef.target_entity_id, cached: true };
    }

    // Attempt sync with retry
    let lastError;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.backoffMs * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        const response = await this._callExternalApi(apiEndpoint, apiKey, buildPayload());

        // Store the external reference
        const externalId = response.id || response.partner_id || response.guest_id || String(response.id);
        await this.externalRefs.createReference({
          entityType,
          entityId,
          targetSystem,
          targetEntityId: String(externalId),
          targetEntityType,
        });

        await this.syncTracking.markCompleted(event.id, String(externalId), response);
        return { referenceId: String(externalId), cached: false };
      } catch (err) {
        lastError = err;
        if (attempt < this.maxRetries - 1) {
          await this.syncTracking.updateEvent(event.id, {
            status: 'in_progress',
            error_message: `Attempt ${attempt + 1} failed: ${err.message}`,
            last_attempt_at: new Date().toISOString(),
          });
        }
      }
    }

    await this.syncTracking.markFailed(event.id, lastError.message);
    throw new Error(`Sync to ${targetSystem} failed after ${this.maxRetries} retries: ${lastError.message}`);
  }

  async _callExternalApi(endpoint, apiKey, payload) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status}: ${body}`);
    }

    return response.json();
  }

  // ---- Conflict Detection ----
  async detectConflicts() {
    const conflicts = [];

    // Get all external references with sync events
    const { data: refs, error: refError } = await this.supabase
      .from('external_references')
      .select('*');

    if (refError) throw refError;
    if (!refs) return { conflicts: [], count: 0 };

    for (const ref of refs) {
      const syncEvents = await this.syncTracking.getEventsByEntity(ref.supabase_entity_type, ref.supabase_entity_id);
      const completedEvents = syncEvents.filter((e) => e.status === 'completed');

      if (completedEvents.length > 0) {
        const latestEvent = completedEvents[0]; // sorted desc by created_at
        const now = new Date();
        const eventTime = new Date(latestEvent.created_at);
        const hoursSinceSync = (now - eventTime) / (1000 * 60 * 60);

        // Flag syncs older than 24 hours as potential conflicts
        if (hoursSinceSync > 24) {
          // Check if the drift exceeds threshold
          const drift = await this._calculateDrift(ref.supabase_entity_type);
          if (drift > this.driftThreshold) {
            const conflictEvent = await this.syncTracking.createEvent({
              sourceSystem: 'supabase',
              targetSystem: ref.target_system,
              entityType: ref.supabase_entity_type,
              entityId: ref.supabase_entity_id,
              requestPayload: { type: 'conflict_detection', drift },
            });
            await this.syncTracking.markConflict(conflictEvent.id,
              `Drift ${(drift * 100).toFixed(1)}% exceeds threshold ${(this.driftThreshold * 100)}%`);
            conflicts.push({
              referenceId: ref.id,
              entityType: ref.supabase_entity_type,
              entityId: ref.supabase_entity_id,
              targetSystem: ref.target_system,
              drift: Math.round(drift * 10000) / 100,
              lastSync: latestEvent.created_at,
            });
          }
        }
      }
    }

    return { conflicts, count: conflicts.length };
  }

  async _calculateDrift(entityType) {
    // Count records in Supabase for this entity type
    const { count: supabaseCount, error: countError } = await this.supabase
      .from(`${entityType}s`)
      .select('*', { count: 'exact', head: true });

    if (countError) return 0;

    // Count external references for this entity type
    const { count: refCount, error: refError } = await this.supabase
      .from('external_references')
      .select('*', { count: 'exact', head: true })
      .eq('supabase_entity_type', entityType);

    if (refError) return 0;

    if (!supabaseCount || supabaseCount === 0) return 0;
    return Math.abs((supabaseCount - (refCount || 0)) / supabaseCount);
  }

  // ---- Conflict Resolution ----
  async resolveConflict(syncEventId) {
    const event = await this.syncTracking.getEvent(syncEventId);
    if (event.status !== 'conflict') {
      throw new Error(`Event ${syncEventId} is not in conflict status`);
    }

    // Supabase timestamp is authoritative — push Supabase data to the target system
    const entityData = await this._fetchEntityData(event.entity_type, event.entity_id);

    try {
      const response = await this._callExternalApi(
        `${event.target_system === 'erpnext' ? process.env.ERPNEXT_API_URL : process.env.PMS_API_URL}/api/sync/resolve`,
        event.target_system === 'erpnext' ? process.env.ERPNEXT_API_KEY : process.env.PMS_API_KEY,
        { ref: event.entity_id, data: entityData, authoritativeSource: 'supabase' }
      );

      await this.syncTracking.markCompleted(event.id, event.external_id, response);
      return { resolved: true, eventId: syncEventId };
    } catch (err) {
      throw new Error(`Resolution failed: ${err.message}`);
    }
  }

  async _fetchEntityData(entityType, entityId) {
    const table = entityType === 'customer' ? 'customers' : `${entityType}s`;
    const { data, error } = await this.supabase
      .from(table)
      .select('*')
      .eq('id', entityId)
      .single();

    if (error) throw error;
    return data;
  }

  // ---- Drift Report ----
  async getDriftReport() {
    const customerDrift = await this._calculateDrift('customer');
    const bookingDrift = await this._calculateDrift('booking');

    return {
      customer_drift: Math.round(customerDrift * 10000) / 100,
      booking_drift: Math.round(bookingDrift * 10000) / 100,
      threshold: this.driftThreshold * 100,
      healthy: customerDrift <= this.driftThreshold && bookingDrift <= this.driftThreshold,
      generated_at: new Date().toISOString(),
    };
  }

  // ---- Sync Status ----
  async getSyncStatus(entityType, entityId) {
    const events = await this.syncTracking.getEventsByEntity(entityType, entityId);
    const refs = await this.externalRefs.getReferencesByEntity(entityType, entityId);

    return {
      entity_type: entityType,
      entity_id: entityId,
      total_syncs: events.length,
      latest_status: events.length > 0 ? events[0].status : 'never_synced',
      external_references: refs.map((r) => ({
        system: r.target_system,
        external_id: r.target_entity_id,
        type: r.target_entity_type,
      })),
      events: events.map((e) => ({
        id: e.id,
        target: e.target_system,
        status: e.status,
        attempts: e.attempt_count,
        error: e.error_message,
        last_attempt: e.last_attempt_at,
        created: e.created_at,
      })),
    };
  }

  // ---- Sync Queue (polling-based) ----
  startPolling(intervalMs = 5000) {
    this._pollInterval = setInterval(async () => {
      try {
        await this._processPendingSyncs();
      } catch (err) {
        console.error('Sync polling error:', err.message);
      }
    }, intervalMs);
    return this;
  }

  stopPolling() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    return this;
  }

  async _processPendingSyncs() {
    const { events } = await this.syncTracking.getPendingSyncs();
    for (const event of events) {
      try {
        const targetSystem = event.target_system;
        const payload = event.request_payload || {};

        const response = await this._callExternalApi(
          targetSystem === 'erpnext'
            ? `${process.env.ERPNEXT_API_URL}/api/sync`
            : `${process.env.PMS_API_URL}/api/sync`,
          targetSystem === 'erpnext' ? process.env.ERPNEXT_API_KEY : process.env.PMS_API_KEY,
          { ...payload, sync_event_id: event.id }
        );

        await this.syncTracking.markCompleted(event.id, response.id || response.external_id, response);
      } catch (err) {
        await this.syncTracking.updateEvent(event.id, {
          status: 'failed',
          error_message: err.message,
          attempt_count: (event.attempt_count || 0) + 1,
          last_attempt_at: new Date().toISOString(),
        });
      }
    }
  }

  // ---- Monitoring ----
  async getMonitorData() {
    const [summary, driftReport, pending] = await Promise.all([
      this.syncTracking.getSyncSummary(),
      this.getDriftReport(),
      this.syncTracking.getPendingSyncs(),
    ]);

    return {
      sync_summary: summary,
      drift: driftReport,
      pending_queue: pending.count,
      timestamp: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Express App
// ---------------------------------------------------------------------------
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : createClient('https://placeholder.supabase.co', 'placeholder-key');

const syncManager = new SyncManager(supabase, {
  maxRetries: parseInt(process.env.SYNC_MAX_RETRIES || '3', 10),
  backoffMs: parseInt(process.env.SYNC_BACKOFF_MS || '1000', 10),
  driftThreshold: parseFloat(process.env.SYNC_DRIFT_THRESHOLD || '0.1'),
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    data: {
      status: 'ok',
      service: 'cross-system-data-consistency',
      timestamp: new Date().toISOString(),
    },
    meta: { timestamp: Date.now() },
  });
});

// POST /api/sync/profile — trigger profile sync
app.post('/api/sync/profile', async (req, res) => {
  try {
    const { customer_id } = req.body;
    if (!customer_id) {
      return res.status(400).json({
        error: { message: 'customer_id is required', code: 400 },
      });
    }

    const result = await syncManager.syncProfile(customer_id);

    const hasErrors = result.errors.length > 0;
    res.status(hasErrors ? 207 : 201).json({
      data: {
        customer_id: result.customerId,
        erpnext_ref: result.erpnext?.referenceId || null,
        pms_ref: result.pms?.referenceId || null,
        errors: result.errors,
      },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Profile sync failed', code: 500, details: error.message },
    });
  }
});

// POST /api/sync/booking — trigger booking sync
app.post('/api/sync/booking', async (req, res) => {
  try {
    const { booking_id } = req.body;
    if (!booking_id) {
      return res.status(400).json({
        error: { message: 'booking_id is required', code: 400 },
      });
    }

    const result = await syncManager.syncBooking(booking_id);

    res.status(201).json({
      data: {
        booking_id: result.bookingId,
        erpnext_ref: result.erpnext?.referenceId || null,
        errors: result.errors,
      },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Booking sync failed', code: 500, details: error.message },
    });
  }
});

// GET /api/sync/status/:entityType/:entityId — sync status for an entity
app.get('/api/sync/status/:entityType/:entityId', async (req, res) => {
  try {
    const { entityType, entityId } = req.params;

    if (!['customer', 'booking'].includes(entityType)) {
      return res.status(400).json({
        error: { message: 'entityType must be "customer" or "booking"', code: 400 },
      });
    }

    const status = await syncManager.getSyncStatus(entityType, entityId);

    res.json({
      data: status,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get sync status', code: 500, details: error.message },
    });
  }
});

// GET /api/sync/conflicts — list unresolved conflicts
app.get('/api/sync/conflicts', async (req, res) => {
  try {
    const conflicts = await syncManager.syncTracking.getConflicts();

    res.json({
      data: conflicts,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to list conflicts', code: 500, details: error.message },
    });
  }
});

// POST /api/sync/conflicts/:id/resolve — resolve a conflict
app.post('/api/sync/conflicts/:id/resolve', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await syncManager.resolveConflict(id);

    res.json({
      data: result,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to resolve conflict', code: 500, details: error.message },
    });
  }
});

// GET /api/sync/monitor — sync health dashboard
app.get('/api/sync/monitor', async (req, res) => {
  try {
    const monitorData = await syncManager.getMonitorData();

    res.json({
      data: monitorData,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get sync monitor data', code: 500, details: error.message },
    });
  }
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: { message: 'Internal server error', code: 500 },
  });
});

// Start server only if not in test mode
const PORT = process.env.PORT || 3001;
if (process.env.MOCHA_TEST_MODE !== 'true') {
  app.listen(PORT, () => {
    console.log(`Cross-system sync service running on port ${PORT}`);
  });
}

module.exports = {
  app,
  SyncManager,
  SyncTracking,
  ExternalReferenceStore,
  syncManager,
};
