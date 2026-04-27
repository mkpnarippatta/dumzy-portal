const express = require('express');

const VALID_ROLES = ['user', 'bot', 'agent'];
const VALID_VERTICALS = ['Bike Rental', 'Hotel', 'Taxi', 'Ticketing', 'Social Media', 'Unknown'];

// Conversation History Service - In-memory storage for MVP, Supabase in Phase 2
class ConversationHistoryService {
  constructor() {
    this.messages = new Map(); // In-memory for MVP, Supabase in Phase 2
    this.sessions = new Map();
    this.RETENTION_DAYS = 90;
  }

  // Phone number normalization for consistent lookup
  normalizePhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return '';
    return phone.replace(/\D/g, '');
  }

  // Generate unique message ID
  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Generate unique session ID
  generateSessionId() {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Get or create session for phone number and vertical
  getOrCreateSession(phoneNumber, vertical) {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    const normalizedVertical = vertical || 'Unknown';

    // Look for existing active session for same phone number and vertical
    let mostRecentSessionId = null;
    let mostRecentActivity = null;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (
        this.normalizePhoneNumber(session.phone_number) === normalizedPhone &&
        session.vertical === normalizedVertical
      ) {
        if (!mostRecentActivity || session.last_activity > mostRecentActivity) {
          mostRecentSessionId = sessionId;
          mostRecentActivity = session.last_activity;
        }
      }
    }
    if (mostRecentSessionId) return mostRecentSessionId;

    // Create new session
    const sessionId = this.generateSessionId();
    const now = new Date().toISOString();

    this.sessions.set(sessionId, {
      id: sessionId,
      phone_number: phoneNumber,
      vertical: normalizedVertical,
      started_at: now,
      last_activity: now,
      message_count: 0
    });

    return sessionId;
  }

  // Store message with phone number indexing (AC #1)
  storeMessage(messageData) {
    const role = messageData.role || 'user';
    if (!VALID_ROLES.includes(role)) {
      throw new Error(`Invalid role: ${role}. Must be one of: ${VALID_ROLES.join(', ')}`);
    }

    const vertical = messageData.vertical || 'Unknown';
    if (!VALID_VERTICALS.includes(vertical)) {
      throw new Error(`Invalid vertical: ${vertical}. Must be one of: ${VALID_VERTICALS.join(', ')}`);
    }

    let sessionId = messageData.session_id;
    if (sessionId) {
      if (!this.sessions.has(sessionId)) {
        // Auto-create session for non-existent session_id (prevent orphan messages)
        const now = new Date().toISOString();
        this.sessions.set(sessionId, {
          id: sessionId,
          phone_number: messageData.phone_number,
          vertical,
          started_at: now,
          last_activity: now,
          message_count: 0
        });
      }
    } else {
      sessionId = this.getOrCreateSession(messageData.phone_number, messageData.vertical);
    }

    const message = {
      id: this.generateMessageId(),
      session_id: sessionId,
      phone_number: messageData.phone_number,
      role,
      content: messageData.content,
      timestamp: messageData.timestamp || new Date().toISOString(),
      vertical,
      metadata: messageData.metadata || {}
    };

    this.messages.set(message.id, message);

    // Update session activity and message count
    const session = this.sessions.get(message.session_id);
    session.last_activity = message.timestamp;
    session.message_count += 1;

    return JSON.parse(JSON.stringify(message));
  }

  // Get session by ID
  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  // Get history for phone number with 90-day filter (AC #2)
  getHistory(phoneNumber, days = this.RETENTION_DAYS) {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    const cutoffDate = new Date();
    const now = cutoffDate.getTime();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const results = Array.from(this.messages.values())
      .filter(m => this.normalizePhoneNumber(m.phone_number) === normalizedPhone)
      .filter(m => Math.min(new Date(m.timestamp).getTime(), now) >= cutoffDate.getTime())
      .sort((a, b) => {
        const dateA = new Date(a.timestamp);
        const dateB = new Date(b.timestamp);
        if (isNaN(dateA.getTime())) return 1;
        if (isNaN(dateB.getTime())) return -1;
        return dateA - dateB;
      });
    return JSON.parse(JSON.stringify(results));
  }
}

