require('dotenv').config();
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// EncryptionService — AES-256-CBC encryption for PII fields
// ---------------------------------------------------------------------------
class EncryptionService {
  constructor(options = {}) {
    this.algorithm = 'aes-256-cbc';
    this.key = Buffer.from(
      options.key || process.env.ENCRYPTION_KEY || this._generateKey(),
      'hex',
    );
    this.keyVersion = options.keyVersion !== undefined
      ? options.keyVersion
      : parseInt(process.env.ENCRYPTION_KEY_VERSION, 10) || 1;

    if (this.key.length !== 32) {
      throw new Error('Encryption key must be 32 bytes (64 hex characters)');
    }
  }

  _generateKey() {
    const key = crypto.randomBytes(32).toString('hex');
    console.warn('WARNING: ENCRYPTION_KEY not set. Generated temporary key. Set ENCRYPTION_KEY in environment for persistence.');
    return key;
  }

  encrypt(plaintext) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return {
      iv: iv.toString('base64'),
      encryptedData: encrypted,
      keyVersion: this.keyVersion,
    };
  }

  decrypt(encrypted) {
    const iv = Buffer.from(encrypted.iv, 'base64');
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    let decrypted = decipher.update(encrypted.encryptedData, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  encryptObject(obj, piiFields) {
    const result = { ...obj };
    for (const field of piiFields) {
      if (result[field] !== undefined && result[field] !== null) {
        result[field] = this.encrypt(String(result[field]));
      }
    }
    return result;
  }

  decryptObject(obj, piiFields) {
    const result = { ...obj };
    for (const field of piiFields) {
      if (result[field] && typeof result[field] === 'object' && result[field].iv && result[field].encryptedData) {
        result[field] = this.decrypt(result[field]);
      }
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// TLSService — simulated TLS 1.3 encryption for data in transit
// ---------------------------------------------------------------------------
class TLSService {
  constructor(options = {}) {
    this.protocol = 'TLS 1.3';
    this._sessionKey = options.sessionKey || crypto.randomBytes(32).toString('hex');
    this.stats = { bytesEncrypted: 0, operations: 0 };
  }

  wrapForTransit(payload) {
    const json = JSON.stringify(payload);
    const iv = crypto.randomBytes(16);
    const key = Buffer.from(this._sessionKey, 'hex');
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(json, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    this.stats.bytesEncrypted += Buffer.byteLength(json, 'utf8');
    this.stats.operations++;

    return { iv: iv.toString('base64'), encryptedData: encrypted };
  }

  unwrapFromTransit(wrapped) {
    const iv = Buffer.from(wrapped.iv, 'base64');
    const key = Buffer.from(this._sessionKey, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(wrapped.encryptedData, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  }

  getProtocol() {
    return this.protocol;
  }

  getStats() {
    return { ...this.stats };
  }
}

// ---------------------------------------------------------------------------
// AccessControlService — role-based access control
// ---------------------------------------------------------------------------
class AccessControlService {
  constructor(options = {}) {
    this.roles = {
      admin: {
        permissions: [
          { action: '*', scope: '*' },
        ],
      },
      operator: {
        permissions: [
          { action: 'read', scope: 'customer_phone' },
          { action: 'read', scope: 'booking_history' },
          { action: 'read', scope: 'chat_logs' },
          { action: 'write', scope: 'booking_history' },
        ],
      },
      auditor: {
        permissions: [
          { action: 'read', scope: 'audit_logs' },
        ],
      },
      support: {
        permissions: [
          { action: 'read', scope: 'customer_phone' },
          { action: 'read', scope: 'booking_history' },
          { action: 'read', scope: 'chat_logs' },
        ],
      },
    };
    this.assignments = {}; // requesterId → { role, verticals }
  }

  hasPermission(role, action, dataScope) {
    const roleDef = this.roles[role];
    if (!roleDef) return false;

    return roleDef.permissions.some(p =>
      (p.action === '*' || p.action === action) &&
      (p.scope === '*' || p.scope === dataScope),
    );
  }

  grantAccess(requesterId, role, verticals) {
    this.assignments[requesterId] = { role, verticals: verticals || [] };
  }

  checkAccess(requesterId, action, dataScope) {
    const assignment = this.assignments[requesterId];
    if (!assignment) return false;
    return this.hasPermission(assignment.role, action, dataScope);
  }

  getRoles() {
    return { ...this.roles };
  }
}

// ---------------------------------------------------------------------------
// AuditLogger — records data access events
// ---------------------------------------------------------------------------
class AuditLogger {
  constructor(options = {}) {
    this.logs = [];
    this.retentionDays = options.retentionDays
      || parseInt(process.env.ACCESS_LOG_RETENTION_DAYS, 10) || 365;
    this._logCounter = 0;
  }

  logAccess(requesterId, action, dataScope, resourceId, allowed) {
    this._logCounter++;
    const entry = {
      id: `log-${Date.now()}-${this._logCounter}`,
      timestamp: new Date().toISOString(),
      requesterId,
      action,
      dataScope,
      resourceId: resourceId || null,
      allowed,
    };
    this.logs.push(entry);
    this._pruneOldLogs();
    return entry;
  }

  getAccessLogs(filters) {
    let result = [...this.logs];

    if (filters) {
      if (filters.requesterId) {
        result = result.filter(l => l.requesterId === filters.requesterId);
      }
      if (filters.dataScope) {
        result = result.filter(l => l.dataScope === filters.dataScope);
      }
      if (filters.action) {
        result = result.filter(l => l.action === filters.action);
      }
      if (filters.allowed !== undefined) {
        result = result.filter(l => l.allowed === filters.allowed);
      }
      if (filters.dateFrom) {
        const from = new Date(filters.dateFrom).getTime();
        result = result.filter(l => new Date(l.timestamp).getTime() >= from);
      }
      if (filters.dateTo) {
        const to = new Date(filters.dateTo).getTime();
        result = result.filter(l => new Date(l.timestamp).getTime() <= to);
      }
    }

    return result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  getAccessLogsByUser(requesterId) {
    return this.getAccessLogs({ requesterId });
  }

  _pruneOldLogs() {
    if (this.retentionDays <= 0) return;
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    this.logs = this.logs.filter(l => new Date(l.timestamp).getTime() >= cutoff);
  }
}

// ---------------------------------------------------------------------------
// Module-level instances
// ---------------------------------------------------------------------------
const encryptionService = new EncryptionService();
const tlsService = new TLSService();
const accessControlService = new AccessControlService();
const auditLogger = new AuditLogger();

// Grant admin access by default
accessControlService.grantAccess('admin-1', 'admin', []);

// ---------------------------------------------------------------------------
// Express API Routes
// ---------------------------------------------------------------------------

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    data: {
      status: 'ok',
      service: 'data-protection-encryption',
      timestamp: new Date().toISOString(),
    },
    meta: { timestamp: Date.now() },
  });
});

// POST /api/compliance/encrypt — encrypt a value
app.post('/api/compliance/encrypt', (req, res) => {
  try {
    const { value } = req.body;
    if (value === undefined || value === null) {
      return res.status(400).json({
        error: { message: 'value is required', code: 400 },
      });
    }
    const result = encryptionService.encrypt(String(value));
    res.json({
      data: result,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Encryption failed', code: 500, details: error.message },
    });
  }
});

// POST /api/compliance/decrypt — decrypt a value
app.post('/api/compliance/decrypt', (req, res) => {
  try {
    const { iv, encryptedData } = req.body;
    if (!iv || !encryptedData) {
      return res.status(400).json({
        error: { message: 'iv and encryptedData are required', code: 400 },
      });
    }
    const value = encryptionService.decrypt({ iv, encryptedData, keyVersion: encryptionService.keyVersion });
    res.json({
      data: { value },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(400).json({
      error: { message: 'Decryption failed', code: 400, details: error.message },
    });
  }
});

// POST /api/compliance/transit/encrypt — encrypt for transit
app.post('/api/compliance/transit/encrypt', (req, res) => {
  try {
    const { payload } = req.body;
    if (payload === undefined || payload === null) {
      return res.status(400).json({
        error: { message: 'payload is required', code: 400 },
      });
    }
    const result = tlsService.wrapForTransit(payload);
    res.json({
      data: result,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Transit encryption failed', code: 500, details: error.message },
    });
  }
});

// POST /api/compliance/transit/decrypt — decrypt from transit
app.post('/api/compliance/transit/decrypt', (req, res) => {
  try {
    const { iv, encryptedData } = req.body;
    if (!iv || !encryptedData) {
      return res.status(400).json({
        error: { message: 'iv and encryptedData are required', code: 400 },
      });
    }
    const payload = tlsService.unwrapFromTransit({ iv, encryptedData });
    res.json({
      data: { payload },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(400).json({
      error: { message: 'Transit decryption failed', code: 400, details: error.message },
    });
  }
});

// GET /api/compliance/access/roles — list roles
app.get('/api/compliance/access/roles', (req, res) => {
  try {
    const roles = accessControlService.getRoles();
    res.json({
      data: { roles },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get roles', code: 500, details: error.message },
    });
  }
});

// POST /api/compliance/access/check — check access
app.post('/api/compliance/access/check', (req, res) => {
  try {
    const { requesterId, action, dataScope } = req.body;
    if (!requesterId) {
      return res.status(400).json({
        error: { message: 'requesterId is required', code: 400 },
      });
    }
    if (!action) {
      return res.status(400).json({
        error: { message: 'action is required', code: 400 },
      });
    }
    if (!dataScope) {
      return res.status(400).json({
        error: { message: 'dataScope is required', code: 400 },
      });
    }

    const allowed = accessControlService.checkAccess(requesterId, action, dataScope);
    auditLogger.logAccess(requesterId, action, dataScope, null, allowed);

    res.json({
      data: { requesterId, action, dataScope, allowed },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Access check failed', code: 500, details: error.message },
    });
  }
});

// GET /api/compliance/access/logs — retrieve access logs
app.get('/api/compliance/access/logs', (req, res) => {
  try {
    const { requesterId, dataScope, action } = req.query;
    const filters = {};
    if (requesterId) filters.requesterId = requesterId;
    if (dataScope) filters.dataScope = dataScope;
    if (action) filters.action = action;

    const logs = auditLogger.getAccessLogs(Object.keys(filters).length > 0 ? filters : null);
    res.json({
      data: { logs, total: logs.length },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get access logs', code: 500, details: error.message },
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
const PORT = process.env.PORT || process.env.COMPLIANCE_PORT || 3010;
if (process.env.MOCHA_TEST_MODE !== 'true') {
  app.listen(PORT, () => {
    console.log(`Data Protection & Encryption service running on port ${PORT}`);
  });
}

module.exports = {
  app,
  EncryptionService,
  TLSService,
  AccessControlService,
  AuditLogger,
  encryptionService,
  tlsService,
  accessControlService,
  auditLogger,
};
