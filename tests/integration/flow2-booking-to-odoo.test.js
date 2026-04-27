require('../helpers/setup');
const { expect } = require('chai');
const request = require('supertest');
const { app: app3_2, BikeAvailabilityService, BikeBookingService } = require('../../src/3-2-bike-rental-booking-flow');
const { app: app8_4, PMSSimulator, InventoryCache, InventoryService } = require('../../src/8-4-pms-inventory-synchronization');
const { app: app8_3, NotificationService, VendorRegistry } = require('../../src/8-3-vendor-notification-system');
const { app: app8_2, LeadManager, LeadAnalytics } = require('../../src/8-2-erpnext-lead-management');
const { bookingData } = require('../helpers/fixtures');

describe('Flow 2: Bike Rental Booking → PMS Sync → Vendor Notification → ERPNext Lead', () => {
  describe('Step 1: Bike availability check via 3-2', () => {
    it('Returns availability for all bike models', async () => {
      const res = await request(app3_2)
        .get('/api/bike/availability')
        .query({ pickup_date: '2026-05-01', return_date: '2026-05-03' });

      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
      expect(res.body.data.length).to.be.at.least(1);
    });
  });

  describe('Step 2: Booking creation via 3-2', () => {
    it('Creates booking successfully', async () => {
      const data = bookingData();
      const res = await request(app3_2)
        .post('/api/bike/booking')
        .send(data);

      expect(res.status).to.equal(201);
      expect(res.body.data.id).to.exist;
      expect(res.body.data.status).to.equal('confirmed');
    });

    it('Rejects booking with missing fields', async () => {
      const res = await request(app3_2)
        .post('/api/bike/booking')
        .send({});

      expect(res.status).to.equal(400);
    });
  });

  describe('Step 3: PMS inventory via 8-4', () => {
    it('PMSSimulator creates booking and reduces availability', () => {
      const simulator = new PMSSimulator();
      const before = simulator.queryAvailability('2026-05-01', '2026-05-03');

      const result = simulator.createBooking({
        roomType: 'standard',
        checkIn: '2026-05-01',
        checkOut: '2026-05-03',
        guestName: 'Test User',
      });

      expect(result.bookingId).to.exist;

      const after = simulator.queryAvailability('2026-05-01', '2026-05-03');
      expect(after.standard.available).to.equal(before.standard.available - 1);
    });

    it('Inventory cache stores and invalidates entries', () => {
      const cache = new InventoryCache(30000);
      cache.set('room-standard', { available: 5 });

      expect(cache.get('room-standard').available).to.equal(5);

      cache.invalidate('room-standard');
      expect(cache.get('room-standard')).to.be.null;
    });

    it('HTTP sync endpoint accessible', async () => {
      const res = await request(app8_4)
        .post('/api/pms/sync')
        .send({ roomType: 'deluxe', checkIn: '2026-05-01', checkOut: '2026-05-03', quantity: 1 });

      expect(res.status).to.equal(200);
    });
  });

  describe('Step 4: Vendor notification via 8-3', () => {
    it('NotificationService sends formatted message for bike rental', () => {
      const registry = new VendorRegistry();
      const vendor = registry.registerVendor({
        vertical: 'Bike Rental',
        name: 'Bike Rental Vendor',
        contact: { phone: '+919999999999', email: 'vendor@example.com' },
        channel: 'whatsapp',
        active: true,
      });

      const notifier = new NotificationService(registry);
      const result = notifier.sendNotification(vendor, {
        message: 'New booking: Hero bike for May 1-3',
      });

      expect(result.success).to.be.true;
      expect(result.notificationId).to.exist;
    });

    it('Tracks success flag for vendor accountability', () => {
      const registry = new VendorRegistry();
      const vendor = registry.registerVendor({
        vertical: 'Bike Rental',
        name: 'Bike Vendor',
        contact: { phone: '+919999999999' },
        channel: 'whatsapp',
        active: true,
      });

      const notifier = new NotificationService(registry);
      const result = notifier.sendNotification(vendor, {
        message: 'New booking for Apr 30',
      });

      expect(result.success).to.be.true;
    });

    it('HTTP notification endpoint returns notification', async () => {
      // First register a vendor to get a valid ID
      const regRes = await request(app8_3)
        .post('/api/vendors/register')
        .send({
          vertical: 'Bike Rental',
          name: 'Bike HTTP Vendor',
          contact: { phone: '+919999999999' },
          channel: 'whatsapp',
          active: true,
        });

      expect(regRes.status).to.equal(201);
      const vendorId = regRes.body.data.id;

      const res = await request(app8_3)
        .post('/api/notifications/send')
        .send({
          vendorId,
          message: 'Booking confirmation needed',
        });

      expect(res.status).to.equal(200);
    });
  });

  describe('Step 5: ERPNext lead via 8-2', () => {
    it('LeadManager creates lead with correct vertical', () => {
      const manager = new LeadManager();
      const lead = manager.createLead({
        vertical: 'bike_rental',
        phoneNumber: '+91987654321',
        intent: 'Bike rental booking for weekend',
        source: 'whatsapp',
      });

      expect(lead.id).to.exist;
      expect(lead.vertical).to.equal('bike_rental');
      expect(lead.status).to.equal('New');
    });

    it('Enforces valid status transitions', () => {
      const manager = new LeadManager();
      const lead = manager.createLead({
        vertical: 'hotel',
        phoneNumber: '+91987654321',
        intent: 'Hotel booking',
        source: 'whatsapp',
      });

      const updated = manager.updateLeadStatus(lead.id, 'InProgress');
      expect(updated.status).to.equal('InProgress');

      expect(() => manager.updateLeadStatus(lead.id, 'Booked')).to.throw();
    });

    it('HTTP endpoint creates lead and returns with id', async () => {
      const res = await request(app8_2)
        .post('/api/erpnext/leads')
        .send({
          vertical: 'bike_rental',
          phoneNumber: '+91987654321',
          intent: 'Weekend bike rental',
          source: 'whatsapp',
        });

      expect(res.status).to.equal(201);
      expect(res.body.data.id).to.exist;
      expect(res.body.data.status).to.equal('New');
    });
  });

  describe('Edge cases', () => {
    it('Rejects past pickup date', async () => {
      const data = bookingData({ pickup_date: '2020-01-01', return_date: '2020-01-03' });
      const res = await request(app3_2)
        .post('/api/bike/booking')
        .send(data);

      expect(res.status).to.equal(400);
      expect(res.body.error.validation_errors).to.be.an('array');
    });

    it('Rejects return date before pickup', async () => {
      const data = bookingData({ pickup_date: '2026-05-10', return_date: '2026-05-09' });
      const res = await request(app3_2)
        .post('/api/bike/booking')
        .send(data);

      expect(res.status).to.equal(400);
    });

    it('Returns no availability for unavailable bike model', async () => {
      const res = await request(app3_2)
        .get('/api/bike/availability')
        .query({ pickup_date: '2026-05-01', return_date: '2026-05-03', bike_model: 'NonExistent' });

      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array').that.is.empty;
    });

    it('Returns 404 for notification to unknown vendor', async () => {
      const res = await request(app8_3)
        .post('/api/notifications/send')
        .send({ vendorId: 'nonexistent-vendor', message: 'test' });

      expect(res.status).to.equal(404);
    });

    it('Rejects ERPNext lead with missing fields', async () => {
      const res = await request(app8_2)
        .post('/api/erpnext/leads')
        .send({});

      expect(res.status).to.equal(400);
    });
  });
});