// Initialize service
const historyService = new ConversationHistoryService();
const APP_START_TIME = Date.now();

// Express app setup
const app = express();
app.use(express.json({ limit: '1mb' }));

// Require JSON content type
app.use((req, res, next) => {
  if (req.method === 'POST' && !req.is('application/json')) {
    return res.status(400).json({
      error: { message: 'Content-Type must be application/json', code: 400, details: 'Invalid content type' }
    });
  }
  next();
});

// POST /api/conversation/message - Store message
app.post('/api/conversation/message', (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({
        error: { message: 'Request body is required', code: 400, details: 'Empty or invalid request body' }
      });
    }

    const { phone_number, content, role, vertical, session_id, metadata } = req.body;

    // Validate required fields
    if (!phone_number) {
      return res.status(400).json({
        error: {
          message: 'phone_number is required',
          code: 400,
          details: 'Missing required field: phone_number'
        }
      });
    }

    if (!content || !content.trim()) {
      return res.status(400).json({
        error: {
          message: 'content is required',
          code: 400,
          details: 'Missing required field: content'
        }
      });
    }

    if (content.length > 10240) {
      return res.status(400).json({
        error: {
          message: 'content exceeds maximum length',
          code: 400,
          details: 'Content must be 10KB or less'
        }
      });
    }

    // Store message
    const message = historyService.storeMessage({
      phone_number,
      content,
      role,
      vertical,
      session_id,
      metadata
    });

    res.status(201).json({
      data: message,
      meta: {
        timestamp: new Date().toISOString(),
        message: 'Message stored successfully'
      }
    });
  } catch (error) {
    console.error('Message storage error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to store message',
        code: 500,
        details: 'An internal error occurred'
      }
    });
  }
});

// GET /api/conversation/history/:phoneNumber - Retrieve history
app.get('/api/conversation/history/:phoneNumber', (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const rawDays = req.query.days;
    let days;
    if (rawDays !== undefined) {
      days = parseInt(rawDays, 10);
      if (!Number.isFinite(days) || days <= 0) {
        return res.status(400).json({
          error: { message: 'Invalid days parameter', code: 400, details: 'Days must be a positive number' }
        });
      }
    } else {
      days = historyService.RETENTION_DAYS;
    }

    if (!phoneNumber) {
      return res.status(400).json({
        error: {
          message: 'phoneNumber is required',
          code: 400,
          details: 'Missing phone number parameter'
        }
      });
    }

    const history = historyService.getHistory(phoneNumber, days);

    res.status(200).json({
      data: history,
      meta: {
        timestamp: new Date().toISOString(),
        days_filter: days,
        message_count: history.length
      }
    });
  } catch (error) {
    console.error('History retrieval error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to retrieve history',
        code: 500,
        details: 'An internal error occurred'
      }
    });
  }
});

// GET /api/health - Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime_ms: Date.now() - APP_START_TIME,
    service: 'conversation-history-persistence',
    endpoints: [
      'POST /api/conversation/message',
      'GET /api/conversation/history/:phoneNumber',
      'GET /api/health'
    ],
    retention_days: historyService.RETENTION_DAYS
  });
});

// Start server (only if not in test mode)
if (process.env.MOCHA_TEST_MODE !== 'true') {
  const PORT = process.env.PORT || 3021;

  app.listen(PORT, () => {
    console.log(`Conversation History Persistence Service listening on port ${PORT}`);
    console.log(`Message retention: ${historyService.RETENTION_DAYS} days`);
    console.log(`Storage: In-memory (MVP) - Supabase in Phase 2`);
  });
}

module.exports = { app, ConversationHistoryService };


