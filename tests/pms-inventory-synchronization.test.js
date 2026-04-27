process.env.MOCHA_TEST_MODE = 'true';
process.env.PMS_CACHE_TTL_MS = '30000';

const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');
const {
  app,
  PMSSimulator,
  InventoryCache,
  InventoryService,
} = require('../src/8-4-pms-inventory-synchronization');

// ---------------------------------------------------------------------------
// PMSSimulator
// ---------------------------------------------------------------------------
describe('PMSSimulator', () => {
  let pms;

  beforeEach(() => {
    pms = new PMSSimulator();
  });

  describe('queryAvailability', () => {
    it('should return available room types with counts', () => {
      const result = pms.queryAvailability('2026-05-10', '2026-05-12');
      expect(result).to.be.an('object');
      expect(result).to.have.property('standard');
      expect(result).to.have.property('deluxe');
      expect(result).to.have.property('suite');
      expect(result.standard).to.have.property('available');
      expect(result.standard).to.have.property('total');
      expect(result.standard).to.have.property('pricePerNight');
    });

    it('should return full inventory when no dates are booked', () => {
      const result = pms.queryAvailability('2026-05-10', '2026-05-12');
      expect(result.standard.available).to.equal(10);
      expect(result.deluxe.available).to.equal(5);
      expect(result.suite.available).to.equal(2);
    });

    it('should reflect bookings in availability', () => {
      pms.createBooking({ checkIn: '2026-05-10', checkOut: '2026-05-12', roomType: 'standard', guestName: 'Guest' });
      const result = pms.queryAvailability('2026-05-10', '2026-05-12');
      expect(result.standard.available).to.equal(9);
    });
  });

  describe('createBooking', () => {
    it('should create a booking and return reference', () => {
      const booking = pms.createBooking({ checkIn: '2026-05-10', checkOut: '2026-05-12', roomType: 'standard', guestName: 'John' });
      expect(booking).to.have.property('bookingId');
      expect(booking.roomType).to.equal('standard');
      expect(booking.guestName).to.equal('John');
    });

    it('should reject booking when no rooms available', () => {
      // Book all standard rooms for a date range
      for (let i = 0; i < 10; i++) {
        pms.createBooking({ checkIn: '2026-05-10', checkOut: '2026-05-12', roomType: 'standard', guestName: `Guest ${i}` });
      }
      expect(() => {
        pms.createBooking({ checkIn: '2026-05-10', checkOut: '2026-05-12', roomType: 'standard', guestName: 'Extra Guest' });
      }).to.throw();
    });

    it('should handle unknown room type', () => {
      expect(() => {
        pms.createBooking({ checkIn: '2026-05-10', checkOut: '2026-05-12', roomType: 'nonexistent', guestName: 'Guest' });
      }).to.throw();
    });
  });

  describe('cancelBooking', () => {
    it('should restore inventory on cancellation', () => {
      const booking = pms.createBooking({ checkIn: '2026-05-10', checkOut: '2026-05-12', roomType: 'standard', guestName: 'John' });
      expect(pms.queryAvailability('2026-05-10', '2026-05-12').standard.available).to.equal(9);
      pms.cancelBooking(booking.bookingId);
      expect(pms.queryAvailability('2026-05-10', '2026-05-12').standard.available).to.equal(10);
    });

    it('should throw for non-existent booking', () => {
      expect(() => pms.cancelBooking('nonexistent')).to.throw();
    });
  });

  describe('setAvailability', () => {
    it('should update total count for a room type', () => {
      pms.setAvailability('standard', 15);
      expect(pms.getInventorySnapshot().standard.total).to.equal(15);
    });
  });

  describe('getInventorySnapshot', () => {
    it('should return full inventory state', () => {
      const snapshot = pms.getInventorySnapshot();
      expect(snapshot).to.have.all.keys('standard', 'deluxe', 'suite');
      expect(snapshot.standard.total).to.equal(10);
    });
  });
});

// ---------------------------------------------------------------------------
// InventoryCache
// ---------------------------------------------------------------------------
describe('InventoryCache', () => {
  let cache;

  beforeEach(() => {
    cache = new InventoryCache(30000); // 30s TTL
  });

  describe('set / get', () => {
    it('should store and return value', () => {
      cache.set('key1', { data: 'test' });
      expect(cache.get('key1')).to.deep.equal({ data: 'test' });
    });

    it('should return null for non-existent key', () => {
      expect(cache.get('nonexistent')).to.be.null;
    });

    it('should return null for expired entry', () => {
      cache.set('key1', { data: 'test' });
      const clock = sinon.useFakeTimers(Date.now() + 60000);
      expect(cache.get('key1')).to.be.null;
      clock.restore();
    });

    it('should return value before expiry', () => {
      cache.set('key1', { data: 'test' });
      const clock = sinon.useFakeTimers(Date.now() + 15000);
      expect(cache.get('key1')).to.deep.equal({ data: 'test' });
      clock.restore();
    });
  });

  describe('isExpired', () => {
    it('should return true for expired entry', () => {
      const entry = { value: 'test', timestamp: Date.now() - 60000 };
      expect(cache.isExpired(entry)).to.be.true;
    });

    it('should return false for fresh entry', () => {
      const entry = { value: 'test', timestamp: Date.now() - 5000 };
      expect(cache.isExpired(entry)).to.be.false;
    });
  });

  describe('invalidate', () => {
    it('should clear a cached entry', () => {
      cache.set('key1', { data: 'test' });
      cache.invalidate('key1');
      expect(cache.get('key1')).to.be.null;
    });
  });
});

