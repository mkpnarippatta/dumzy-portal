process.env.MOCHA_TEST_MODE = 'true';

const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');
const {
  app,
  VendorRegistry,
  NotificationService,
  AcknowledgmentTracker,
} = require('../src/8-3-vendor-notification-system');

// ---------------------------------------------------------------------------
// VendorRegistry
// ---------------------------------------------------------------------------
describe('VendorRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new VendorRegistry();
  });

  describe('registerVendor', () => {
    it('should register a vendor with vertical and contact info', () => {
      const vendor = registry.registerVendor({
        vertical: 'bike_rental',
        name: 'Bike Shop Hyderabad',
        contact: '+918888888888',
        channel: 'whatsapp',
      });
      expect(vendor).to.have.property('id');
      expect(vendor.vertical).to.equal('bike_rental');
      expect(vendor.name).to.equal('Bike Shop Hyderabad');
      expect(vendor.contact).to.equal('+918888888888');
      expect(vendor.channel).to.equal('whatsapp');
    });

    it('should default channel to whatsapp', () => {
      const vendor = registry.registerVendor({
        vertical: 'hotel',
        name: 'Hotel Grand',
        contact: 'hotel@example.com',
      });
      expect(vendor.channel).to.equal('whatsapp');
    });

    it('should default active to true', () => {
      const vendor = registry.registerVendor({
        vertical: 'taxi',
        name: 'Taxi Dispatch',
        contact: '+919999999999',
      });
      expect(vendor.active).to.be.true;
    });
  });

  describe('getVendorsByVertical', () => {
    it('should return vendors for a specific vertical', () => {
      registry.registerVendor({ vertical: 'bike_rental', name: 'Bike Shop A', contact: '+911111111111' });
      registry.registerVendor({ vertical: 'bike_rental', name: 'Bike Shop B', contact: '+912222222222' });
      registry.registerVendor({ vertical: 'hotel', name: 'Hotel A', contact: '+913333333333' });

      const vendors = registry.getVendorsByVertical('bike_rental');
      expect(vendors).to.have.length(2);
    });

    it('should return empty array for vertical with no vendors', () => {
      expect(registry.getVendorsByVertical('unknown')).to.have.length(0);
    });
  });

  describe('getVendor', () => {
    it('should return vendor by ID', () => {
      const created = registry.registerVendor({ vertical: 'taxi', name: 'Taxi Co', contact: '+911111111111' });
      const found = registry.getVendor(created.id);
      expect(found.id).to.equal(created.id);
    });

    it('should return null for non-existent ID', () => {
      expect(registry.getVendor('nonexistent')).to.be.null;
    });
  });

  describe('removeVendor', () => {
    it('should remove a vendor and return true', () => {
      const created = registry.registerVendor({ vertical: 'bike_rental', name: 'Bike Shop', contact: '+911111111111' });
      expect(registry.removeVendor(created.id)).to.be.true;
      expect(registry.getVendor(created.id)).to.be.null;
    });

    it('should return false for non-existent ID', () => {
      expect(registry.removeVendor('nonexistent')).to.be.false;
    });
  });
});

