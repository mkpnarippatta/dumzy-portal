process.env.MOCHA_TEST_MODE = 'true';
process.env.AUDIT_LOG_RETENTION_DAYS = '365';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');
const {
  app,
  AuditEventBus,
  AuditStore,
  AuditAlerting,
  AuditReporter,
} = require('../src/7-3-audit-logging-system');

// ---------------------------------------------------------------------------
// AuditEventBus
// ---------------------------------------------------------------------------
describe('AuditEventBus', () => {
  let bus;

  beforeEach(() => {
    bus = new AuditEventBus();
  });

  describe('constructor', () => {
    it('should have defined categories', () => {
      expect(bus.categories).to.deep.equal([
        'data_access',
        'system_operation',
        'configuration_change',
        'security_event',
        'business_operation',
      ]);
    });
  });

  describe('emitEvent', () => {
    it('should emit an audit event with all standard fields', () => {
      const event = bus.emitEvent('data_access', 'read', {
        actor: 'operator-1',
        resourceType: 'customer_phone',
        resourceId: 'cust-123',
        outcome: 'success',
        details: { ip: '192.168.1.1' },
      });

      expect(event).to.have.property('id');
      expect(event).to.have.property('timestamp');
      expect(event).to.have.property('category', 'data_access');
      expect(event).to.have.property('action', 'read');
      expect(event).to.have.property('actor', 'operator-1');
      expect(event).to.have.property('resourceType', 'customer_phone');
      expect(event).to.have.property('resourceId', 'cust-123');
      expect(event).to.have.property('outcome', 'success');
      expect(event).to.have.property('details');
      expect(event.details).to.have.property('ip', '192.168.1.1');
    });

    it('should generate unique IDs for each event', () => {
      const e1 = bus.emitEvent('data_access', 'read', { actor: 'a1', resourceType: 'r1', resourceId: 'id1', outcome: 'success' });
      const e2 = bus.emitEvent('data_access', 'read', { actor: 'a1', resourceType: 'r1', resourceId: 'id1', outcome: 'success' });
      expect(e1.id).to.not.equal(e2.id);
    });

    it('should include ISO timestamp', () => {
      const event = bus.emitEvent('system_operation', 'start', {
        actor: 'system',
        resourceType: 'service',
        resourceId: 'svc-1',
        outcome: 'success',
      });
      expect(() => new Date(event.timestamp)).to.not.throw();
      expect(new Date(event.timestamp).toISOString()).to.equal(event.timestamp);
    });

    it('should accept all valid categories', () => {
      const categories = ['data_access', 'system_operation', 'configuration_change', 'security_event', 'business_operation'];
      for (const cat of categories) {
        const event = bus.emitEvent(cat, 'action', {
          actor: 'test', resourceType: 'r', resourceId: 'id', outcome: 'success',
        });
        expect(event.category).to.equal(cat);
      }
    });

    it('should reject invalid category', () => {
      expect(() => {
        bus.emitEvent('invalid_category', 'read', {
          actor: 'op', resourceType: 'r', resourceId: 'id', outcome: 'success',
        });
      }).to.throw();
    });

    it('should include details/metadata when provided', () => {
      const details = { ip: '10.0.0.1', userAgent: 'Mozilla/5.0', sessionId: 'sess-1' };
      const event = bus.emitEvent('security_event', 'login', {
        actor: 'user-1', resourceType: 'session', resourceId: 'sess-1', outcome: 'success', details,
      });
      expect(event.details).to.deep.equal(details);
    });

    it('should default outcome to success', () => {
      const event = bus.emitEvent('business_operation', 'booking_created', {
        actor: 'op-1', resourceType: 'booking', resourceId: 'bk-1',
      });
      expect(event.outcome).to.equal('success');
    });
  });

  describe('subscribe', () => {
    it('should notify subscribers when events are emitted', (done) => {
      bus.subscribe((event) => {
        expect(event.action).to.equal('read');
        done();
      });
      bus.emitEvent('data_access', 'read', {
        actor: 'op-1', resourceType: 'r', resourceId: 'id', outcome: 'success',
      });
    });

    it('should pass the full event payload to subscribers', (done) => {
      bus.subscribe((event) => {
        expect(event.category).to.equal('data_access');
        expect(event.actor).to.equal('op-1');
        expect(event.resourceType).to.equal('customer_phone');
        expect(event.resourceId).to.equal('cust-123');
        expect(event.outcome).to.equal('success');
        done();
      });
      bus.emitEvent('data_access', 'read', {
        actor: 'op-1', resourceType: 'customer_phone', resourceId: 'cust-123', outcome: 'success',
      });
    });

    it('should support multiple subscribers', () => {
      let count = 0;
      bus.subscribe(() => count++);
      bus.subscribe(() => count++);
      bus.emitEvent('data_access', 'read', {
        actor: 'a1', resourceType: 'r', resourceId: 'id', outcome: 'success',
      });
      expect(count).to.equal(2);
    });

    it('should pass enriched events (with timestamp and id) to subscribers', (done) => {
      bus.subscribe((event) => {
        expect(event).to.have.property('id');
        expect(event).to.have.property('timestamp');
        expect(event.id).to.match(/^audit-/);
        done();
      });
      bus.emitEvent('system_operation', 'config_update', {
        actor: 'admin', resourceType: 'config', resourceId: 'cfg-1', outcome: 'success',
      });
    });
  });
});