// ---------------------------------------------------------------------------
// InventoryService
// ---------------------------------------------------------------------------
describe('InventoryService', () => {
  let pms;
  let cache;
  let service;

  beforeEach(() => {
    pms = new PMSSimulator();
    cache = new InventoryCache(30000);
    service = new InventoryService(pms, cache);
  });

  describe('checkAvailability', () => {
    it('should return PMS data when healthy', () => {
      const result = service.checkAvailability('2026-05-10', '2026-05-12');
      expect(result.source).to.equal('pms');
      expect(result.cached).to.be.false;
      expect(result.rooms.standard.available).to.equal(10);
    });

    it('should return cached data on PMS failure', () => {
      // First query populates cache
      service.checkAvailability('2026-05-10', '2026-05-12');
      // Simulate PMS failure
      service.healthy = false;
      const result = service.checkAvailability('2026-05-10', '2026-05-12');
      expect(result.source).to.equal('cache');
      expect(result.cached).to.be.true;
      expect(result.rooms.standard.available).to.equal(10);
    });

    it('should return error when PMS down and no cache', () => {
      service.healthy = false;
      const result = service.checkAvailability('2026-05-10', '2026-05-12');
      expect(result.error).to.exist;
    });

    it('should track query stats', () => {
      service.checkAvailability('2026-05-10', '2026-05-12');
      service.checkAvailability('2026-05-15', '2026-05-17');
      expect(service.stats.totalQueries).to.equal(2);
    });

    it('should track cache hits', () => {
      service.checkAvailability('2026-05-10', '2026-05-12');
      service.healthy = false;
      service.checkAvailability('2026-05-10', '2026-05-12');
      expect(service.stats.cacheHits).to.equal(1);
    });
  });

  describe('bookRoom', () => {
    it('should book and invalidate cache', () => {
      service.checkAvailability('2026-05-10', '2026-05-12'); // populate cache
      const booking = service.bookRoom({ checkIn: '2026-05-10', checkOut: '2026-05-12', roomType: 'standard', guestName: 'John' });
      expect(booking).to.have.property('bookingId');

      // Cache should be invalidated
      expect(cache.get('availability:2026-05-10:2026-05-12')).to.be.null;
    });

    it('should return error when PMS down', () => {
      service.healthy = false;
      const result = service.bookRoom({ checkIn: '2026-05-10', checkOut: '2026-05-12', roomType: 'standard', guestName: 'John' });
      expect(result.error).to.exist;
    });
  });

  describe('syncInventory', () => {
    it('should refresh cache from PMS', () => {
      service.checkAvailability('2026-05-10', '2026-05-12'); // populate cache
      pms.createBooking({ checkIn: '2026-05-10', checkOut: '2026-05-12', roomType: 'standard', guestName: 'John' });
      service.syncInventory('2026-05-10', '2026-05-12');
      const result = cache.get('availability:2026-05-10:2026-05-12');
      expect(result.rooms.standard.available).to.equal(9);
    });
  });

  describe('getHealthStatus', () => {
    it('should report health and stats', () => {
      const status = service.getHealthStatus();
      expect(status).to.have.property('healthy', true);
      expect(status).to.have.property('stats');
      expect(status.stats).to.have.property('totalQueries');
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------
describe('Integration', () => {
  it('should complete full cycle: query → book → verify reduced → cancel → verify restored', () => {
    const pms = new PMSSimulator();
    const cache = new InventoryCache(30000);
    const service = new InventoryService(pms, cache);

    const initial = service.checkAvailability('2026-05-10', '2026-05-12');
    expect(initial.rooms.standard.available).to.equal(10);

    const booking = service.bookRoom({ checkIn: '2026-05-10', checkOut: '2026-05-12', roomType: 'standard', guestName: 'John' });

    // Refresh via sync
    service.syncInventory('2026-05-10', '2026-05-12');
    const afterBooking = cache.get('availability:2026-05-10:2026-05-12');
    expect(afterBooking.rooms.standard.available).to.equal(9);

    pms.cancelBooking(booking.bookingId);
    service.syncInventory('2026-05-10', '2026-05-12');
    const afterCancel = cache.get('availability:2026-05-10:2026-05-12');
    expect(afterCancel.rooms.standard.available).to.equal(10);
  });

  it('should handle PMS failure → cached data → recovery', () => {
    const pms = new PMSSimulator();
    const cache = new InventoryCache(30000);
    const service = new InventoryService(pms, cache);

    // Initial query populates cache
    service.checkAvailability('2026-05-10', '2026-05-12');

    // PMS fails
    service.healthy = false;
    const cachedResult = service.checkAvailability('2026-05-10', '2026-05-12');
    expect(cachedResult.cached).to.be.true;
    expect(cachedResult.source).to.equal('cache');

    // PMS recovers
    service.healthy = true;
    const freshResult = service.checkAvailability('2026-05-10', '2026-05-12');
    expect(freshResult.cached).to.be.false;
    expect(freshResult.source).to.equal('pms');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('Edge cases', () => {
  it('should handle full house scenario', () => {
    const pms = new PMSSimulator();
    for (let i = 0; i < 2; i++) {
      pms.createBooking({ checkIn: '2026-05-10', checkOut: '2026-05-12', roomType: 'suite', guestName: `Guest ${i}` });
    }
    const result = pms.queryAvailability('2026-05-10', '2026-05-12');
    expect(result.suite.available).to.equal(0);
  });

  it('should reject booking more rooms than available', () => {
    const pms = new PMSSimulator();
    for (let i = 0; i < 10; i++) {
      pms.createBooking({ checkIn: '2026-05-10', checkOut: '2026-05-12', roomType: 'standard', guestName: `Guest ${i}` });
    }
    expect(() => {
      pms.createBooking({ checkIn: '2026-05-10', checkOut: '2026-05-12', roomType: 'standard', guestName: 'Extra' });
    }).to.throw();
  });

  it('should handle empty cache gracefully', () => {
    const cache = new InventoryCache(30000);
    expect(cache.get('nonexistent')).to.be.null;
  });
});

// ---------------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------------
describe('API endpoints', () => {
  describe('GET /api/pms/availability', () => {
    it('should return room availability', async () => {
      const res = await request(app)
        .get('/api/pms/availability')
        .query({ checkIn: '2026-05-10', checkOut: '2026-05-12' });
      expect(res.status).to.equal(200);
      expect(res.body.data.rooms).to.have.property('standard');
      expect(res.body.data.rooms).to.have.property('deluxe');
      expect(res.body.data.rooms).to.have.property('suite');
    });

    it('should return 400 without dates', async () => {
      const res = await request(app).get('/api/pms/availability');
      expect(res.status).to.equal(400);
    });
  });

  describe('POST /api/pms/booking', () => {
    it('should create a booking', async () => {
      const res = await request(app)
        .post('/api/pms/booking')
        .send({ checkIn: '2026-05-10', checkOut: '2026-05-12', roomType: 'standard', guestName: 'John' });
      expect(res.status).to.equal(201);
      expect(res.body.data).to.have.property('bookingId');
    });

    it('should return 400 for missing fields', async () => {
      const res = await request(app)
        .post('/api/pms/booking')
        .send({ checkIn: '2026-05-10' });
      expect(res.status).to.equal(400);
    });

    it('should return 400 when no rooms available', async () => {
      // Book all standard rooms first
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/api/pms/booking')
          .send({ checkIn: '2026-05-10', checkOut: '2026-05-12', roomType: 'standard', guestName: `Guest ${i}` });
      }
      const res = await request(app)
        .post('/api/pms/booking')
        .send({ checkIn: '2026-05-10', checkOut: '2026-05-12', roomType: 'standard', guestName: 'Extra' });
      expect(res.status).to.equal(400);
    });
  });

  describe('POST /api/pms/cancel', () => {
    it('should cancel a booking', async () => {
      const bookRes = await request(app)
        .post('/api/pms/booking')
        .send({ checkIn: '2026-05-10', checkOut: '2026-05-12', roomType: 'suite', guestName: 'John' });
      expect(bookRes.status).to.equal(201);
      const bookingId = bookRes.body.data.bookingId;

      const res = await request(app)
        .post('/api/pms/cancel')
        .send({ bookingId });
      expect(res.status).to.equal(200);
      expect(res.body.data.cancelled).to.be.true;
    });

    it('should return 400 for non-existent booking', async () => {
      const res = await request(app)
        .post('/api/pms/cancel')
        .send({ bookingId: 'nonexistent' });
      expect(res.status).to.equal(400);
    });
  });

  describe('GET /api/pms/inventory', () => {
    it('should return inventory snapshot', async () => {
      const res = await request(app).get('/api/pms/inventory');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.all.keys('standard', 'deluxe', 'suite');
    });
  });

  describe('POST /api/pms/sync', () => {
    it('should force sync inventory', async () => {
      const res = await request(app)
        .post('/api/pms/sync')
        .send({ checkIn: '2026-05-10', checkOut: '2026-05-12' });
      expect(res.status).to.equal(200);
      expect(res.body.data.synced).to.be.true;
    });
  });

  describe('GET /api/pms/health', () => {
    it('should return PMS health status', async () => {
      const res = await request(app).get('/api/pms/health');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.property('healthy');
      expect(res.body.data).to.have.property('stats');
    });
  });
});
