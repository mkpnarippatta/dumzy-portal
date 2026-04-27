require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// PMSSimulator — mock PMS backend
// ---------------------------------------------------------------------------
class PMSSimulator {
  constructor() {
    this.inventory = {
      standard: { total: 10, pricePerNight: 2500, booked: {} },
      deluxe: { total: 5, pricePerNight: 4500, booked: {} },
      suite: { total: 2, pricePerNight: 8000, booked: {} },
    };
    this.bookings = [];
    this._counter = 0;
  }

  _dateRangeArray(checkIn, checkOut) {
    const dates = [];
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  }

  _getBookedCount(roomType, checkIn, checkOut) {
    const dates = this._dateRangeArray(checkIn, checkOut);
    let maxBooked = 0;
    for (const date of dates) {
      const count = (this.inventory[roomType]?.booked[date] || 0);
      if (count > maxBooked) maxBooked = count;
    }
    return maxBooked;
  }

  queryAvailability(checkIn, checkOut) {
    const result = {};
    for (const [type, info] of Object.entries(this.inventory)) {
      const booked = this._getBookedCount(type, checkIn, checkOut);
      result[type] = {
        total: info.total,
        available: info.total - booked,
        pricePerNight: info.pricePerNight,
      };
    }
    return result;
  }

  createBooking({ checkIn, checkOut, roomType, guestName }) {
    if (!this.inventory[roomType]) {
      throw new Error(`Unknown room type: ${roomType}`);
    }
    const booked = this._getBookedCount(roomType, checkIn, checkOut);
    if (booked >= this.inventory[roomType].total) {
      throw new Error(`No ${roomType} rooms available for the requested dates`);
    }

    this._counter++;
    const bookingId = `pms-booking-${Date.now()}-${this._counter}`;
    const booking = { bookingId, checkIn, checkOut, roomType, guestName, createdAt: new Date().toISOString() };
    this.bookings.push(booking);

    // Record booking per date
    const dates = this._dateRangeArray(checkIn, checkOut);
    for (const date of dates) {
      if (!this.inventory[roomType].booked[date]) {
        this.inventory[roomType].booked[date] = 0;
      }
      this.inventory[roomType].booked[date]++;
    }

    return { ...booking };
  }

  cancelBooking(bookingId) {
    const index = this.bookings.findIndex(b => b.bookingId === bookingId);
    if (index === -1) {
      throw new Error(`Booking not found: ${bookingId}`);
    }
    const booking = this.bookings[index];
    this.bookings.splice(index, 1);

    const dates = this._dateRangeArray(booking.checkIn, booking.checkOut);
    for (const date of dates) {
      if (this.inventory[booking.roomType]?.booked[date]) {
        this.inventory[booking.roomType].booked[date]--;
      }
    }

    return { cancelled: true, bookingId };
  }

  setAvailability(roomType, total) {
    if (!this.inventory[roomType]) {
      throw new Error(`Unknown room type: ${roomType}`);
    }
    this.inventory[roomType].total = total;
  }

  getInventorySnapshot() {
    const snapshot = {};
    for (const [type, info] of Object.entries(this.inventory)) {
      snapshot[type] = {
        total: info.total,
        pricePerNight: info.pricePerNight,
        booked: { ...info.booked },
      };
    }
    return snapshot;
  }
}

// ---------------------------------------------------------------------------
// InventoryCache — TTL-based availability cache
// ---------------------------------------------------------------------------
class InventoryCache {
  constructor(ttlMs = 30000) {
    this.cache = {};
    this.ttlMs = ttlMs || parseInt(process.env.PMS_CACHE_TTL_MS, 10) || 30000;
  }

  get(key) {
    const entry = this.cache[key];
    if (!entry) return null;
    if (this.isExpired(entry)) {
      delete this.cache[key];
      return null;
    }
    return entry.value;
  }

  set(key, value) {
    this.cache[key] = { value, timestamp: Date.now() };
  }

  invalidate(key) {
    delete this.cache[key];
  }

  isExpired(entry) {
    return Date.now() - entry.timestamp > this.ttlMs;
  }
}

// ---------------------------------------------------------------------------
// InventoryService — composed PMS + cache
// ---------------------------------------------------------------------------
class InventoryService {
  constructor(pmsSimulator, cache) {
    this.pms = pmsSimulator;
    this.cache = cache;
    this.healthy = true;
    this.stats = { totalQueries: 0, cacheHits: 0, pmsFailures: 0 };
  }

