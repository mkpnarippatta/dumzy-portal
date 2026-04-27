process.env.MOCHA_TEST_MODE = 'true';
process.env.TEMPLATE_MAX_NAME_LENGTH = '512';
process.env.TEMPLATE_ALLOWED_CATEGORIES = 'utility,marketing,authentication';
process.env.TEMPLATE_ONLY_APPROVED = 'true';
process.env.COMPLIANCE_PORT = '3009';

const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');

const {
  app,
  TemplateRegistry,
  TemplateValidator,
  TemplateParameterEngine,
  MessageComposer,
  templateRegistry,
  templateValidator,
  parameterEngine,
  messageComposer,
} = require('../src/7-1-whatsapp-template-compliance');

// ---------------------------------------------------------------------------
// TemplateRegistry
// ---------------------------------------------------------------------------
describe('TemplateRegistry', () => {
  beforeEach(() => {
    templateRegistry.templates.clear();
    templateRegistry._templateIdCounter = 0;
  });

  describe('registerTemplate', () => {
    it('should register a template with all required fields', () => {
      const result = templateRegistry.registerTemplate({
        name: 'booking_confirmation',
        category: 'utility',
        body: 'Your booking {{1}} is confirmed for {{2}}. Reference: {{3}}.',
        parameters: [
          { name: 'serviceType', position: 1, required: true },
          { name: 'date', position: 2, required: true },
          { name: 'referenceNumber', position: 3, required: true },
        ],
      });
      expect(result).to.have.property('name', 'booking_confirmation');
      expect(result).to.have.property('templateId');
      expect(result).to.have.property('category', 'utility');
      expect(result).to.have.property('status', 'pending');
      expect(result).to.have.property('submittedAt');
      expect(result).to.have.property('version', 1);
    });

    it('should reject duplicate name registration', () => {
      templateRegistry.registerTemplate({ name: 'test', category: 'utility', body: 'Hello {{1}}', parameters: [] });
      expect(() => {
        templateRegistry.registerTemplate({ name: 'test', category: 'utility', body: 'Hello {{1}}', parameters: [] });
      }).to.throw();
    });
  });

  describe('getTemplate', () => {
    it('should retrieve template by name', () => {
      templateRegistry.registerTemplate({
        name: 'my_template', category: 'marketing', body: 'Hi {{1}}', parameters: [],
      });
      const tpl = templateRegistry.getTemplate('my_template');
      expect(tpl).to.have.property('name', 'my_template');
    });

    it('should return null for unknown template', () => {
      expect(templateRegistry.getTemplate('nonexistent')).to.be.null;
    });
  });

  describe('getTemplatesByCategory', () => {
    it('should filter templates by category', () => {
      templateRegistry.registerTemplate({ name: 'util1', category: 'utility', body: 'a', parameters: [] });
      templateRegistry.registerTemplate({ name: 'util2', category: 'utility', body: 'b', parameters: [] });
      templateRegistry.registerTemplate({ name: 'mkt1', category: 'marketing', body: 'c', parameters: [] });

      const utility = templateRegistry.getTemplatesByCategory('utility');
      expect(utility).to.have.length(2);

      const marketing = templateRegistry.getTemplatesByCategory('marketing');
      expect(marketing).to.have.length(1);
    });
  });

  describe('getTemplatesByStatus', () => {
    it('should filter templates by status', () => {
      const t1 = templateRegistry.registerTemplate({ name: 't1', category: 'utility', body: 'a', parameters: [] });
      const t2 = templateRegistry.registerTemplate({ name: 't2', category: 'utility', body: 'b', parameters: [] });
      templateRegistry.updateTemplateStatus(t1.name, 'approved');
      templateRegistry.updateTemplateStatus(t2.name, 'rejected', 'Invalid content');

      const approved = templateRegistry.getTemplatesByStatus('approved');
      expect(approved).to.have.length(1);
      expect(approved[0].name).to.equal('t1');

      const rejected = templateRegistry.getTemplatesByStatus('rejected');
      expect(rejected).to.have.length(1);
      expect(rejected[0].rejectionReason).to.equal('Invalid content');
    });
  });

  describe('updateTemplateStatus', () => {
    it('should track status lifecycle changes', () => {
      const tpl = templateRegistry.registerTemplate({ name: 'lifecycle', category: 'utility', body: 'x', parameters: [] });
      expect(tpl.status).to.equal('pending');

      templateRegistry.updateTemplateStatus('lifecycle', 'approved');
      const approved = templateRegistry.getTemplate('lifecycle');
      expect(approved.status).to.equal('approved');
      expect(approved.approvedAt).to.not.be.null;

      templateRegistry.updateTemplateStatus('lifecycle', 'rejected', 'Header too long');
      const rejected = templateRegistry.getTemplate('lifecycle');
      expect(rejected.status).to.equal('rejected');
      expect(rejected.rejectionReason).to.equal('Header too long');
    });

    it('should return false for unknown template', () => {
      expect(templateRegistry.updateTemplateStatus('nope', 'approved')).to.be.false;
    });
  });

  describe('getAllTemplates', () => {
    it('should return all registered templates', () => {
      templateRegistry.registerTemplate({ name: 'a', category: 'utility', body: 'x', parameters: [] });
      templateRegistry.registerTemplate({ name: 'b', category: 'marketing', body: 'y', parameters: [] });
      expect(templateRegistry.getAllTemplates()).to.have.length(2);
    });

    it('should return empty array when no templates', () => {
      expect(templateRegistry.getAllTemplates()).to.be.empty;
    });
  });
});

