const express = require('express');

// Webhook payload validation
const WEBHOOK_SECRET = process.env.WEBHOOK_VERIFY_TOKEN || 'dev-secret';
const CLASSIFICATION_SERVICE_URL = process.env.CLASSIFICATION_SERVICE_URL || 'http://localhost:3099';
const ROUTING_SERVICE_URL = process.env.ROUTING_SERVICE_URL || 'http://localhost:3099';

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

// WhatsApp Cloud API format parser
function parseWhatsAppPayload(body) {
  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    if (!message || !contact) return null;

    const text = message.text?.body || message.caption?.text || '';

    return {
      From: message.from,
      ProfileName: contact.profile?.name || 'Unknown',
      WaId: message.from,
      Message: text,
      Timestamp: new Date(parseInt(message.timestamp) * 1000).toISOString(),
      messageId: message.id,
      messageType: message.type,
    };
  } catch {
    return null;
  }
}

// Intent mapping: vertical name → routing intent
const INTENT_MAP = {
  'Bike Rental': 'bike_rental',
  'Hotel': 'hotel',
  'Taxi': 'taxi',
  'Ticketing': 'ticketing',
  'Social Media': 'social_media',
};

// Vertical label mapping for ERPNext lead source
const VERTICAL_LABELS = {
  'Bike Rental': 'bike_rental',
  'Hotel': 'hotel',
  'Taxi': 'taxi',
  'Ticketing': 'ticketing',
  'Social Media': 'social_media',
};

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

// WhatsApp Cloud API webhook verification (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === WEBHOOK_SECRET) {
    console.log('Webhook verified successfully');
    return res.status(200).send(challenge);
  }

  res.status(403).send('Forbidden');
});

// Webhook endpoint — accepts both simplified and WhatsApp Cloud API format
app.post('/webhook', async (req, res) => {
  const startTime = Date.now();

  try {
    // Try WhatsApp Cloud API format first, fall back to simplified
    const waPayload = parseWhatsAppPayload(req.body);
    const payload = waPayload || req.body;

    // Validate webhook payload
    const isValid = webhookValidator.validate(payload);
    if (!isValid) {
      console.error('Invalid webhook payload:', req.body);
      return res.status(400).json({ error: { message: 'Invalid webhook payload', code: 400, details: 'Required fields missing or invalid' } });
    }

    const { From, Message, Timestamp } = payload;

    // Determine if message is during business hours and should be queued
    const messageHour = new Date(Timestamp).getUTCHours();
    const shouldQueue = !BUSINESS_HOURS.isDuringBusinessHours(messageHour);

    // Track SLA
    const tracker = new SLAResponseTracker(30000);

    if (shouldQueue) {
      return res.status(200).json({
        status: 'queued',
        message: 'Thank you for your message. Our business hours are 9 AM - 6 PM. Your enquiry will be processed when we reopen.'
      });
    }

    // Simulate bot processing time
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));

    const botProcessingTime = tracker.getElapsedTime();

    return res.status(200).json({
      status: 'acknowledged',
      message: 'Thank you for your message. Our team is reviewing your enquiry and will respond shortly.',
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

// Full integration chain: webhook → classify → route → respond
app.post('/webhook/integration', async (req, res) => {
  const startTime = Date.now();

  try {
    const waPayload = parseWhatsAppPayload(req.body);
    const payload = waPayload || req.body;

    const isValid = webhookValidator.validate(payload);
    if (!isValid) {
      return res.status(400).json({ error: { message: 'Invalid webhook payload', code: 400 } });
    }

    const { From, Message } = payload;

    // Step 1: Classify intent
    let classification = null;
    try {
      const classifyRes = await fetch(`${CLASSIFICATION_SERVICE_URL}/api/intent/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: Message }),
      });
      if (classifyRes.ok) {
        classification = await classifyRes.json();
      }
    } catch (e) {
      console.warn('Classification service unavailable:', e.message);
    }

    // Step 2: Route to backend if classified
    let routeResult = null;
    if (classification && classification.vertical && classification.vertical !== 'Unknown') {
      const intent = INTENT_MAP[classification.vertical];
      if (intent) {
        try {
          const routeRes = await fetch(`${ROUTING_SERVICE_URL}/api/routing/route`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              intent,
              payload: {
                phoneNumber: From,
                source: 'whatsapp',
                vertical: VERTICAL_LABELS[classification.vertical],
              },
            }),
          });
          if (routeRes.ok) {
            routeResult = await routeRes.json();
          }
        } catch (e) {
          console.warn('Routing service unavailable:', e.message);
        }
      }
    }

    return res.status(200).json({
      status: 'processed',
      message: Message,
      classification,
      routing: routeResult,
      processingTimeMs: Date.now() - startTime,
    });
  } catch (error) {
    console.error('Integration error:', error);
    return res.status(500).json({
      error: { message: 'Integration processing failed', code: 500 },
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
