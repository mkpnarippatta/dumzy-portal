const request = require('supertest');
const { expect } = require('chai');
const { app, BikeAvailabilityService, BikeBookingService, FlowTemplateService, FlowValidator } = require('../src/3-2-bike-rental-booking-flow');

// ============================================================================
// SETUP MOCK DEPENDENCIES
// ============================================================================

// Mock FlowTemplateService for BikeBookingService
class MockFlowTemplateService {
  constructor() {
    this.templates = new Map();
    // Register bike rental template
    this.templates.set('bike-rental-booking-flow', {
      id: 'bike-rental-booking-flow',
      name: 'Bike Rental Booking Form',
      version: '1.0',
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
          label: 'Bike Model Preference',
          required: true,
          validation: { options: ['Hero', 'Honda', 'Bajaj', 'TVS', 'Royal Enfield'] }
        },
        {
          name: 'id_document_type',
          type: 'select',
          label: 'ID Document Type',
          required: true,
          validation: { options: ['Aadhaar', 'Driving License', 'Passport'] }
        },
        {
          name: 'id_number',
          type: 'text',
          label: 'ID Number',
          required: true,
          validation: {
            pattern: '^[A-Z0-9]{8,20}$',
            minLength: 8,
            maxLength: 20
          }
        }
      ]
    });
  }

  registerTemplate(template) {
    if (!template.id || !template.name || !template.vertical) {
      throw new Error('Template must have id, name, and vertical');
    }

    const registeredTemplate = {
      id: template.id,
      name: template.name,
      version: template.version || '1.0',
      vertical: template.vertical,
      status: template.status || 'draft',
      fields: template.fields || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    this.templates.set(registeredTemplate.id, registeredTemplate);
    return registeredTemplate;
  }

  getTemplateByVertical(vertical) {
    return Array.from(this.templates.values())
      .filter(t => t.vertical === vertical && t.status === 'active')
      .sort((a, b) => b.updated_at?.localeCompare(a.updated_at))[0] || null;
  }

  getTemplate(templateId) {
    return this.templates.get(templateId) || null;
  }
}

// Mock FlowValidator for BikeBookingService
class MockFlowValidator {
  validateField(field, value) {
    const errors = [];

    // Required check
    if (field.required && (value === undefined || value === null || value === '')) {
      errors.push({
        field: field.name,
        message: `${field.label} is required`,
        code: 'REQUIRED'
      });
      return errors;
    }

    // Skip validation if not required and empty
    if (!field.required && (value === undefined || value === null || value === '')) {
      return errors;
    }

    // Length validation (check before pattern)
    if (field.validation?.minLength && String(value).length < field.validation.minLength) {
      errors.push({
        field: field.name,
        message: `Minimum ${field.validation.minLength} characters required`,
        code: 'MIN_LENGTH'
      });
    }

    if (field.validation?.maxLength && String(value).length > field.validation.maxLength) {
      errors.push({
        field: field.name,
        message: `Maximum ${field.validation.maxLength} characters allowed`,
        code: 'MAX_LENGTH'
      });
    }

    // Pattern validation (check after length)
    if (field.validation?.pattern && !new RegExp(field.validation.pattern).test(String(value))) {
      errors.push({
        field: field.name,
        message: 'Invalid format',
        code: 'INVALID_PATTERN'
      });
    }

    return errors;
  }

  validateSubmission(template, data) {
    const errors = [];

    for (const field of template.fields) {
      const fieldErrors = this.validateField(field, data[field.name]);
      errors.push(...fieldErrors);
    }

    return errors;
  }
}

// ============================================================================
// BIKE AVAILABILITY SERVICE TESTS
// ============================================================================

