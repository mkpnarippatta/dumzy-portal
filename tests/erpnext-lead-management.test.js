process.env.MOCHA_TEST_MODE = 'true';
process.env.FOLLOWUP_BIKE_HOURS = '24';
process.env.FOLLOWUP_HOTEL_HOURS = '48';
process.env.FOLLOWUP_TAXI_HOURS = '24';
process.env.FOLLOWUP_TICKETING_HOURS = '4';
process.env.FOLLOWUP_SOCIAL_HOURS = '24';

const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');
const {
  app,
  LeadManager,
  FollowUpTracker,
  LeadAnalytics,
} = require('../src/8-2-erpnext-lead-management');

// ---------------------------------------------------------------------------
// LeadManager
// ---------------------------------------------------------------------------
describe('LeadManager', () => {
  let lm;

  beforeEach(() => {
    lm = new LeadManager();
  });

  describe('createLead', () => {
    it('should create a lead with Bike Rental vertical tag', () => {
      const lead = lm.createLead({ vertical: 'bike_rental', phoneNumber: '+911234567890', intent: 'bike rental enquiry', timestamp: new Date().toISOString() });
      expect(lead).to.have.property('id');
      expect(lead.vertical).to.equal('bike_rental');
      expect(lead.phoneNumber).to.equal('+911234567890');
      expect(lead.status).to.equal('New');
    });

    it('should create a lead with Hotel vertical tag', () => {
      const lead = lm.createLead({ vertical: 'hotel', phoneNumber: '+919999999999', intent: 'hotel availability', timestamp: new Date().toISOString() });
      expect(lead.vertical).to.equal('hotel');
      expect(lead.status).to.equal('New');
    });

    it('should create a lead with Taxi vertical tag', () => {
      const lead = lm.createLead({ vertical: 'taxi', phoneNumber: '+918888888888', intent: 'taxi booking', timestamp: new Date().toISOString() });
      expect(lead.vertical).to.equal('taxi');
    });

    it('should create a lead with Ticketing vertical tag', () => {
      const lead = lm.createLead({ vertical: 'ticketing', phoneNumber: '+917777777777', intent: 'event tickets', timestamp: new Date().toISOString() });
      expect(lead.vertical).to.equal('ticketing');
    });

    it('should create a lead with Social Media vertical tag', () => {
      const lead = lm.createLead({ vertical: 'social_media', phoneNumber: '+916666666666', intent: 'social media enquiry', timestamp: new Date().toISOString() });
      expect(lead.vertical).to.equal('social_media');
    });

    it('should set initial status to New', () => {
      const lead = lm.createLead({ vertical: 'bike_rental', phoneNumber: '+911234567890', intent: 'test' });
      expect(lead.status).to.equal('New');
    });

    it('should include source if provided', () => {
      const lead = lm.createLead({ vertical: 'bike_rental', phoneNumber: '+911234567890', intent: 'test', source: 'whatsapp' });
      expect(lead.source).to.equal('whatsapp');
    });

    it('should reject unknown vertical', () => {
      expect(() => lm.createLead({ vertical: 'unknown', phoneNumber: '+911234567890', intent: 'test' })).to.throw();
    });
  });

  describe('getLead', () => {
    it('should return lead by ID', () => {
      const created = lm.createLead({ vertical: 'bike_rental', phoneNumber: '+911234567890', intent: 'test' });
      const found = lm.getLead(created.id);
      expect(found.id).to.equal(created.id);
    });

    it('should return null for non-existent ID', () => {
      expect(lm.getLead('non-existent')).to.be.null;
    });
  });

  describe('updateLeadStatus', () => {
    it('should transition New to InProgress', () => {
      const lead = lm.createLead({ vertical: 'bike_rental', phoneNumber: '+911234567890', intent: 'test' });
      const updated = lm.updateLeadStatus(lead.id, 'InProgress');
      expect(updated.status).to.equal('InProgress');
    });

    it('should transition InProgress to Qualified', () => {
      const lead = lm.createLead({ vertical: 'bike_rental', phoneNumber: '+911234567890', intent: 'test' });
      lm.updateLeadStatus(lead.id, 'InProgress');
      const updated = lm.updateLeadStatus(lead.id, 'Qualified');
      expect(updated.status).to.equal('Qualified');
    });

    it('should transition Qualified to Booked', () => {
      const lead = lm.createLead({ vertical: 'bike_rental', phoneNumber: '+911234567890', intent: 'test' });
      lm.updateLeadStatus(lead.id, 'InProgress');
      lm.updateLeadStatus(lead.id, 'Qualified');
      const updated = lm.updateLeadStatus(lead.id, 'Booked');
      expect(updated.status).to.equal('Booked');
    });

    it('should allow any status to transition to Lost', () => {
      const lead = lm.createLead({ vertical: 'bike_rental', phoneNumber: '+911234567890', intent: 'test' });
      const updated = lm.updateLeadStatus(lead.id, 'Lost');
      expect(updated.status).to.equal('Lost');
    });

    it('should reject invalid transition New to Booked', () => {
      const lead = lm.createLead({ vertical: 'bike_rental', phoneNumber: '+911234567890', intent: 'test' });
      expect(() => lm.updateLeadStatus(lead.id, 'Booked')).to.throw();
    });

    it('should track status history', () => {
      const lead = lm.createLead({ vertical: 'bike_rental', phoneNumber: '+911234567890', intent: 'test' });
      lm.updateLeadStatus(lead.id, 'InProgress');
      lm.updateLeadStatus(lead.id, 'Qualified');
      const updated = lm.getLead(lead.id);
      expect(updated.statusHistory).to.have.length(2);
      expect(updated.statusHistory[0].to).to.equal('InProgress');
      expect(updated.statusHistory[1].to).to.equal('Qualified');
    });

    it('should return null for non-existent lead', () => {
      expect(lm.updateLeadStatus('nonexistent', 'InProgress')).to.be.null;
    });
  });

  describe('listLeads', () => {
    beforeEach(() => {
      lm.createLead({ vertical: 'bike_rental', phoneNumber: '+911111111111', intent: 'bike', timestamp: '2026-04-01T00:00:00.000Z' });
      lm.createLead({ vertical: 'hotel', phoneNumber: '+912222222222', intent: 'hotel', timestamp: '2026-04-02T00:00:00.000Z' });
      lm.createLead({ vertical: 'bike_rental', phoneNumber: '+913333333333', intent: 'another bike', timestamp: '2026-04-03T00:00:00.000Z' });
    });

    it('should filter by vertical', () => {
      const results = lm.listLeads({ vertical: 'bike_rental' });
      expect(results).to.have.length(2);
    });

    it('should filter by status', () => {
      const leads = lm.listLeads({ vertical: 'bike_rental' });
      const results = lm.listLeads({ status: 'New' });
      expect(results).to.have.length(3);
    });

    it('should filter by date range', () => {
      const results = lm.listLeads({ dateFrom: '2026-04-02T00:00:00.000Z', dateTo: '2026-04-04T00:00:00.000Z' });
      expect(results).to.have.length(2);
    });

    it('should search by phone number', () => {
      const results = lm.listLeads({ search: '+911111111111' });
      expect(results).to.have.length(1);
    });

    it('should return all leads when no filters', () => {
      expect(lm.listLeads({})).to.have.length(3);
    });
  });

  describe('getLeadsByVertical', () => {
    it('should return leads for a specific vertical', () => {
      lm.createLead({ vertical: 'bike_rental', phoneNumber: '+911111111111', intent: 'bike' });
      lm.createLead({ vertical: 'hotel', phoneNumber: '+912222222222', intent: 'hotel' });
      const bikeLeads = lm.getLeadsByVertical('bike_rental');
      expect(bikeLeads).to.have.length(1);
    });

    it('should return empty array for vertical with no leads', () => {
      expect(lm.getLeadsByVertical('taxi')).to.have.length(0);
    });
  });
});