// ---------------------------------------------------------------------------
// TemplateValidator
// ---------------------------------------------------------------------------
describe('TemplateValidator', () => {
  const validator = new TemplateValidator({ maxNameLength: 512 });

  describe('validateName', () => {
    it('should accept valid names', () => {
      expect(validator.validateName('booking_confirmation').valid).to.be.true;
      expect(validator.validateName('helloWorld123').valid).to.be.true;
    });

    it('should reject empty name', () => {
      expect(validator.validateName('').valid).to.be.false;
    });

    it('should reject name with spaces', () => {
      expect(validator.validateName('my template').valid).to.be.false;
    });

    it('should reject name exceeding max length', () => {
      const longName = 'a'.repeat(513);
      expect(validator.validateName(longName).valid).to.be.false;
    });
  });

  describe('validateCategory', () => {
    it('should accept utility', () => {
      expect(validator.validateCategory('utility').valid).to.be.true;
    });

    it('should accept marketing', () => {
      expect(validator.validateCategory('marketing').valid).to.be.true;
    });

    it('should accept authentication', () => {
      expect(validator.validateCategory('authentication').valid).to.be.true;
    });

    it('should reject invalid category', () => {
      expect(validator.validateCategory('promotional').valid).to.be.false;
    });
  });

  describe('validateParameters', () => {
    it('should accept valid parameters', () => {
      const params = [
        { name: 'name', position: 1, required: true },
        { name: 'date', position: 2, required: false },
      ];
      expect(validator.validateParameters(params).valid).to.be.true;
    });

    it('should reject duplicate positions', () => {
      const params = [
        { name: 'a', position: 1, required: true },
        { name: 'b', position: 1, required: true },
      ];
      expect(validator.validateParameters(params).valid).to.be.false;
    });

    it('should reject missing name field', () => {
      const params = [{ position: 1, required: true }];
      expect(validator.validateParameters(params).valid).to.be.false;
    });
  });

  describe('validateBody', () => {
    it('should accept body matching parameters', () => {
      const params = [
        { name: 'a', position: 1, required: true },
        { name: 'b', position: 2, required: true },
      ];
      expect(validator.validateBody('Hello {{1}}, your {{2}} is ready.', params).valid).to.be.true;
    });

    it('should reject body with placeholder not in parameters', () => {
      const params = [{ name: 'a', position: 1, required: true }];
      expect(validator.validateBody('Hello {{1}}, ref {{3}}', params).valid).to.be.false;
    });

    it('should accept body with no parameters', () => {
      expect(validator.validateBody('Hello, welcome!', []).valid).to.be.true;
    });
  });

  describe('validate', () => {
    it('should pass a complete valid template', () => {
      const result = validator.validate({
        name: 'booking_confirmation',
        category: 'utility',
        body: 'Your {{1}} is confirmed.',
        parameters: [{ name: 'service', position: 1, required: true }],
      });
      expect(result.valid).to.be.true;
      expect(result.errors).to.be.empty;
    });

    it('should collect all errors for invalid template', () => {
      const result = validator.validate({
        name: '',
        category: 'invalid',
        body: 'Hello {{3}}',
        parameters: [{ name: 'a', position: 1, required: true }],
      });
      expect(result.valid).to.be.false;
      expect(result.errors.length).to.be.at.least(2);
    });
  });
});