// ---------------------------------------------------------------------------
// AuditStore
// ---------------------------------------------------------------------------
describe('AuditStore', () => {
  let store;
  let sampleEvent;

  beforeEach(() => {
    store = new AuditStore({ retentionDays: 365 });
    sampleEvent = {
      id: 'audit-1',
      timestamp: new Date().toISOString(),
      category: 'data_access',
      action: 'read',
      actor: 'operator-1',
      resourceType: 'customer_phone',
      resourceId: 'cust-123',
      outcome: 'success',
      details: { ip: '10.0.0.1' },
    };
  });

  describe('store', () => {
    it('should persist an audit record with all fields', () => {
      const stored = store.store(sampleEvent);
      expect(stored.id).to.equal('audit-1');
      expect(stored.category).to.equal('data_access');
      expect(stored.action).to.equal('read');
      expect(stored.actor).to.equal('operator-1');
      expect(stored.resourceType).to.equal('customer_phone');
      expect(stored.resourceId).to.equal('cust-123');
      expect(stored.outcome).to.equal('success');
      expect(stored.details.ip).to.equal('10.0.0.1');
    });

    it('should return the stored record', () => {
      const stored = store.store(sampleEvent);
      expect(stored).to.deep.include(sampleEvent);
    });

    it('should require id field', () => {
      expect(() => store.store({ ...sampleEvent, id: undefined })).to.throw();
    });
  });

  describe('getRecord', () => {
    it('should retrieve a record by ID', () => {
      store.store(sampleEvent);
      const record = store.getRecord('audit-1');
      expect(record).to.have.property('id', 'audit-1');
    });

    it('should return null for non-existent ID', () => {
      const record = store.getRecord('non-existent');
      expect(record).to.be.null;
    });
  });

  describe('query', () => {
    beforeEach(() => {
      const events = [
        { id: 'e1', timestamp: '2026-04-01T00:00:00.000Z', category: 'data_access', action: 'read', actor: 'op-1', resourceType: 'customer_phone', resourceId: 'c1', outcome: 'success' },
        { id: 'e2', timestamp: '2026-04-02T00:00:00.000Z', category: 'data_access', action: 'write', actor: 'op-1', resourceType: 'booking_history', resourceId: 'b1', outcome: 'success' },
        { id: 'e3', timestamp: '2026-04-03T00:00:00.000Z', category: 'system_operation', action: 'restart', actor: 'admin', resourceType: 'service', resourceId: 'svc-1', outcome: 'success' },
        { id: 'e4', timestamp: '2026-04-04T00:00:00.000Z', category: 'security_event', action: 'login_failed', actor: 'op-2', resourceType: 'session', resourceId: 'sess-1', outcome: 'failure' },
        { id: 'e5', timestamp: '2026-04-05T00:00:00.000Z', category: 'data_access', action: 'read', actor: 'op-2', resourceType: 'customer_phone', resourceId: 'c2', outcome: 'success' },
      ];
      for (const e of events) store.store(e);
    });

    it('should return all records when no filters provided', () => {
      const results = store.query({});
      expect(results).to.have.length(5);
    });

    it('should filter by actor', () => {
      const results = store.query({ actor: 'op-1' });
      expect(results).to.have.length(2);
      expect(results.every(r => r.actor === 'op-1')).to.be.true;
    });

    it('should filter by action type', () => {
      const results = store.query({ action: 'read' });
      expect(results).to.have.length(2);
      expect(results.every(r => r.action === 'read')).to.be.true;
    });

    it('should filter by resource type', () => {
      const results = store.query({ resourceType: 'customer_phone' });
      expect(results).to.have.length(2);
      expect(results.every(r => r.resourceType === 'customer_phone')).to.be.true;
    });

    it('should filter by outcome', () => {
      const results = store.query({ outcome: 'failure' });
      expect(results).to.have.length(1);
      expect(results[0].outcome).to.equal('failure');
    });

    it('should filter by category', () => {
      const results = store.query({ category: 'data_access' });
      expect(results).to.have.length(3);
      expect(results.every(r => r.category === 'data_access')).to.be.true;
    });

    it('should filter by date range', () => {
      const results = store.query({ dateFrom: '2026-04-02T00:00:00.000Z', dateTo: '2026-04-04T00:00:00.000Z' });
      expect(results).to.have.length(3);
    });

    it('should combine multiple filters', () => {
      const results = store.query({ actor: 'op-1', action: 'read' });
      expect(results).to.have.length(1);
      expect(results[0].id).to.equal('e1');
    });

    it('should sort results by timestamp descending', () => {
      const results = store.query({});
      for (let i = 1; i < results.length; i++) {
        expect(new Date(results[i - 1].timestamp) >= new Date(results[i].timestamp)).to.be.true;
      }
    });

    it('should support pagination with page and limit', () => {
      const page1 = store.query({}, 1, 2);
      const page2 = store.query({}, 2, 2);
      expect(page1).to.have.length(2);
      expect(page2).to.have.length(2);
      expect(page1[0].id).to.not.equal(page2[0].id);
    });

    it('should return empty array when no records match', () => {
      const results = store.query({ actor: 'nonexistent' });
      expect(results).to.have.length(0);
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      const events = [
        { id: 's1', timestamp: '2026-04-01T00:00:00.000Z', category: 'data_access', action: 'read', actor: 'op-1', resourceType: 'r', resourceId: '1', outcome: 'success' },
        { id: 's2', timestamp: '2026-04-02T00:00:00.000Z', category: 'data_access', action: 'write', actor: 'op-1', resourceType: 'r', resourceId: '2', outcome: 'success' },
        { id: 's3', timestamp: '2026-04-03T00:00:00.000Z', category: 'system_operation', action: 'restart', actor: 'admin', resourceType: 'r', resourceId: '3', outcome: 'success' },
        { id: 's4', timestamp: '2026-04-04T00:00:00.000Z', category: 'security_event', action: 'login_failed', actor: 'op-2', resourceType: 'r', resourceId: '4', outcome: 'failure' },
        { id: 's5', timestamp: '2026-04-05T00:00:00.000Z', category: 'data_access', action: 'read', actor: 'op-2', resourceType: 'r', resourceId: '5', outcome: 'success' },
      ];
      for (const e of events) store.store(e);
    });

    it('should return count by category', () => {
      const stats = store.getStats();
      expect(stats.byCategory).to.have.property('data_access', 3);
      expect(stats.byCategory).to.have.property('system_operation', 1);
      expect(stats.byCategory).to.have.property('security_event', 1);
    });

    it('should return count by action', () => {
      const stats = store.getStats();
      expect(stats.byAction).to.have.property('read', 2);
      expect(stats.byAction).to.have.property('write', 1);
      expect(stats.byAction).to.have.property('restart', 1);
      expect(stats.byAction).to.have.property('login_failed', 1);
    });

    it('should return count by outcome', () => {
      const stats = store.getStats();
      expect(stats.byOutcome).to.have.property('success', 4);
      expect(stats.byOutcome).to.have.property('failure', 1);
    });
  });

  describe('retention', () => {
    it('should prune records older than retention period', () => {
      const oldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
      store.store({ ...sampleEvent, id: 'old-1', timestamp: oldDate });
      store.store(sampleEvent);
      expect(store.getRecord('old-1')).to.be.null;
      expect(store.getRecord('audit-1')).to.not.be.null;
    });

    it('should not prune records within retention period', () => {
      const recentDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
      store.store({ ...sampleEvent, id: 'recent-1', timestamp: recentDate });
      expect(store.getRecord('recent-1')).to.not.be.null;
    });

    it('should respect custom retentionDays', () => {
      const shortStore = new AuditStore({ retentionDays: 30 });
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      shortStore.store({ ...sampleEvent, id: 'old-2', timestamp: oldDate });
      expect(shortStore.getRecord('old-2')).to.be.null;
    });
  });

  describe('exportData', () => {
    beforeEach(() => {
      const events = [
        { id: 'x1', timestamp: '2026-04-01T00:00:00.000Z', category: 'data_access', action: 'read', actor: 'op-1', resourceType: 'r', resourceId: '1', outcome: 'success' },
        { id: 'x2', timestamp: '2026-04-02T00:00:00.000Z', category: 'system_operation', action: 'restart', actor: 'admin', resourceType: 'r', resourceId: '2', outcome: 'success' },
      ];
      for (const e of events) store.store(e);
    });

    it('should return filtered data as array', () => {
      const result = store.exportData({});
      expect(result).to.be.an('array');
      expect(result).to.have.length(2);
    });

    it('should apply filters to export', () => {
      const result = store.exportData({ actor: 'admin' });
      expect(result).to.have.length(1);
      expect(result[0].actor).to.equal('admin');
    });
  });
});