describe('BikeAvailabilityService', () => {
  let bikeAvailabilityService;

  beforeEach(() => {
    bikeAvailabilityService = new BikeAvailabilityService();
  });

  describe('Bike Inventory', () => {
    it('should have initial inventory with 5 bike models', () => {
      const availability = bikeAvailabilityService.checkAvailability('2026-05-01', '2026-05-03');
      expect(availability).to.have.lengthOf(5);
    });

    it('should return correct initial counts for all models', () => {
      const availability = bikeAvailabilityService.checkAvailability('2026-05-01', '2026-05-03');
      const modelCounts = availability.reduce((acc, bike) => {
        acc[bike.model] = bike.available;
        return acc;
      }, {});

      expect(modelCounts).to.deep.equal({
        'Hero': 5,
        'Honda': 3,
        'Bajaj': 4,
        'TVS': 2,
        'Royal Enfield': 3
      });
    });
  });

  describe('Availability Checking (AC: #2)', () => {
    it('should return available bikes for valid date range', () => {
      const availability = bikeAvailabilityService.checkAvailability('2026-05-01', '2026-05-03');
      expect(availability).to.be.an('array');
      expect(availability).to.have.length.greaterThan(0);
      availability.forEach(bike => {
        expect(bike).to.have.property('model');
        expect(bike).to.have.property('available');
        expect(bike).to.have.property('total');
        expect(bike.available).to.be.greaterThan(0);
      });
    });

    it('should filter by bike model when specified', () => {
      const allBikes = bikeAvailabilityService.checkAvailability('2026-05-01', '2026-05-03');
      const heroBikes = bikeAvailabilityService.checkAvailability('2026-05-01', '2026-05-03', 'Hero');

      expect(heroBikes).to.have.lengthOf(1);
      expect(heroBikes[0].model).to.equal('Hero');
      expect(allBikes.length).to.be.greaterThan(heroBikes.length);
    });

    it('should return empty array when model has no availability', () => {
      // Book all Hero bikes
      for (let i = 0; i < 5; i++) {
        bikeAvailabilityService.bookBike('Hero', '2026-05-01', '2026-05-03', `phone_${i}`);
      }

      const heroBikes = bikeAvailabilityService.checkAvailability('2026-05-01', '2026-05-03', 'Hero');
      expect(heroBikes).to.have.lengthOf(0);
    });

    it('should return all models when no model filter specified', () => {
      const availability = bikeAvailabilityService.checkAvailability('2026-05-01', '2026-05-03');
      const models = availability.map(b => b.model);
      expect(models).to.include.members(['Hero', 'Honda', 'Bajaj', 'TVS', 'Royal Enfield']);
    });
  });

  describe('Booking Simulation', () => {
    it('should decrease available count after booking', () => {
      const before = bikeAvailabilityService.checkAvailability('2026-05-01', '2026-05-03', 'Hero');
      expect(before[0].available).to.equal(5);

      bikeAvailabilityService.bookBike('Hero', '2026-05-01', '2026-05-03', '+919876543210');

      const after = bikeAvailabilityService.checkAvailability('2026-05-01', '2026-05-03', 'Hero');
      expect(after[0].available).to.equal(4);
    });

    it('should not affect availability for different date ranges', () => {
      bikeAvailabilityService.bookBike('Hero', '2026-05-01', '2026-05-03', '+919876543210');

      const sameRange = bikeAvailabilityService.checkAvailability('2026-05-01', '2026-05-03', 'Hero');
      const differentRange = bikeAvailabilityService.checkAvailability('2026-06-01', '2026-06-03', 'Hero');

      expect(sameRange[0].available).to.equal(4);
      expect(differentRange[0].available).to.equal(5);
    });

    it('should not affect availability for different models', () => {
      bikeAvailabilityService.bookBike('Hero', '2026-05-01', '2026-05-03', '+919876543210');

      const heroBikes = bikeAvailabilityService.checkAvailability('2026-05-01', '2026-05-03', 'Hero');
      const hondaBikes = bikeAvailabilityService.checkAvailability('2026-05-01', '2026-05-03', 'Honda');

      expect(heroBikes[0].available).to.equal(4);
      expect(hondaBikes[0].available).to.equal(3);
    });
  });
});

// ============================================================================
// BIKE BOOKING SERVICE TESTS
// ============================================================================

