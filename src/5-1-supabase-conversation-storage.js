require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Connection Pool
// ---------------------------------------------------------------------------
class ConnectionPool {
  constructor(maxConnections = 5) {
    this.connections = [];
    this.maxConnections = maxConnections;
    this.activeConnections = 0;
    this.waiting = [];
  }

  async getConnection() {
    if (this.connections.length > 0) {
      return this.connections.pop();
    }
    if (this.activeConnections < this.maxConnections) {
      return this._createConnection();
    }
    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  releaseConnection(connection) {
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift();
      resolve(connection);
      return;
    }
    this.connections.push(connection);
    this.activeConnections--;
  }

  _createConnection() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_KEY must be set');
    }
    this.activeConnections++;
    return createClient(url, key);
  }

  getStatus() {
    return {
      available: this.connections.length,
      active: this.activeConnections,
      max: this.maxConnections,
      waiting: this.waiting.length,
    };
  }
}

// ---------------------------------------------------------------------------
// Supabase Conversation Storage
// ---------------------------------------------------------------------------
class SupabaseConversationStorage {
  constructor(supabaseClient, pool) {
    this.supabase = supabaseClient;
    this.pool = pool;
    this.queryTimings = [];
  }

  async insertMessage(messageData) {
    const connection = this.pool ? await this.pool.getConnection() : this.supabase;
    const start = Date.now();
    try {
      const payload = {
        phone_number: messageData.phoneNumber,
        message: messageData.message,
        direction: messageData.direction || 'incoming',
        timestamp: messageData.timestamp || new Date().toISOString(),
        sender_phone_number: messageData.senderPhoneNumber || null,
        message_id: messageData.messageId || null,
        classification_id: messageData.classificationId || null,
        vertical_tag: messageData.verticalTag || null,
        metadata: messageData.metadata || {},
        customer_id: messageData.customerId || null,
      };

      const { data, error } = await connection
        .from('conversations')
        .insert(payload)
        .select();

      if (error) throw error;

      this._recordTiming('insertMessage', Date.now() - start);
      return data[0];
    } finally {
      if (this.pool) {
        this.pool.releaseConnection(connection);
      }
    }
  }

  async insertMessages(messageDataArray) {
    const connection = this.pool ? await this.pool.getConnection() : this.supabase;
    const start = Date.now();
    try {
      const payloads = messageDataArray.map((msg) => ({
        phone_number: msg.phoneNumber,
        message: msg.message,
        direction: msg.direction || 'incoming',
        timestamp: msg.timestamp || new Date().toISOString(),
        sender_phone_number: msg.senderPhoneNumber || null,
        message_id: msg.messageId || null,
        classification_id: msg.classificationId || null,
        vertical_tag: msg.verticalTag || null,
        metadata: msg.metadata || {},
        customer_id: msg.customerId || null,
      }));

      if (payloads.length === 0) return [];

      const { data, error } = await connection
        .from('conversations')
        .insert(payloads)
        .select();

      if (error) throw error;

      this._recordTiming('insertMessages', Date.now() - start);
      return data;
    } finally {
      if (this.pool) {
        this.pool.releaseConnection(connection);
      }
    }
  }

  async getConversationsByPhone(phoneNumber, options = {}) {
    const connection = this.pool ? await this.pool.getConnection() : this.supabase;
    const start = Date.now();
    try {
      let query = connection
        .from('conversations')
        .select('*', { count: 'exact' })
        .eq('phone_number', phoneNumber);

      if (options.vertical) {
        query = query.eq('vertical_tag', options.vertical);
      }

      if (options.after) {
        query = query.gte('timestamp', options.after);
      }

      if (options.before) {
        query = query.lte('timestamp', options.before);
      }

      query = query.order('timestamp', { ascending: false });

      if (options.limit) {
        query = query.limit(options.limit + 1);
      } else {
        query = query.limit(51);
      }

      if (options.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
      }

      const { data, error, count } = await query;

      if (error) throw error;

      this._recordTiming('getConversationsByPhone', Date.now() - start);

      const messages = data || [];
      const limit = options.limit || 50;
      const hasMore = messages.length > limit;

      return {
        phone_number: phoneNumber,
        messages: hasMore ? messages.slice(0, limit) : messages,
        total_count: count || messages.length,
        has_more: hasMore,
      };
    } finally {
      if (this.pool) {
        this.pool.releaseConnection(connection);
      }
    }
  }

  async searchMessages(searchTerm, options = {}) {
    const connection = this.pool ? await this.pool.getConnection() : this.supabase;
    const start = Date.now();
    try {
      let query = connection
        .from('conversations')
        .select('*', { count: 'exact' })
        .textSearch('message', searchTerm);

      if (options.vertical) {
        query = query.eq('vertical_tag', options.vertical);
      }

      query = query.order('timestamp', { ascending: false });

      if (options.limit) {
        query = query.limit(options.limit);
      }

      const { data, error, count } = await query;

      if (error) throw error;

      this._recordTiming('searchMessages', Date.now() - start);

      return {
        messages: data || [],
        total_count: count || 0,
        search_term: searchTerm,
      };
    } finally {
      if (this.pool) {
        this.pool.releaseConnection(connection);
      }
    }
  }

