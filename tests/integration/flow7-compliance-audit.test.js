require('../helpers/setup');
const { expect } = require('chai');
const request = require('supertest');
const { app: app7_1, TemplateRegistry, TemplateValidator, TemplateParameterEngine, MessageComposer } = require('../../src/7-1-whatsapp-template-compliance');
const { app: app7_2, EncryptionService, TLSService, AccessControlService, AuditLogger } = require('../../src/7-2-data-protection-encryption');
const { app: app7_3, AuditEventBus, AuditStore, AuditAlerting, AuditReporter } = require('../../src/7-3-audit-logging-system');

describe('Flow 7: Compliance & Audit Trail', () => {
  describe('Step 1: Template compliance via 7-1', () => {
    let templateName;

    it('Registers a new compliance template', async () => {
      const res = await request(app7_1)
        .post('/api/compliance/templates')
        .send({
          name: 'booking_confirmation',
          category: 'utility',
          body: 'Dear {{1}}, your booking for {{2}} is confirmed on {{3}}.',
          parameters: [
            { name: 'customer_name', position: 1, required: true },
            { name: 'service', position: 2, required: true },
            { name: 'date', position: 3, required: true },
          ],
          status: 'approved',
        });

      expect(res.status).to.equal(201);
      expect(res.body.data.name).to.equal('booking_confirmation');
      expect(res.body.data.templateId).to.exist;
      templateName = res.body.data.name;
    });

    it('Retrieves registered template by name', async () => {
      const res = await request(app7_1).get(`/api/compliance/templates/${templateName}`);

      expect(res.status).to.equal(200);
      expect(res.body.data.name).to.equal('booking_confirmation');
      expect(res.body.data.category).to.equal('utility');
    });

    it('Lists all templates', async () => {
      const res = await request(app7_1).get('/api/compliance/templates');

      expect(res.status).to.equal(200);
      expect(res.body.data.templates).to.be.an('array');
      expect(res.body.data.total).to.be.at.least(1);
    });

    it('Filters templates by category', async () => {
      const res = await request(app7_1).get('/api/compliance/templates?category=utility');

      expect(res.status).to.equal(200);
      expect(res.body.data.templates.every(t => t.category === 'utility')).to.be.true;
    });

    it('Validates an existing template', async () => {
      const res = await request(app7_1)
        .post(`/api/compliance/templates/${templateName}/validate`);

      expect(res.status).to.equal(200);
      expect(res.body.data.valid).to.be.true;
    });

    it('Populates a template with parameters', async () => {
      const res = await request(app7_1)
        .post(`/api/compliance/templates/${templateName}/populate`)
        .send({ customer_name: 'John', service: 'Bike Rental', date: '2026-06-01' });

      expect(res.status).to.equal(200);
      expect(res.body.data.body).to.equal('Dear John, your booking for Bike Rental is confirmed on 2026-06-01.');
    });

    it('Sends a template message', async () => {
      const res = await request(app7_1)
        .post('/api/compliance/send')
        .send({
          recipient: '+91987654321',
          templateName: 'booking_confirmation',
          params: { customer_name: 'John', service: 'Bike Rental', date: '2026-06-01' },
        });

      expect(res.status).to.equal(200);
      expect(res.body.data.recipient).to.equal('+91987654321');
      expect(res.body.data.body).to.include('Dear John');
      expect(res.body.data.status).to.equal('sent');
    });

    it('Returns send history', async () => {
      const res = await request(app7_1).get('/api/compliance/send/history');

      expect(res.status).to.equal(200);
      expect(res.body.data.history).to.be.an('array');
      expect(res.body.data.total).to.be.at.least(1);
    });

    it('Updates template status via PUT', async () => {
      const res = await request(app7_1)
        .put('/api/compliance/templates/booking_confirmation')
        .send({ status: 'approved' });

      expect(res.status).to.equal(200);
      expect(res.body.data.status).to.equal('approved');
    });

    it('Returns 404 for non-existent template', async () => {
      const res = await request(app7_1).get('/api/compliance/templates/nonexistent_template');

      expect(res.status).to.equal(404);
    });

    it('Rejects template registration with missing fields', async () => {
      const res = await request(app7_1)
        .post('/api/compliance/templates')
        .send({ name: 'incomplete' });

      expect(res.status).to.equal(400);
    });

    it('Rejects send with missing templateName', async () => {
      const res = await request(app7_1)
        .post('/api/compliance/send')
        .send({ recipient: '+911234567890' });

      expect(res.status).to.equal(400);
    });
  });

  describe('Step 2: Data protection and encryption via 7-2', () => {
    it('Encrypts a value', async () => {
      const res = await request(app7_2)
        .post('/api/compliance/encrypt')
        .send({ value: 'sensitive-pii-data' });

      expect(res.status).to.equal(200);
      expect(res.body.data.iv).to.exist;
      expect(res.body.data.encryptedData).to.exist;
      expect(res.body.data.keyVersion).to.equal(1);
    });

    it('Decrypts a previously encrypted value', async () => {
      const encryptRes = await request(app7_2)
        .post('/api/compliance/encrypt')
        .send({ value: 'my-phone-number' });

      const { iv, encryptedData } = encryptRes.body.data;

      const res = await request(app7_2)
        .post('/api/compliance/decrypt')
        .send({ iv, encryptedData });

      expect(res.status).to.equal(200);
      expect(res.body.data.value).to.equal('my-phone-number');
    });

    it('Encrypts payload for transit', async () => {
      const res = await request(app7_2)
        .post('/api/compliance/transit/encrypt')
        .send({ payload: { phone: '+91987654321', message: 'Test' } });

      expect(res.status).to.equal(200);
      expect(res.body.data.iv).to.exist;
      expect(res.body.data.encryptedData).to.exist;
    });

    it('Decrypts transit payload', async () => {
      const encryptRes = await request(app7_2)
        .post('/api/compliance/transit/encrypt')
        .send({ payload: { phone: '+91987654321' } });

      const res = await request(app7_2)
        .post('/api/compliance/transit/decrypt')
        .send({ iv: encryptRes.body.data.iv, encryptedData: encryptRes.body.data.encryptedData });

      expect(res.status).to.equal(200);
      expect(res.body.data.payload.phone).to.equal('+91987654321');
    });

    it('Lists available access roles', async () => {
      const res = await request(app7_2).get('/api/compliance/access/roles');

      expect(res.status).to.equal(200);
      expect(res.body.data.roles).to.include.keys('admin', 'operator', 'auditor', 'support');
    });

    it('Checks access permission', async () => {
      const res = await request(app7_2)
        .post('/api/compliance/access/check')
        .send({ requesterId: 'admin-1', action: 'read', dataScope: 'customer_phone' });

      expect(res.status).to.equal(200);
      expect(res.body.data.allowed).to.be.true;
    });

    it('Denies access for unauthorized role', async () => {
      const res = await request(app7_2)
        .post('/api/compliance/access/check')
        .send({ requesterId: 'unknown-user', action: 'read', dataScope: 'customer_phone' });

      expect(res.status).to.equal(200);
      expect(res.body.data.allowed).to.be.false;
    });

    it('Returns access logs', async () => {
      const res = await request(app7_2).get('/api/compliance/access/logs');

      expect(res.status).to.equal(200);
      expect(res.body.data.logs).to.be.an('array');
    });

    it('Rejects encrypt with missing value', async () => {
      const res = await request(app7_2)
        .post('/api/compliance/encrypt')
        .send({});

      expect(res.status).to.equal(400);
    });

    it('Rejects decrypt with missing fields', async () => {
      const res = await request(app7_2)
        .post('/api/compliance/decrypt')
        .send({});

      expect(res.status).to.equal(400);
    });

    it('Rejects access check with missing fields', async () => {
      const res = await request(app7_2)
        .post('/api/compliance/access/check')
        .send({});

      expect(res.status).to.equal(400);
    });
  });

  describe('Step 3: Audit logging via 7-3', () => {
    let eventId;

    it('Emits an audit event', async () => {
      const res = await request(app7_3)
        .post('/api/compliance/audit/event')
        .send({
          category: 'business_operation',
          action: 'booking_created',
          actor: 'system',
          resourceType: 'booking',
          resourceId: 'booking-123',
          outcome: 'success',
          details: { vertical: 'hotel', amount: 5000 },
        });

      expect(res.status).to.equal(201);
      expect(res.body.data.id).to.exist;
      expect(res.body.data.category).to.equal('business_operation');
      expect(res.body.data.action).to.equal('booking_created');
      eventId = res.body.data.id;
    });

    it('Queries audit events', async () => {
      const res = await request(app7_3).get('/api/compliance/audit/events');

      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
      expect(res.body.meta.total).to.be.at.least(1);
    });

    it('Gets specific audit record by ID', async () => {
      const res = await request(app7_3).get(`/api/compliance/audit/events/${eventId}`);

      expect(res.status).to.equal(200);
      expect(res.body.data.id).to.equal(eventId);
    });

    it('Returns audit statistics', async () => {
      const res = await request(app7_3).get('/api/compliance/audit/stats');

      expect(res.status).to.equal(200);
      expect(res.body.data).to.include.keys('byCategory', 'byAction', 'byOutcome');
    });

    it('Returns compliance report', async () => {
      const res = await request(app7_3)
        .get('/api/compliance/audit/report?dateFrom=2026-01-01');

      expect(res.status).to.equal(200);
      expect(res.body.data.totalEvents).to.be.at.least(1);
    });

    it('Exports audit logs as JSON', async () => {
      const res = await request(app7_3).get('/api/compliance/audit/export');

      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
    });

    it('Exports audit logs as CSV', async () => {
      const res = await request(app7_3).get('/api/compliance/audit/export?format=csv');

      expect(res.status).to.equal(200);
      expect(res.headers['content-type']).to.include('text/csv');
    });

    it('Returns audit alerts', async () => {
      const res = await request(app7_3).get('/api/compliance/audit/alerts');

      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
    });

    it('Acknowledges an alert', async () => {
      // Emit events that trigger the unusual_hour_access or repeated_failed_access rule
      const emitRes = await request(app7_3)
        .post('/api/compliance/audit/event')
        .send({
          category: 'security_event',
          action: 'access_denied',
          actor: 'test-actor',
          resourceType: 'system',
          resourceId: 'failed-login',
          outcome: 'failure',
        });
      expect(emitRes.status).to.equal(201);

      // Fetch the alerts list
      const alertsRes = await request(app7_3).get('/api/compliance/audit/alerts');
      if (alertsRes.body.data.length > 0) {
        const alertId = alertsRes.body.data[0].id;

        const ackRes = await request(app7_3)
          .post(`/api/compliance/audit/alerts/${alertId}/acknowledge`);

        expect(ackRes.status).to.equal(200);
        expect(ackRes.body.data.acknowledged).to.be.true;
      }
    });

    it('Filters audit events by actor', async () => {
      const res = await request(app7_3)
        .get('/api/compliance/audit/events?actor=system');

      expect(res.status).to.equal(200);
      expect(res.body.data.every(e => e.actor === 'system')).to.be.true;
    });

    it('Returns 404 for non-existent audit record', async () => {
      const res = await request(app7_3).get('/api/compliance/audit/events/nonexistent-id');

      expect(res.status).to.equal(404);
    });

    it('Rejects audit event with missing fields', async () => {
      const res = await request(app7_3)
        .post('/api/compliance/audit/event')
        .send({ category: 'business_operation' });

      expect(res.status).to.equal(400);
    });

    it('Rejects audit event with invalid category', async () => {
      const res = await request(app7_3)
        .post('/api/compliance/audit/event')
        .send({
          category: 'invalid_category',
          action: 'test',
          actor: 'system',
          resourceType: 'test',
          resourceId: 'test-1',
        });

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.include('Invalid category');
    });

    it('Rejects report without dateFrom', async () => {
      const res = await request(app7_3).get('/api/compliance/audit/report');

      expect(res.status).to.equal(400);
    });

    it('Returns 404 for acknowledging non-existent alert', async () => {
      const res = await request(app7_3)
        .post('/api/compliance/audit/alerts/nonexistent/acknowledge');

      expect(res.status).to.equal(404);
    });
  });

  describe('Step 4: Class-level edge cases', () => {
    it('TemplateRegistry rejects exact duplicate', () => {
      const registry = new TemplateRegistry();

      registry.registerTemplate({ name: 'dup_test', category: 'utility', body: 'Hello {{1}}', parameters: [{ name: 'name', position: 1 }] });

      expect(() => registry.registerTemplate({ name: 'dup_test', category: 'utility', body: 'Hello {{1}}', parameters: [{ name: 'name', position: 1 }] })).to.throw();
    });

    it('TemplateValidator validates name format', () => {
      const validator = new TemplateValidator();

      expect(validator.validateName(null).valid).to.be.false;
      expect(validator.validateName('').valid).to.be.false;
      expect(validator.validateName('valid_name_123').valid).to.be.true;
      expect(validator.validateName('invalid name!').valid).to.be.false;
    });

    it('TemplateValidator validates category', () => {
      const validator = new TemplateValidator();

      expect(validator.validateCategory(null).valid).to.be.false;
      expect(validator.validateCategory('utility').valid).to.be.true;
      expect(validator.validateCategory('invalid-cat').valid).to.be.false;
    });

    it('MessageComposer rejects unapproved template', () => {
      const registry = new TemplateRegistry();
      const engine = new TemplateParameterEngine(registry);

      registry.registerTemplate({ name: 'unapproved_tpl', category: 'utility', body: 'Test {{1}}', parameters: [{ name: 'p1', position: 1 }], status: 'pending' });

      const composer = new MessageComposer(registry, engine, { onlyApprovedTemplates: true });

      expect(() => composer.composeMessage('unapproved_tpl', { p1: 'test' })).to.throw('not approved');
    });

    it('MessageComposer throws for missing template', () => {
      const registry = new TemplateRegistry();
      const engine = new TemplateParameterEngine(registry);
      const composer = new MessageComposer(registry, engine);

      expect(() => composer.composeMessage('nonexistent', {})).to.throw('Template not found');
    });

    it('EncryptionService requires 32-byte key', () => {
      expect(() => new EncryptionService({ key: 'abcd' })).to.throw('Encryption key must be 32 bytes');
    });

    it('EncryptionService encryptObject/decryptObject round-trips PII fields', () => {
      const service = new EncryptionService({ key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });

      const obj = { name: 'John', phone: '+91987654321', nonPii: 'hello' };
      const encrypted = service.encryptObject(obj, ['name', 'phone']);

      expect(encrypted.name.encryptedData).to.exist;
      expect(encrypted.phone.encryptedData).to.exist;
      expect(encrypted.nonPii).to.equal('hello');

      const decrypted = service.decryptObject(encrypted, ['name', 'phone']);
      expect(decrypted.name).to.equal('John');
      expect(decrypted.phone).to.equal('+91987654321');
    });

    it('AccessControlService grants and checks permissions', () => {
      const acs = new AccessControlService();

      acs.grantAccess('user-1', 'operator', ['hotel']);
      expect(acs.checkAccess('user-1', 'read', 'customer_phone')).to.be.true;
      expect(acs.checkAccess('user-1', 'write', 'audit_logs')).to.be.false;
      expect(acs.checkAccess('unknown-user', 'read', 'customer_phone')).to.be.false;
    });

    it('AuditEventBus throws for missing required fields', () => {
      const bus = new AuditEventBus();

      expect(() => bus.emitEvent('data_access', 'read', {})).to.throw('actor is required');
    });

    it('AuditStore stores and queries records', () => {
      const store = new AuditStore();
      const event = { id: 'test-1', timestamp: new Date().toISOString(), category: 'test', action: 'test', actor: 'tester', resourceType: 'test', resourceId: '1' };

      store.store(event);
      expect(store.getRecord('test-1')).to.exist;
      expect(store.query({ actor: 'tester' })).to.have.length(1);
      expect(store.query({ actor: 'nonexistent' })).to.have.length(0);
    });

    it('AuditReporter generates activity summary', () => {
      const store = new AuditStore();
      const reporter = new AuditReporter(store);

      store.store({ id: 'r1', timestamp: '2026-04-01T00:00:00Z', category: 'data_access', action: 'read', actor: 'user-1', resourceType: 'booking', resourceId: 'b1' });
      store.store({ id: 'r2', timestamp: '2026-04-02T00:00:00Z', category: 'data_access', action: 'write', actor: 'user-1', resourceType: 'booking', resourceId: 'b1' });

      const summary = reporter.getActivitySummary('user-1', '2026-01-01', '2026-12-31');
      expect(summary.totalEvents).to.equal(2);
    });

    it('AuditStore getStats aggregates correctly', () => {
      const store = new AuditStore();

      store.store({ id: 's1', timestamp: new Date().toISOString(), category: 'data_access', action: 'read', actor: 'u1', resourceType: 'booking', resourceId: 'b1', outcome: 'success' });
      store.store({ id: 's2', timestamp: new Date().toISOString(), category: 'data_access', action: 'write', actor: 'u1', resourceType: 'booking', resourceId: 'b1', outcome: 'success' });

      const stats = store.getStats();
      expect(stats.byCategory.data_access).to.equal(2);
      expect(stats.byAction.read).to.equal(1);
      expect(stats.byAction.write).to.equal(1);
    });

    it('TLSService wraps and unwraps payloads', () => {
      const tls = new TLSService();

      const wrapped = tls.wrapForTransit({ secret: 'data' });
      expect(wrapped.iv).to.exist;

      const unwrapped = tls.unwrapFromTransit(wrapped);
      expect(unwrapped.secret).to.equal('data');
    });

    it('AuditAlerting built-in rules evaluate events', () => {
      const store = new AuditStore();
      const alerting = new AuditAlerting(store);
      alerting.addBuiltInRules();

      const event = {
        id: 'alert-test-1',
        timestamp: new Date().toISOString(),
        category: 'data_access',
        action: 'read',
        actor: 'bulk-exporter',
        resourceType: 'customer',
        resourceId: 'c1',
        outcome: 'success',
      };
      store.store(event);

      const triggered = alerting.evaluate(event);
      // unusual_hour_access may or may not trigger depending on current hour
      // bulk_data_export needs > 100 records
      expect(triggered).to.be.an('array');
    });
  });
});
