require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// LeadManager — lead CRUD and status workflow
// ---------------------------------------------------------------------------
class LeadManager {
  constructor() {
    this.leads = [];
    this._counter = 0;
    this.validTransitions = {
      New: ['InProgress', 'Lost'],
      InProgress: ['Qualified', 'Lost'],
      Qualified: ['Booked', 'Lost'],
      Booked: [],
      Lost: [],
    };
    this.validVerticals = ['bike_rental', 'hotel', 'taxi', 'ticketing', 'social_media', 'tour_packages'];
  }

  createLead({ vertical, phoneNumber, intent, timestamp, source }) {
    if (!this.validVerticals.includes(vertical)) {
      throw new Error(`Invalid vertical: ${vertical}. Must be one of: ${this.validVerticals.join(', ')}`);
    }
    if (!phoneNumber) throw new Error('phoneNumber is required');
    if (!intent) throw new Error('intent is required');

    this._counter++;
    const lead = {
      id: `lead-${Date.now()}-${this._counter}`,
      vertical,
      phoneNumber,
      intent,
      timestamp: timestamp || new Date().toISOString(),
      source: source || 'whatsapp',
      status: 'New',
      statusHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.leads.push(lead);
    return { ...lead };
  }

  getLead(id) {
    const lead = this.leads.find(l => l.id === id);
    return lead ? { ...lead } : null;
  }

  updateLeadStatus(id, newStatus) {
    const lead = this.leads.find(l => l.id === id);
    if (!lead) return null;

    const allowed = this.validTransitions[lead.status];
    if (!allowed || !allowed.includes(newStatus)) {
      throw new Error(`Invalid status transition: ${lead.status} → ${newStatus}. Allowed: ${(allowed || []).join(', ') || 'none'}`);
    }

    const from = lead.status;
    lead.status = newStatus;
    lead.updatedAt = new Date().toISOString();
    lead.statusHistory.push({ from, to: newStatus, timestamp: lead.updatedAt });

    return { ...lead };
  }

  listLeads(filters = {}) {
    let result = [...this.leads];

    if (filters.vertical) result = result.filter(l => l.vertical === filters.vertical);
    if (filters.status) result = result.filter(l => l.status === filters.status);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(l => l.phoneNumber.includes(q) || l.intent.toLowerCase().includes(q));
    }
    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom).getTime();
      result = result.filter(l => new Date(l.timestamp).getTime() >= from);
    }
    if (filters.dateTo) {
      const to = new Date(filters.dateTo).getTime();
      result = result.filter(l => new Date(l.timestamp).getTime() <= to);
    }

    return result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  getLeadsByVertical(vertical) {
    return this.leads.filter(l => l.vertical === vertical);
  }
}

// ---------------------------------------------------------------------------
// FollowUpTracker — deadline assignment per vertical
// ---------------------------------------------------------------------------
class FollowUpTracker {
  constructor() {
    this.deadlineRules = {
      bike_rental: { hours: parseInt(process.env.FOLLOWUP_BIKE_HOURS, 10) || 24 },
      taxi: { hours: parseInt(process.env.FOLLOWUP_TAXI_HOURS, 10) || 24 },
      hotel: { hours: parseInt(process.env.FOLLOWUP_HOTEL_HOURS, 10) || 48 },
      ticketing: { hours: parseInt(process.env.FOLLOWUP_TICKETING_HOURS, 10) || 4 },
      social_media: { hours: parseInt(process.env.FOLLOWUP_SOCIAL_HOURS, 10) || 24 },
      tour_packages: { hours: parseInt(process.env.FOLLOWUP_TOUR_HOURS, 10) || 48 },
    };
  }

  setFollowUpDeadline(lead) {
    const rule = this.deadlineRules[lead.vertical];
    if (!rule) return;
    lead.followUpDeadline = new Date(Date.now() + rule.hours * 60 * 60 * 1000).toISOString();
  }

  getOverdueLeads(leads) {
    const now = Date.now();
    return leads.filter(l => l.followUpDeadline && new Date(l.followUpDeadline).getTime() < now);
  }

  getFollowUpsDueToday(leads) {
    const now = Date.now();
    const in24h = now + 24 * 60 * 60 * 1000;
    return leads.filter(l => l.followUpDeadline && new Date(l.followUpDeadline).getTime() <= in24h);
  }
}

// ---------------------------------------------------------------------------
// LeadAnalytics — conversion rates and reporting
// ---------------------------------------------------------------------------
class LeadAnalytics {
  constructor(leadManager) {
    this.leadManager = leadManager;
  }

  getConversionRate(vertical) {
    const leads = this.leadManager.getLeadsByVertical(vertical);
    if (leads.length === 0) return 0;
    const booked = leads.filter(l => l.status === 'Booked').length;
    return booked / leads.length;
  }

  getLeadSummary() {
    const summary = {};
    const verticals = ['bike_rental', 'hotel', 'taxi', 'ticketing', 'social_media', 'tour_packages'];
    const statuses = ['New', 'InProgress', 'Qualified', 'Booked', 'Lost'];

    for (const v of verticals) {
      summary[v] = {};
      for (const s of statuses) {
        summary[v][s] = 0;
      }
    }

    for (const lead of this.leadManager.leads) {
      if (summary[lead.vertical]) {
        summary[lead.vertical][lead.status] = (summary[lead.vertical][lead.status] || 0) + 1;
      }
    }

    return summary;
  }

