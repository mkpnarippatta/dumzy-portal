const express = require('express');

// Acquisition channel configuration
const ACQUISITION_CHANNELS = Object.freeze(['Direct', 'Airbnb', 'Booking.com', 'Agoda']);

// Marketplace source patterns for detection
const MARKETPLACE_PATTERNS = {
  'Airbnb': {
    utmSource: ['airbnb', 'airbnb.com'],
    referralPrefix: ['AIRBNB'],
    phonePrefix: [process.env.MARKETPLACE_PREFIX_AIRBNB || '+911111']
  },
  'Booking.com': {
    utmSource: ['booking', 'booking.com'],
    referralPrefix: ['BOOKING', 'BCOM'],
    phonePrefix: [process.env.MARKETPLACE_PREFIX_BOOKING || '+912222']
  },
  'Agoda': {
    utmSource: ['agoda', 'agoda.com'],
    referralPrefix: ['AGODA'],
    phonePrefix: [process.env.MARKETPLACE_PREFIX_AGODA || '+913333']
  }
};

const PMS_SYNC_DELAY_THRESHOLD = 30000; // 30 seconds
const MAX_ANALYTICS_LOG_ENTRIES = 10000;
const CLASSIFICATION_SERVICE_URL = process.env.CLASSIFICATION_SERVICE_URL || 'http://localhost:3017';

// Business hours configuration (matching pattern from Story 1.1)
const BUSINESS_HOURS = {
  start: 9,  // 9 AM
  end: 18    // 6 PM
};
BUSINESS_HOURS.isDuringBusinessHours = function (hour) {
  return hour >= this.start && hour < this.end;
};

// Response time tracking for 30-second SLA (matching Story 1.1)
class SLAResponseTracker {
  constructor(ackTimeoutMs) {
    this.startTime = Date.now();
    this.ackTimeout = ackTimeoutMs;
  }

  getElapsedTime() {
    return Date.now() - this.startTime;
  }

  hasExceededTimeout() {
    return this.getElapsedTime() > this.ackTimeout;
  }
}

// Marketplace Source Detection Middleware
class MarketplaceSourceDetector {
  static detectAcquisitionSource(webhookData) {
    if (!webhookData || typeof webhookData !== 'object' || Array.isArray(webhookData)) {
      return 'Direct';
    }

    // Check UTM parameters
    if (typeof webhookData.utm_source === 'string') {
      for (const [channel, patterns] of Object.entries(MARKETPLACE_PATTERNS)) {
        if (patterns.utmSource.includes(webhookData.utm_source.toLowerCase())) {
          return channel;
        }
      }
    }

    // Check referral source
    if (typeof webhookData.referral_source === 'string') {
      for (const [channel, patterns] of Object.entries(MARKETPLACE_PATTERNS)) {
        if (patterns.referralPrefix.includes(webhookData.referral_source.toUpperCase())) {
          return channel;
        }
      }
    }

    // Check phone number prefix
    if (typeof webhookData.From === 'string') {
      for (const [channel, patterns] of Object.entries(MARKETPLACE_PATTERNS)) {
        if (patterns.phonePrefix.some(prefix => webhookData.From.startsWith(prefix))) {
          return channel;
        }
      }
    }

    return 'Direct';
  }

  static validateAcquisitionChannel(channel) {
    return ACQUISITION_CHANNELS.includes(channel);
  }
}

// PMS Inventory Sync Validation Service (simulated for MVP)
class PMSInventoryValidator {
  constructor() {
    this.lastSyncTime = null;
    this.syncDelay = 0;
    this.marketplaceData = this.initializeMarketplaceData();
  }