// ---------------------------------------------------------------------------
// TemplateParameterEngine
// ---------------------------------------------------------------------------
describe('TemplateParameterEngine', () => {
  let registry;
  let engine;

  beforeEach(() => {
    registry = new TemplateRegistry();
    engine = new TemplateParameterEngine(registry);
  });

  describe('populateTemplate', () => {
    it('should populate parameters correctly', () => {
      registry.registerTemplate({
        name: 'booking_confirmation',
        category: 'utility',
        body: 'Your {{1}} booking is confirmed for {{2}}. Reference: {{3}}.',
        parameters: [
          { name: 'serviceType', position: 1, required: true },
          { name: 'date', position: 2, required: true },
          { name: 'referenceNumber', position: 3, required: true },
        ],
      });

      const result = engine.populateTemplate('booking_confirmation', {
        serviceType: 'Bike Rental',
        date: '2026-04-25',
        referenceNumber: 'BR-12345',
      });
      expect(result).to.equal('Your Bike Rental booking is confirmed for 2026-04-25. Reference: BR-12345.');
    });

    it('should throw on missing required parameter', () => {
      registry.registerTemplate({
        name: 'test',
        category: 'utility',
        body: 'Hello {{1}}, your {{2}} is ready.',
        parameters: [
          { name: 'name', position: 1, required: true },
          { name: 'item', position: 2, required: true },
        ],
      });

      expect(() => {
        engine.populateTemplate('test', { name: 'Ali' });
      }).to.throw();
    });
  });

  describe('getRequiredParameters', () => {
    it('should return required parameters for a template', () => {
      registry.registerTemplate({
        name: 'test',
        category: 'utility',
        body: 'Hello {{1}}',
        parameters: [
          { name: 'name', position: 1, required: true },
          { name: 'optionalField', position: 2, required: false },
        ],
      });

      const required = engine.getRequiredParameters('test');
      expect(required).to.have.length(1);
      expect(required[0].name).to.equal('name');
    });

    it('should return empty array when template has no parameters', () => {
      registry.registerTemplate({ name: 'simple', category: 'utility', body: 'Hello!', parameters: [] });
      expect(engine.getRequiredParameters('simple')).to.be.empty;
    });
  });

  describe('validateParameters', () => {
    it('should validate correct parameters', () => {
      registry.registerTemplate({
        name: 'test',
        category: 'utility',
        body: '{{1}} {{2}}',
        parameters: [
          { name: 'a', position: 1, required: true },
          { name: 'b', position: 2, required: true },
        ],
      });

      const result = engine.validateParameters('test', { a: 'x', b: 'y' });
      expect(result.valid).to.be.true;
    });

    it('should reject missing required parameters', () => {
      registry.registerTemplate({
        name: 'test',
        category: 'utility',
        body: '{{1}} {{2}}',
        parameters: [
          { name: 'a', position: 1, required: true },
          { name: 'b', position: 2, required: true },
        ],
      });

      const result = engine.validateParameters('test', { a: 'x' });
      expect(result.valid).to.be.false;
    });
  });
});

