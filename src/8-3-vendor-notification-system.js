require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// VendorRegistry — vendor contact management per vertical
// ---------------------------------------------------------------------------
class VendorRegistry {
  constructor() {
    this.vendors = [];
    this._counter = 0;
  }

  registerVendor({ vertical, name, contact, channel, active }) {
    this._counter++;
    const vendor = {
      id: `vendor-${Date.now()}-${this._counter}`,
      vertical,
      name,
      contact,
      channel: channel || 'whatsapp',
      active: active !== undefined ? active : true,
      registeredAt: new Date().toISOString(),
    };
    this.vendors.push(vendor);
    return { ...vendor };
  }

  getVendorsByVertical(vertical) {
    return this.vendors.filter(v => v.vertical === vertical && v.active);
  }

  getVendor(id) {
    const vendor = this.vendors.find(v => v.id === id);
    return vendor ? { ...vendor } : null;
  }

  removeVendor(id) {
    const index = this.vendors.findIndex(v => v.id === id);
    if (index === -1) return false;
    this.vendors.splice(index, 1);
    return true;
  }
}

// ---------------------------------------------------------------------------
// NotificationService — send notifications to vendors
// ---------------------------------------------------------------------------
class NotificationService {
  constructor(vendorRegistry) {
    this.vendorRegistry = vendorRegistry;
    this.history = [];
    this._counter = 0;
    this.channels = { whatsapp: true, email: true, sms: true };
  }

  sendNotification(vendor, content) {
    this._counter++;
    const notification = {
      notificationId: `notif-${Date.now()}-${this._counter}`,
      vendorId: vendor.id,
      vendorName: vendor.name,
      vertical: vendor.vertical,
      channel: vendor.channel,
      contact: vendor.contact,
      message: content.message || '',
      sentAt: new Date().toISOString(),
      success: true,
    };
    this.history.push(notification);
    return { ...notification };
  }

  notifyVertical(vertical, bookingData) {
    const vendors = this.vendorRegistry.getVendorsByVertical(vertical);
    const results = [];

    for (const vendor of vendors) {
      const message = this._formatMessage(vertical, bookingData);
      const result = this.sendNotification(vendor, { message });
      results.push(result);
    }

    return results;
  }

  _formatMessage(vertical, data) {
    switch (vertical) {
      case 'bike_rental':
        return `New Bike Booking: ${data.bikeModel || 'N/A'} | Pickup: ${data.pickupDate || 'N/A'} | Return: ${data.returnDate || 'N/A'} | Customer: ${data.phoneNumber || 'N/A'} | ID: ${data.idStatus || 'pending'} | Ref: ${data.referenceId || 'N/A'}`;
      case 'hotel':
        return `New Hotel Booking: ${data.roomType || 'N/A'} | Check-in: ${data.checkIn || 'N/A'} | Check-out: ${data.checkOut || 'N/A'} | Guests: ${data.guestCount || 1} | Ref: ${data.bookingRef || data.referenceId || 'N/A'}`;
      case 'taxi':
        return `New Taxi Booking: Pickup: ${data.pickupLocation || 'N/A'} → Dropoff: ${data.dropoffLocation || 'N/A'} | Time: ${data.pickupTime || 'N/A'} | Customer: ${data.phoneNumber || 'N/A'} | Ref: ${data.referenceId || 'N/A'}`;
      case 'ticketing':
        return `New Ticket Booking: ${data.eventType || 'N/A'} | Tickets: ${data.ticketCount || 1} | Customer: ${data.phoneNumber || 'N/A'} | Ref: ${data.referenceId || 'N/A'}`;
      case 'social_media':
        return `New Social Media Enquiry: Platform: ${data.platform || 'N/A'} | Type: ${data.enquiryType || 'N/A'} | Customer: ${data.phoneNumber || 'N/A'} | Ref: ${data.referenceId || 'N/A'}`;
      default:
        return `New booking notification: Ref: ${data.referenceId || 'N/A'}`;
    }
  }

  getNotificationHistory(filters = {}) {
    let result = [...this.history];
    if (filters.vertical) result = result.filter(n => n.vertical === filters.vertical);
    if (filters.vendorId) result = result.filter(n => n.vendorId === filters.vendorId);
    return result.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
  }
}

// ---------------------------------------------------------------------------
// AcknowledgmentTracker — vendor response tracking
// ---------------------------------------------------------------------------
class AcknowledgmentTracker {
  constructor() {
    this.acknowledgments = {};
  }

  recordAcknowledgment(notificationId, vendorId) {
    const now = Date.now();
    const entry = {
      notificationId,
      vendorId,
      acknowledged: true,
      acknowledgedAt: new Date(now).toISOString(),
      responseTimeMs: 0,
    };
    this.acknowledgments[notificationId] = entry;
    return { ...entry };
  }

  getAcknowledgmentStatus(notificationId) {
    return !!this.acknowledgments[notificationId];
  }

  getPendingAcknowledgments(notifications) {
    return notifications.filter(n => !this.acknowledgments[n.notificationId]);
  }

  getResponseTimeStats(vendorId) {
    const vendorAcks = Object.values(this.acknowledgments).filter(a => a.vendorId === vendorId);
    if (vendorAcks.length === 0) {
      return { totalAcknowledged: 0, averageResponseTimeMs: 0 };
    }
    const total = vendorAcks.reduce((sum, a) => sum + a.responseTimeMs, 0);
    return {
      totalAcknowledged: vendorAcks.length,
      averageResponseTimeMs: Math.round(total / vendorAcks.length),
    };
  }
}

