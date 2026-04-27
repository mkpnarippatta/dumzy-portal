require('dotenv').config();
const express = require('express');
const EventEmitter = require('events');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// AuditEventBus — centralized event collection
// ---------------------------------------------------------------------------
class AuditEventBus extends EventEmitter {
  constructor() {
    super();
    this.categories = [
      'data_access',
      'system_operation',
      'configuration_change',
      'security_event',
      'business_operation',
    ];
    this._eventCounter = 0;
  }

  emitEvent(category, action, options = {}) {
    if (!this.categories.includes(category)) {
      throw new Error(
        `Invalid category: ${category}. Must be one of: ${this.categories.join(', ')}`,
      );
    }

    const { actor, resourceType, resourceId, outcome, details, timestamp } = options;

    if (!actor) throw new Error('actor is required');
    if (!resourceType) throw new Error('resourceType is required');
    if (!resourceId) throw new Error('resourceId is required');

    this._eventCounter++;
    const event = {
      id: `audit-${Date.now()}-${this._eventCounter}`,
      timestamp: timestamp || new Date().toISOString(),
      category,
      action,
      actor,
      resourceType,
      resourceId,
      outcome: outcome || 'success',
      details: details || {},
    };

    this.emit('audit_event', event);
    return event;
  }

  subscribe(handler) {
    this.on('audit_event', handler);
  }
}

// ---------------------------------------------------------------------------
// AuditStore — persistent audit log storage
// ---------------------------------------------------------------------------
class AuditStore {
  constructor(options = {}) {
    this.records = [];
    this.retentionDays = options.retentionDays
      || parseInt(process.env.AUDIT_LOG_RETENTION_DAYS, 10) || 365;
  }

  store(event) {
    if (!event.id) throw new Error('Event must have an id');
    this.records.push(event);
    this._prune();
    return event;
  }

  getRecord(id) {
    return this.records.find(r => r.id === id) || null;
  }

  query(filters = {}, page, limit) {
    let result = [...this.records];

    if (filters.actor) result = result.filter(r => r.actor === filters.actor);
    if (filters.action) result = result.filter(r => r.action === filters.action);
    if (filters.resourceType) result = result.filter(r => r.resourceType === filters.resourceType);
    if (filters.outcome) result = result.filter(r => r.outcome === filters.outcome);
    if (filters.category) result = result.filter(r => r.category === filters.category);
    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom).getTime();
      result = result.filter(r => new Date(r.timestamp).getTime() >= from);
    }
    if (filters.dateTo) {
      const to = new Date(filters.dateTo).getTime();
      result = result.filter(r => new Date(r.timestamp).getTime() <= to);
    }

    result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (page !== undefined && page !== null && limit !== undefined && limit !== null) {
      const start = (page - 1) * limit;
      result = result.slice(start, start + limit);
    }

    return result;
  }

  getStats() {
    const byCategory = {};
    const byAction = {};
    const byOutcome = {};

    for (const r of this.records) {
      byCategory[r.category] = (byCategory[r.category] || 0) + 1;
      byAction[r.action] = (byAction[r.action] || 0) + 1;
      byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1;
    }

    return { byCategory, byAction, byOutcome };
  }

  exportData(filters = {}) {
    return this.query(filters);
  }

  _prune() {
    if (this.retentionDays <= 0) return;
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    this.records = this.records.filter(
      r => new Date(r.timestamp).getTime() >= cutoff,
    );
  }
}

// ---------------------------------------------------------------------------
// AuditAlerting — suspicious activity detection
// ---------------------------------------------------------------------------
class AuditAlerting {
  constructor(store) {
    this.store = store;
    this.rules = [];
    this.alerts = [];
    this._alertCounter = 0;
  }

  addRule(rule) {
    this.rules.push(rule);
  }