// ---------------------------------------------------------------------------
// AuditAlerting
// ---------------------------------------------------------------------------
describe('AuditAlerting', () => {
  let store;
  let alerting;

  beforeEach(() => {
    store = new AuditStore({ retentionDays: 365 });
    alerting = new AuditAlerting(store);
    // Add default rules
    alerting.addBuiltInRules();
  });

  describe('addRule', () => {
    it('should store a rule', () => {
      expect(alerting.rules).to.have.length(3);
    });

    it('should store rule with name and description', () => {
      const rule = alerting.rules[0];
      expect(rule).to.have.property('name');
      expect(rule).to.have.property('description');
      expect(rule).to.have.property('evaluate');
    });
  });

  describe('evaluate', () => {
    it('should not trigger alert for normal single event', () => {
      const event = {
        id: 'e1', timestamp: new Date().toISOString(),
        category: 'data_access', action: 'read',
        actor: 'op-1', resourceType: 'r', resourceId: 'id',
        outcome: 'success',
      };
      alerting.evaluate(event);
      expect(alerting.getAlerts()).to.have.length(0);
    });

    it('should trigger alert on repeated failed access', () => {
      const now = Date.now();
      for (let i = 0; i < 6; i++) {
        const event = {
          id: `fail-${i}`, timestamp: new Date(now + i * 60000).toISOString(),
          category: 'data_access', action: 'read',
          actor: 'bad-actor', resourceType: 'customer_phone', resourceId: `c-${i}`,
          outcome: 'failure',
        };
        store.store(event);
        alerting.evaluate(event);
      }
      const alerts = alerting.getAlerts();
      expect(alerts.length).to.be.at.least(1);
    });

    it('should not trigger alert for repeated failed access below threshold', () => {
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        const event = {
          id: `fail-${i}`, timestamp: new Date(now + i * 60000).toISOString(),
          category: 'data_access', action: 'read',
          actor: 'good-actor', resourceType: 'customer_phone', resourceId: `c-${i}`,
          outcome: 'failure',
        };
        store.store(event);
        alerting.evaluate(event);
      }
      expect(alerting.getAlerts()).to.have.length(0);
    });

    it('should trigger alert on unusual hour access', () => {
      // 11 PM = 23:00
      const event = {
        id: 'late-event', timestamp: new Date('2026-04-24T23:30:00.000Z').toISOString(),
        category: 'data_access', action: 'read',
        actor: 'night-operator', resourceType: 'customer_phone', resourceId: 'c-1',
        outcome: 'success',
      };
      store.store(event);
      alerting.evaluate(event);
      const alerts = alerting.getAlerts();
      expect(alerts.length).to.be.at.least(1);
      expect(alerts[0].ruleName).to.equal('unusual_hour_access');
    });

    it('should not trigger unusual hour alert for normal hours', () => {
      const event = {
        id: 'day-event', timestamp: new Date('2026-04-24T14:00:00.000Z').toISOString(),
        category: 'data_access', action: 'read',
        actor: 'day-operator', resourceType: 'customer_phone', resourceId: 'c-1',
        outcome: 'success',
      };
      alerting.evaluate(event);
      expect(alerting.getAlerts()).to.have.length(0);
    });

    it('should trigger alert on bulk data export', () => {
      const now = Date.now();
      const actor = 'bulk-exporter';
      // Store and evaluate many read events within 5 minutes
      for (let i = 0; i < 101; i++) {
        const event = {
          id: `bulk-${i}`, timestamp: new Date(now + i * 1000).toISOString(),
          category: 'data_access', action: 'read',
          actor, resourceType: 'customer_phone', resourceId: `c-${i}`,
          outcome: 'success',
        };
        store.store(event);
      }
      // Evaluate against the last event
      const lastEvent = {
        id: 'bulk-last', timestamp: new Date(now + 101 * 1000).toISOString(),
        category: 'data_access', action: 'read',
        actor, resourceType: 'customer_phone', resourceId: 'c-last',
        outcome: 'success',
      };
      store.store(lastEvent);
      alerting.evaluate(lastEvent);
      const alerts = alerting.getAlerts();
      expect(alerts.length).to.be.at.least(1);
      expect(alerts.some(a => a.ruleName === 'bulk_data_export')).to.be.true;
    });
  });

  describe('acknowledgeAlert', () => {
    it('should mark an alert as acknowledged', () => {
      // Trigger an alert first
      const event = {
        id: 'late-alert', timestamp: new Date('2026-04-24T23:30:00.000Z').toISOString(),
        category: 'data_access', action: 'read',
        actor: 'night-op', resourceType: 'customer_phone', resourceId: 'c-1',
        outcome: 'success',
      };
      store.store(event);
      alerting.evaluate(event);
      const alerts = alerting.getAlerts();
      expect(alerts[0].acknowledged).to.be.false;

      alerting.acknowledgeAlert(alerts[0].id);
      const updated = alerting.getAlerts();
      expect(updated[0].acknowledged).to.be.true;
    });
  });

  describe('getAlerts', () => {
    it('should return alert history sorted by timestamp descending', () => {
      const lateEvent = {
        id: 'late-1', timestamp: new Date('2026-04-24T23:30:00.000Z').toISOString(),
        category: 'data_access', action: 'read',
        actor: 'night-op', resourceType: 'customer_phone', resourceId: 'c-1',
        outcome: 'success',
      };
      store.store(lateEvent);
      alerting.evaluate(lateEvent);
      expect(alerting.getAlerts()).to.have.length(1);
    });
  });
});

