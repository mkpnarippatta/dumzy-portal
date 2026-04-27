require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// RoutingService — intent-to-backend mapping with data transformation
// ---------------------------------------------------------------------------
class RoutingService {
  constructor() {
    this.routes = {
      bike_rental: { system: 'erpnext_rental', endpoint: '/api/erpnext/rental/book' },
      hotel: { system: 'pms', endpoint: '/api/pms/availability' },
      taxi: { system: 'erpnext_crm', endpoint: '/api/erpnext/crm/lead' },
      ticketing: { system: 'erpnext_crm', endpoint: '/api/erpnext/crm/lead' },
      social_media: { system: 'erpnext_crm', endpoint: '/api/erpnext/crm/lead' },
    };

    this.transformers = {
      bike_rental: (data) => ({
        customer_phone: data.phoneNumber,
        bike_model: data.bikeModel,
        pickup_date: data.pickupDate,
        return_date: data.returnDate,
        id_document: data.idDocument || null,
      }),
      hotel: (data) => ({
        check_in: data.checkIn,
        check_out: data.checkOut,
        guests: data.guestCount || 1,
        room_type: data.roomType || 'standard',
      }),
      taxi: (data) => ({
        customer_phone: data.phoneNumber,
        pickup_location: data.pickupLocation,
        dropoff_location: data.dropoffLocation,
        pickup_time: data.pickupTime,
      }),
      ticketing: (data) => ({
        customer_phone: data.phoneNumber,
        event_type: data.eventType,
        ticket_count: data.ticketCount || 1,
      }),
      social_media: (data) => ({
        customer_phone: data.phoneNumber,
        platform: data.platform,
        enquiry_type: data.enquiryType,
      }),
    };

    this._requiredFields = {
      bike_rental: ['phoneNumber', 'bikeModel', 'pickupDate', 'returnDate'],
      hotel: ['checkIn', 'checkOut'],
      taxi: ['phoneNumber', 'pickupLocation', 'dropoffLocation'],
      ticketing: ['phoneNumber'],
      social_media: ['phoneNumber', 'platform'],
    };
  }

  routeByIntent(intent) {
    const route = this.routes[intent];
    if (!route) {
      throw new Error(`Unknown intent: ${intent}. Valid intents: ${Object.keys(this.routes).join(', ')}`);
    }
    return { ...route };
  }

  route(intent, payload) {
    const route = this.routeByIntent(intent);

    const required = this._requiredFields[intent] || [];
    for (const field of required) {
      if (payload[field] === undefined || payload[field] === null) {
        throw new Error(`Missing required field: ${field} for intent: ${intent}`);
      }
    }

    const transform = this.transformers[intent];
    const transformedData = transform ? transform(payload) : { ...payload };

    return {
      intent,
      system: route.system,
      endpoint: route.endpoint,
      transformedData,
    };
  }

  getRouteConfig() {
    return { ...this.routes };
  }
}

// ---------------------------------------------------------------------------
// BackendSimulator — mock backend endpoints for testing
// ---------------------------------------------------------------------------
class BackendSimulator {
  constructor() {
    this._failMode = false;
    this.stats = { totalRequests: 0, successCount: 0, failureCount: 0 };
    this._backends = {
      erpnext_crm: { leads: [] },
      erpnext_rental: { bookings: [] },
      pms: { queries: [] },
    };
  }

  setFailMode(enabled) {
    this._failMode = enabled;
  }

  simulateCall(system, data) {
    if (!this._backends[system]) {
      throw new Error(`Unknown backend system: ${system}`);
    }

    this.stats.totalRequests++;

    if (this._failMode) {
      this.stats.failureCount++;
      return { success: false, system, error: 'Backend temporarily unavailable' };
    }

    this.stats.successCount++;
    let result;

    switch (system) {
      case 'erpnext_crm': {
        const leadId = `erpnext-crm-${Date.now()}-${this.stats.successCount}`;
        this._backends.erpnext_crm.leads.push({ id: leadId, ...data });
        result = { success: true, system, referenceId: leadId, status: 'lead_created', vertical: data.vertical || 'general' };
        break;
      }
      case 'erpnext_rental': {
        const bookingId = `erpnext-rental-${Date.now()}-${this.stats.successCount}`;
        this._backends.erpnext_rental.bookings.push({ id: bookingId, ...data });
        result = { success: true, system, referenceId: bookingId, status: 'booking_created' };
        break;
      }
      case 'pms': {
        const queryId = `pms-${Date.now()}-${this.stats.successCount}`;
        this._backends.pms.queries.push({ id: queryId, ...data });
        result = {
          success: true,
          system,
          referenceId: queryId,
          status: 'availability_checked',
          availableRooms: [
            { type: 'standard', count: 5, pricePerNight: 2500 },
            { type: 'deluxe', count: 3, pricePerNight: 4500 },
            { type: 'suite', count: 1, pricePerNight: 8000 },
          ],
        };
        break;
      }
      default:
        result = { success: true, system };
    }

    return result;
  }

  getStats() {
    return { ...this.stats };
  }

  getBackendData(system) {
    return this._backends[system] ? { ...this._backends[system] } : null;
  }