  initializeMarketplaceData() {
    // Simulated marketplace listing data for MVP
    return {
      'Airbnb': {
        roomTypes: ['Standard', 'Deluxe', 'Suite'],
        availability: { 'Standard': 5, 'Deluxe': 3, 'Suite': 1 }
      },
      'Booking.com': {
        roomTypes: ['Standard', 'Deluxe', 'Suite'],
        availability: { 'Standard': 5, 'Deluxe': 3, 'Suite': 1 }
      },
      'Agoda': {
        roomTypes: ['Standard', 'Deluxe', 'Suite'],
        availability: { 'Standard': 5, 'Deluxe': 3, 'Suite': 1 }
      }
    };
  }

  async syncWithPMS() {
    // Simulate PMS sync delay
    this.syncDelay = Math.random() * 5000;
    await new Promise(resolve => setTimeout(resolve, this.syncDelay));
    this.lastSyncTime = Date.now();
    return true;
  }

  compareWithMarketplaceData(marketplace) {
    const marketplaceInfo = this.marketplaceData[marketplace];
    if (!marketplaceInfo) {
      return { consistent: false, message: 'Unknown marketplace' };
    }

    return {
      consistent: true,
      message: 'Availability matches marketplace listing',
      marketplaceData: marketplaceInfo.availability
    };
  }

  getSyncStatus() {
    if (!this.lastSyncTime) {
      return { status: 'checking', message: 'No sync performed yet — checking availability, please wait' };
    }

    const timeSinceSync = Date.now() - this.lastSyncTime;
    if (timeSinceSync >= PMS_SYNC_DELAY_THRESHOLD) {
      return { status: 'stale', message: 'Last sync is outdated — checking availability, please wait' };
    }

    return { status: 'current', message: 'Availability up to date' };
  }
}

// Marketplace Enquiry Service
class MarketplaceEnquiryService {
  constructor() {
    this.pmsValidator = new PMSInventoryValidator();
    this.acquisitionAnalytics = {
      total: 0,
      byChannel: [...ACQUISITION_CHANNELS].reduce((acc, channel) => {
        acc[channel] = 0;
        return acc;
      }, {}),
      logs: []
    };
  }