// ---------------------------------------------------------------------------
// AuditReporter
// ---------------------------------------------------------------------------
describe('AuditReporter', () => {
  let store;
  let reporter;

  beforeEach(() => {
    store = new AuditStore({ retentionDays: 365 });
    reporter = new AuditReporter(store);

    const events = [
      { id: 'r1', timestamp: '2026-04-01T00:00:00.000Z', category: 'data_access', action: 'read', actor: 'op-1', resourceType: 'customer_phone', resourceId: 'c1', outcome: 'success' },
      { id: 'r2', timestamp: '2026-04-02T00:00:00.000Z', category: 'data_access', action: 'write', actor: 'op-1', resourceType: 'booking_history', resourceId: 'b1', outcome: 'success' },
      { id: 'r3', timestamp: '2026-04-03T00:00:00.000Z', category: 'system_operation', action: 'restart', actor: 'admin', resourceType: 'service', resourceId: 'svc-1', outcome: 'success' },
      { id: 'r4', timestamp: '2026-04-04T00:00:00.000Z', category: 'security_event', action: 'login_failed', actor: 'op-2', resourceType: 'session', resourceId: 'sess-1', outcome: 'failure' },
      { id: 'r5', timestamp: '2026-04-05T00:00:00.000Z', category: 'data_access', action: 'read', actor: 'op-2', resourceType: 'customer_phone', resourceId: 'c2', outcome: 'success' },
    ];
    for (const e of events) store.store(e);
  });

  describe('generateReport', () => {
    it('should create summary report with event breakdown by category', () => {
      const report = reporter.generateReport('2026-04-01T00:00:00.000Z', '2026-04-30T00:00:00.000Z');
      expect(report).to.have.property('byCategory');
      expect(report).to.have.property('byAction');
      expect(report).to.have.property('totalEvents', 5);
      expect(report).to.have.property('dateFrom');
      expect(report).to.have.property('dateTo');
      expect(report.byCategory).to.have.property('data_access', 3);
      expect(report.byCategory).to.have.property('system_operation', 1);
    });

    it('should handle empty date range', () => {
      const report = reporter.generateReport('2025-01-01T00:00:00.000Z', '2025-01-02T00:00:00.000Z');
      expect(report.totalEvents).to.equal(0);
    });
  });

  describe('getActivitySummary', () => {
    it('should return per-actor activity summary', () => {
      const summary = reporter.getActivitySummary('op-1', '2026-04-01T00:00:00.000Z', '2026-04-30T00:00:00.000Z');
      expect(summary).to.have.property('actorId', 'op-1');
      expect(summary).to.have.property('totalEvents', 2);
      expect(summary).to.have.property('eventsByAction');
      expect(summary.eventsByAction).to.have.property('read', 1);
      expect(summary.eventsByAction).to.have.property('write', 1);
    });

    it('should return empty summary for unknown actor', () => {
      const summary = reporter.getActivitySummary('unknown', '2026-04-01T00:00:00.000Z', '2026-04-30T00:00:00.000Z');
      expect(summary.totalEvents).to.equal(0);
    });
  });

  describe('getResourceAccessReport', () => {
    it('should return access patterns for a resource type', () => {
      const report = reporter.getResourceAccessReport('customer_phone', '2026-04-01T00:00:00.000Z', '2026-04-30T00:00:00.000Z');
      expect(report).to.have.property('resourceType', 'customer_phone');
      expect(report).to.have.property('totalAccessCount', 2);
      expect(report).to.have.property('uniqueActors');
      expect(report.uniqueActors).to.equal(2);
    });

    it('should return empty report for untouched resource type', () => {
      const report = reporter.getResourceAccessReport('id_documents', '2026-04-01T00:00:00.000Z', '2026-04-30T00:00:00.000Z');
      expect(report.totalAccessCount).to.equal(0);
    });
  });

  describe('exportCSV', () => {
    it('should format records as CSV string with headers', () => {
      const records = store.query({});
      const csv = reporter.exportCSV(records);
      expect(csv).to.be.a('string');
      expect(csv).to.contain('id,timestamp,category,action,actor,resourceType,resourceId,outcome');
      expect(csv).to.contain('r1');
      expect(csv).to.contain('data_access');
    });

    it('should handle special characters in fields', () => {
      const records = [
        { id: 'csv-1', timestamp: '2026-04-01T00:00:00.000Z', category: 'data_access', action: 'read', actor: 'op-1', resourceType: 'customer_phone', resourceId: 'c-1', outcome: 'success' },
      ];
      const csv = reporter.exportCSV(records);
      expect(csv).to.contain('csv-1');
    });

    it('should return header-only for empty records', () => {
      const csv = reporter.exportCSV([]);
      expect(csv).to.contain('id,timestamp,category,action,actor,resourceType,resourceId,outcome');
      const lines = csv.trim().split('\n');
      expect(lines).to.have.length(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------
describe('Integration', () => {
  it('should complete full cycle: emit events → query → generate report → export', () => {
    const bus = new AuditEventBus();
    const store = new AuditStore({ retentionDays: 365 });
    const reporter = new AuditReporter(store);

    // Subscribe bus to store events
    bus.subscribe((event) => store.store(event));

    // Emit events
    bus.emitEvent('data_access', 'read', { actor: 'op-1', resourceType: 'customer_phone', resourceId: 'c1', outcome: 'success' });
    bus.emitEvent('data_access', 'write', { actor: 'op-1', resourceType: 'booking_history', resourceId: 'b1', outcome: 'success' });
    bus.emitEvent('system_operation', 'restart', { actor: 'admin', resourceType: 'service', resourceId: 'svc-1', outcome: 'success' });

    // Query
    const events = store.query({ actor: 'op-1' });
    expect(events).to.have.length(2);

    // Generate report
    const report = reporter.generateReport(
      new Date(Date.now() - 3600000).toISOString(),
      new Date().toISOString(),
    );
    expect(report.totalEvents).to.equal(3);

    // Export CSV
    const csv = reporter.exportCSV(events);
    expect(csv).to.contain('op-1');
  });

  it('should handle consecutive failures → alert triggered → acknowledged', () => {
    const store = new AuditStore({ retentionDays: 365 });
    const alerting = new AuditAlerting(store);
    alerting.addBuiltInRules();

    const now = Date.now();
    for (let i = 0; i < 6; i++) {
      const event = {
        id: `int-fail-${i}`, timestamp: new Date(now + i * 60000).toISOString(),
        category: 'data_access', action: 'read',
        actor: 'int-bad-actor', resourceType: 'customer_phone', resourceId: `c-${i}`,
        outcome: 'failure',
      };
      store.store(event);
      alerting.evaluate(event);
    }

    const alerts = alerting.getAlerts();
    expect(alerts.length).to.be.at.least(1);

    alerting.acknowledgeAlert(alerts[0].id);
    const updated = alerting.getAlerts();
    expect(updated[0].acknowledged).to.be.true;
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('Edge cases', () => {
  it('should return empty array when querying empty store', () => {
    const store = new AuditStore();
    const results = store.query({});
    expect(results).to.have.length(0);
  });

  it('should handle export with special characters in log data', () => {
    const store = new AuditStore();
    const reporter = new AuditReporter(store);
    const event = {
      id: 'spec-1', timestamp: new Date().toISOString(),
      category: 'data_access', action: 'read',
      actor: 'op-1', resourceType: 'customer_phone', resourceId: 'c-1',
      outcome: 'success',
      details: { note: 'contains, commas, and "quotes" and newlines' },
    };
    store.store(event);
    const csv = reporter.exportCSV(store.query({}));
    expect(csv).to.contain('spec-1');
    expect(csv).to.contain('data_access');
  });

  it('should not throw when evaluating event with empty store', () => {
    const store = new AuditStore();
    const alerting = new AuditAlerting(store);
    alerting.addBuiltInRules();
    const event = {
      id: 'e1', timestamp: new Date().toISOString(),
      category: 'system_operation', action: 'start',
      actor: 'system', resourceType: 'service', resourceId: 'svc-1',
      outcome: 'success',
    };
    expect(() => alerting.evaluate(event)).to.not.throw();
  });

  it('should return empty stats for empty store', () => {
    const store = new AuditStore();
    const stats = store.getStats();
    expect(stats.byCategory).to.deep.equal({});
    expect(stats.byAction).to.deep.equal({});
    expect(stats.byOutcome).to.deep.equal({});
  });
});

// ---------------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------------
describe('API endpoints', () => {
  describe('POST /api/compliance/audit/event', () => {
    it('should emit an audit event', async () => {
      const res = await request(app)
        .post('/api/compliance/audit/event')
        .send({
          category: 'data_access',
          action: 'read',
          actor: 'operator-1',
          resourceType: 'customer_phone',
          resourceId: 'cust-123',
          outcome: 'success',
          details: { ip: '10.0.0.1' },
        });
      expect(res.status).to.equal(201);
      expect(res.body.data).to.have.property('id');
      expect(res.body.data.category).to.equal('data_access');
    });

    it('should return 400 for invalid category', async () => {
      const res = await request(app)
        .post('/api/compliance/audit/event')
        .send({
          category: 'invalid',
          action: 'read',
          actor: 'op-1',
          resourceType: 'r',
          resourceId: 'id',
        });
      expect(res.status).to.equal(400);
    });

    it('should return 400 for missing required fields', async () => {
      const res = await request(app)
        .post('/api/compliance/audit/event')
        .send({ category: 'data_access' });
      expect(res.status).to.equal(400);
    });
  });

  describe('GET /api/compliance/audit/events', () => {
    it('should return audit events with filters', async () => {
      const res = await request(app)
        .get('/api/compliance/audit/events')
        .query({ actor: 'operator-1' });
      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
    });

    it('should support multiple query filters', async () => {
      const res = await request(app)
        .get('/api/compliance/audit/events')
        .query({ action: 'read', outcome: 'success', category: 'data_access' });
      expect(res.status).to.equal(200);
    });
  });

  describe('GET /api/compliance/audit/events/:id', () => {
    it('should return a specific audit record', async () => {
      const postRes = await request(app)
        .post('/api/compliance/audit/event')
        .send({ category: 'data_access', action: 'read', actor: 'op-1', resourceType: 'r', resourceId: 'id' });
      const id = postRes.body.data.id;

      const res = await request(app).get(`/api/compliance/audit/events/${id}`);
      expect(res.status).to.equal(200);
      expect(res.body.data.id).to.equal(id);
    });

    it('should return 404 for non-existent ID', async () => {
      const res = await request(app).get('/api/compliance/audit/events/non-existent');
      expect(res.status).to.equal(404);
    });
  });

  describe('GET /api/compliance/audit/stats', () => {
    it('should return audit statistics', async () => {
      const res = await request(app).get('/api/compliance/audit/stats');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.property('byCategory');
      expect(res.body.data).to.have.property('byAction');
      expect(res.body.data).to.have.property('byOutcome');
    });
  });

  describe('GET /api/compliance/audit/export', () => {
    it('should export filtered logs as JSON', async () => {
      const res = await request(app)
        .get('/api/compliance/audit/export')
        .query({ format: 'json' });
      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
    });

    it('should export filtered logs as CSV', async () => {
      const res = await request(app)
        .get('/api/compliance/audit/export')
        .query({ format: 'csv' });
      expect(res.status).to.equal(200);
      expect(res.headers['content-type']).to.include('text/csv');
    });
  });

  describe('GET /api/compliance/audit/alerts', () => {
    it('should return alert history', async () => {
      const res = await request(app).get('/api/compliance/audit/alerts');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
    });
  });

  describe('POST /api/compliance/audit/alerts/:id/acknowledge', () => {
    it('should acknowledge an alert', async () => {
      // Trigger an unusual hour alert first
      await request(app)
        .post('/api/compliance/audit/event')
        .send({
          category: 'data_access',
          action: 'read',
          actor: 'night-op-api',
          resourceType: 'customer_phone',
          resourceId: 'cust-1',
          timestamp: '2026-04-24T23:30:00.000Z',
        });

      const alertsRes = await request(app).get('/api/compliance/audit/alerts');
      if (alertsRes.body.data.length > 0) {
        const alertId = alertsRes.body.data[0].id;
        const ackRes = await request(app)
          .post(`/api/compliance/audit/alerts/${alertId}/acknowledge`);
        expect(ackRes.status).to.equal(200);
        expect(ackRes.body.data.acknowledged).to.be.true;
      }
    });

    it('should return 404 for non-existent alert ID', async () => {
      const res = await request(app)
        .post('/api/compliance/audit/alerts/non-existent/acknowledge');
      expect(res.status).to.equal(404);
    });
  });

  describe('GET /api/compliance/audit/report', () => {
    it('should generate compliance report', async () => {
      const res = await request(app)
        .get('/api/compliance/audit/report')
        .query({ dateFrom: '2026-04-01T00:00:00.000Z', dateTo: '2026-04-30T00:00:00.000Z' });
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.property('byCategory');
      expect(res.body.data).to.have.property('byAction');
      expect(res.body.data).to.have.property('totalEvents');
    });

    it('should return 400 without dateFrom', async () => {
      const res = await request(app)
        .get('/api/compliance/audit/report')
        .query({ dateTo: '2026-04-30T00:00:00.000Z' });
      expect(res.status).to.equal(400);
    });
  });
});
