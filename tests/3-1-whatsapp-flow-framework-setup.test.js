process.env.MOCHA_TEST_MODE = 'true';
const { expect } = require('chai');
const { FlowTemplateService, FlowValidator, FlowSubmissionService, app } = require('../src/3-1-whatsapp-flow-framework-setup');
const request = require('supertest');

// ============================================================================
// FLOW TEMPLATE SERVICE TESTS
// ============================================================================

describe('FlowTemplateService', () => {
  let service;

  beforeEach(() => {
    service = new FlowTemplateService();
  });

  // ------------------------------------------------------------
  // Template Registration (AC: #1)
  // ------------------------------------------------------------
  describe('Template Registration', () => {
    it('should register template with required fields', () => {
      const template = {
        id: 'bike-rental-flow',
        name: 'Bike Rental Booking Flow',
        vertical: 'Bike Rental',
        fields: []
      };

      const registered = service.registerTemplate(template);

      expect(registered).to.have.property('id');
      expect(registered).to.have.property('name', 'Bike Rental Booking Flow');
      expect(registered).to.have.property('vertical', 'Bike Rental');
      expect(registered).to.have.property('status', 'draft');
      expect(registered).to.have.property('version', '1.0');
      expect(registered).to.have.property('created_at');
      expect(registered).to.have.property('updated_at');
    });

    it('should reject template without id', () => {
      const template = {
        name: 'Test Flow',
        vertical: 'Bike Rental',
        fields: []
      };

      expect(() => {
        service.registerTemplate(template);
      }).to.throw('Template must have id, name, and vertical');
    });

    it('should reject template without name', () => {
      const template = {
        id: 'test-flow',
        vertical: 'Bike Rental',
        fields: []
      };

      expect(() => {
        service.registerTemplate(template);
      }).to.throw('Template must have id, name, and vertical');
    });

    it('should reject template without vertical', () => {
      const template = {
        id: 'test-flow',
        name: 'Test Flow',
        fields: []
      };

      expect(() => {
        service.registerTemplate(template);
      }).to.throw('Template must have id, name, and vertical');
    });

    it('should allow custom version', () => {
      const template = {
        id: 'bike-flow',
        name: 'Bike Flow',
        version: '2.0',
        vertical: 'Bike Rental',
        fields: []
      };

      const registered = service.registerTemplate(template);
      expect(registered.version).to.equal('2.0');
    });

    it('should allow custom status', () => {
      const template = {
        id: 'hotel-flow',
        name: 'Hotel Flow',
        vertical: 'Hotel',
        status: 'active',
        fields: []
      };

      const registered = service.registerTemplate(template);
      expect(registered.status).to.equal('active');
    });
  });

  // ------------------------------------------------------------
  // Template Retrieval (AC: #1)
  // ------------------------------------------------------------
  describe('Template Retrieval', () => {
    it('should get active template by vertical (AC: #1)', () => {
      service.registerTemplate({
        id: 'bike-flow-v1',
        name: 'Bike Flow V1',
        vertical: 'Bike Rental',
        status: 'active',
        fields: []
      });

      const template = service.getTemplateByVertical('Bike Rental');

      expect(template).to.not.be.null;
      expect(template.id).to.equal('bike-flow-v1');
      expect(template.vertical).to.equal('Bike Rental');
      expect(template.status).to.equal('active');
    });

    it('should return null for vertical with no active template', () => {
      const template = service.getTemplateByVertical('Taxi');
      expect(template).to.be.null;
    });

    it('should not return draft templates', () => {
      service.registerTemplate({
        id: 'taxi-flow',
        name: 'Taxi Flow',
        vertical: 'Taxi',
        status: 'draft',
        fields: []
      });

      const template = service.getTemplateByVertical('Taxi');
      expect(template).to.be.null;
    });

    it('should return most recently updated active template', (done) => {
      // Register first template
      service.registerTemplate({
        id: 'bike-flow-v1',
        name: 'Bike Flow V1',
        vertical: 'Bike Rental',
        status: 'active',
        fields: []
      });

      // Register second template (more recent)
      setTimeout(() => {
        service.registerTemplate({
          id: 'bike-flow-v2',
          name: 'Bike Flow V2',
          vertical: 'Bike Rental',
          status: 'active',
          fields: []
        });

        const template = service.getTemplateByVertical('Bike Rental');
        expect(template.id).to.equal('bike-flow-v2');
        done();
      }, 10);
    });
  });
});