// ---------------------------------------------------------------------------
// MessageComposer
// ---------------------------------------------------------------------------
describe('MessageComposer', () => {
  let registry;
  let engine;
  let composer;

  beforeEach(() => {
    registry = new TemplateRegistry();
    engine = new TemplateParameterEngine(registry);
    composer = new MessageComposer(registry, engine, { onlyApprovedTemplates: false });

    registry.registerTemplate({
      name: 'booking_confirmation',
      category: 'utility',
      body: 'Your {{1}} booking is confirmed for {{2}}. Reference: {{3}}.',
      parameters: [
        { name: 'serviceType', position: 1, required: true },
        { name: 'date', position: 2, required: true },
        { name: 'referenceNumber', position: 3, required: true },
      ],
      status: 'approved',
    });

    registry.registerTemplate({
      name: 'pending_template',
      category: 'utility',
      body: 'Your {{1}} is pending.',
      parameters: [{ name: 'item', position: 1, required: true }],
      status: 'pending',
    });
  });

  describe('composeMessage', () => {
    it('should compose message from approved template', () => {
      const msg = composer.composeMessage('booking_confirmation', {
        serviceType: 'Hotel',
        date: '2026-05-01',
        referenceNumber: 'HTL-001',
      });
      expect(msg).to.have.property('body');
      expect(msg).to.have.property('templateName', 'booking_confirmation');
      expect(msg.body).to.equal('Your Hotel booking is confirmed for 2026-05-01. Reference: HTL-001.');
    });

    it('should throw for unknown template', () => {
      expect(() => {
        composer.composeMessage('nonexistent', {});
      }).to.throw();
    });
  });

  describe('sendTemplateMessage', () => {
    it('should record sent message in history', () => {
      const result = composer.sendTemplateMessage('+919876543210', 'booking_confirmation', {
        serviceType: 'Bike',
        date: '2026-04-25',
        referenceNumber: 'BK-001',
      });
      expect(result).to.have.property('recipient', '+919876543210');
      expect(result).to.have.property('templateName', 'booking_confirmation');
      expect(result).to.have.property('body');
      expect(result).to.have.property('timestamp');
      expect(result).to.have.property('status', 'sent');

      const history = composer.getSendHistory();
      expect(history).to.have.length(1);
    });
  });

  describe('onlyApprovedTemplates', () => {
    it('should reject sending pending template when onlyApproved is true', () => {
      const strictComposer = new MessageComposer(registry, engine, { onlyApprovedTemplates: true });
      expect(() => {
        strictComposer.composeMessage('pending_template', { item: 'test' });
      }).to.throw();
    });

    it('should allow sending approved template when onlyApproved is true', () => {
      const strictComposer = new MessageComposer(registry, engine, { onlyApprovedTemplates: true });
      const msg = strictComposer.composeMessage('booking_confirmation', {
        serviceType: 'Bike',
        date: '2026-04-25',
        referenceNumber: 'BK-001',
      });
      expect(msg.body).to.include('Bike');
    });
  });

  describe('getSendHistory', () => {
    it('should return history sorted by timestamp descending', () => {
      composer.sendTemplateMessage('+91-1', 'booking_confirmation', {
        serviceType: 'Bike', date: '2026-04-25', referenceNumber: 'R1',
      });

      return new Promise(resolve => setTimeout(resolve, 20)).then(() => {
        composer.sendTemplateMessage('+91-2', 'booking_confirmation', {
          serviceType: 'Hotel', date: '2026-04-26', referenceNumber: 'R2',
        });

        const history = composer.getSendHistory();
        expect(history).to.have.length(2);
        expect(history[0].recipient).to.equal('+91-2');
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------
describe('Integration: Template Lifecycle', () => {
  it('should complete full cycle: register → validate → approve → compose → send', () => {
    const registry = new TemplateRegistry();
    const validator = new TemplateValidator();
    const engine = new TemplateParameterEngine(registry);
    const composer = new MessageComposer(registry, engine, { onlyApprovedTemplates: true });

    // Define a template
    const def = {
      name: 'handoff_notification',
      category: 'utility',
      body: 'You are being transferred to a {{1}} agent. You will be connected shortly.',
      parameters: [{ name: 'vertical', position: 1, required: true }],
    };

    // Validate
    const validation = validator.validate(def);
    expect(validation.valid).to.be.true;

    // Register (status starts as pending)
    const registered = registry.registerTemplate(def);
    expect(registered.status).to.equal('pending');

    // Cannot send while pending
    expect(() => {
      composer.composeMessage('handoff_notification', { vertical: 'Bike Rental' });
    }).to.throw();

    // Approve
    registry.updateTemplateStatus('handoff_notification', 'approved');

    // Now can send
    const msg = composer.composeMessage('handoff_notification', { vertical: 'Bike Rental' });
    expect(msg.body).to.equal('You are being transferred to a Bike Rental agent. You will be connected shortly.');

    const sent = composer.sendTemplateMessage('+911234567890', 'handoff_notification', { vertical: 'Bike Rental' });
    expect(sent.status).to.equal('sent');
    expect(composer.getSendHistory()).to.have.length(1);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('Edge cases', () => {
  let registry;
  let engine;

  beforeEach(() => {
    registry = new TemplateRegistry();
    engine = new TemplateParameterEngine(registry);
  });

  it('should handle template with no parameters', () => {
    registry.registerTemplate({ name: 'simple_greeting', category: 'utility', body: 'Welcome to our service!', parameters: [], status: 'approved' });
    const msg = new MessageComposer(registry, engine).composeMessage('simple_greeting', {});
    expect(msg.body).to.equal('Welcome to our service!');
  });

  it('should handle template with many parameters (up to 25)', () => {
    let body = '';
    const params = [];
    for (let i = 1; i <= 25; i++) {
      body += `{{${i}}} `;
      params.push({ name: `param${i}`, position: i, required: true });
    }
    const values = {};
    for (let i = 1; i <= 25; i++) values[`param${i}`] = `val${i}`;

    registry.registerTemplate({ name: 'big_template', category: 'utility', body: body.trim(), parameters: params, status: 'approved' });
    const msg = new MessageComposer(registry, engine).composeMessage('big_template', values);
    expect(msg.body).to.include('val1');
    expect(msg.body).to.include('val25');
  });

  it('should handle special characters in parameter values', () => {
    registry.registerTemplate({ name: 'special_chars', category: 'utility', body: 'Hello {{1}}, ref {{2}}.', parameters: [
      { name: 'name', position: 1, required: true },
      { name: 'ref', position: 2, required: true },
    ], status: 'approved' });

    const msg = new MessageComposer(registry, engine).composeMessage('special_chars', {
      name: 'John & Doe',
      ref: 'REF-123/2026',
    });
    expect(msg.body).to.equal('Hello John & Doe, ref REF-123/2026.');
  });

  it('should handle template registration after previous rejection', () => {
    registry.registerTemplate({ name: 'retry', category: 'utility', body: 'Original {{1}}', parameters: [{ name: 'x', position: 1, required: true }] });
    registry.updateTemplateStatus('retry', 'rejected', 'Body too short');

    // Update with new version
    const updated = registry.registerTemplate({ name: 'retry', category: 'utility', body: 'Original {{1}} with more content here', parameters: [{ name: 'x', position: 1, required: true }] });
    expect(updated.version).to.equal(2);
    expect(updated.status).to.equal('pending');
  });

  it('should reject invalid template data via validator', () => {
    const validator = new TemplateValidator();
    const result = validator.validate({
      name: 'has space',
      category: 'promo',
      body: 'Hello {{1}}',
      parameters: [{ name: 'x', position: 1, required: true }],
    });
    expect(result.valid).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------------
describe('API endpoints', () => {
  beforeEach(() => {
    templateRegistry.templates.clear();
    templateRegistry._templateIdCounter = 0;

    // Register some templates for testing
    templateRegistry.registerTemplate({
      name: 'booking_confirmation',
      category: 'utility',
      body: 'Your {{1}} booking is confirmed.',
      parameters: [{ name: 'serviceType', position: 1, required: true }],
      status: 'approved',
    });
    templateRegistry.registerTemplate({
      name: 'welcome_message',
      category: 'marketing',
      body: 'Welcome {{1}}!',
      parameters: [{ name: 'name', position: 1, required: true }],
      status: 'approved',
    });
  });

  describe('GET /api/health', () => {
    it('should return health ok', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).to.equal(200);
      expect(res.body.data.status).to.equal('ok');
    });
  });

  describe('GET /api/compliance/templates', () => {
    it('should list all templates', async () => {
      const res = await request(app).get('/api/compliance/templates');
      expect(res.status).to.equal(200);
      expect(res.body.data.templates).to.be.an('array');
      expect(res.body.data.templates.length).to.equal(2);
    });

    it('should filter by category', async () => {
      const res = await request(app).get('/api/compliance/templates?category=marketing');
      expect(res.status).to.equal(200);
      expect(res.body.data.templates).to.have.length(1);
      expect(res.body.data.templates[0].name).to.equal('welcome_message');
    });

    it('should filter by status', async () => {
      const res = await request(app).get('/api/compliance/templates?status=approved');
      expect(res.status).to.equal(200);
      expect(res.body.data.templates).to.have.length(2);
    });
  });

  describe('GET /api/compliance/templates/:name', () => {
    it('should return specific template by name', async () => {
      const res = await request(app).get('/api/compliance/templates/booking_confirmation');
      expect(res.status).to.equal(200);
      expect(res.body.data.name).to.equal('booking_confirmation');
    });

    it('should return 404 for unknown template', async () => {
      const res = await request(app).get('/api/compliance/templates/nonexistent');
      expect(res.status).to.equal(404);
    });
  });

  describe('POST /api/compliance/templates', () => {
    it('should register a new template', async () => {
      const res = await request(app)
        .post('/api/compliance/templates')
        .send({
          name: 'new_template',
          category: 'utility',
          body: 'Hello {{1}}',
          parameters: [{ name: 'name', position: 1, required: true }],
        });
      expect(res.status).to.equal(201);
      expect(res.body.data.name).to.equal('new_template');
    });

    it('should return 400 for missing name', async () => {
      const res = await request(app)
        .post('/api/compliance/templates')
        .send({ category: 'utility', body: 'Hello', parameters: [] });
      expect(res.status).to.equal(400);
    });
  });

  describe('PUT /api/compliance/templates/:name', () => {
    it('should update template status', async () => {
      const res = await request(app)
        .put('/api/compliance/templates/booking_confirmation')
        .send({ status: 'rejected', rejectionReason: 'Test rejection' });
      expect(res.status).to.equal(200);
      expect(res.body.data.status).to.equal('rejected');
    });

    it('should return 404 for unknown template', async () => {
      const res = await request(app)
        .put('/api/compliance/templates/nonexistent')
        .send({ status: 'approved' });
      expect(res.status).to.equal(404);
    });
  });

  describe('POST /api/compliance/templates/:name/validate', () => {
    it('should validate an existing template', async () => {
      const res = await request(app)
        .post('/api/compliance/templates/booking_confirmation/validate');
      expect(res.status).to.equal(200);
      expect(res.body.data.valid).to.be.true;
    });

    it('should return 404 for unknown template validate', async () => {
      const res = await request(app)
        .post('/api/compliance/templates/nonexistent/validate');
      expect(res.status).to.equal(404);
    });
  });

  describe('POST /api/compliance/templates/:name/populate', () => {
    it('should preview template with parameters', async () => {
      const res = await request(app)
        .post('/api/compliance/templates/booking_confirmation/populate')
        .send({ serviceType: 'Bike Rental' });
      expect(res.status).to.equal(200);
      expect(res.body.data.body).to.equal('Your Bike Rental booking is confirmed.');
    });
  });

  describe('POST /api/compliance/send', () => {
    it('should compose and send a template message', async () => {
      const res = await request(app)
        .post('/api/compliance/send')
        .send({
          recipient: '+911234567890',
          templateName: 'booking_confirmation',
          params: { serviceType: 'Hotel' },
        });
      expect(res.status).to.equal(200);
      expect(res.body.data.recipient).to.equal('+911234567890');
      expect(res.body.data.status).to.equal('sent');
    });

    it('should return 400 without templateName', async () => {
      const res = await request(app)
        .post('/api/compliance/send')
        .send({ recipient: '+911234567890', params: {} });
      expect(res.status).to.equal(400);
    });
  });

  describe('GET /api/compliance/send/history', () => {
    it('should return send history', async () => {
      const res = await request(app).get('/api/compliance/send/history');
      expect(res.status).to.equal(200);
      expect(res.body.data.history).to.be.an('array');
    });
  });
});