// ---------------------------------------------------------------------------
// NotificationService
// ---------------------------------------------------------------------------
describe('NotificationService', () => {
  let registry;
  let notifier;
  let bookingData;

  beforeEach(() => {
    registry = new VendorRegistry();
    notifier = new NotificationService(registry);
    bookingData = {
      referenceId: 'bk-001',
      phoneNumber: '+919999999999',
    };
  });

  describe('sendNotification', () => {
    it('should send a notification and return sent status', () => {
      const vendor = registry.registerVendor({ vertical: 'bike_rental', name: 'Bike Shop', contact: '+911111111111' });
      const result = notifier.sendNotification(vendor, { message: 'Test notification' });
      expect(result.success).to.be.true;
      expect(result.notificationId).to.exist;
      expect(result.vendorId).to.equal(vendor.id);
    });

    it('should record in history', () => {
      const vendor = registry.registerVendor({ vertical: 'bike_rental', name: 'Bike Shop', contact: '+911111111111' });
      notifier.sendNotification(vendor, { message: 'Test' });
      expect(notifier.getNotificationHistory()).to.have.length(1);
    });
  });

  describe('notifyVertical', () => {
    it('should send bike rental formatted notification', () => {
      registry.registerVendor({ vertical: 'bike_rental', name: 'Bike Shop', contact: '+911111111111' });
      const data = { ...bookingData, bikeModel: 'Hero Splendor', pickupDate: '2026-05-01', returnDate: '2026-05-03', idStatus: 'verified' };
      const results = notifier.notifyVertical('bike_rental', data);
      expect(results).to.have.length(1);
      expect(results[0].success).to.be.true;
      expect(results[0].message).to.include('Hero Splendor');
      expect(results[0].message).to.include('2026-05-01');
      expect(results[0].message).to.include('verified');
    });

    it('should send hotel formatted notification', () => {
      registry.registerVendor({ vertical: 'hotel', name: 'Hotel Grand', contact: 'hotel@example.com', channel: 'email' });
      const data = { ...bookingData, roomType: 'Deluxe', checkIn: '2026-05-10', checkOut: '2026-05-12', guestCount: 2, bookingRef: 'HTL-001' };
      const results = notifier.notifyVertical('hotel', data);
      expect(results).to.have.length(1);
      expect(results[0].message).to.include('Deluxe');
      expect(results[0].message).to.include('2026-05-10');
      expect(results[0].message).to.include('HTL-001');
    });

    it('should send taxi formatted notification', () => {
      registry.registerVendor({ vertical: 'taxi', name: 'Taxi Dispatch', contact: '+919999999999' });
      const data = { ...bookingData, pickupLocation: 'Hitech City', dropoffLocation: 'Gachibowli', pickupTime: '2026-05-01T10:00:00Z' };
      const results = notifier.notifyVertical('taxi', data);
      expect(results).to.have.length(1);
      expect(results[0].message).to.include('Hitech City');
      expect(results[0].message).to.include('Gachibowli');
      expect(results[0].message).to.include('10:00');
    });

    it('should send to multiple vendors in same vertical', () => {
      registry.registerVendor({ vertical: 'bike_rental', name: 'Bike Shop A', contact: '+911111111111' });
      registry.registerVendor({ vertical: 'bike_rental', name: 'Bike Shop B', contact: '+912222222222' });
      const results = notifier.notifyVertical('bike_rental', { ...bookingData, bikeModel: 'Hero', pickupDate: '2026-05-01', returnDate: '2026-05-03' });
      expect(results).to.have.length(2);
    });

    it('should return empty array if no vendors for vertical', () => {
      const results = notifier.notifyVertical('hotel', { ...bookingData });
      expect(results).to.have.length(0);
    });
  });

  describe('getNotificationHistory', () => {
    it('should return all sent notifications', () => {
      registry.registerVendor({ vertical: 'bike_rental', name: 'Bike Shop', contact: '+911111111111' });
      notifier.notifyVertical('bike_rental', { ...bookingData, bikeModel: 'Hero', pickupDate: '2026-05-01', returnDate: '2026-05-03' });
      expect(notifier.getNotificationHistory()).to.have.length(1);
    });

    it('should filter by vertical', () => {
      registry.registerVendor({ vertical: 'bike_rental', name: 'Bike Shop', contact: '+911111111111' });
      registry.registerVendor({ vertical: 'hotel', name: 'Hotel Grand', contact: '+912222222222', channel: 'email' });
      notifier.notifyVertical('bike_rental', { ...bookingData, bikeModel: 'Hero', pickupDate: '2026-05-01', returnDate: '2026-05-03' });
      notifier.notifyVertical('hotel', { ...bookingData, roomType: 'Deluxe', checkIn: '2026-05-10', checkOut: '2026-05-12' });
      const bikeHistory = notifier.getNotificationHistory({ vertical: 'bike_rental' });
      expect(bikeHistory).to.have.length(1);
    });
  });
});