// ============================================================================
// FLOW VALIDATOR TESTS
// ============================================================================

describe('FlowValidator', () => {
  let validator;

  beforeEach(() => {
    validator = new FlowValidator();
  });

  // ------------------------------------------------------------
  // Required Field Validation (AC: #2)
  // ------------------------------------------------------------
  describe('Required Field Validation', () => {
    it('should return error for missing required field (AC: #2)', () => {
      const field = {
        name: 'email',
        type: 'email',
        label: 'Email Address',
        required: true
      };

      const errors = validator.validateField(field, undefined);
      expect(errors).to.have.length(1);
      expect(errors[0].field).to.equal('email');
      expect(errors[0].code).to.equal('REQUIRED');
    });

    it('should return error for empty required field', () => {
      const field = {
        name: 'name',
        type: 'text',
        label: 'Name',
        required: true
      };

      const errors = validator.validateField(field, '');
      expect(errors).to.have.length(1);
      expect(errors[0].code).to.equal('REQUIRED');
    });

    it('should pass validation for filled required field', () => {
      const field = {
        name: 'name',
        type: 'text',
        label: 'Name',
        required: true
      };

      const errors = validator.validateField(field, 'John Doe');
      expect(errors).to.have.length(0);
    });

    it('should skip validation for empty optional field', () => {
      const field = {
        name: 'phone',
        type: 'phone',
        label: 'Phone Number',
        required: false
      };

      const errors = validator.validateField(field, '');
      expect(errors).to.have.length(0);
    });
  });

  // ------------------------------------------------------------
  // Format Validation (AC: #2)
  // ------------------------------------------------------------
  describe('Format Validation', () => {
    it('should validate email format (AC: #2)', () => {
      const field = {
        name: 'email',
        type: 'email',
        label: 'Email Address',
        required: true
      };

      const validErrors = validator.validateField(field, 'user@example.com');
      expect(validErrors).to.have.length(0);

      const invalidErrors = validator.validateField(field, 'invalid-email');
      expect(invalidErrors).to.have.length(1);
      expect(invalidErrors[0].code).to.equal('INVALID_EMAIL');
    });

    it('should validate phone format (AC: #2)', () => {
      const field = {
        name: 'phone',
        type: 'phone',
        label: 'Phone Number',
        required: true
      };

      const validErrors = validator.validateField(field, '+919876543210');
      expect(validErrors).to.have.length(0);

      const invalidErrors = validator.validateField(field, '123');
      expect(invalidErrors).to.have.length(1);
      expect(invalidErrors[0].code).to.equal('INVALID_PHONE');
    });

    it('should validate date format (AC: #2)', () => {
      const field = {
        name: 'pickup_date',
        type: 'date',
        label: 'Pickup Date',
        required: true
      };

      const validErrors = validator.validateField(field, '2026-04-22');
      expect(validErrors).to.have.length(0);

      const invalidErrors = validator.validateField(field, 'not-a-date');
      expect(invalidErrors).to.have.length(1);
      expect(invalidErrors[0].code).to.equal('INVALID_DATE');
    });
  });

  // ------------------------------------------------------------
  // Pattern Validation
  // ------------------------------------------------------------
  describe('Pattern Validation', () => {
    it('should validate against regex pattern', () => {
      const field = {
        name: 'postal_code',
        type: 'text',
        label: 'Postal Code',
        required: true,
        validation: {
          pattern: '^[0-9]{6}$'
        }
      };

      const validErrors = validator.validateField(field, '500001');
      expect(validErrors).to.have.length(0);

      const invalidErrors = validator.validateField(field, 'ABC123');
      expect(invalidErrors).to.have.length(1);
      expect(invalidErrors[0].code).to.equal('INVALID_PATTERN');
    });
  });

  // ------------------------------------------------------------
  // Length Validation
  // ------------------------------------------------------------
  describe('Length Validation', () => {
    it('should validate minimum length', () => {
      const field = {
        name: 'name',
        type: 'text',
        label: 'Name',
        required: true,
        validation: {
          minLength: 3
        }
      };

      const invalidErrors = validator.validateField(field, 'AB');
      expect(invalidErrors).to.have.length(1);
      expect(invalidErrors[0].code).to.equal('MIN_LENGTH');

      const validErrors = validator.validateField(field, 'ABC');
      expect(validErrors).to.have.length(0);
    });

    it('should validate maximum length', () => {
      const field = {
        name: 'name',
        type: 'text',
        label: 'Name',
        required: true,
        validation: {
          maxLength: 10
        }
      };

      const invalidErrors = validator.validateField(field, 'This is too long');
      expect(invalidErrors).to.have.length(1);
      expect(invalidErrors[0].code).to.equal('MAX_LENGTH');

      const validErrors = validator.validateField(field, 'Short');
      expect(validErrors).to.have.length(0);
    });
  });

  // ------------------------------------------------------------
  // Submission Validation (AC: #2)
  // ------------------------------------------------------------
  describe('Submission Validation', () => {
    it('should validate all fields in template (AC: #2)', () => {
      const template = {
        id: 'test-flow',
        name: 'Test Flow',
        vertical: 'Bike Rental',
        fields: [
          {
            name: 'email',
            type: 'email',
            label: 'Email',
            required: true
          },
          {
            name: 'name',
            type: 'text',
            label: 'Name',
            required: true
          }
        ]
      };

      const data = {
        email: 'user@example.com',
        name: 'John Doe'
      };

      const errors = validator.validateSubmission(template, data);
      expect(errors).to.have.length(0);
    });

    it('should return all validation errors for invalid submission', () => {
      const template = {
        id: 'test-flow',
        name: 'Test Flow',
        vertical: 'Bike Rental',
        fields: [
          {
            name: 'email',
            type: 'email',
            label: 'Email',
            required: true
          },
          {
            name: 'phone',
            type: 'phone',
            label: 'Phone',
            required: true
          }
        ]
      };

      const data = {
        email: 'invalid-email',
        phone: '123'
      };

      const errors = validator.validateSubmission(template, data);
      expect(errors).to.have.length(2);
      expect(errors[0].code).to.equal('INVALID_EMAIL');
      expect(errors[1].code).to.equal('INVALID_PHONE');
    });
  });
});