describe('BikeBookingService', () => {
  let bikeBookingService;
  let mockFlowTemplateService;
  let mockFlowValidator;
  let mockBikeAvailabilityService;

  beforeEach(() => {
    mockFlowTemplateService = new MockFlowTemplateService();
    mockFlowValidator = new MockFlowValidator();
    mockBikeAvailabilityService = new BikeAvailabilityService();
    bikeBookingService = new BikeBookingService(
      mockFlowTemplateService,
      mockFlowValidator,
      mockBikeAvailabilityService
    );
  });

  describe('Date Validation', () => {
    it('should reject pickup date in the past (AC: #3)', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      const pickupDate = pastDate.toISOString().split('T')[0];

      const result = bikeBookingService.submitBooking('+919876543210', {
        pickup_date: pickupDate,
        return_date: '2026-05-05',
        bike_model: 'Hero',
        id_document_type: 'Aadhaar',
        id_number: 'ABCD1234EFGH'
      });

      expect(result.success).to.be.false;
      expect(result.validation_errors).to.be.an('array');
      const pickupError = result.validation_errors.find(e => e.field === 'pickup_date');
      expect(pickupError).to.exist;
      expect(pickupError.code).to.equal('PICKUP_DATE_PAST');
    });

    it('should reject pickup date equal to today', () => {
      const today = new Date().toISOString().split('T')[0];

      const result = bikeBookingService.submitBooking('+919876543210', {
        pickup_date: today,
        return_date: '2026-05-05',
        bike_model: 'Hero',
        id_document_type: 'Aadhaar',
        id_number: 'ABCD1234EFGH'
      });

      expect(result.success).to.be.false;
      const pickupError = result.validation_errors.find(e => e.field === 'pickup_date');
      expect(pickupError).to.exist;
      expect(pickupError.code).to.equal('PICKUP_DATE_PAST');
    });

    it('should reject return date before pickup date (AC: #3)', () => {
      const result = bikeBookingService.submitBooking('+919876543210', {
        pickup_date: '2026-05-05',
        return_date: '2026-05-03',
        bike_model: 'Hero',
        id_document_type: 'Aadhaar',
        id_number: 'ABCD1234EFGH'
      });

      expect(result.success).to.be.false;
      const returnError = result.validation_errors.find(e => e.field === 'return_date');
      expect(returnError).to.exist;
      expect(returnError.code).to.equal('RETURN_DATE_BEFORE_PICKUP');
    });

    it('should reject return date equal to pickup date', () => {
      const result = bikeBookingService.submitBooking('+919876543210', {
        pickup_date: '2026-05-05',
        return_date: '2026-05-05',
        bike_model: 'Hero',
        id_document_type: 'Aadhaar',
        id_number: 'ABCD1234EFGH'
      });

      expect(result.success).to.be.false;
      const returnError = result.validation_errors.find(e => e.field === 'return_date');
      expect(returnError).to.exist;
      expect(returnError.code).to.equal('RETURN_DATE_BEFORE_PICKUP');
    });

    it('should accept valid date range (pickup in future, return after pickup)', () => {
      const result = bikeBookingService.submitBooking('+919876543210', {
        pickup_date: '2026-05-10',
        return_date: '2026-05-15',
        bike_model: 'Hero',
        id_document_type: 'Aadhaar',
        id_number: 'ABCD1234EFGH'
      });

      expect(result.success).to.be.true;
    });
  });

  describe('ID Document Validation (AC: #1)', () => {
    it('should reject ID number shorter than 8 characters', () => {
      const result = bikeBookingService.submitBooking('+919876543210', {
        pickup_date: '2026-05-10',
        return_date: '2026-05-15',
        bike_model: 'Hero',
        id_document_type: 'Aadhaar',
        id_number: 'ABC1234'
      });

      expect(result.success).to.be.false;
      const idError = result.validation_errors.find(e => e.field === 'id_number');
      expect(idError).to.exist;
      expect(idError.code).to.equal('MIN_LENGTH');
    });

    it('should reject ID number longer than 20 characters', () => {
      const result = bikeBookingService.submitBooking('+919876543210', {
        pickup_date: '2026-05-10',
        return_date: '2026-05-15',
        bike_model: 'Hero',
        id_document_type: 'Aadhaar',
        id_number: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ12345'
      });

      expect(result.success).to.be.false;
      const idError = result.validation_errors.find(e => e.field === 'id_number');
      expect(idError).to.exist;
      expect(idError.code).to.equal('MAX_LENGTH');
    });

    it('should reject ID number with invalid format (special characters)', () => {
      const result = bikeBookingService.submitBooking('+919876543210', {
        pickup_date: '2026-05-10',
        return_date: '2026-05-15',
        bike_model: 'Hero',
        id_document_type: 'Aadhaar',
        id_number: 'ABCD-1234-EFGH'
      });

      expect(result.success).to.be.false;
      const idError = result.validation_errors.find(e => e.field === 'id_number');
      expect(idError).to.exist;
      expect(idError.code).to.equal('INVALID_PATTERN');
    });

    it('should accept valid ID number (alphanumeric, 8-20 chars)', () => {
      const result = bikeBookingService.submitBooking('+919876543210', {
        pickup_date: '2026-05-10',
        return_date: '2026-05-15',
        bike_model: 'Hero',
        id_document_type: 'Aadhaar',
        id_number: 'ABCD1234EFGH5678'
      });

      expect(result.success).to.be.true;
    });
  });

  describe('Booking Creation (AC: #3)', () => {
    it('should create booking with valid data', () => {
      const result = bikeBookingService.submitBooking('+919876543210', {
        pickup_date: '2026-05-10',
        return_date: '2026-05-15',
        bike_model: 'Hero',
        id_document_type: 'Aadhaar',
        id_number: 'ABCD1234EFGH'
      });

      expect(result.success).to.be.true;
      expect(result.booking).to.exist;
      expect(result.booking).to.have.property('id');
      expect(result.booking).to.have.property('phone_number', '+919876543210');
      expect(result.booking).to.have.property('pickup_date', '2026-05-10');
      expect(result.booking).to.have.property('return_date', '2026-05-15');
      expect(result.booking).to.have.property('bike_model', 'Hero');
      expect(result.booking).to.have.property('id_document_type', 'Aadhaar');
      expect(result.booking).to.have.property('id_number', 'ABCD1234EFGH');
      expect(result.booking).to.have.property('status', 'confirmed');
      expect(result.message).to.equal('Booking confirmed successfully');
    });

    it('should generate unique booking ID for each booking', () => {
      const result1 = bikeBookingService.submitBooking('+919876543210', {
        pickup_date: '2026-05-10',
        return_date: '2026-05-15',
        bike_model: 'Hero',
        id_document_type: 'Aadhaar',
        id_number: 'ABCD1234EFGH'
      });

      const result2 = bikeBookingService.submitBooking('+919876543211', {
        pickup_date: '2026-06-10',
        return_date: '2026-06-15',
        bike_model: 'Honda',
        id_document_type: 'Passport',
        id_number: 'P1234567'
      });

      expect(result1.booking.id).to.not.equal(result2.booking.id);
    });

    it('should store booking with timestamps', () => {
      const result = bikeBookingService.submitBooking('+919876543210', {
        pickup_date: '2026-05-10',
        return_date: '2026-05-15',
        bike_model: 'Hero',
        id_document_type: 'Aadhaar',
        id_number: 'ABCD1234EFGH'
      });

      expect(result.booking).to.have.property('created_at');
      expect(result.booking).to.have.property('updated_at');
      expect(result.booking.created_at).to.be.a('string');
      expect(result.booking.updated_at).to.be.a('string');
    });
  });

  describe('Booking Retrieval', () => {
    it('should retrieve booking by ID', () => {
      const createResult = bikeBookingService.submitBooking('+919876543210', {
        pickup_date: '2026-05-10',
        return_date: '2026-05-15',
        bike_model: 'Hero',
        id_document_type: 'Aadhaar',
        id_number: 'ABCD1234EFGH'
      });

      const booking = bikeBookingService.getBooking(createResult.booking.id);
      expect(booking).to.exist;
      expect(booking.id).to.equal(createResult.booking.id);
    });

    it('should return null for non-existent booking', () => {
      const booking = bikeBookingService.getBooking('non-existent-id');
      expect(booking).to.be.null;
    });
  });

  describe('Bike Model Selection (AC: #2)', () => {
    it('should accept valid bike models', () => {
      const validModels = ['Hero', 'Honda', 'Bajaj', 'TVS', 'Royal Enfield'];

      validModels.forEach(model => {
        const result = bikeBookingService.submitBooking(`+91987654321${validModels.indexOf(model)}`, {
          pickup_date: '2026-05-10',
          return_date: '2026-05-15',
          bike_model: model,
          id_document_type: 'Aadhaar',
          id_number: 'ABCD1234EFGH'
        });
        expect(result.success).to.be.true;
        expect(result.booking.bike_model).to.equal(model);
      });
    });
  });
});

