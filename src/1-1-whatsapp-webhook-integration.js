const express = require('express');
const { ConversationSessionManager, VERTICAL_FIELDS } = require('./lib/conversation-session');

// Webhook payload validation
const WEBHOOK_SECRET = process.env.WEBHOOK_VERIFY_TOKEN || 'dev-secret';
const GATEWAY_PORT = process.env.PORT || 3000;
const CLASSIFICATION_SERVICE_URL = process.env.CLASSIFICATION_SERVICE_URL || `http://localhost:${GATEWAY_PORT}`;
const ROUTING_SERVICE_URL = process.env.ROUTING_SERVICE_URL || `http://localhost:${GATEWAY_PORT}`;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';
const WHATSAPP_API_URL = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

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

// WhatsApp Cloud API format parser — also handles interactive list replies
function parseWhatsAppPayload(body) {
  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    if (!message || !contact) return null;

    // Interactive list reply: the selected row id is the message text
    let text = '';
    if (message.type === 'interactive' && message.interactive?.list_reply?.id) {
      text = message.interactive.list_reply.id;
    } else {
      text = message.text?.body || message.caption?.text || '';
    }

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

// Send a reply message via WhatsApp Cloud API
// Normalize phone number: strip +, spaces, dashes — WhatsApp API expects plain digits
function normalizePhoneNumber(number) {
  return number.replace(/[^0-9]/g, '');
}

async function sendWhatsAppReply(to, text) {
  if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
    console.warn('WhatsApp API not configured — set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN');
    return false;
  }

  const normalizedTo = normalizePhoneNumber(to);
  console.log(`Sending WhatsApp reply to normalized number: ${normalizedTo}`);

  try {
    const res = await fetch(WHATSAPP_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: normalizedTo,
        type: 'text',
        text: { body: text },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('WhatsApp API error:', err);
      return false;
    }

    return true;
  } catch (e) {
    console.error('WhatsApp API send failed:', e.message);
    return false;
  }
}

// Send an interactive list message for select-type fields
async function sendWhatsAppListMessage(to, bodyText, options, buttonLabel = 'Select') {
  if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN || options.length === 0) {
    return false;
  }

  const rows = options.map((opt, i) => ({ id: opt, title: opt.length > 24 ? opt.slice(0, 21) + '...' : opt }));
  const normalizedTo = normalizePhoneNumber(to);

  try {
    const res = await fetch(WHATSAPP_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedTo,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: bodyText.length > 1024 ? bodyText.slice(0, 1021) + '...' : bodyText },
          action: {
            button: buttonLabel,
            sections: [{ rows }],
          },
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('WhatsApp list message error:', err);
      return false;
    }
    return true;
  } catch (e) {
    console.error('WhatsApp list message send failed:', e.message);
    return false;
  }
}