// ============================================================================
// FLOW SUBMISSION SERVICE TESTS
// ============================================================================

describe('FlowSubmissionService', () => {
  let templateService;
  let validator;
  let submissionService;

  beforeEach(() => {
    templateService = new FlowTemplateService();
    validator = new FlowValidator();
    submissionService = new FlowSubmissionService(templateService, validator);
  });

  // ------------------------------------------------------------
  // Flow Submission (AC: #3)
  // ------------------------------------------------------------
  describe('Flow Submission', () => {
    beforeEach(() => {
      templateService.registerTemplate({
        id: 'bike-rental-flow',
        name: 'Bike Rental Flow',
        vertical: 'Bike Rental',
        status: 'active',
        fields: [
          {
            name: 'pickup_date',
            type: 'date',
            label: 'Pickup Date',
            required: true
          },
          {
            name: 'return_date',
            type: 'date',
            label: 'Return Date',
            required: true
          },
          {
            name: 'bike_model',
            type: 'text',
            label: 'Bike Model',
            required: true
          }
        ]
      });
    });

    it('should submit flow with valid data (AC: #3)', () => {
      const submission = submissionService.submitFlow(
        'bike-rental-flow',
        '+919876543210',
        {
          pickup_date: '2026-04-25',
          return_date: '2026-04-28',
          bike_model: 'Hero'
        }
      );

      expect(submission).to.have.property('id');
      expect(submission.flow_id).to.equal('bike-rental-flow');
      expect(submission.phone_number).to.equal('+919876543210');
      expect(submission.status).to.equal('validated');
      expect(submission.validation_errors).to.have.length(0);
      expect(submission).to.have.property('submitted_at');
    });

    it('should reject submission for non-existent template', () => {
      expect(() => {
        submissionService.submitFlow(
          'non-existent-flow',
          '+919876543210',
          {}
        );
      }).to.throw('Flow template not found');
    });

    it('should set status to pending for invalid submission', () => {
      const submission = submissionService.submitFlow(
        'bike-rental-flow',
        '+919876543210',
        {
          pickup_date: 'invalid-date',
          return_date: '2026-04-28',
          bike_model: 'Hero'
        }
      );

      expect(submission.status).to.equal('pending');
      expect(submission.validation_errors).to.have.length.greaterThan(0);
    });

    it('should store submission with phone number indexing (AC: #3)', () => {
      const submission = submissionService.submitFlow(
        'bike-rental-flow',
        '+919876543210',
        {
          pickup_date: '2026-04-25',
          return_date: '2026-04-28',
          bike_model: 'Hero'
        }
      );

      expect(submission).to.have.property('id');
      const retrieved = submissionService.getSubmission(submission.id);
      expect(retrieved).to.not.be.null;
      expect(retrieved.phone_number).to.equal('+919876543210');
    });
  });

  // ------------------------------------------------------------
  // Submission Tracking
  // ------------------------------------------------------------
  describe('Submission Tracking', () => {
    it('should retrieve submission by ID', () => {
      templateService.registerTemplate({
        id: 'test-flow',
        name: 'Test Flow',
        vertical: 'Bike Rental',
        status: 'active',
        fields: []
      });

      const submitted = submissionService.submitFlow('test-flow', '+919876543210', {});
      const retrieved = submissionService.getSubmission(submitted.id);

      expect(retrieved).to.not.be.null;
      expect(retrieved.id).to.equal(submitted.id);
    });

    it('should return null for non-existent submission', () => {
      const retrieved = submissionService.getSubmission('non-existent-id');
      expect(retrieved).to.be.null;
    });
  });
});