  async getIndexHealth() {
    const start = Date.now();
    try {
      const { data, error } = await this.supabase.rpc('index_health_check');
      if (error) {
        return { status: 'unknown', indexes: [], error: error.message };
      }
      this._recordTiming('getIndexHealth', Date.now() - start);
      return data;
    } catch (err) {
      return { status: 'unknown', indexes: [], error: err.message };
    }
  }

  generateMessageId() {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  _recordTiming(operation, durationMs) {
    this.queryTimings.push({ operation, durationMs, timestamp: Date.now() });
  }

  getQueryTimings() {
    const timings = this.queryTimings;
    if (timings.length === 0) {
      return { avgDurationMs: 0, count: 0 };
    }
    const total = timings.reduce((sum, t) => sum + t.durationMs, 0);
    return {
      avgDurationMs: Math.round(total / timings.length),
      count: timings.length,
    };
  }
}

// ---------------------------------------------------------------------------
// Express App
// ---------------------------------------------------------------------------
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : createClient('https://placeholder.supabase.co', 'placeholder-key');

const pool = new ConnectionPool();
const conversationStorage = new SupabaseConversationStorage(supabase, pool);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    data: {
      status: 'ok',
      service: 'conversation-storage',
      timestamp: new Date().toISOString(),
    },
    meta: { timestamp: Date.now() },
  });
});

// POST /api/conversations — store a message
app.post('/api/conversations', async (req, res) => {
  try {
    const { phone_number, message, direction, metadata, vertical_tag, classification_id, sender_phone_number } = req.body;

    if (!phone_number) {
      return res.status(400).json({
        error: { message: 'phone_number is required', code: 400 },
      });
    }
    if (!message) {
      return res.status(400).json({
        error: { message: 'message is required', code: 400 },
      });
    }

    const result = await conversationStorage.insertMessage({
      phoneNumber: phone_number,
      message,
      direction,
      verticalTag: vertical_tag,
      classificationId: classification_id,
      senderPhoneNumber: sender_phone_number,
      metadata,
    });

    res.status(201).json({
      data: result,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    console.error('Insert error:', error);
    res.status(500).json({
      error: { message: 'Failed to store message', code: 500, details: error.message },
    });
  }
});

// POST /api/conversations/batch — batch insert
app.post('/api/conversations/batch', async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: { message: 'messages array is required', code: 400 },
      });
    }
    if (messages.length === 0) {
      return res.status(400).json({
        error: { message: 'messages array must not be empty', code: 400 },
      });
    }
    if (messages.length > 100) {
      return res.status(400).json({
        error: { message: 'Batch size cannot exceed 100 messages', code: 400 },
      });
    }

    const results = await conversationStorage.insertMessages(messages);

    res.status(201).json({
      data: { inserted: results.length, messages: results },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    console.error('Batch insert error:', error);
    res.status(500).json({
      error: { message: 'Failed to batch insert messages', code: 500, details: error.message },
    });
  }
});

// GET /api/conversations/search — search messages (MUST be before :phone route)
app.get('/api/conversations/search', async (req, res) => {
  try {
    const { q, limit, vertical } = req.query;

    if (!q) {
      return res.status(400).json({
        error: { message: 'Search query (q) is required', code: 400 },
      });
    }

    const results = await conversationStorage.searchMessages(q, {
      limit: parseInt(limit, 10) || 20,
      vertical,
    });

    res.json({
      data: results,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      error: { message: 'Search failed', code: 500, details: error.message },
    });
  }
});

// GET /api/conversations/:phone — get conversations by phone
app.get('/api/conversations/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const { limit, offset, after, before, vertical } = req.query;

    const result = await conversationStorage.getConversationsByPhone(phone, {
      limit: parseInt(limit, 10) || 50,
      offset: parseInt(offset, 10) || 0,
      after,
      before,
      vertical,
    });

    if (result.messages.length === 0) {
      return res.status(404).json({
        error: { message: 'No conversations found for this phone number', code: 404 },
      });
    }

    res.json({
      data: result,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({
      error: { message: 'Failed to get conversations', code: 500, details: error.message },
    });
  }
});

// GET /api/conversations/monitor/performance
app.get('/api/conversations/monitor/performance', (req, res) => {
  res.json({
    data: {
      query_performance: conversationStorage.getQueryTimings(),
      connection_pool: pool.getStatus(),
    },
    meta: { timestamp: Date.now() },
  });
});

// GET /api/conversations/monitor/index-health
app.get('/api/conversations/monitor/index-health', async (req, res) => {
  try {
    const health = await conversationStorage.getIndexHealth();
    res.json({
      data: health,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Index health check failed', code: 500, details: error.message },
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
const PORT = process.env.PORT || 3000;
if (process.env.MOCHA_TEST_MODE !== 'true') {
  app.listen(PORT, () => {
    console.log(`Conversation storage service running on port ${PORT}`);
  });
}

module.exports = {
  app,
  SupabaseConversationStorage,
  ConnectionPool,
  conversationStorage,
};