  checkAvailability(checkIn, checkOut) {
    this.stats.totalQueries++;
    const cacheKey = `availability:${checkIn}:${checkOut}`;

    if (this.healthy) {
      try {
        const rooms = this.pms.queryAvailability(checkIn, checkOut);
        this.cache.set(cacheKey, { rooms, checkIn, checkOut });
        return { source: 'pms', cached: false, rooms };
      } catch (error) {
        this.stats.pmsFailures++;
        this.healthy = false;
      }
    }

    // Try cache fallback
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.stats.cacheHits++;
      return { source: 'cache', cached: true, rooms: cached.rooms };
    }

    return { source: 'error', error: 'PMS unavailable and no cached data available. Please try again.' };
  }

  bookRoom({ checkIn, checkOut, roomType, guestName }) {
    if (!this.healthy) {
      return { error: 'PMS is currently unavailable. Please try again later.' };
    }
    try {
      const booking = this.pms.createBooking({ checkIn, checkOut, roomType, guestName });
      // Invalidate affected cache entries
      this.cache.invalidate(`availability:${checkIn}:${checkOut}`);
      return booking;
    } catch (error) {
      return { error: error.message };
    }
  }

  syncInventory(checkIn, checkOut) {
    const cacheKey = `availability:${checkIn}:${checkOut}`;
    const rooms = this.pms.queryAvailability(checkIn, checkOut);
    this.cache.set(cacheKey, { rooms, checkIn, checkOut });
    return { synced: true, checkIn, checkOut };
  }

  getHealthStatus() {
    return {
      healthy: this.healthy,
      stats: { ...this.stats },
    };
  }
}

// ---------------------------------------------------------------------------
// Module-level instances
// ---------------------------------------------------------------------------
const pmsSimulator = new PMSSimulator();
const inventoryCache = new InventoryCache();
const inventoryService = new InventoryService(pmsSimulator, inventoryCache);

// ---------------------------------------------------------------------------
// Express API Routes
// ---------------------------------------------------------------------------

// GET /api/pms/availability — check room availability
app.get('/api/pms/availability', (req, res) => {
  try {
    const { checkIn, checkOut } = req.query;
    if (!checkIn || !checkOut) {
      return res.status(400).json({
        error: { message: 'checkIn and checkOut are required', code: 400 },
      });
    }
    const result = inventoryService.checkAvailability(checkIn, checkOut);
    if (result.error) {
      return res.status(503).json({
        error: { message: result.error, code: 503 },
      });
    }
    res.json({
      data: result,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to check availability', code: 500, details: error.message },
    });
  }
});

// POST /api/pms/booking — create a booking
app.post('/api/pms/booking', (req, res) => {
  try {
    const { checkIn, checkOut, roomType, guestName } = req.body;
    if (!checkIn || !checkOut || !roomType || !guestName) {
      return res.status(400).json({
        error: { message: 'checkIn, checkOut, roomType, and guestName are required', code: 400 },
      });
    }
    const result = inventoryService.bookRoom({ checkIn, checkOut, roomType, guestName });
    if (result.error) {
      return res.status(400).json({
        error: { message: result.error, code: 400 },
      });
    }
    res.status(201).json({
      data: result,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to create booking', code: 500, details: error.message },
    });
  }
});

// POST /api/pms/cancel — cancel a booking
app.post('/api/pms/cancel', (req, res) => {
  try {
    const { bookingId } = req.body;
    if (!bookingId) {
      return res.status(400).json({
        error: { message: 'bookingId is required', code: 400 },
      });
    }
    const result = pmsSimulator.cancelBooking(bookingId);
    res.json({
      data: result,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(400).json({
      error: { message: error.message, code: 400 },
    });
  }
});

// GET /api/pms/inventory — get inventory snapshot
app.get('/api/pms/inventory', (req, res) => {
  try {
    const snapshot = pmsSimulator.getInventorySnapshot();
    res.json({
      data: snapshot,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get inventory', code: 500, details: error.message },
    });
  }
});

// POST /api/pms/sync — force sync inventory
app.post('/api/pms/sync', (req, res) => {
  try {
    const { checkIn, checkOut } = req.body;
    if (!checkIn || !checkOut) {
      return res.status(400).json({
        error: { message: 'checkIn and checkOut are required', code: 400 },
      });
    }
    const result = inventoryService.syncInventory(checkIn, checkOut);
    res.json({
      data: result,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to sync inventory', code: 500, details: error.message },
    });
  }
});

// GET /api/pms/health — get PMS health status
app.get('/api/pms/health', (req, res) => {
  try {
    const status = inventoryService.getHealthStatus();
    res.json({
      data: status,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get health status', code: 500, details: error.message },
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
const PORT = process.env.PORT || process.env.PMS_PORT || 3015;
if (process.env.MOCHA_TEST_MODE !== 'true') {
  app.listen(PORT, () => {
    console.log(`PMS Inventory Synchronization service running on port ${PORT}`);
  });
}

module.exports = {
  app,
  PMSSimulator,
  InventoryCache,
  InventoryService,
};