// ============================================================================
// API ENDPOINTS TESTS
// ============================================================================

describe('API Endpoints', () => {
  // ------------------------------------------------------------
  // POST /api/flow/templates - Register Template
  // ------------------------------------------------------------
  describe('POST /api/flow/templates', () => {
    it('should register flow template successfully', async () => {
      const response = await request(app)
        .post('/api/flow/templates')
        .send({
          id: 'bike-rental-flow',
          name: 'Bike Rental Booking Flow',
          vertical: 'Bike Rental',
          fields: [
            {
              name: 'pickup_date',
              type: 'date',
              label: 'Pickup Date',
              required: true
            }
          ]
        })
        .expect(201);

      expect(response.body).to.have.property('data');
      expect(response.body.data).to.have.property('id', 'bike-rental-flow');
      expect(response.body.data).to.have.property('status', 'draft');
      expect(response.body).to.have.property('meta');
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/flow/templates')
        .send({
          id: 'test-flow',
          fields: []
        })
        .expect(400);

      expect(response.body.error.code).to.equal(400);
      expect(response.body.error.message).to.include('Template must have');
    });
  });

  // ------------------------------------------------------------
  // GET /api/flow/templates/:vertical - Get Template
  // ------------------------------------------------------------
  describe('GET /api/flow/templates/:vertical', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/flow/templates')
        .send({
          id: 'bike-flow-active',
          name: 'Bike Flow',
          vertical: 'Bike Rental',
          status: 'active',
          fields: []
        });
    });

    it('should get active template by vertical (AC: #1)', async () => {
      const response = await request(app)
        .get('/api/flow/templates/Bike Rental')
        .expect(200);

      expect(response.body).to.have.property('data');
      expect(response.body.data).to.have.property('id', 'bike-flow-active');
      expect(response.body.data).to.have.property('vertical', 'Bike Rental');
      expect(response.body.data).to.have.property('status', 'active');
    });

    it('should return 404 for vertical with no active template', async () => {
      const response = await request(app)
        .get('/api/flow/templates/Taxi')
        .expect(404);

      expect(response.body.error.code).to.equal(404);
    });
  });

  // ------------------------------------------------------------
  // POST /api/flow/submit - Submit Flow
  // ------------------------------------------------------------
  describe('POST /api/flow/submit', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/flow/templates')
        .send({
          id: 'bike-flow',
          name: 'Bike Flow',
          vertical: 'Bike Rental',
          status: 'active',
          fields: [
            {
              name: 'pickup_date',
              type: 'date',
              label: 'Pickup Date',
              required: true
            }
          ]
        });
    });

    it('should submit flow with valid data (AC: #3)', async () => {
      const response = await request(app)
        .post('/api/flow/submit')
        .send({
          flow_id: 'bike-flow',
          phone_number: '+919876543210',
          data: {
            pickup_date: '2026-04-25'
          }
        })
        .expect(201);

      expect(response.body).to.have.property('data');
      expect(response.body.data).to.have.property('id');
      expect(response.body.data).to.have.property('status', 'validated');
      expect(response.body.data.validation_errors).to.have.length(0);
    });

    it('should return 400 for missing flow_id', async () => {
      const response = await request(app)
        .post('/api/flow/submit')
        .send({
          phone_number: '+919876543210',
          data: {}
        })
        .expect(400);

      expect(response.body.error.code).to.equal(400);
    });

    it('should return 404 for non-existent template', async () => {
      const response = await request(app)
        .post('/api/flow/submit')
        .send({
          flow_id: 'non-existent',
          phone_number: '+919876543210',
          data: {}
        })
        .expect(404);

      expect(response.body.error.code).to.equal(404);
    });

    it('should return validation errors for invalid data (AC: #2)', async () => {
      const response = await request(app)
        .post('/api/flow/submit')
        .send({
          flow_id: 'bike-flow',
          phone_number: '+919876543210',
          data: {
            pickup_date: 'invalid-date'
          }
        })
        .expect(201);

      expect(response.body.data.status).to.equal('pending');
      expect(response.body.data.validation_errors).to.have.length.greaterThan(0);
    });
  });

  // ------------------------------------------------------------
  // GET /api/flow/submission/:id - Get Submission Status
  // ------------------------------------------------------------
  describe('GET /api/flow/submission/:id', () => {
    let submissionId;

    beforeEach(async () => {
      await request(app)
        .post('/api/flow/templates')
        .send({
          id: 'test-flow',
          name: 'Test Flow',
          vertical: 'Bike Rental',
          status: 'active',
          fields: []
        });

      const submitResponse = await request(app)
        .post('/api/flow/submit')
        .send({
          flow_id: 'test-flow',
          phone_number: '+919876543210',
          data: {}
        });

      submissionId = submitResponse.body.data.id;
    });

    it('should get submission status', async () => {
      const response = await request(app)
        .get(`/api/flow/submission/${submissionId}`)
        .expect(200);

      expect(response.body).to.have.property('data');
      expect(response.body.data).to.have.property('id', submissionId);
      expect(response.body.data).to.have.property('status');
    });

    it('should return 404 for non-existent submission', async () => {
      const response = await request(app)
        .get('/api/flow/submission/non-existent-id')
        .expect(404);

      expect(response.body.error.code).to.equal(404);
    });
  });

  // ------------------------------------------------------------
  // GET /api/health - Health Check
  // ------------------------------------------------------------
  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body).to.have.property('status', 'healthy');
      expect(response.body).to.have.property('service', 'whatsapp-flow-framework');
      expect(response.body).to.have.property('endpoints');
      expect(response.body).to.have.property('uptime_ms');
      expect(response.body.uptime_ms).to.be.a('number').that.is.at.least(0);
    });
  });
});