// ---------------------------------------------------------------------------
// FollowUpTracker
// ---------------------------------------------------------------------------
describe('FollowUpTracker', () => {
  let tracker;
  let lm;

  beforeEach(() => {
    tracker = new FollowUpTracker();
    lm = new LeadManager();
  });

  describe('setFollowUpDeadline', () => {
    it('should set 24h deadline for bike_rental', () => {
      const lead = lm.createLead({ vertical: 'bike_rental', phoneNumber: '+911234567890', intent: 'test' });
      tracker.setFollowUpDeadline(lead);
      expect(lead).to.have.property('followUpDeadline');
      const expected = Date.now() + 24 * 60 * 60 * 1000;
      expect(new Date(lead.followUpDeadline).getTime()).to.be.closeTo(expected, 1000);
    });

    it('should set 48h deadline for hotel', () => {
      const lead = lm.createLead({ vertical: 'hotel', phoneNumber: '+911234567890', intent: 'test' });
      tracker.setFollowUpDeadline(lead);
      const expected = Date.now() + 48 * 60 * 60 * 1000;
      expect(new Date(lead.followUpDeadline).getTime()).to.be.closeTo(expected, 1000);
    });

    it('should set 4h deadline for ticketing', () => {
      const lead = lm.createLead({ vertical: 'ticketing', phoneNumber: '+911234567890', intent: 'test' });
      tracker.setFollowUpDeadline(lead);
      const expected = Date.now() + 4 * 60 * 60 * 1000;
      expect(new Date(lead.followUpDeadline).getTime()).to.be.closeTo(expected, 1000);
    });

    it('should not set deadline for unknown vertical', () => {
      const lead = { id: 'test', vertical: 'unknown' };
      tracker.setFollowUpDeadline(lead);
      expect(lead.followUpDeadline).to.be.undefined;
    });
  });

  describe('getOverdueLeads', () => {
    it('should return leads past their follow-up deadline', () => {
      const leads = [
        { id: 'l1', vertical: 'bike_rental', followUpDeadline: new Date(Date.now() - 3600000).toISOString() },
        { id: 'l2', vertical: 'hotel', followUpDeadline: new Date(Date.now() + 3600000).toISOString() },
      ];
      const overdue = tracker.getOverdueLeads(leads);
      expect(overdue).to.have.length(1);
      expect(overdue[0].id).to.equal('l1');
    });
  });

  describe('getFollowUpsDueToday', () => {
    it('should return leads with deadlines within 24 hours', () => {
      const leads = [
        { id: 'l1', vertical: 'bike_rental', followUpDeadline: new Date(Date.now() + 3600000).toISOString() },
        { id: 'l2', vertical: 'hotel', followUpDeadline: new Date(Date.now() + 48 * 3600000).toISOString() },
      ];
      const due = tracker.getFollowUpsDueToday(leads);
      expect(due).to.have.length(1);
      expect(due[0].id).to.equal('l1');
    });
  });
});