// ---------------------------------------------------------------------------
// Module-level instances
// ---------------------------------------------------------------------------
const vendorRegistry = new VendorRegistry();
const notificationService = new NotificationService(vendorRegistry);
const acknowledgmentTracker = new AcknowledgmentTracker();

// ---------------------------------------------------------------------------
// Express API Routes
// ---------------------------------------------------------------------------

// POST /api/vendors/register — register a vendor
app.post('/api/vendors/register', (req, res) => {
  try {
    const { vertical, name, contact, channel, active } = req.body;
    if (!vertical || !name || !contact) {
      return res.status(400).json({
        error: { message: 'Missing required fields: vertical, name, contact', code: 400 },
      });
    }
    const vendor = vendorRegistry.registerVendor({ vertical, name, contact, channel, active });
    res.status(201).json({
      data: vendor,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to register vendor', code: 500, details: error.message },
    });
  }
});

// GET /api/vendors — list all vendors
app.get('/api/vendors', (req, res) => {
  try {
    const vendors = vendorRegistry.vendors.map(v => ({ ...v }));
    res.json({
      data: vendors,
      meta: { timestamp: Date.now(), total: vendors.length },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to list vendors', code: 500, details: error.message },
    });
  }
});

// GET /api/vendors/:id — get vendor by ID
app.get('/api/vendors/:id', (req, res) => {
  try {
    const vendor = vendorRegistry.getVendor(req.params.id);
    if (!vendor) {
      return res.status(404).json({
        error: { message: 'Vendor not found', code: 404 },
      });
    }
    res.json({
      data: vendor,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get vendor', code: 500, details: error.message },
    });
  }
});

// DELETE /api/vendors/:id — remove a vendor
app.delete('/api/vendors/:id', (req, res) => {
  try {
    const removed = vendorRegistry.removeVendor(req.params.id);
    if (!removed) {
      return res.status(404).json({
        error: { message: 'Vendor not found', code: 404 },
      });
    }
    res.json({
      data: { removed: true },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to remove vendor', code: 500, details: error.message },
    });
  }
});

// POST /api/notifications/send — send a notification to a vendor
app.post('/api/notifications/send', (req, res) => {
  try {
    const { vendorId, message } = req.body;
    if (!vendorId || !message) {
      return res.status(400).json({
        error: { message: 'vendorId and message are required', code: 400 },
      });
    }
    const vendor = vendorRegistry.getVendor(vendorId);
    if (!vendor) {
      return res.status(404).json({
        error: { message: 'Vendor not found', code: 404 },
      });
    }
    const result = notificationService.sendNotification(vendor, { message });
    res.json({
      data: result,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to send notification', code: 500, details: error.message },
    });
  }
});

// POST /api/notifications/notify-vertical — notify all vendors in a vertical
app.post('/api/notifications/notify-vertical', (req, res) => {
  try {
    const { vertical, bookingData } = req.body;
    if (!vertical || !bookingData) {
      return res.status(400).json({
        error: { message: 'vertical and bookingData are required', code: 400 },
      });
    }
    const results = notificationService.notifyVertical(vertical, bookingData);
    res.json({
      data: results,
      meta: { timestamp: Date.now(), count: results.length },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to notify vertical', code: 500, details: error.message },
    });
  }
});

// GET /api/notifications/history — get notification history
app.get('/api/notifications/history', (req, res) => {
  try {
    const { vertical, vendorId } = req.query;
    const filters = {};
    if (vertical) filters.vertical = vertical;
    if (vendorId) filters.vendorId = vendorId;

    const history = notificationService.getNotificationHistory(
      Object.keys(filters).length > 0 ? filters : undefined,
    );
    res.json({
      data: history,
      meta: { timestamp: Date.now(), total: history.length },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get history', code: 500, details: error.message },
    });
  }
});

// POST /api/notifications/:id/acknowledge — acknowledge a notification
app.post('/api/notifications/:id/acknowledge', (req, res) => {
  try {
    const { vendorId } = req.body;
    if (!vendorId) {
      return res.status(400).json({
        error: { message: 'vendorId is required', code: 400 },
      });
    }
    const result = acknowledgmentTracker.recordAcknowledgment(req.params.id, vendorId);
    res.json({
      data: result,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to acknowledge', code: 500, details: error.message },
    });
  }
});

// GET /api/notifications/pending — get pending acknowledgments
app.get('/api/notifications/pending', (req, res) => {
  try {
    const history = notificationService.getNotificationHistory();
    const pending = acknowledgmentTracker.getPendingAcknowledgments(
      history.map(n => ({ notificationId: n.notificationId, vendorId: n.vendorId })),
    );
    res.json({
      data: pending,
      meta: { timestamp: Date.now(), count: pending.length },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get pending acknowledgments', code: 500, details: error.message },
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
const PORT = process.env.PORT || process.env.NOTIFICATION_PORT || 3014;
if (process.env.MOCHA_TEST_MODE !== 'true') {
  app.listen(PORT, () => {
    console.log(`Vendor Notification System service running on port ${PORT}`);
  });
}

module.exports = {
  app,
  VendorRegistry,
  NotificationService,
  AcknowledgmentTracker,
};