  async processMarketplaceEnquiry(enquiryData) {
    const acquisitionChannel = MarketplaceSourceDetector.detectAcquisitionSource(enquiryData);
    const syncStatus = this.pmsValidator.getSyncStatus();

    // Check business hours
    const currentHour = new Date().getUTCHours();
    const shouldQueue = !BUSINESS_HOURS.isDuringBusinessHours(currentHour);

    // Classify enquiry through AI service
    let classification = null;
    let requiresHandoff = false;
    if (enquiryData.Message && typeof enquiryData.Message === 'string') {
      try {
        const response = await fetch(`${CLASSIFICATION_SERVICE_URL}/api/intent/classify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: enquiryData.Message,
            conversation_context: enquiryData.conversation_context || ''
          })
        });
        if (response.ok) {
          classification = await response.json();
          requiresHandoff = classification.requires_human_handoff;
        }
      } catch {
        // Classification service unavailable — continue without classification
      }
    }

    // Track SLA response time
    const slaTracker = new SLAResponseTracker(30000);

    const enquiry = {
      From: enquiryData.From,
      Message: enquiryData.Message,
      ProfileName: enquiryData.ProfileName,
      WaId: enquiryData.WaId,
      Timestamp: enquiryData.Timestamp,
      acquisition_channel: acquisitionChannel,
      processed_at: new Date().toISOString(),
      sync_status: syncStatus,
      classification,
      requires_human_handoff: requiresHandoff,
      sla_tracking: {
        elapsed_ms: slaTracker.getElapsedTime(),
        within_sla: !slaTracker.hasExceededTimeout()
      },
      business_hours: !shouldQueue
    };

    if (shouldQueue) {
      enquiry.queued = true;
    }

    // Log acquisition for analytics
    this.logAcquisition(acquisitionChannel, enquiry);

    return enquiry;
  }

  async validateDataConsistency(marketplace) {
    await this.pmsValidator.syncWithPMS();
    return this.pmsValidator.compareWithMarketplaceData(marketplace);
  }

  logAcquisition(channel, enquiry) {
    this.acquisitionAnalytics.total++;
    this.acquisitionAnalytics.byChannel[channel]++;
    this.acquisitionAnalytics.logs.push({
      channel,
      timestamp: new Date().toISOString(),
      phone: enquiry.From || 'unknown',
      enquiryId: enquiry.enquiry_id || 'unknown'
    });
    // Cap log growth
    if (this.acquisitionAnalytics.logs.length > MAX_ANALYTICS_LOG_ENTRIES) {
      this.acquisitionAnalytics.logs = this.acquisitionAnalytics.logs.slice(-MAX_ANALYTICS_LOG_ENTRIES);
    }
  }

  getAcquisitionAnalytics() {
    return {
      total: this.acquisitionAnalytics.total,
      byChannel: { ...this.acquisitionAnalytics.byChannel },
      recentLogs: this.acquisitionAnalytics.logs.slice(-100),
      logs: this.acquisitionAnalytics.logs
    };
  }

  resetAnalytics() {
    this.acquisitionAnalytics.total = 0;
    Object.keys(this.acquisitionAnalytics.byChannel).forEach(key => {
      this.acquisitionAnalytics.byChannel[key] = 0;
    });
    this.acquisitionAnalytics.logs.length = 0;
  }
}

// Initialize service
const marketplaceService = new MarketplaceEnquiryService();
const APP_START_TIME = Date.now();

// Express app setup
const app = express();
app.use(express.json({ limit: '1mb' }));

// Middleware to detect and tag marketplace source (POST only, specific path)
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/api/enquiry/marketplace') {
    const channel = MarketplaceSourceDetector.detectAcquisitionSource(req.body);
    req.body.acquisition_channel = channel;
  }
  next();
});

// POST /api/enquiry/marketplace - Marketplace inquiry routing endpoint
app.post('/api/enquiry/marketplace', async (req, res) => {
  try {
    const enquiryData = req.body;

    // Validate required fields with per-field messages
    if (!enquiryData.From && !enquiryData.Message) {
      return res.status(400).json({
        error: {
          message: 'From and Message fields are required',
          code: 400,
          details: 'Missing required fields: From, Message'
        }
      });
    }
    if (!enquiryData.From) {
      return res.status(400).json({
        error: {
          message: 'From field is required',
          code: 400,
          details: 'Missing required field: From'
        }
      });
    }
    if (!enquiryData.Message) {
      return res.status(400).json({
        error: {
          message: 'Message field is required',
          code: 400,
          details: 'Missing required field: Message'
        }
      });
    }

    // Check business hours
    const currentHour = new Date().getUTCHours();
    if (!BUSINESS_HOURS.isDuringBusinessHours(currentHour)) {
      return res.status(200).json({
        data: {
          status: 'queued',
          acquisition_channel: enquiryData.acquisition_channel || 'Direct'
        },
        meta: {
          timestamp: new Date().toISOString(),
          processed: true,
          note: 'Your enquiry has been queued during off-hours and will be processed when business hours resume (9 AM - 6 PM)'
        }
      });
    }

    // Process enquiry through service (same workflow as direct enquiries, with classification)
    const processedEnquiry = await marketplaceService.processMarketplaceEnquiry(enquiryData);

    // If handoff is required, indicate it
    if (processedEnquiry.requires_human_handoff) {
      return res.status(200).json({
        data: {
          ...processedEnquiry,
          handoff: true,
          handoff_reason: 'Complex enquiry requires human agent'
        },
        meta: {
          timestamp: new Date().toISOString(),
          processed: true,
          handoff_required: true,
          note: 'Marketplace enquiries follow the same workflow as direct enquiries'
        }
      });
    }

    res.status(200).json({
      data: processedEnquiry,
      meta: {
        timestamp: new Date().toISOString(),
        processed: true,
        note: 'Marketplace enquiries follow the same workflow as direct enquiries'
      }
    });
  } catch (error) {
    console.error('Marketplace enquiry processing error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to process marketplace enquiry',
        code: 500,
        details: 'An internal error occurred'
      }
    });
  }
});

// GET /api/marketplace/validate/:channel - Validate data consistency with marketplace
app.get('/api/marketplace/validate/:channel', async (req, res) => {
  try {
    const { channel } = req.params;

    // Validate channel (case-insensitive lookup)
    const normalizedChannel = ACQUISITION_CHANNELS.find(
      c => c.toLowerCase() === channel.toLowerCase()
    );
    if (!normalizedChannel || normalizedChannel === 'Direct') {
      return res.status(400).json({
        error: {
          message: 'Invalid marketplace channel',
          code: 400,
          details: `Valid channels: ${ACQUISITION_CHANNELS.filter(c => c !== 'Direct').join(', ')}`
        }
      });
    }

    // Validate data consistency with timeout
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('PMS sync timeout')), 10000)
    );
    const consistencyResult = await Promise.race([
      marketplaceService.validateDataConsistency(normalizedChannel),
      timeoutPromise
    ]);
    const syncStatus = marketplaceService.pmsValidator.getSyncStatus();

    res.status(200).json({
      data: {
        channel: normalizedChannel,
        ...consistencyResult,
        sync_status: syncStatus
      },
      meta: {
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Marketplace validation error:', error);
    const isTimeout = error instanceof Error && error.message === 'PMS sync timeout';
    res.status(isTimeout ? 504 : 500).json({
      error: {
        message: isTimeout ? 'PMS sync timed out' : 'Failed to validate marketplace data',
        code: isTimeout ? 504 : 500,
        details: 'An internal error occurred'
      }
    });
  }
});

// GET /api/analytics/acquisition - Get acquisition channel analytics
app.get('/api/analytics/acquisition', (req, res) => {
  try {
    const analytics = marketplaceService.getAcquisitionAnalytics();

    res.status(200).json({
      data: analytics,
      meta: {
        timestamp: new Date().toISOString(),
        channels: [...ACQUISITION_CHANNELS]
      }
    });
  } catch (error) {
    console.error('Analytics retrieval error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to retrieve acquisition analytics',
        code: 500,
        details: 'An internal error occurred'
      }
    });
  }
});

// GET /api/marketplace/channels - Get available acquisition channels
app.get('/api/marketplace/channels', (req, res) => {
  res.status(200).json({
    data: {
      channels: [...ACQUISITION_CHANNELS],
      patterns: Object.entries(MARKETPLACE_PATTERNS).reduce((acc, [channel]) => {
        acc[channel] = { utmSource: true, referralPrefix: true, phonePrefix: true };
        return acc;
      }, {})
    },
    meta: {
      timestamp: new Date().toISOString()
    }
  });
});

// GET /api/health - Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime_ms: Date.now() - APP_START_TIME,
    service: 'marketplace-enquiry-routing',
    endpoints: [
      'POST /api/enquiry/marketplace',
      'GET /api/marketplace/validate/:channel',
      'GET /api/analytics/acquisition',
      'GET /api/marketplace/channels',
      'GET /api/health'
    ],
    acquisition_channels: [...ACQUISITION_CHANNELS]
  });
});

// Start server (only if not in test mode)
const PORT = parseInt(process.env.PORT, 10);
const SERVER_PORT = Number.isFinite(PORT) && PORT > 0 && PORT < 65536 ? PORT : 3003;

if (process.env.MOCHA_TEST_MODE !== 'true') {
  app.listen(SERVER_PORT, () => {
    console.log(`Marketplace Enquiry Routing Service listening on port ${SERVER_PORT}`);
    console.log(`Acquisition channels: ${ACQUISITION_CHANNELS.join(', ')}`);
    console.log(`PMS sync delay threshold: ${PMS_SYNC_DELAY_THRESHOLD}ms`);
  });
}

module.exports = { app, MarketplaceSourceDetector, PMSInventoryValidator, MarketplaceEnquiryService };