  reset() {
    this.stats = { totalRequests: 0, successCount: 0, failureCount: 0 };
    this._backends = {
      erpnext_crm: { leads: [] },
      erpnext_rental: { bookings: [] },
      pms: { queries: [] },
    };
    this._failMode = false;
  }
}

// ---------------------------------------------------------------------------
// RetryQueue — queued retry with exponential backoff
// ---------------------------------------------------------------------------
class RetryQueue {
  constructor(options = {}) {
    this.queue = [];
    this.maxRetries = options.maxRetries || parseInt(process.env.ROUTING_MAX_RETRIES, 10) || 3;
    this.baseDelay = options.baseDelay || parseInt(process.env.ROUTING_BASE_DELAY_MS, 10) || 1000;
    this.processing = false;
    this._totalFailed = 0;
  }

  enqueue(item) {
    this.queue.push({
      ...item,
      retryCount: 0,
      timestamp: new Date().toISOString(),
      lastError: null,
    });
  }

  async processQueue(handler) {
    if (this.processing) return { processed: 0, failed: 0 };
    this.processing = true;

    const items = [...this.queue];
    this.queue = [];
    let processed = 0;
    let failed = 0;

    for (const item of items) {
      try {
        await handler(item);
        processed++;
      } catch (error) {
        if (item.retryCount < this.maxRetries) {
          this.queue.push({
            ...item,
            retryCount: item.retryCount + 1,
            lastError: error.message,
            lastAttempt: new Date().toISOString(),
          });
        } else {
          this._totalFailed++;
          failed++;
        }
      }
    }

    this.processing = false;
    return { processed, failed };
  }

  getQueueStatus() {
    return {
      depth: this.queue.length,
      pending: this.queue.filter(i => i.retryCount < this.maxRetries).length,
      totalFailed: this._totalFailed,
    };
  }

  clearQueue() {
    this.queue = [];
    this._totalFailed = 0;
  }
}

// ---------------------------------------------------------------------------
// Module-level instances
// ---------------------------------------------------------------------------
const router = new RoutingService();
const simulator = new BackendSimulator();
const retryQueue = new RetryQueue();

// ---------------------------------------------------------------------------
// Express API Routes
// ---------------------------------------------------------------------------

// POST /api/routing/route — route an enquiry by intent
app.post('/api/routing/route', (req, res) => {
  try {
    const { intent, payload } = req.body;

    if (!intent) {
      return res.status(400).json({
        error: { message: 'intent is required', code: 400 },
      });
    }
    if (!payload) {
      return res.status(400).json({
        error: { message: 'payload is required', code: 400 },
      });
    }

    const routeResult = router.route(intent, payload);
    const backendResult = simulator.simulateCall(routeResult.system, routeResult.transformedData);

    if (!backendResult.success) {
      retryQueue.enqueue({ intent, payload, system: routeResult.system, transformedData: routeResult.transformedData });
    }

    res.json({
      data: {
        ...routeResult,
        backendResult,
      },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    if (error.message && error.message.startsWith('Unknown intent')) {
      return res.status(400).json({
        error: { message: error.message, code: 400 },
      });
    }
    if (error.message && error.message.startsWith('Missing required field')) {
      return res.status(400).json({
        error: { message: error.message, code: 400 },
      });
    }
    res.status(500).json({
      error: { message: 'Routing failed', code: 500, details: error.message },
    });
  }
});

// GET /api/routing/config — view routing configuration
app.get('/api/routing/config', (req, res) => {
  try {
    const config = router.getRouteConfig();
    res.json({
      data: config,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get config', code: 500, details: error.message },
    });
  }
});

// GET /api/routing/status — view backend health and stats
app.get('/api/routing/status', (req, res) => {
  try {
    res.json({
      data: {
        stats: simulator.getStats(),
        backends: {
          erpnext_crm: { data: simulator.getBackendData('erpnext_crm') },
          erpnext_rental: { data: simulator.getBackendData('erpnext_rental') },
          pms: { data: simulator.getBackendData('pms') },
        },
      },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get status', code: 500, details: error.message },
    });
  }
});

// GET /api/routing/queue — view retry queue status
app.get('/api/routing/queue', (req, res) => {
  try {
    const status = retryQueue.getQueueStatus();
    res.json({
      data: status,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get queue status', code: 500, details: error.message },
    });
  }
});

// POST /api/routing/queue/process — manually trigger queue processing
app.post('/api/routing/queue/process', (req, res) => {
  try {
    const handler = async (item) => {
      const result = simulator.simulateCall(item.system, item.transformedData);
      if (!result.success) throw new Error(result.error);
      return result;
    };

    retryQueue.processQueue(handler).then(result => {
      res.json({
        data: result,
        meta: { timestamp: Date.now() },
      });
    }).catch(error => {
      res.status(500).json({
        error: { message: 'Queue processing failed', code: 500, details: error.message },
      });
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to process queue', code: 500, details: error.message },
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
const PORT = process.env.PORT || process.env.ROUTING_PORT || 3012;
if (process.env.MOCHA_TEST_MODE !== 'true') {
  app.listen(PORT, () => {
    console.log(`Backend System Routing service running on port ${PORT}`);
  });
}

module.exports = {
  app,
  RoutingService,
  BackendSimulator,
  RetryQueue,
};