  exportLeads(filters = {}) {
    return this.leadManager.listLeads(filters).map(l => ({ ...l }));
  }
}

// ---------------------------------------------------------------------------
// Module-level instances
// ---------------------------------------------------------------------------
const leadManager = new LeadManager();
const followUpTracker = new FollowUpTracker();
const leadAnalytics = new LeadAnalytics(leadManager);

// ---------------------------------------------------------------------------
// Express API Routes — note: analytics/followups routes before parameterized
// ---------------------------------------------------------------------------

// GET /api/erpnext/leads/analytics/conversion — get conversion rates
app.get('/api/erpnext/leads/analytics/conversion', (req, res) => {
  try {
    const verticals = ['bike_rental', 'hotel', 'taxi', 'ticketing', 'social_media', 'tour_packages'];
    const rates = {};
    for (const v of verticals) {
      rates[v] = leadAnalytics.getConversionRate(v);
    }
    res.json({
      data: { rates },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get conversion rates', code: 500, details: error.message },
    });
  }
});

// GET /api/erpnext/leads/analytics/summary — get lead summary
app.get('/api/erpnext/leads/analytics/summary', (req, res) => {
  try {
    const summary = leadAnalytics.getLeadSummary();
    res.json({
      data: { summary },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get lead summary', code: 500, details: error.message },
    });
  }
});

// GET /api/erpnext/leads/followups/overdue — get overdue follow-ups
app.get('/api/erpnext/leads/followups/overdue', (req, res) => {
  try {
    const overdue = followUpTracker.getOverdueLeads(leadManager.leads);
    res.json({
      data: overdue,
      meta: { timestamp: Date.now(), count: overdue.length },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get overdue follow-ups', code: 500, details: error.message },
    });
  }
});

// GET /api/erpnext/leads/export — export leads
app.get('/api/erpnext/leads/export', (req, res) => {
  try {
    const { vertical, status } = req.query;
    const filters = {};
    if (vertical) filters.vertical = vertical;
    if (status) filters.status = status;
    const data = leadAnalytics.exportLeads(filters);
    res.json({
      data,
      meta: { timestamp: Date.now(), total: data.length },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to export leads', code: 500, details: error.message },
    });
  }
});

// POST /api/erpnext/leads — create a new lead
app.post('/api/erpnext/leads', (req, res) => {
  try {
    const { vertical, phoneNumber, intent, timestamp, source } = req.body;
    if (!vertical || !phoneNumber || !intent) {
      return res.status(400).json({
        error: { message: 'Missing required fields: vertical, phoneNumber, intent', code: 400 },
      });
    }
    const lead = leadManager.createLead({ vertical, phoneNumber, intent, timestamp, source });
    followUpTracker.setFollowUpDeadline(lead);
    res.status(201).json({
      data: lead,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    if (error.message && error.message.startsWith('Invalid vertical')) {
      return res.status(400).json({
        error: { message: error.message, code: 400 },
      });
    }
    res.status(500).json({
      error: { message: 'Failed to create lead', code: 500, details: error.message },
    });
  }
});

// GET /api/erpnext/leads — list leads with filters
app.get('/api/erpnext/leads', (req, res) => {
  try {
    const { vertical, status, search, dateFrom, dateTo } = req.query;
    const filters = {};
    if (vertical) filters.vertical = vertical;
    if (status) filters.status = status;
    if (search) filters.search = search;
    if (dateFrom) filters.dateFrom = dateFrom;
    if (dateTo) filters.dateTo = dateTo;

    const leads = leadManager.listLeads(filters);
    res.json({
      data: leads,
      meta: { timestamp: Date.now(), total: leads.length },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to list leads', code: 500, details: error.message },
    });
  }
});

// GET /api/erpnext/leads/:id — get lead by ID
app.get('/api/erpnext/leads/:id', (req, res) => {
  try {
    const lead = leadManager.getLead(req.params.id);
    if (!lead) {
      return res.status(404).json({
        error: { message: 'Lead not found', code: 404 },
      });
    }
    res.json({
      data: lead,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get lead', code: 500, details: error.message },
    });
  }
});

// PATCH /api/erpnext/leads/:id/status — update lead status
app.patch('/api/erpnext/leads/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({
        error: { message: 'status is required', code: 400 },
      });
    }
    const lead = leadManager.updateLeadStatus(req.params.id, status);
    if (!lead) {
      return res.status(404).json({
        error: { message: 'Lead not found', code: 404 },
      });
    }
    res.json({
      data: lead,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    if (error.message && error.message.startsWith('Invalid status transition')) {
      return res.status(400).json({
        error: { message: error.message, code: 400 },
      });
    }
    res.status(500).json({
      error: { message: 'Failed to update status', code: 500, details: error.message },
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
const PORT = process.env.PORT || process.env.ERP_PORT || 3013;
if (process.env.MOCHA_TEST_MODE !== 'true') {
  app.listen(PORT, () => {
    console.log(`ERPNext Lead Management service running on port ${PORT}`);
  });
}

module.exports = {
  app,
  LeadManager,
  FollowUpTracker,
  LeadAnalytics,
};