// Generate a contextual reply based on classification
function buildReply(classification, routeResult) {
  if (!classification || !classification.vertical || classification.vertical === 'Unknown') {
    return "Thanks for your message! I'm not sure what you're looking for. Could you specify if you need a bike rental, hotel, taxi, or ticketing?";
  }

  const replies = {
    'Bike Rental': "Great! I see you're interested in a bike rental. Our team will check availability and get back to you with options.",
    'Hotel': "Thanks! Looking for a hotel room? We'll check availability and send you the best options.",
    'Taxi': "Need a taxi? We'll find available rides in your area and get back to you.",
    'Ticketing': "Looking for tickets? We'll check what's available and get back to you.",
    'Social Media': "Thanks for reaching out! We'll look into this and get back to you.",
  };

  return replies[classification.vertical] || "Thanks for your message! We'll process your enquiry and get back to you shortly.";
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
const sessionManager = new ConversationSessionManager();

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

// Build a confirmation message after successful backend submission
function buildConfirmation(vertical, routeResult) {
  const backendResult = routeResult?.data?.backendResult || routeResult;
  const refId = backendResult?.referenceId || backendResult?.id;
  const base = `Thanks! Your ${vertical.toLowerCase()} enquiry has been submitted.`;

  if (refId) {
    return `${base} Your reference ID is ${refId}. We'll get back to you shortly.`;
  }
  return base;
}

// Webhook endpoint — multi-turn conversation support
app.post('/webhook', async (req, res) => {
  try {
    // Always return 200 to WhatsApp webhooks (they resend on non-200)
    res.status(200).send('OK');

    const body = req.body;

    // Check if this is a status update (delivered/read receipt) — ignore it
    const entry = body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    if (value?.statuses) {
      return; // Ignore status updates
    }

    // Try WhatsApp Cloud API format first, fall back to simplified
    const waPayload = parseWhatsAppPayload(body);
    const payload = waPayload || body;

    // Validate
    const isValid = webhookValidator.validate(payload);
    if (!isValid) {
      console.log('Webhook received (non-message payload)');
      return;
    }

    const { From, Message } = payload;
    console.log(`Webhook message from ${From}: "${Message}"`);

    // Check for existing session (multi-turn conversation)
    const session = sessionManager.getSession(From);

    if (session) {
      // === EXISTING SESSION: validate and collect next field response ===
      const result = session.addResponse(Message);
      console.log(`Session ${session.vertical}[${session.fieldIndex}/${session.fields.length}]: ${result.ok ? 'ok' : 'invalid'}`);

      if (!result.ok) {
        // Validation failed — re-prompt with error message
        const field = session.currentField;
        const hint = field.placeholder ? ` (${field.placeholder})` : '';
        await sendWhatsAppReply(From, `${result.error}\n\n${field.question}${hint}`);
        return;
      }

      if (session.isComplete) {
        console.log(`Session ${session.vertical} complete for ${From}, submitting...`);
        const intent = INTENT_MAP[session.vertical];
        const submissionPayload = session.getSubmissionPayload(From);
        let confirmText = `Thank you! Your ${session.vertical.toLowerCase()} enquiry has been received. We'll process it shortly.`;

        if (intent) {
          try {
            const routeRes = await fetch(`${ROUTING_SERVICE_URL}/api/routing/route`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ intent, payload: submissionPayload }),
            });
            if (routeRes.ok) {
              const result = await routeRes.json();
              confirmText = buildConfirmation(session.vertical, result);
            }
          } catch (e) {
            console.warn('Routing unavailable after data collection:', e.message);
          }
        }

        await sendWhatsAppReply(From, confirmText);
        sessionManager.removeSession(From);
      } else {
        // Ask next question — use interactive list for select fields
        const nextField = session.currentField;
        if (nextField.type === 'select' && nextField.options) {
          await sendWhatsAppListMessage(From, nextField.question, nextField.options);
        } else {
          const hint = nextField.placeholder ? ` (${nextField.placeholder})` : '';
          await sendWhatsAppReply(From, nextField.question + hint);
        }
      }
      return;
    }

    // === NEW CONVERSATION: classify and start data collection ===
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

    const vertical = classification?.vertical;
    const isUnknown = !vertical || vertical === 'Unknown';

    if (isUnknown) {
      await sendWhatsAppReply(From, buildReply(classification));
      return;
    }

    const fields = VERTICAL_FIELDS[vertical] || [];

    if (fields.length === 0) {
      // No data collection needed (Ticketing, Social Media) — route directly
      const intent = INTENT_MAP[vertical];
      let confirmText = buildReply(classification);

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
                vertical: VERTICAL_LABELS[vertical],
                intent,
              },
            }),
          });
          if (routeRes.ok) {
            const result = await routeRes.json();
            confirmText = buildConfirmation(vertical, result);
          }
        } catch (e) {
          console.warn('Routing unavailable:', e.message);
        }
      }

      await sendWhatsAppReply(From, confirmText);
    } else {
      // Start data collection session
      sessionManager.getOrCreateSession(From, vertical);
      const firstField = fields[0];
      if (firstField.type === 'select' && firstField.options) {
        await sendWhatsAppListMessage(From, firstField.question, firstField.options);
      } else {
        const hint = firstField.placeholder ? ` (${firstField.placeholder})` : '';
        await sendWhatsAppReply(From, firstField.question + hint);
      }
    }
  } catch (error) {
    console.error('Webhook processing error:', error);
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

    // Send contextual reply via WhatsApp
    const replyText = buildReply(classification, routeResult);
    sendWhatsAppReply(From, replyText);

    return res.status(200).json({
      status: 'processed',
      message: Message,
      classification,
      routing: routeResult,
      reply: replyText,
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