// ============================================================================
// ACCEPTANCE CRITERIA TESTS
// ============================================================================

describe('Acceptance Criteria', () => {
  // ------------------------------------------------------------
  // AC #1: Launch appropriate WhatsApp Flow for structured data collection
  // ------------------------------------------------------------
  it('AC #1: System launches appropriate Flow for vertical', async () => {
    // Register template for Bike Rental
    await request(app)
      .post('/api/flow/templates')
      .send({
        id: 'bike-rental-flow',
        name: 'Bike Rental Booking Flow',
        vertical: 'Bike Rental',
        status: 'active',
        fields: [
          {
            name: 'pickup_date',
            type: 'date',
            label: 'Pickup Date',
            required: true
          },
          {
            name: 'bike_model',
            type: 'select',
            label: 'Bike Model',
            required: true,
            validation: {
              options: ['Hero', 'Honda', 'Bajaj']
            }
          }
        ]
      });

    // Get template for Bike Rental vertical
    const response = await request(app)
      .get('/api/flow/templates/Bike Rental')
      .expect(200);

    expect(response.body.data).to.not.be.null;
    expect(response.body.data.vertical).to.equal('Bike Rental');
    expect(response.body.data.fields).to.be.an('array');
    expect(response.body.data.fields.length).to.equal(2);
  });

  // ------------------------------------------------------------
  // AC #2: Validate data when completing each field
  // ------------------------------------------------------------
  it('AC #2: System validates data when completing each field', async () => {
    await request(app)
      .post('/api/flow/templates')
      .send({
        id: 'validation-flow',
        name: 'Validation Test Flow',
        vertical: 'Hotel',
        status: 'active',
        fields: [
          {
            name: 'email',
            type: 'email',
            label: 'Email Address',
            required: true
          },
          {
            name: 'phone',
            type: 'phone',
            label: 'Phone Number',
            required: true
          },
          {
            name: 'checkin_date',
            type: 'date',
            label: 'Check-in Date',
            required: true
          }
        ]
      });

    // Submit with invalid data
    const response = await request(app)
      .post('/api/flow/submit')
      .send({
        flow_id: 'validation-flow',
        phone_number: '+919876543210',
        data: {
          email: 'invalid-email',
          phone: '123',
          checkin_date: 'not-a-date'
        }
      })
      .expect(201);

    // Should have validation errors for all three fields
    expect(response.body.data.status).to.equal('pending');
    expect(response.body.data.validation_errors).to.have.length(3);

    const errorCodes = response.body.data.validation_errors.map(e => e.code);
    expect(errorCodes).to.include('INVALID_EMAIL');
    expect(errorCodes).to.include('INVALID_PHONE');
    expect(errorCodes).to.include('INVALID_DATE');
  });

  // ------------------------------------------------------------
  // AC #3: Pass all collected data to backend for processing
  // ------------------------------------------------------------
  it('AC #3: System passes all collected data to backend for processing', async () => {
    await request(app)
      .post('/api/flow/templates')
      .send({
        id: 'bike-booking-flow',
        name: 'Bike Booking Flow',
        vertical: 'Bike Rental',
        status: 'active',
        fields: [
          {
            name: 'pickup_date',
            type: 'date',
            label: 'Pickup Date',
            required: true
          },
          {
            name: 'return_date',
            type: 'date',
            label: 'Return Date',
            required: true
          },
          {
            name: 'bike_model',
            type: 'select',
            label: 'Bike Model',
            required: true,
            validation: {
              options: ['Hero', 'Honda', 'Bajaj']
            }
          },
          {
            name: 'id_type',
            type: 'select',
            label: 'ID Type',
            required: true,
            validation: {
              options: ['Aadhaar', 'Driving License', 'Passport']
            }
          },
          {
            name: 'id_number',
            type: 'text',
            label: 'ID Number',
            required: true
          }
        ]
      });

    const formData = {
      pickup_date: '2026-04-25',
      return_date: '2026-04-28',
      bike_model: 'Hero',
      id_type: 'Driving License',
      id_number: 'DL123456789'
    };

    const response = await request(app)
      .post('/api/flow/submit')
      .send({
        flow_id: 'bike-booking-flow',
        phone_number: '+919876543210',
        data: formData
      })
      .expect(201);

    // All data should be passed and stored
    expect(response.body.data).to.have.property('id');
    expect(response.body.data.data).to.deep.equal(formData);
    expect(response.body.data.status).to.equal('validated');
    expect(response.body.data.validation_errors).to.have.length(0);

    // Verify submission can be retrieved by ID
    const submissionResponse = await request(app)
      .get(`/api/flow/submission/${response.body.data.id}`)
      .expect(200);

    expect(submissionResponse.body.data.data).to.deep.equal(formData);
  });
});