// ============================================================================
// API ENDPOINTS TESTS
// ============================================================================

describe('API Endpoints', () => {
  describe('GET /api/bike/availability', () => {
    it('should return available bikes for valid date range (AC: #2)', async () => {
      const response = await request(app)
        .get('/api/bike/availability')
        .query({ pickup_date: '2026-05-01', return_date: '2026-05-03' })
        .expect(200);

      expect(response.body).to.have.property('data');
      expect(response.body.data).to.be.an('array');
      expect(response.body.data).to.have.lengthOf(5);
      expect(response.body.data[0]).to.have.property('model');
      expect(response.body.data[0]).to.have.property('available');
      expect(response.body.data[0]).to.have.property('total');
    });

    it('should filter by bike_model when specified (AC: #2)', async () => {
      const response = await request(app)
        .get('/api/bike/availability')
        .query({ pickup_date: '2026-05-01', return_date: '2026-05-03', bike_model: 'Hero' })
        .expect(200);

      expect(response.body.data).to.have.lengthOf(1);
      expect(response.body.data[0].model).to.equal('Hero');
    });

    it('should return 400 for missing pickup_date', async () => {
      const response = await request(app)
        .get('/api/bike/availability')
        .query({ return_date: '2026-05-03' })
        .expect(400);

      expect(response.body).to.have.property('error');
      expect(response.body.error.code).to.equal(400);
    });

    it('should return 400 for missing return_date', async () => {
      const response = await request(app)
        .get('/api/bike/availability')
        .query({ pickup_date: '2026-05-01' })
        .expect(400);

      expect(response.body).to.have.property('error');
      expect(response.body.error.code).to.equal(400);
    });
  });

  describe('POST /api/bike/booking', () => {
    it('should create booking with valid data (AC: #3)', async () => {
      const response = await request(app)
        .post('/api/bike/booking')
        .send({
          phone_number: '+919876543210',
          pickup_date: '2026-05-10',
          return_date: '2026-05-15',
          bike_model: 'Hero',
          id_document_type: 'Aadhaar',
          id_number: 'ABCD1234EFGH'
        })
        .expect(201);

      expect(response.body).to.have.property('data');
      expect(response.body.data).to.have.property('id');
      expect(response.body.data).to.have.property('status', 'confirmed');
      expect(response.body.data).to.have.property('phone_number', '+919876543210');
      expect(response.body.meta).to.have.property('message', 'Booking confirmed successfully');
    });

    it('should return 400 for missing phone_number', async () => {
      const response = await request(app)
        .post('/api/bike/booking')
        .send({
          pickup_date: '2026-05-10',
          return_date: '2026-05-15',
          bike_model: 'Hero',
          id_document_type: 'Aadhaar',
          id_number: 'ABCD1234EFGH'
        })
        .expect(400);

      expect(response.body).to.have.property('error');
      expect(response.body.error.code).to.equal(400);
    });

    it('should return 400 for invalid date: pickup in past', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      const pickupDate = pastDate.toISOString().split('T')[0];

      const response = await request(app)
        .post('/api/bike/booking')
        .send({
          phone_number: '+919876543210',
          pickup_date: pickupDate,
          return_date: '2026-05-15',
          bike_model: 'Hero',
          id_document_type: 'Aadhaar',
          id_number: 'ABCD1234EFGH'
        })
        .expect(400);

      expect(response.body).to.have.property('error');
      expect(response.body.error.validation_errors).to.be.an('array');
      const pickupError = response.body.error.validation_errors.find(e => e.code === 'PICKUP_DATE_PAST');
      expect(pickupError).to.exist;
    });

    it('should return 400 for invalid date: return before pickup', async () => {
      const response = await request(app)
        .post('/api/bike/booking')
        .send({
          phone_number: '+919876543210',
          pickup_date: '2026-05-10',
          return_date: '2026-05-05',
          bike_model: 'Hero',
          id_document_type: 'Aadhaar',
          id_number: 'ABCD1234EFGH'
        })
        .expect(400);

      expect(response.body).to.have.property('error');
      const returnError = response.body.error.validation_errors.find(e => e.code === 'RETURN_DATE_BEFORE_PICKUP');
      expect(returnError).to.exist;
    });

    it('should return 400 for invalid ID number format', async () => {
      const response = await request(app)
        .post('/api/bike/booking')
        .send({
          phone_number: '+919876543210',
          pickup_date: '2026-05-10',
          return_date: '2026-05-15',
          bike_model: 'Hero',
          id_document_type: 'Aadhaar',
          id_number: 'ABCD-1234-EFGH'
        })
        .expect(400);

      expect(response.body).to.have.property('error');
      const idError = response.body.error.validation_errors.find(e => e.field === 'id_number');
      expect(idError).to.exist;
    });
  });

  describe('GET /api/bike/booking/:id', () => {
    it('should return booking by ID', async () => {
      const createResponse = await request(app)
        .post('/api/bike/booking')
        .send({
          phone_number: '+919876543210',
          pickup_date: '2026-05-10',
          return_date: '2026-05-15',
          bike_model: 'Hero',
          id_document_type: 'Aadhaar',
          id_number: 'ABCD1234EFGH'
        })
        .expect(201);

      const bookingId = createResponse.body.data.id;

      const response = await request(app)
        .get(`/api/bike/booking/${bookingId}`)
        .expect(200);

      expect(response.body).to.have.property('data');
      expect(response.body.data.id).to.equal(bookingId);
      expect(response.body.data).to.have.property('phone_number', '+919876543210');
    });

    it('should return 404 for non-existent booking', async () => {
      const response = await request(app)
        .get('/api/bike/booking/non-existent-id')
        .expect(404);

      expect(response.body).to.have.property('error');
      expect(response.body.error.code).to.equal(404);
    });
  });

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body).to.have.property('status', 'healthy');
      expect(response.body).to.have.property('service', 'bike-rental-booking');
      expect(response.body).to.have.property('endpoints');
      expect(response.body.endpoints).to.include.members([
        'GET /api/bike/availability',
        'POST /api/bike/booking',
        'GET /api/bike/booking/:id',
        'GET /api/health'
      ]);
    });
  });
});

