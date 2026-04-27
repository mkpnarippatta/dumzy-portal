const express = require('express');

// Webhook payload validation
const WEBHOOK_SECRET = process.env.WEBHOOK_VERIFY_TOKEN || 'dev-secret';

class WebhookPayloadValidator {
  validate(payload) {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    const { From, ProfileName, WaId, Message, Timestamp } = payload;

    if (!From || !ProfileName || !WaId || !Message || !Timestamp) {
      return false;
    }

    if (!From.match(/^\+?[1-9]\d{6,14}$/)) {
      return false;
    }

    if (new Date(Timestamp).toString() === 'Invalid Date') {
      return false;
    }

    return true;
  }
}

// Response time tracking for 30-second SLA
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

// Business hours configuration
const BUSINESS_HOURS = {
  start: 9,  // 9 AM
  end: 18    // 6 PM
};

BUSINESS_HOURS.isDuringBusinessHours = function(hour) {
  return hour >= this.start && hour < this.end;
};

const webhookValidator = new WebhookPayloadValidator();

// Express app setup
const app = express();
app.use(express.json());

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  const startTime = Date.now();

  try {
    // Validate webhook payload
    const isValid = webhookValidator.validate(req.body);
    if (!isValid) {
      console.error('Invalid webhook payload:', req.body);
      return res.status(400).json({ error: { message: 'Invalid webhook payload', code: 400, details: 'Required fields missing or invalid' } });
    }

    const { From, Message, Timestamp } = req.body;

    // Determine if message is during business hours and should be queued
    // Use UTC hours for consistent business hours across timezones
    const messageHour = new Date(Timestamp).getUTCHours();
    const shouldQueue = !BUSINESS_HOURS.isDuringBusinessHours(messageHour);

    // Generate acknowledgment response using per-request tracker
    const tracker = new SLAResponseTracker(30000);
    const acknowledgeWithinSLA = tracker.getElapsedTime() < tracker.ackTimeout;

    if (shouldQueue) {
      return res.status(200).json({
        status: 'queued',
        message: 'Thank you for your message. Our business hours are 9 AM - 6 PM. Your enquiry will be processed when we reopen.'
      });
    }

    // Simulate bot processing time (actual implementation would use AI classifier here)
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000)); // 1-3 seconds

    const botProcessingTime = tracker.getElapsedTime();

    if (acknowledgeWithinSLA) {
      return res.status(200).json({
        status: 'acknowledged',
        message: 'Thank you for your message. Our team is reviewing your enquiry and will respond shortly.',
        processingTimeMs: botProcessingTime
      });
    }

    return res.status(200).json({
      status: 'processed',
      message: 'Your enquiry is being processed.',
      processingTimeMs: botProcessingTime
    });
  }

  catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`Webhook processing error after ${processingTime}ms:`, error);
    return res.status(500).json({
      error: { message: 'Internal server error', code: 500, details: 'An error occurred while processing your request. Please try again.' }
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime: Date.now(),
    webhookEndpoint: '/webhook'
  });
});

// Start server (only if not imported by tests)
if (process.env.MOCHA_TEST_MODE !== 'true') {
  const PORT = process.env.PORT || 3016;

  app.listen(PORT, () => {
    console.log(`WhatsApp webhook server listening on port ${PORT}`);
    console.log(`Business Hours: ${BUSINESS_HOURS.start}:00 - ${BUSINESS_HOURS.end}:00`);
  });
}

module.exports = { app };