  addBuiltInRules() {
    // Repeated Failed Access: > 5 failed access events from same actor within 10 minutes
    this.addRule({
      name: 'repeated_failed_access',
      description: 'More than 5 failed access events from the same actor within 10 minutes',
      evaluate: (event, store) => {
        if (event.outcome !== 'failure') return false;
        const windowMs = parseInt(process.env.AUDIT_ALERT_FAILED_WINDOW_MS, 10) || 600000;
        const threshold = parseInt(process.env.AUDIT_ALERT_FAILED_THRESHOLD, 10) || 5;
        const eventTime = new Date(event.timestamp).getTime();
        const recent = store.query({
          actor: event.actor,
          outcome: 'failure',
          dateFrom: new Date(eventTime - windowMs).toISOString(),
          dateTo: new Date(eventTime + 1000).toISOString(),
        });
        return recent.length > threshold;
      },
    });

    // Unusual Hour Access: data access events between 11 PM and 5 AM
    this.addRule({
      name: 'unusual_hour_access',
      description: 'Data access events between 11 PM and 5 AM UTC',
      evaluate: (event) => {
        if (event.category !== 'data_access') return false;
        const hour = new Date(event.timestamp).getUTCHours();
        return hour >= 23 || hour < 5;
      },
    });

    // Bulk Data Export: > 100 records accessed by same actor within 5 minutes
    this.addRule({
      name: 'bulk_data_export',
      description: 'More than 100 records accessed by the same actor within 5 minutes',
      evaluate: (event, store) => {
        if (event.category !== 'data_access' || event.action !== 'read') return false;
        const windowMs = 300000;
        const threshold = 100;
        const eventTime = new Date(event.timestamp).getTime();
        const recent = store.query({
          actor: event.actor,
          category: 'data_access',
          action: 'read',
          dateFrom: new Date(eventTime - windowMs).toISOString(),
          dateTo: new Date(eventTime + 1000).toISOString(),
        });
        return recent.length > threshold;
      },
    });
  }

  evaluate(event) {
    const triggeredAlerts = [];
    for (const rule of this.rules) {
      try {
        if (rule.evaluate(event, this.store)) {
          this._alertCounter++;
          const alert = {
            id: `alert-${Date.now()}-${this._alertCounter}`,
            ruleName: rule.name,
            description: rule.description,
            eventId: event.id,
            timestamp: new Date().toISOString(),
            acknowledged: false,
          };
          this.alerts.push(alert);
          triggeredAlerts.push(alert);
        }
      } catch (e) {
        // Silently skip rules that error
      }
    }
    return triggeredAlerts;
  }

  acknowledgeAlert(alertId) {
    const alert = this.alerts.find(a => a.id === alertId);
    if (!alert) return null;
    alert.acknowledged = true;
    return alert;
  }

  getAlerts() {
    return [...this.alerts].sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
    );
  }
}

// ---------------------------------------------------------------------------
// AuditReporter — compliance reporting
// ---------------------------------------------------------------------------
class AuditReporter {
  constructor(store) {
    this.store = store;
  }

  generateReport(dateFrom, dateTo) {
    const records = this.store.query({ dateFrom, dateTo });
    const byCategory = {};
    const byAction = {};

    for (const r of records) {
      byCategory[r.category] = (byCategory[r.category] || 0) + 1;
      byAction[r.action] = (byAction[r.action] || 0) + 1;
    }

    return {
      dateFrom,
      dateTo,
      totalEvents: records.length,
      byCategory,
      byAction,
    };
  }

  getActivitySummary(actorId, dateFrom, dateTo) {
    const records = this.store.query({ actor: actorId, dateFrom, dateTo });
    const eventsByAction = {};

    for (const r of records) {
      eventsByAction[r.action] = (eventsByAction[r.action] || 0) + 1;
    }

    return {
      actorId,
      dateFrom,
      dateTo,
      totalEvents: records.length,
      eventsByAction,
    };
  }

  getResourceAccessReport(resourceType, dateFrom, dateTo) {
    const records = this.store.query({ resourceType, dateFrom, dateTo });
    const uniqueActors = new Set(records.map(r => r.actor));
    const eventsByAction = {};

    for (const r of records) {
      eventsByAction[r.action] = (eventsByAction[r.action] || 0) + 1;
    }

    return {
      resourceType,
      dateFrom,
      dateTo,
      totalAccessCount: records.length,
      uniqueActors: uniqueActors.size,
      eventsByAction,
    };
  }