// ---------------------------------------------------------------------------
// AcknowledgmentTracker
// ---------------------------------------------------------------------------
describe('AcknowledgmentTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = new AcknowledgmentTracker();
  });

  describe('recordAcknowledgment', () => {
    it('should mark notification as acknowledged', () => {
      const result = tracker.recordAcknowledgment('notif-1', 'vendor-1');
      expect(result.acknowledged).to.be.true;
      expect(result.notificationId).to.equal('notif-1');
      expect(result.vendorId).to.equal('vendor-1');
      expect(result).to.have.property('acknowledgedAt');
    });
  });

  describe('getAcknowledgmentStatus', () => {
    it('should return false for unacknowledged notification', () => {
      expect(tracker.getAcknowledgmentStatus('notif-1')).to.be.false;
    });

    it('should return true for acknowledged notification', () => {
      tracker.recordAcknowledgment('notif-1', 'vendor-1');
      expect(tracker.getAcknowledgmentStatus('notif-1')).to.be.true;
    });
  });

  describe('getPendingAcknowledgments', () => {
    it('should return notifications that are not acknowledged', () => {
      const notifications = [
        { notificationId: 'n1', vendorId: 'v1' },
        { notificationId: 'n2', vendorId: 'v2' },
        { notificationId: 'n3', vendorId: 'v3' },
      ];
      tracker.recordAcknowledgment('n2', 'v2');
      const pending = tracker.getPendingAcknowledgments(notifications);
      expect(pending).to.have.length(2);
      expect(pending.map(p => p.notificationId)).to.deep.equal(['n1', 'n3']);
    });
  });

  describe('getResponseTimeStats', () => {
    it('should return average response time for a vendor', () => {
      // Mock Date.now for deterministic test
      const clock = sinon.useFakeTimers();
      const n1 = tracker.recordAcknowledgment('notif-1', 'vendor-1');
      clock.tick(5000);
      const n2 = tracker.recordAcknowledgment('notif-2', 'vendor-1');
      clock.restore();

      const stats = tracker.getResponseTimeStats('vendor-1');
      expect(stats).to.have.property('totalAcknowledged', 2);
      expect(stats).to.have.property('averageResponseTimeMs');
      expect(stats.averageResponseTimeMs).to.be.at.least(0);
    });

    it('should return zeros for vendor with no acknowledgments', () => {
      const stats = tracker.getResponseTimeStats('unknown-vendor');
      expect(stats.totalAcknowledged).to.equal(0);
      expect(stats.averageResponseTimeMs).to.equal(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------
describe('Integration', () => {
  it('should complete full cycle: register vendor → send notification → acknowledge', () => {
    const registry = new VendorRegistry();
    const notifier = new NotificationService(registry);
    const tracker = new AcknowledgmentTracker();

    const vendor = registry.registerVendor({ vertical: 'bike_rental', name: 'Bike Shop', contact: '+911111111111' });
    expect(registry.getVendorsByVertical('bike_rental')).to.have.length(1);

    const data = { referenceId: 'bk-001', phoneNumber: '+919999999999', bikeModel: 'Hero Splendor', pickupDate: '2026-05-01', returnDate: '2026-05-03', idStatus: 'verified' };
    const results = notifier.notifyVertical('bike_rental', data);
    expect(results[0].success).to.be.true;

    const history = notifier.getNotificationHistory();
    const ack = tracker.recordAcknowledgment(history[0].notificationId, vendor.id);
    expect(ack.acknowledged).to.be.true;
    expect(tracker.getAcknowledgmentStatus(history[0].notificationId)).to.be.true;
  });

  it('should notify multiple vendors across a vertical', () => {
    const registry = new VendorRegistry();
    const notifier = new NotificationService(registry);

    registry.registerVendor({ vertical: 'taxi', name: 'Taxi Dispatch A', contact: '+911111111111' });
    registry.registerVendor({ vertical: 'taxi', name: 'Taxi Dispatch B', contact: '+912222222222' });

    const results = notifier.notifyVertical('taxi', {
      referenceId: 'tx-001', phoneNumber: '+919999999999',
      pickupLocation: 'Airport', dropoffLocation: 'City Center', pickupTime: '2026-05-01T14:00:00Z',
    });
    expect(results).to.have.length(2);
    expect(results.every(r => r.success)).to.be.true;
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('Edge cases', () => {
  it('should handle unknown notification channel', () => {
    const registry = new VendorRegistry();
    const notifier = new NotificationService(registry);
    const vendor = registry.registerVendor({ vertical: 'bike_rental', name: 'Test', contact: 'test@test.com', channel: 'unknown_channel' });
    const result = notifier.sendNotification(vendor, { message: 'Test' });
    expect(result.success).to.be.true; // Default to sending anyway
  });

  it('should handle notifyVertical with no vendors', () => {
    const registry = new VendorRegistry();
    const notifier = new NotificationService(registry);
    const results = notifier.notifyVertical('bike_rental', { referenceId: 'test' });
    expect(results).to.have.length(0);
  });

  it('should handle registering vendor without optional fields', () => {
    const registry = new VendorRegistry();
    const vendor = registry.registerVendor({ vertical: 'hotel', name: 'Hotel', contact: '+911111111111' });
    expect(vendor.active).to.be.true;
    expect(vendor.channel).to.equal('whatsapp');
  });
});

// ---------------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------------
describe('API endpoints', () => {
  describe('POST /api/vendors/register', () => {
    it('should register a vendor', async () => {
      const res = await request(app)
        .post('/api/vendors/register')
        .send({ vertical: 'bike_rental', name: 'Bike Shop', contact: '+918888888888', channel: 'whatsapp' });
      expect(res.status).to.equal(201);
      expect(res.body.data).to.have.property('id');
      expect(res.body.data.vertical).to.equal('bike_rental');
    });

    it('should return 400 for missing fields', async () => {
      const res = await request(app)
        .post('/api/vendors/register')
        .send({ vertical: 'bike_rental' });
      expect(res.status).to.equal(400);
    });
  });

  describe('GET /api/vendors', () => {
    it('should list all vendors', async () => {
      const res = await request(app).get('/api/vendors');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
    });
  });

  describe('GET /api/vendors/:id', () => {
    it('should return vendor by ID', async () => {
      const postRes = await request(app)
        .post('/api/vendors/register')
        .send({ vertical: 'hotel', name: 'Hotel Grand', contact: '+911111111111' });
      const id = postRes.body.data.id;

      const res = await request(app).get(`/api/vendors/${id}`);
      expect(res.status).to.equal(200);
      expect(res.body.data.id).to.equal(id);
    });

    it('should return 404 for non-existent ID', async () => {
      const res = await request(app).get('/api/vendors/nonexistent');
      expect(res.status).to.equal(404);
    });
  });

  describe('DELETE /api/vendors/:id', () => {
    it('should remove a vendor', async () => {
      const postRes = await request(app)
        .post('/api/vendors/register')
        .send({ vertical: 'taxi', name: 'Taxi Co', contact: '+911111111111' });
      const id = postRes.body.data.id;

      const res = await request(app).delete(`/api/vendors/${id}`);
      expect(res.status).to.equal(200);
      expect(res.body.data.removed).to.be.true;
    });
  });

  describe('POST /api/notifications/send', () => {
    it('should send a notification', async () => {
      const vendorRes = await request(app)
        .post('/api/vendors/register')
        .send({ vertical: 'bike_rental', name: 'Bike Shop', contact: '+911111111111' });
      const vendorId = vendorRes.body.data.id;

      const res = await request(app)
        .post('/api/notifications/send')
        .send({ vendorId, message: 'Test notification' });
      expect(res.status).to.equal(200);
      expect(res.body.data.success).to.be.true;
    });

    it('should return 404 for unknown vendor', async () => {
      const res = await request(app)
        .post('/api/notifications/send')
        .send({ vendorId: 'nonexistent', message: 'Test' });
      expect(res.status).to.equal(404);
    });
  });

  describe('POST /api/notifications/notify-vertical', () => {
    it('should notify all vendors in a vertical', async () => {
      await request(app)
        .post('/api/vendors/register')
        .send({ vertical: 'bike_rental', name: 'Bike Shop', contact: '+911111111111' });

      const res = await request(app)
        .post('/api/notifications/notify-vertical')
        .send({ vertical: 'bike_rental', bookingData: { referenceId: 'bk-001', phoneNumber: '+919999999999', bikeModel: 'Hero', pickupDate: '2026-05-01', returnDate: '2026-05-03' } });
      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
      expect(res.body.data.length).to.be.at.least(1);
    });
  });

  describe('GET /api/notifications/history', () => {
    it('should return notification history', async () => {
      const res = await request(app).get('/api/notifications/history');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
    });
  });

  describe('POST /api/notifications/:id/acknowledge', () => {
    it('should acknowledge a notification', async () => {
      // First send a notification
      const vendorRes = await request(app)
        .post('/api/vendors/register')
        .send({ vertical: 'bike_rental', name: 'Bike Shop', contact: '+911111111111' });
      const vendorId = vendorRes.body.data.id;

      const notifRes = await request(app)
        .post('/api/notifications/send')
        .send({ vendorId, message: 'Test' });
      const notifId = notifRes.body.data.notificationId;

      const res = await request(app)
        .post(`/api/notifications/${notifId}/acknowledge`)
        .send({ vendorId });
      expect(res.status).to.equal(200);
      expect(res.body.data.acknowledged).to.be.true;
    });
  });

  describe('GET /api/notifications/pending', () => {
    it('should return pending acknowledgments', async () => {
      const res = await request(app).get('/api/notifications/pending');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
    });
  });
});