// ---------------------------------------------------------------------------
// LeadAnalytics
// ---------------------------------------------------------------------------
describe('LeadAnalytics', () => {
  let lm;
  let analytics;

  beforeEach(() => {
    lm = new LeadManager();
    analytics = new LeadAnalytics(lm);
  });

  describe('getConversionRate', () => {
    it('should return 0 for vertical with no leads', () => {
      expect(analytics.getConversionRate('bike_rental')).to.equal(0);
    });

    it('should calculate conversion rate for a vertical', () => {
      const l1 = lm.createLead({ vertical: 'bike_rental', phoneNumber: '+911111111111', intent: 'bike' });
      lm.updateLeadStatus(l1.id, 'InProgress');
      lm.updateLeadStatus(l1.id, 'Qualified');
      lm.updateLeadStatus(l1.id, 'Booked');

      const l2 = lm.createLead({ vertical: 'bike_rental', phoneNumber: '+912222222222', intent: 'bike' });
      const l3 = lm.createLead({ vertical: 'bike_rental', phoneNumber: '+913333333333', intent: 'bike' });
      lm.updateLeadStatus(l3.id, 'Lost');

      expect(analytics.getConversionRate('bike_rental')).to.be.closeTo(1 / 3, 0.01);
    });
  });

  describe('getLeadSummary', () => {
    it('should return counts by status per vertical', () => {
      lm.createLead({ vertical: 'bike_rental', phoneNumber: '+911111111111', intent: 'bike' });
      lm.createLead({ vertical: 'bike_rental', phoneNumber: '+912222222222', intent: 'bike' });
      lm.createLead({ vertical: 'hotel', phoneNumber: '+913333333333', intent: 'hotel' });

      const summary = analytics.getLeadSummary();
      expect(summary.bike_rental).to.have.property('New', 2);
      expect(summary.hotel).to.have.property('New', 1);
    });
  });

  describe('exportLeads', () => {
    it('should return all leads as structured array', () => {
      lm.createLead({ vertical: 'bike_rental', phoneNumber: '+911111111111', intent: 'bike', timestamp: '2026-04-01T00:00:00.000Z' });
      lm.createLead({ vertical: 'hotel', phoneNumber: '+912222222222', intent: 'hotel', timestamp: '2026-04-02T00:00:00.000Z' });

      const exported = analytics.exportLeads({});
      expect(exported).to.have.length(2);
      expect(exported[0]).to.have.property('id');
      expect(exported[0]).to.have.property('vertical');
      expect(exported[0]).to.have.property('phoneNumber');
      expect(exported[0]).to.have.property('status');
    });

    it('should apply filters to export', () => {
      lm.createLead({ vertical: 'bike_rental', phoneNumber: '+911111111111', intent: 'bike' });
      lm.createLead({ vertical: 'hotel', phoneNumber: '+912222222222', intent: 'hotel' });

      const exported = analytics.exportLeads({ vertical: 'hotel' });
      expect(exported).to.have.length(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------
describe('Integration', () => {
  it('should complete full cycle: create lead → update status → export → verify conversion', () => {
    const lm = new LeadManager();
    const analytics = new LeadAnalytics(lm);

    const lead = lm.createLead({ vertical: 'bike_rental', phoneNumber: '+911234567890', intent: 'bike rental' });
    expect(lead.status).to.equal('New');

    lm.updateLeadStatus(lead.id, 'InProgress');
    lm.updateLeadStatus(lead.id, 'Qualified');
    lm.updateLeadStatus(lead.id, 'Booked');

    const exported = analytics.exportLeads({ vertical: 'bike_rental' });
    expect(exported).to.have.length(1);
    expect(analytics.getConversionRate('bike_rental')).to.equal(1);
  });

  it('should create leads across verticals and get summary', () => {
    const lm = new LeadManager();
    const analytics = new LeadAnalytics(lm);

    lm.createLead({ vertical: 'bike_rental', phoneNumber: '+911111111111', intent: 'bike' });
    lm.createLead({ vertical: 'hotel', phoneNumber: '+912222222222', intent: 'hotel' });
    lm.createLead({ vertical: 'taxi', phoneNumber: '+913333333333', intent: 'taxi' });

    const summary = analytics.getLeadSummary();
    expect(summary.bike_rental.New).to.equal(1);
    expect(summary.hotel.New).to.equal(1);
    expect(summary.taxi.New).to.equal(1);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('Edge cases', () => {
  it('should reject invalid status transition from New to Booked', () => {
    const lm = new LeadManager();
    const lead = lm.createLead({ vertical: 'bike_rental', phoneNumber: '+911234567890', intent: 'test' });
    expect(() => lm.updateLeadStatus(lead.id, 'Booked')).to.throw();
  });

  it('should reject unknown vertical tag', () => {
    const lm = new LeadManager();
    expect(() => lm.createLead({ vertical: 'invalid_vertical', phoneNumber: '+911234567890', intent: 'test' })).to.throw();
  });

  it('should handle export with no leads', () => {
    const lm = new LeadManager();
    const analytics = new LeadAnalytics(lm);
    const exported = analytics.exportLeads({});
    expect(exported).to.have.length(0);
  });

  it('should handle getConversionRate with no leads', () => {
    const lm = new LeadManager();
    const analytics = new LeadAnalytics(lm);
    expect(analytics.getConversionRate('bike_rental')).to.equal(0);
  });
});

// ---------------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------------
describe('API endpoints', () => {
  describe('POST /api/erpnext/leads', () => {
    it('should create a new lead', async () => {
      const res = await request(app)
        .post('/api/erpnext/leads')
        .send({ vertical: 'bike_rental', phoneNumber: '+911234567890', intent: 'bike rental enquiry' });
      expect(res.status).to.equal(201);
      expect(res.body.data.vertical).to.equal('bike_rental');
      expect(res.body.data.status).to.equal('New');
    });

    it('should return 400 for missing required fields', async () => {
      const res = await request(app)
        .post('/api/erpnext/leads')
        .send({ vertical: 'bike_rental' });
      expect(res.status).to.equal(400);
    });

    it('should return 400 for unknown vertical', async () => {
      const res = await request(app)
        .post('/api/erpnext/leads')
        .send({ vertical: 'unknown', phoneNumber: '+911234567890', intent: 'test' });
      expect(res.status).to.equal(400);
    });
  });

  describe('GET /api/erpnext/leads', () => {
    it('should list leads', async () => {
      const res = await request(app).get('/api/erpnext/leads');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
    });

    it('should filter by vertical', async () => {
      const res = await request(app).get('/api/erpnext/leads?vertical=bike_rental');
      expect(res.status).to.equal(200);
    });
  });

  describe('GET /api/erpnext/leads/:id', () => {
    it('should return lead by ID', async () => {
      const postRes = await request(app)
        .post('/api/erpnext/leads')
        .send({ vertical: 'bike_rental', phoneNumber: '+911234567890', intent: 'test' });
      const id = postRes.body.data.id;

      const res = await request(app).get(`/api/erpnext/leads/${id}`);
      expect(res.status).to.equal(200);
      expect(res.body.data.id).to.equal(id);
    });

    it('should return 404 for non-existent ID', async () => {
      const res = await request(app).get('/api/erpnext/leads/nonexistent');
      expect(res.status).to.equal(404);
    });
  });

  describe('PATCH /api/erpnext/leads/:id/status', () => {
    it('should update lead status', async () => {
      const postRes = await request(app)
        .post('/api/erpnext/leads')
        .send({ vertical: 'bike_rental', phoneNumber: '+911234567890', intent: 'test' });
      const id = postRes.body.data.id;

      const res = await request(app)
        .patch(`/api/erpnext/leads/${id}/status`)
        .send({ status: 'InProgress' });
      expect(res.status).to.equal(200);
      expect(res.body.data.status).to.equal('InProgress');
    });

    it('should return 400 for invalid transition', async () => {
      const postRes = await request(app)
        .post('/api/erpnext/leads')
        .send({ vertical: 'bike_rental', phoneNumber: '+911234567890', intent: 'test' });
      const id = postRes.body.data.id;

      const res = await request(app)
        .patch(`/api/erpnext/leads/${id}/status`)
        .send({ status: 'Booked' });
      expect(res.status).to.equal(400);
    });
  });

  describe('GET /api/erpnext/leads/analytics/conversion', () => {
    it('should return conversion rates', async () => {
      const res = await request(app).get('/api/erpnext/leads/analytics/conversion');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.property('rates');
    });
  });

  describe('GET /api/erpnext/leads/analytics/summary', () => {
    it('should return lead summary', async () => {
      const res = await request(app).get('/api/erpnext/leads/analytics/summary');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.property('summary');
    });
  });

  describe('GET /api/erpnext/leads/followups/overdue', () => {
    it('should return overdue follow-ups', async () => {
      const res = await request(app).get('/api/erpnext/leads/followups/overdue');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
    });
  });

  describe('GET /api/erpnext/leads/export', () => {
    it('should export leads', async () => {
      const res = await request(app).get('/api/erpnext/leads/export');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
    });
  });
});