  exportCSV(records) {
    const headers = ['id', 'timestamp', 'category', 'action', 'actor', 'resourceType', 'resourceId', 'outcome'];
    const lines = [headers.join(',')];

    for (const r of records) {
      const row = headers.map(h => {
        const val = r[h] !== undefined ? String(r[h]) : '';
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          return '"' + val.replace(/"/g, '""') + '"';
        }
        return val;
      });
      lines.push(row.join(','));
    }

    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Module-level instances
// ---------------------------------------------------------------------------
const bus = new AuditEventBus();
const store = new AuditStore({
  retentionDays: parseInt(process.env.AUDIT_LOG_RETENTION_DAYS, 10) || 365,
});
const alerting = new AuditAlerting(store);
alerting.addBuiltInRules();
const reporter = new AuditReporter(store);

bus.subscribe((event) => store.store(event));
bus.subscribe((event) => alerting.evaluate(event));

// ---------------------------------------------------------------------------
// Express API Routes
// ---------------------------------------------------------------------------

// POST /api/compliance/audit/event — emit an audit event
app.post('/api/compliance/audit/event', (req, res) => {
  try {
    const { category, action, actor, resourceType, resourceId, outcome, details, timestamp } = req.body;
    if (!category || !action || !actor || !resourceType || !resourceId) {
      return res.status(400).json({
        error: { message: 'Missing required fields: category, action, actor, resourceType, resourceId', code: 400 },
      });
    }
    const event = bus.emitEvent(category, action, { actor, resourceType, resourceId, outcome, details, timestamp });
    res.status(201).json({
      data: event,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    if (error.message && error.message.startsWith('Invalid category')) {
      return res.status(400).json({
        error: { message: error.message, code: 400 },
      });
    }
    res.status(500).json({
      error: { message: 'Failed to emit event', code: 500, details: error.message },
    });
  }
});

// GET /api/compliance/audit/events — query audit logs
app.get('/api/compliance/audit/events', (req, res) => {
  try {
    const { actor, action, resourceType, outcome, category, dateFrom, dateTo, page, limit } = req.query;
    const filters = {};
    if (actor) filters.actor = actor;
    if (action) filters.action = action;
    if (resourceType) filters.resourceType = resourceType;
    if (outcome) filters.outcome = outcome;
    if (category) filters.category = category;
    if (dateFrom) filters.dateFrom = dateFrom;
    if (dateTo) filters.dateTo = dateTo;

    const pageNum = page ? parseInt(page, 10) : undefined;
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    const results = store.query(filters, pageNum, limitNum);

    res.json({
      data: results,
      meta: { timestamp: Date.now(), total: store.query(filters).length },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to query events', code: 500, details: error.message },
    });
  }
});

// GET /api/compliance/audit/events/:id — get specific audit record
app.get('/api/compliance/audit/events/:id', (req, res) => {
  try {
    const record = store.getRecord(req.params.id);
    if (!record) {
      return res.status(404).json({
        error: { message: 'Audit record not found', code: 404 },
      });
    }
    res.json({
      data: record,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get record', code: 500, details: error.message },
    });
  }
});

// GET /api/compliance/audit/stats — get audit statistics
app.get('/api/compliance/audit/stats', (req, res) => {
  try {
    const stats = store.getStats();
    res.json({
      data: stats,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get stats', code: 500, details: error.message },
    });
  }
});

// GET /api/compliance/audit/export — export filtered logs
app.get('/api/compliance/audit/export', (req, res) => {
  try {
    const { actor, action, resourceType, outcome, category, dateFrom, dateTo, format } = req.query;
    const filters = {};
    if (actor) filters.actor = actor;
    if (action) filters.action = action;
    if (resourceType) filters.resourceType = resourceType;
    if (outcome) filters.outcome = outcome;
    if (category) filters.category = category;
    if (dateFrom) filters.dateFrom = dateFrom;
    if (dateTo) filters.dateTo = dateTo;

    const records = store.exportData(filters);

    if (format === 'csv') {
      const csv = reporter.exportCSV(records);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="audit-log-export.csv"');
      return res.send(csv);
    }

    res.json({
      data: records,
      meta: { timestamp: Date.now(), total: records.length },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to export logs', code: 500, details: error.message },
    });
  }
});

// GET /api/compliance/audit/alerts — get audit alert history
app.get('/api/compliance/audit/alerts', (req, res) => {
  try {
    const alerts = alerting.getAlerts();
    res.json({
      data: alerts,
      meta: { timestamp: Date.now(), total: alerts.length },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get alerts', code: 500, details: error.message },
    });
  }
});

// POST /api/compliance/audit/alerts/:id/acknowledge — acknowledge an alert
app.post('/api/compliance/audit/alerts/:id/acknowledge', (req, res) => {
  try {
    const alert = alerting.acknowledgeAlert(req.params.id);
    if (!alert) {
      return res.status(404).json({
        error: { message: 'Alert not found', code: 404 },
      });
    }
    res.json({
      data: alert,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to acknowledge alert', code: 500, details: error.message },
    });
  }
});

// GET /api/compliance/audit/report — generate compliance report
app.get('/api/compliance/audit/report', (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    if (!dateFrom) {
      return res.status(400).json({
        error: { message: 'dateFrom is required', code: 400 },
      });
    }
    const report = reporter.generateReport(dateFrom, dateTo || new Date().toISOString());
    res.json({
      data: report,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to generate report', code: 500, details: error.message },
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
const PORT = process.env.PORT || process.env.AUDIT_PORT || 3011;
if (process.env.MOCHA_TEST_MODE !== 'true') {
  app.listen(PORT, () => {
    console.log(`Audit Logging System service running on port ${PORT}`);
  });
}

module.exports = {
  app,
  AuditEventBus,
  AuditStore,
  AuditAlerting,
  AuditReporter,
};