// ============================================================================
// ACCEPTANCE CRITERIA TESTS
// ============================================================================

describe('Acceptance Criteria', () => {
  let mockFlowTemplateService;
  let mockFlowValidator;
  let bikeAvailabilityService;
  let bikeBookingService;

  beforeEach(() => {
    mockFlowTemplateService = new MockFlowTemplateService();
    mockFlowValidator = new MockFlowValidator();
    bikeAvailabilityService = new BikeAvailabilityService();
    bikeBookingService = new BikeBookingService(
      mockFlowTemplateService,
      mockFlowValidator,
      bikeAvailabilityService
    );

    // Register bike rental flow template
    mockFlowTemplateService.registerTemplate({
      id: 'bike-rental-booking-flow',
      name: 'Bike Rental Booking Form',
      vertical: 'Bike Rental',
      status: 'active',
      fields: [
        { name: 'pickup_date', type: 'date', label: 'Pickup Date', required: true },
        { name: 'return_date', type: 'date', label: 'Return Date', required: true },
        { name: 'bike_model', type: 'select', label: 'Bike Model Preference', required: true },
        { name: 'id_document_type', type: 'select', label: 'ID Document Type', required: true },
        {
          name: 'id_number',
          type: 'text',
          label: 'ID Number',
          required: true,
          validation: {
            pattern: '^[A-Z0-9]{8,20}$',
            minLength: 8,
            maxLength: 20
          }
        }
      ]
    });
  });

  describe('AC #1: Bot detects Bike Rental intent and launches Flow collecting required fields', () => {
    it('should have Flow template with all required fields', () => {
      const template = mockFlowTemplateService.getTemplateByVertical('Bike Rental');

      expect(template).to.exist;
      expect(template.vertical).to.equal('Bike Rental');
      expect(template.status).to.equal('active');

      const fieldNames = template.fields.map(f => f.name);
      expect(fieldNames).to.include.members([
        'pickup_date',
        'return_date',
        'bike_model',
        'id_document_type',
        'id_number'
      ]);
    });

    it('should have field validation rules for ID number', () => {
      const template = mockFlowTemplateService.getTemplateByVertical('Bike Rental');
      const idField = template.fields.find(f => f.name === 'id_number');

      expect(idField).to.exist;
      expect(idField.validation).to.exist;
      expect(idField.validation.pattern).to.equal('^[A-Z0-9]{8,20}$');
      expect(idField.validation.minLength).to.equal(8);
      expect(idField.validation.maxLength).to.equal(20);
    });
  });

  describe('AC #2: System displays available bikes based on selected date range', () => {
    it('should return available bikes for date range', () => {
      const availability = bikeAvailabilityService.checkAvailability('2026-05-10', '2026-05-15');

      expect(availability).to.be.an('array');
      expect(availability.length).to.be.greaterThan(0);
      availability.forEach(bike => {
        expect(bike.available).to.be.greaterThan(0);
      });
    });

    it('should filter available bikes by model selection', () => {
      const heroBikes = bikeAvailabilityService.checkAvailability('2026-05-10', '2026-05-15', 'Hero');

      expect(heroBikes).to.have.lengthOf(1);
      expect(heroBikes[0].model).to.equal('Hero');
    });

    it('should reflect reduced availability after booking', () => {
      const before = bikeAvailabilityService.checkAvailability('2026-05-10', '2026-05-15', 'Hero');
      const beforeCount = before[0].available;

      bikeAvailabilityService.bookBike('Hero', '2026-05-10', '2026-05-15', '+919876543210');

      const after = bikeAvailabilityService.checkAvailability('2026-05-10', '2026-05-15', 'Hero');
      expect(after[0].available).to.equal(beforeCount - 1);
    });
  });

  describe('AC #3: System passes validated data to backend for order creation', () => {
    it('should validate and create booking with complete Flow data', () => {
      const result = bikeBookingService.submitBooking('+919876543210', {
        pickup_date: '2026-05-10',
        return_date: '2026-05-15',
        bike_model: 'Hero',
        id_document_type: 'Aadhaar',
        id_number: 'ABCD1234EFGH'
      });

      expect(result.success).to.be.true;
      expect(result.booking).to.exist;
      expect(result.booking.status).to.equal('confirmed');
    });

    it('should store booking with all Flow fields', () => {
      const result = bikeBookingService.submitBooking('+919876543210', {
        pickup_date: '2026-05-10',
        return_date: '2026-05-15',
        bike_model: 'Honda',
        id_document_type: 'Passport',
        id_number: 'P1234567890'
      });

      expect(result.booking.pickup_date).to.equal('2026-05-10');
      expect(result.booking.return_date).to.equal('2026-05-15');
      expect(result.booking.bike_model).to.equal('Honda');
      expect(result.booking.id_document_type).to.equal('Passport');
      expect(result.booking.id_number).to.equal('P1234567890');
    });

    it('should reject booking with invalid pickup date', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      const pickupDate = pastDate.toISOString().split('T')[0];

      const result = bikeBookingService.submitBooking('+919876543210', {
        pickup_date: pickupDate,
        return_date: '2026-05-15',
        bike_model: 'Hero',
        id_document_type: 'Aadhaar',
        id_number: 'ABCD1234EFGH'
      });

      expect(result.success).to.be.false;
      expect(result.validation_errors).to.be.an('array');
      expect(result.validation_errors.some(e => e.code === 'PICKUP_DATE_PAST')).to.be.true;
    });
  });
});
