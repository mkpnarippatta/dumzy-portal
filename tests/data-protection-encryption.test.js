process.env.MOCHA_TEST_MODE = 'true';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.ENCRYPTION_KEY_VERSION = '1';

const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');
const crypto = require('crypto');

const {
  app,
  EncryptionService,
  TLSService,
  AccessControlService,
  AuditLogger,
  encryptionService,
  tlsService,
  accessControlService,
  auditLogger,
} = require('../src/7-2-data-protection-encryption');

// ---------------------------------------------------------------------------
// EncryptionService
// ---------------------------------------------------------------------------
describe('EncryptionService', () => {
  describe('encrypt / decrypt', () => {
    it('should encrypt and decrypt a string', () => {
      const service = new EncryptionService({ key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
      const encrypted = service.encrypt('Hello, World!');
      expect(encrypted).to.have.property('iv');
      expect(encrypted).to.have.property('encryptedData');
      expect(encrypted.iv).to.be.a('string');
      expect(encrypted.encryptedData).to.be.a('string');

      const decrypted = service.decrypt(encrypted);
      expect(decrypted).to.equal('Hello, World!');
    });

    it('should handle empty string', () => {
      const service = new EncryptionService({ key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
      const encrypted = service.encrypt('');
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).to.equal('');
    });

    it('should handle special characters', () => {
      const service = new EncryptionService({ key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
      const encrypted = service.encrypt('Price: ₹500 & special chars: üñíçødé! @#$%');
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).to.equal('Price: ₹500 & special chars: üñíçødé! @#$%');
    });

    it('should produce different ciphertext each time (IV randomization)', () => {
      const service = new EncryptionService({ key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
      const enc1 = service.encrypt('same text');
      const enc2 = service.encrypt('same text');
      expect(enc1.encryptedData).to.not.equal(enc2.encryptedData);
    });

    it('should fail to decrypt with wrong key', () => {
      const service1 = new EncryptionService({ key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
      const service2 = new EncryptionService({ key: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' });
      const encrypted = service1.encrypt('secret data');
      expect(() => service2.decrypt(encrypted)).to.throw();
    });
  });

  describe('encryptObject / decryptObject', () => {
    it('should encrypt specified PII fields only', () => {
      const service = new EncryptionService({ key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
      const obj = {
        name: 'John Doe',
        phone: '+911234567890',
        bookingRef: 'BK-001',
        amount: 500,
      };
      const encrypted = service.encryptObject(obj, ['phone']);
      expect(encrypted.name).to.equal('John Doe');
      expect(encrypted.bookingRef).to.equal('BK-001');
      expect(encrypted.amount).to.equal(500);
      expect(encrypted.phone).to.not.equal('+911234567890');
      expect(encrypted.phone).to.have.property('iv');
      expect(encrypted.phone).to.have.property('encryptedData');
    });

    it('should decrypt specified fields', () => {
      const service = new EncryptionService({ key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
      const obj = { name: 'Alice', phone: '+919876543210' };
      const encrypted = service.encryptObject(obj, ['phone']);
      const decrypted = service.decryptObject(encrypted, ['phone']);
      expect(decrypted.name).to.equal('Alice');
      expect(decrypted.phone).to.equal('+919876543210');
    });

    it('should handle multiple PII fields', () => {
      const service = new EncryptionService({ key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
      const obj = { name: 'Bob', phone: '+911111111111', email: 'bob@test.com', age: 30 };
      const encrypted = service.encryptObject(obj, ['phone', 'email']);
      const decrypted = service.decryptObject(encrypted, ['phone', 'email']);
      expect(decrypted.name).to.equal('Bob');
      expect(decrypted.phone).to.equal('+911111111111');
      expect(decrypted.email).to.equal('bob@test.com');
      expect(decrypted.age).to.equal(30);
    });
  });

  describe('key rotation', () => {
    it('should support key version tracking', () => {
      const service = new EncryptionService({ key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', keyVersion: 1 });
      const encrypted = service.encrypt('test');
      expect(encrypted.keyVersion).to.equal(1);
    });
  });
});

// ---------------------------------------------------------------------------
// TLSService
// ---------------------------------------------------------------------------
describe('TLSService', () => {
  it('should wrap and unwrap payload', () => {
    const tls = new TLSService();
    const payload = { message: 'Hello', amount: 500 };
    const wrapped = tls.wrapForTransit(payload);
    expect(wrapped).to.have.property('iv');
    expect(wrapped).to.have.property('encryptedData');

    const unwrapped = tls.unwrapFromTransit(wrapped);
    expect(unwrapped.message).to.equal('Hello');
    expect(unwrapped.amount).to.equal(500);
  });

  it('should return TLS 1.3 protocol', () => {
    const tls = new TLSService();
    expect(tls.getProtocol()).to.equal('TLS 1.3');
  });

  it('should track encryption stats', () => {
    const tls = new TLSService();
    tls.wrapForTransit({ test: 'data' });
    tls.wrapForTransit({ another: 'payload' });
    const stats = tls.getStats();
    expect(stats).to.have.property('bytesEncrypted');
    expect(stats).to.have.property('operations', 2);
  });

  it('should handle JSON serializable objects', () => {
    const tls = new TLSService();
    const complex = { numbers: [1, 2, 3], nested: { key: 'value' }, flag: true, count: 42 };
    const wrapped = tls.wrapForTransit(complex);
    const unwrapped = tls.unwrapFromTransit(wrapped);
    expect(unwrapped).to.deep.equal(complex);
  });
});

// ---------------------------------------------------------------------------
// AccessControlService
// ---------------------------------------------------------------------------
describe('AccessControlService', () => {
  let acs;

  beforeEach(() => {
    acs = new AccessControlService();
  });

  describe('hasPermission', () => {
    it('should grant admin full access', () => {
      expect(acs.hasPermission('admin', 'read', 'customer_phone')).to.be.true;
      expect(acs.hasPermission('admin', 'write', 'id_documents')).to.be.true;
      expect(acs.hasPermission('admin', 'delete', 'audit_logs')).to.be.true;
    });

    it('should grant operator access to customer_phone and booking_history', () => {
      expect(acs.hasPermission('operator', 'read', 'customer_phone')).to.be.true;
      expect(acs.hasPermission('operator', 'read', 'booking_history')).to.be.true;
      expect(acs.hasPermission('operator', 'read', 'id_documents')).to.be.false;
    });

    it('should grant auditor read-only access to audit_logs', () => {
      expect(acs.hasPermission('auditor', 'read', 'audit_logs')).to.be.true;
      expect(acs.hasPermission('auditor', 'write', 'customer_phone')).to.be.false;
    });

    it('should reject unknown roles', () => {
      expect(acs.hasPermission('hacker', 'read', 'customer_phone')).to.be.false;
    });
  });

  describe('grantAccess / checkAccess', () => {
    it('should grant access to a requester with a role', () => {
      acs.grantAccess('agent-1', 'operator', ['bike_rental']);
      expect(acs.checkAccess('agent-1', 'read', 'customer_phone')).to.be.true;
    });

    it('should deny access for unauthorized requester', () => {
      expect(acs.checkAccess('unknown', 'read', 'customer_phone')).to.be.false;
    });

    it('should deny access when requester lacks permission for data scope', () => {
      acs.grantAccess('agent-2', 'operator', ['hotel']);
      expect(acs.checkAccess('agent-2', 'read', 'id_documents')).to.be.false;
    });

    it('should update existing grant', () => {
      acs.grantAccess('agent-3', 'support', ['bike_rental']);
      expect(acs.checkAccess('agent-3', 'read', 'booking_history')).to.be.true;

      acs.grantAccess('agent-3', 'auditor', []);
      expect(acs.checkAccess('agent-3', 'read', 'audit_logs')).to.be.true;
      expect(acs.checkAccess('agent-3', 'read', 'booking_history')).to.be.false;
    });
  });

  describe('getRoles', () => {
    it('should return all defined roles', () => {
      const roles = acs.getRoles();
      expect(roles).to.have.all.keys('admin', 'operator', 'auditor', 'support');
    });
  });
});

// ---------------------------------------------------------------------------
// AuditLogger
// ---------------------------------------------------------------------------
describe('AuditLogger', () => {
  let logger;

  beforeEach(() => {
    logger = new AuditLogger({ retentionDays: 365 });
  });

  describe('logAccess', () => {
    it('should create an access log entry', () => {
      logger.logAccess('agent-1', 'read', 'customer_phone', 'cust-123', true);
      const logs = logger.getAccessLogs();
      expect(logs).to.have.length(1);
      expect(logs[0]).to.have.property('requesterId', 'agent-1');
      expect(logs[0]).to.have.property('action', 'read');
      expect(logs[0]).to.have.property('dataScope', 'customer_phone');
      expect(logs[0]).to.have.property('resourceId', 'cust-123');
      expect(logs[0]).to.have.property('allowed', true);
      expect(logs[0]).to.have.property('timestamp');
    });
  });

  describe('getAccessLogs', () => {
    it('should filter by requesterId', () => {
      logger.logAccess('agent-1', 'read', 'customer_phone', 'c1', true);
      logger.logAccess('agent-2', 'read', 'booking_history', 'c2', true);
      logger.logAccess('agent-1', 'read', 'audit_logs', 'c3', true);

      const agent1Logs = logger.getAccessLogs({ requesterId: 'agent-1' });
      expect(agent1Logs).to.have.length(2);
    });

    it('should filter by dataScope', () => {
      logger.logAccess('a1', 'read', 'customer_phone', 'c1', true);
      logger.logAccess('a1', 'read', 'booking_history', 'c2', false);

      const phoneLogs = logger.getAccessLogs({ dataScope: 'customer_phone' });
      expect(phoneLogs).to.have.length(1);
    });

    it('should return logs sorted by timestamp descending', () => {
      logger.logAccess('a1', 'read', 'customer_phone', 'c1', true);

      return new Promise(resolve => setTimeout(resolve, 20)).then(() => {
        logger.logAccess('a2', 'read', 'booking_history', 'c2', true);
        const logs = logger.getAccessLogs();
        expect(logs[0].requesterId).to.equal('a2');
      });
    });
  });

  describe('getAccessLogsByUser', () => {
    it('should return all logs for a specific user', () => {
      logger.logAccess('user-1', 'read', 'customer_phone', 'c1', true);
      logger.logAccess('user-2', 'read', 'booking_history', 'c2', false);
      logger.logAccess('user-1', 'read', 'audit_logs', 'c3', true);

      const logs = logger.getAccessLogsByUser('user-1');
      expect(logs).to.have.length(2);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------
describe('Integration: PII Encryption and Access', () => {
  it('should complete full cycle: encrypt PII → access control → audit log', () => {
    const service = new EncryptionService({ key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
    const acs = new AccessControlService();
    const audit = new AuditLogger();

    // Grant access
    acs.grantAccess('operator-1', 'operator', ['bike_rental']);

    // Encrypt PII data
    const customer = { name: 'Raj', phone: '+919999999999', bookingRef: 'BR-2026' };
    const secured = service.encryptObject(customer, ['phone']);

    // Verify phone is encrypted but other fields are readable
    expect(secured.name).to.equal('Raj');
    expect(secured.bookingRef).to.equal('BR-2026');
    expect(secured.phone).to.not.equal('+919999999999');

    // Access control check and audit
    const hasAccess = acs.checkAccess('operator-1', 'read', 'customer_phone');
    audit.logAccess('operator-1', 'read', 'customer_phone', 'cust-raj', hasAccess);

    expect(hasAccess).to.be.true;
    expect(audit.getAccessLogs()).to.have.length(1);
    expect(audit.getAccessLogs()[0].allowed).to.be.true;
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('Edge cases', () => {
  it('should handle very long text', () => {
    const service = new EncryptionService({ key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
    const longText = 'A'.repeat(10000);
    const encrypted = service.encrypt(longText);
    const decrypted = service.decrypt(encrypted);
    expect(decrypted).to.equal(longText);
  });

  it('should handle non-string object field values', () => {
    const service = new EncryptionService({ key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
    const obj = { name: 'Test', count: 42, active: true, meta: { key: 'val' } };
    const encrypted = service.encryptObject(obj, ['name', 'count']);
    expect(encrypted.count).to.not.equal(42);
    const decrypted = service.decryptObject(encrypted, ['name', 'count']);
    expect(decrypted.name).to.equal('Test');
  });

  it('should deny access for revoked role', () => {
    const acs = new AccessControlService();
    acs.grantAccess('temp-agent', 'operator', ['hotel']);
    expect(acs.checkAccess('temp-agent', 'read', 'customer_phone')).to.be.true;

    acs.grantAccess('temp-agent', 'support', ['hotel']);
    // Support role may have different permissions
    expect(acs.checkAccess('temp-agent', 'read', 'id_documents')).to.be.false;
  });

  it('should handle encryptObject with empty PII fields array', () => {
    const service = new EncryptionService({ key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
    const obj = { name: 'Test', phone: '+911234567890' };
    const encrypted = service.encryptObject(obj, []);
    expect(encrypted).to.deep.equal(obj);
  });
});

// ---------------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------------
describe('API endpoints', () => {
  describe('GET /api/health', () => {
    it('should return health ok', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).to.equal(200);
      expect(res.body.data.status).to.equal('ok');
    });
  });

  describe('POST /api/compliance/encrypt', () => {
    it('should encrypt a value', async () => {
      const res = await request(app)
        .post('/api/compliance/encrypt')
        .send({ value: 'Hello, World!' });
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.property('iv');
      expect(res.body.data).to.have.property('encryptedData');
    });

    it('should return 400 without value', async () => {
      const res = await request(app)
        .post('/api/compliance/encrypt')
        .send({});
      expect(res.status).to.equal(400);
    });
  });

  describe('POST /api/compliance/decrypt', () => {
    it('should decrypt an encrypted value', async () => {
      const encRes = await request(app)
        .post('/api/compliance/encrypt')
        .send({ value: 'Secret message' });

      const decRes = await request(app)
        .post('/api/compliance/decrypt')
        .send({ iv: encRes.body.data.iv, encryptedData: encRes.body.data.encryptedData });
      expect(decRes.status).to.equal(200);
      expect(decRes.body.data.value).to.equal('Secret message');
    });
  });

  describe('POST /api/compliance/transit/encrypt', () => {
    it('should encrypt payload for transit', async () => {
      const res = await request(app)
        .post('/api/compliance/transit/encrypt')
        .send({ payload: { message: 'Hello', count: 42 } });
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.property('iv');
      expect(res.body.data).to.have.property('encryptedData');
    });
  });

  describe('POST /api/compliance/transit/decrypt', () => {
    it('should decrypt transit payload', async () => {
      const encRes = await request(app)
        .post('/api/compliance/transit/encrypt')
        .send({ payload: { test: 'data' } });

      const decRes = await request(app)
        .post('/api/compliance/transit/decrypt')
        .send({ iv: encRes.body.data.iv, encryptedData: encRes.body.data.encryptedData });
      expect(decRes.status).to.equal(200);
      expect(decRes.body.data.payload.test).to.equal('data');
    });
  });

  describe('GET /api/compliance/access/roles', () => {
    it('should return all roles', async () => {
      const res = await request(app).get('/api/compliance/access/roles');
      expect(res.status).to.equal(200);
      expect(res.body.data.roles).to.have.all.keys('admin', 'operator', 'auditor', 'support');
    });
  });

  describe('POST /api/compliance/access/check', () => {
    it('should check access for a requester', async () => {
      const res = await request(app)
        .post('/api/compliance/access/check')
        .send({ requesterId: 'admin-1', action: 'read', dataScope: 'customer_phone' });
      expect(res.status).to.equal(200);
      expect(res.body.data.allowed).to.be.true;
    });

    it('should return 400 without requesterId', async () => {
      const res = await request(app)
        .post('/api/compliance/access/check')
        .send({ action: 'read', dataScope: 'customer_phone' });
      expect(res.status).to.equal(400);
    });
  });

  describe('GET /api/compliance/access/logs', () => {
    it('should return access logs', async () => {
      const res = await request(app).get('/api/compliance/access/logs');
      expect(res.status).to.equal(200);
      expect(res.body.data.logs).to.be.an('array');
    });
  });
});
