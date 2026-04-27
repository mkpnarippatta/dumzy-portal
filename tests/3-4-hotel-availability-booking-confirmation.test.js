const request = require('supertest');
const { expect } = require('chai');
const { app, HotelBookingService, PMSAvailabilityService, FlowTemplateService, FlowValidator } = require('../src/3-4-hotel-availability-booking-confirmation');

// ============================================================================
// SETUP MOCK DEPENDENCIES
// ============================================================================

class MockFlowTemplateService {
  constructor() {
    this.templates = new Map();
    this.templates.set('hotel-availability-flow', {
      id: 'hotel-availability-flow',
      name: 'Hotel Availability Request Form',
      version: '1.0',
      vertical: 'Hotel',
      status: 'active',
      fields: [
        { name: 'check_in_date', type: 'date', label: 'Check-in Date', required: true },
        { name: 'check_out_date', type: 'date', label: 'Check-out Date', required: true },
        { name: 'guest_count', type: 'number', label: 'Number of Guests', required: true, validation: { min: 1, max: 10 } },
        { name: 'room_type_preference', type: 'select', label: 'Room Type Preference', required: false, validation: { options: ['Standard', 'Deluxe', 'Suite', 'Family Room'] } }
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

class MockFlowValidator {
  validateField(field, value) {
    const errors = [];
    const isEmpty = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    if (field.required && isEmpty) {
      errors.push({ field: field.name, message: `${field.label} is required`, code: 'REQUIRED' });
      return errors;
    }
    if (!field.required && isEmpty) {
      return errors;
    }
    if (field.validation?.options && !field.validation.options.includes(value)) {
      errors.push({ field: field.name, message: `Invalid option for ${field.label}`, code: 'INVALID_OPTION' });
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
// TASK 1: TESTS FOR FLOW TEMPLATE REGISTRATION
// ============================================================================

describe('Task 1: Hotel Availability Flow Template Registration', () => {
  describe('FlowTemplateService.registerTemplate', () => {
    it('should register hotel availability template with all required fields', () => {
      const flowService = new FlowTemplateService();
      const template = {
        id: 'hotel-availability-flow',
        name: 'Hotel Availability Request Form',
        version: '1.0',
        vertical: 'Hotel',
        status: 'active',
        fields: [
          { name: 'check_in_date', type: 'date', label: 'Check-in Date', required: true },
          { name: 'check_out_date', type: 'date', label: 'Check-out Date', required: true },
          { name: 'guest_count', type: 'number', label: 'Number of Guests', required: true, validation: { min: 1, max: 10 } },
          { name: 'room_type_preference', type: 'select', label: 'Room Type Preference', required: false, validation: { options: ['Standard', 'Deluxe', 'Suite', 'Family Room'] } }
        ]
      };

      const registered = flowService.registerTemplate(template);
      expect(registered).to.have.property('id', 'hotel-availability-flow');
      expect(registered).to.have.property('vertical', 'Hotel');
      expect(registered).to.have.property('status', 'active');
      expect(registered.fields).to.have.lengthOf(4);
    });

    it('should throw error without id', () => {
      const flowService = new FlowTemplateService();
      expect(() => flowService.registerTemplate({ name: 'Test', vertical: 'Hotel', fields: [] }))
        .to.throw('Template must have id, name, and vertical');
    });

    it('should throw error without name', () => {
      const flowService = new FlowTemplateService();
      expect(() => flowService.registerTemplate({ id: 'test', vertical: 'Hotel', fields: [] }))
        .to.throw('Template must have id, name, and vertical');
    });

    it('should throw error without vertical', () => {
      const flowService = new FlowTemplateService();
      expect(() => flowService.registerTemplate({ id: 'test', name: 'Test', fields: [] }))
        .to.throw('Template must have id, name, and vertical');
    });

    it('should set default status to draft when not provided', () => {
      const flowService = new FlowTemplateService();
      const registered = flowService.registerTemplate({ id: 'draft-flow', name: 'Draft', vertical: 'Hotel', fields: [] });
      expect(registered).to.have.property('status', 'draft');
    });

    it('should retrieve active template by vertical', () => {
      const flowService = new FlowTemplateService();
      flowService.registerTemplate({ id: 'hotel-availability-flow', name: 'Hotel Form', vertical: 'Hotel', status: 'active', fields: [] });
      const template = flowService.getTemplateByVertical('Hotel');
      expect(template).to.not.be.null;
      expect(template).to.have.property('id', 'hotel-availability-flow');
    });

    it('should return null for draft templates when retrieving by vertical', () => {
      const flowService = new FlowTemplateService();
      flowService.registerTemplate({ id: 'draft-flow', name: 'Draft', vertical: 'Hotel', status: 'draft', fields: [] });
      expect(flowService.getTemplateByVertical('Hotel')).to.be.null;
    });

    it('should retrieve template by id', () => {
      const flowService = new FlowTemplateService();
      flowService.registerTemplate({ id: 'hotel-availability-flow', name: 'Hotel Form', vertical: 'Hotel', fields: [] });
      expect(flowService.getTemplate('hotel-availability-flow')).to.not.be.null;
    });

    it('should return null for non-existent template', () => {
      const flowService = new FlowTemplateService();
      expect(flowService.getTemplate('non-existent')).to.be.null;
    });
  });

  describe('FlowValidator field validation', () => {
    let validator;

    beforeEach(() => { validator = new FlowValidator(); });

    it('should validate required field correctly', () => {
      const errors = validator.validateField({ name: 'check_in_date', type: 'date', label: 'Check-in Date', required: true }, '');
      expect(errors).to.have.lengthOf(1);
      expect(errors[0]).to.have.property('code', 'REQUIRED');
    });

    it('should pass validation for required field with value', () => {
      const errors = validator.validateField({ name: 'check_in_date', type: 'date', label: 'Check-in Date', required: true }, '2026-05-01');
      expect(errors).to.have.lengthOf(0);
    });

    it('should validate optional field as empty', () => {
      const errors = validator.validateField({ name: 'room_type_preference', type: 'select', label: 'Room Type', required: false }, '');
      expect(errors).to.have.lengthOf(0);
    });

    it('should pass for whitespace-only required fields (triggers required)', () => {
      const errors = validator.validateField({ name: 'check_in_date', type: 'date', label: 'Check-in Date', required: true }, '   ');
      expect(errors).to.have.lengthOf(1);
      expect(errors[0]).to.have.property('code', 'REQUIRED');
    });
  });
});

// ============================================================================
// TASK 2: TESTS FOR PMS AVAILABILITY SERVICE
// ============================================================================

describe('Task 2: PMS Availability Service', () => {
  let pmsService;

  beforeEach(() => { pmsService = new PMSAvailabilityService(); });

  describe('getRoomTypes', () => {
    it('should return all room types with pricing', () => {
      const rooms = pmsService.getRoomTypes();
      expect(rooms).to.be.an('array');
      expect(rooms).to.have.lengthOf(4);
      expect(rooms[0]).to.have.all.keys('code', 'name', 'price', 'capacity');
    });

    it('should include Standard room at 2500', () => {
      const standard = pmsService.getRoomTypes().find(r => r.code === 'Standard');
      expect(standard).to.exist;
      expect(standard.price).to.equal(2500);
    });

    it('should include Suite at 5000 with capacity 3', () => {
      const suite = pmsService.getRoomTypes().find(r => r.code === 'Suite');
      expect(suite).to.exist;
      expect(suite.price).to.equal(5000);
      expect(suite.capacity).to.equal(3);
    });
  });

  describe('queryAvailability', () => {
    it('should return availability for valid date range (AC: #2)', () => {
      const result = pmsService.queryAvailability({
        check_in_date: '2026-05-01',
        check_out_date: '2026-05-03',
        guest_count: 1
      });

      expect(result.success).to.be.true;
      expect(result.rooms).to.be.an('array');
      expect(result.rooms).to.have.lengthOf(4);
      expect(result.total_rooms).to.equal(4);
    });

    it('should include pricing for each room type', () => {
      const result = pmsService.queryAvailability({
        check_in_date: '2026-05-01',
        check_out_date: '2026-05-03',
        guest_count: 2
      });

      result.rooms.forEach(room => {
        expect(room).to.have.property('price').that.is.a('number');
        expect(room).to.have.property('available', true);
        expect(room).to.have.property('capacity').that.is.a('number');
      });
    });

    it('should return correct nights count', () => {
      const result = pmsService.queryAvailability({
        check_in_date: '2026-05-01',
        check_out_date: '2026-05-04',
        guest_count: 1
      });

      expect(result.dates.nights).to.equal(3);
    });

    it('should return error for past check-in date', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 5);
      const result = pmsService.queryAvailability({
        check_in_date: pastDate.toISOString().split('T')[0],
        check_out_date: '2026-05-03',
        guest_count: 1
      });

      expect(result.success).to.be.false;
      expect(result.error.code).to.equal('PAST_CHECK_IN_DATE');
    });

    it('should return error when check-out is before check-in', () => {
      const result = pmsService.queryAvailability({
        check_in_date: '2026-05-05',
        check_out_date: '2026-05-03',
        guest_count: 1
      });

      expect(result.success).to.be.false;
      expect(result.error.code).to.equal('CHECK_OUT_BEFORE_CHECK_IN');
    });

    it('should return error for invalid date format', () => {
      const result = pmsService.queryAvailability({
        check_in_date: 'invalid-date',
        check_out_date: '2026-05-03',
        guest_count: 1
      });

      expect(result.success).to.be.false;
      expect(result.error.code).to.equal('INVALID_DATE');
    });

    it('should cache availability results with 30s TTL', () => {
      const result1 = pmsService.queryAvailability({
        check_in_date: '2026-06-01',
        check_out_date: '2026-06-03',
        guest_count: 1
      });

      expect(result1.cached).to.be.undefined;

      const result2 = pmsService.queryAvailability({
        check_in_date: '2026-06-01',
        check_out_date: '2026-06-03',
        guest_count: 1
      });

      expect(result2.cached).to.be.true;
    });

    it('should display checking_availability status for slow responses', () => {
      pmsService.setSlowResponse(true);
      const result = pmsService.queryAvailability({
        check_in_date: '2026-05-10',
        check_out_date: '2026-05-12',
        guest_count: 1
      });

      expect(result.checking_availability).to.be.true;
    });
  });
});

// ============================================================================
// TASK 3: TESTS FOR FLOW SUBMISSION HANDLING
// ============================================================================

describe('Task 3: Flow Submission Handling', () => {
  let flowTemplateService, flowValidator, pmsService, bookingService;

  beforeEach(() => {
    flowTemplateService = new MockFlowTemplateService();
    flowValidator = new MockFlowValidator();
    pmsService = new PMSAvailabilityService();
    bookingService = new HotelBookingService(flowTemplateService, flowValidator, pmsService);
  });

  describe('submitAvailabilityRequest with valid data', () => {
    it('should submit request with all required fields (AC: #2)', () => {
      const result = bookingService.submitAvailabilityRequest('+919876543210', {
        check_in_date: '2026-05-10',
        check_out_date: '2026-05-15',
        guest_count: 2,
        room_type_preference: 'Deluxe'
      });

      expect(result.success).to.be.true;
      expect(result).to.have.property('request_id').that.is.a('string');
      expect(result).to.have.property('message').that.includes('reference number');
      expect(result).to.have.property('availability');
      expect(result.availability.total_rooms).to.equal(4);
    });

    it('should generate unique request IDs', () => {
      const result1 = bookingService.submitAvailabilityRequest('+919876543210', {
        check_in_date: '2026-05-10',
        check_out_date: '2026-05-15',
        guest_count: 1
      });

      const result2 = bookingService.submitAvailabilityRequest('+919876543210', {
        check_in_date: '2026-06-10',
        check_out_date: '2026-06-15',
        guest_count: 1
      });

      expect(result1.request_id).to.not.equal(result2.request_id);
    });
  });

  describe('submitAvailabilityRequest validation - required fields', () => {
    it('should reject without check_in_date', () => {
      const result = bookingService.submitAvailabilityRequest('+919876543210', {
        check_out_date: '2026-05-15',
        guest_count: 1
      });

      expect(result.success).to.be.false;
      const error = result.validation_errors.find(e => e.field === 'check_in_date');
      expect(error).to.exist;
      expect(error.code).to.equal('REQUIRED');
    });

    it('should reject without check_out_date', () => {
      const result = bookingService.submitAvailabilityRequest('+919876543210', {
        check_in_date: '2026-05-10',
        guest_count: 1
      });

      expect(result.success).to.be.false;
      const error = result.validation_errors.find(e => e.field === 'check_out_date');
      expect(error).to.exist;
      expect(error.code).to.equal('REQUIRED');
    });

    it('should reject without guest_count', () => {
      const result = bookingService.submitAvailabilityRequest('+919876543210', {
        check_in_date: '2026-05-10',
        check_out_date: '2026-05-15'
      });

      expect(result.success).to.be.false;
      const error = result.validation_errors.find(e => e.field === 'guest_count');
      expect(error).to.exist;
      expect(error.code).to.equal('REQUIRED');
    });
  });

  describe('submitAvailabilityRequest validation - dates', () => {
    it('should reject past check-in date', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      const result = bookingService.submitAvailabilityRequest('+919876543210', {
        check_in_date: pastDate.toISOString().split('T')[0],
        check_out_date: '2026-05-15',
        guest_count: 1
      });

      expect(result.success).to.be.false;
      const error = result.validation_errors.find(e => e.code === 'PAST_CHECK_IN_DATE');
      expect(error).to.exist;
    });

    it('should reject check-out before check-in', () => {
      const result = bookingService.submitAvailabilityRequest('+919876543210', {
        check_in_date: '2026-05-15',
        check_out_date: '2026-05-10',
        guest_count: 1
      });

      expect(result.success).to.be.false;
      const error = result.validation_errors.find(e => e.code === 'CHECK_OUT_BEFORE_CHECK_IN');
      expect(error).to.exist;
    });

    it('should accept valid future date range', () => {
      const result = bookingService.submitAvailabilityRequest('+919876543210', {
        check_in_date: '2026-05-10',
        check_out_date: '2026-05-15',
        guest_count: 2
      });

      expect(result.success).to.be.true;
    });

    it('should reject invalid date format', () => {
      const result = bookingService.submitAvailabilityRequest('+919876543210', {
        check_in_date: 'not-a-date',
        check_out_date: '2026-05-15',
        guest_count: 1
      });

      expect(result.success).to.be.false;
      const error = result.validation_errors.find(e => e.code === 'INVALID_DATE');
      expect(error).to.exist;
    });
  });

  describe('submitAvailabilityRequest - availability results', () => {
    it('should return room types and pricing from query (AC: #2)', () => {
      const result = bookingService.submitAvailabilityRequest('+919876543210', {
        check_in_date: '2026-05-10',
        check_out_date: '2026-05-15',
        guest_count: 2
      });

      expect(result.availability.rooms).to.be.an('array');
      expect(result.availability.rooms.length).to.be.greaterThan(0);
      result.availability.rooms.forEach(room => {
        expect(room).to.have.property('type');
        expect(room).to.have.property('price');
        expect(room).to.have.property('available');
      });
    });

    it('should include check-in/out dates and nights in response', () => {
      const result = bookingService.submitAvailabilityRequest('+919876543210', {
        check_in_date: '2026-05-10',
        check_out_date: '2026-05-15',
        guest_count: 2
      });

      expect(result.availability.dates.check_in).to.equal('2026-05-10');
      expect(result.availability.dates.check_out).to.equal('2026-05-15');
      expect(result.availability.dates.nights).to.equal(5);
    });
  });

  describe('getAvailabilityRequest', () => {
    it('should retrieve existing request by ID', () => {
      const submitResult = bookingService.submitAvailabilityRequest('+919876543210', {
        check_in_date: '2026-05-10',
        check_out_date: '2026-05-15',
        guest_count: 2,
        room_type_preference: 'Suite'
      });

      const request = bookingService.getAvailabilityRequest(submitResult.request_id);
      expect(request).to.not.be.null;
      expect(request.check_in_date).to.equal('2026-05-10');
      expect(request.guest_count).to.equal(2);
    });

    it('should return null for non-existent request', () => {
      expect(bookingService.getAvailabilityRequest('non-existent')).to.be.null;
    });
  });
});

// ============================================================================
// TASK 4: TESTS FOR API ENDPOINTS
// ============================================================================

describe('Task 4: Hotel Booking API Endpoints', () => {
  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/api/health');
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('status', 'healthy');
      expect(response.body).to.have.property('service', 'hotel-availability');
    });
  });

  describe('POST /api/hotel/availability', () => {
    it('should return availability for valid request (AC: #2)', async () => {
      const response = await request(app)
        .post('/api/hotel/availability')
        .send({
          phone_number: '+919876543210',
          check_in_date: '2026-05-10',
          check_out_date: '2026-05-15',
          guest_count: 2,
          room_type_preference: 'Deluxe'
        })
        .expect(200);

      expect(response.body).to.have.property('data');
      expect(response.body.data).to.have.property('success', true);
      expect(response.body.data).to.have.property('request_id');
      expect(response.body.data).to.have.property('availability');
      expect(response.body.meta).to.have.property('total_rooms', 4);
    });

    it('should return 400 for missing phone_number', async () => {
      const response = await request(app)
        .post('/api/hotel/availability')
        .send({
          check_in_date: '2026-05-10',
          check_out_date: '2026-05-15',
          guest_count: 2
        })
        .expect(400);

      expect(response.body.error.code).to.equal(400);
    });

    it('should return 400 for missing check_in_date', async () => {
      const response = await request(app)
        .post('/api/hotel/availability')
        .send({
          phone_number: '+919876543210',
          check_out_date: '2026-05-15',
          guest_count: 2
        })
        .expect(400);

      expect(response.body.error.code).to.equal(400);
    });

    it('should return 400 for past check-in date', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      const response = await request(app)
        .post('/api/hotel/availability')
        .send({
          phone_number: '+919876543210',
          check_in_date: pastDate.toISOString().split('T')[0],
          check_out_date: '2026-05-15',
          guest_count: 2
        })
        .expect(400);

      expect(response.body.error.validation_errors).to.be.an('array');
    });

    it('should return 400 for invalid date format', async () => {
      const response = await request(app)
        .post('/api/hotel/availability')
        .send({
          phone_number: '+919876543210',
          check_in_date: 'not-a-date',
          check_out_date: '2026-05-15',
          guest_count: 2
        })
        .expect(400);

      expect(response.body.error.code).to.equal(400);
    });
  });

  describe('POST /api/hotel/booking', () => {
    it('should return booking info for valid request (Phase 2 placeholder)', async () => {
      const availabilityResponse = await request(app)
        .post('/api/hotel/availability')
        .send({
          phone_number: '+919876543210',
          check_in_date: '2026-05-10',
          check_out_date: '2026-05-15',
          guest_count: 2
        })
        .expect(200);

      const requestId = availabilityResponse.body.data.request_id;

      const response = await request(app)
        .post('/api/hotel/booking')
        .send({
          phone_number: '+919876543210',
          request_id: requestId
        })
        .expect(200);

      expect(response.body.data).to.have.property('success', true);
      expect(response.body.data).to.have.property('request_id', requestId);
    });

    it('should return 400 for missing phone_number', async () => {
      const response = await request(app)
        .post('/api/hotel/booking')
        .send({ request_id: 'test-id' })
        .expect(400);

      expect(response.body.error.code).to.equal(400);
    });

    it('should return 400 for missing request_id', async () => {
      const response = await request(app)
        .post('/api/hotel/booking')
        .send({ phone_number: '+919876543210' })
        .expect(400);

      expect(response.body.error.code).to.equal(400);
    });

    it('should return 404 for non-existent request_id', async () => {
      const response = await request(app)
        .post('/api/hotel/booking')
        .send({
          phone_number: '+919876543210',
          request_id: 'non-existent-id'
        })
        .expect(404);

      expect(response.body.error.code).to.equal(404);
    });
  });

  describe('GET /api/hotel/booking/:id', () => {
    it('should return booking status by ID', async () => {
      const availabilityResponse = await request(app)
        .post('/api/hotel/availability')
        .send({
          phone_number: '+919876543210',
          check_in_date: '2026-05-10',
          check_out_date: '2026-05-15',
          guest_count: 2
        })
        .expect(200);

      const requestId = availabilityResponse.body.data.request_id;

      const response = await request(app)
        .get(`/api/hotel/booking/${requestId}`)
        .expect(200);

      expect(response.body).to.have.property('data');
      expect(response.body.data).to.have.property('request_id', requestId);
      expect(response.body.data).to.have.property('status', 'pending');
    });

    it('should return 404 for non-existent booking', async () => {
      const response = await request(app)
        .get('/api/hotel/booking/non-existent')
        .expect(404);

      expect(response.body.error.code).to.equal(404);
    });
  });
});

// ============================================================================
// ACCEPTANCE CRITERIA TESTS
// ============================================================================

describe('Acceptance Criteria', () => {
  let flowTemplateService, flowValidator, pmsService, bookingService;

  beforeEach(() => {
    flowTemplateService = new MockFlowTemplateService();
    flowValidator = new MockFlowValidator();
    pmsService = new PMSAvailabilityService();
    bookingService = new HotelBookingService(flowTemplateService, flowValidator, pmsService);
  });

  describe('AC #1: System launches Flow collecting check-in and check-out dates', () => {
    it('should have Flow template with all required fields (AC: #1)', () => {
      const template = flowTemplateService.getTemplateByVertical('Hotel');
      expect(template).to.exist;
      expect(template.status).to.equal('active');

      const fieldNames = template.fields.map(f => f.name);
      expect(fieldNames).to.include.members(['check_in_date', 'check_out_date', 'guest_count']);
    });

    it('should have room_type_preference as optional field', () => {
      const template = flowTemplateService.getTemplateByVertical('Hotel');
      const roomPref = template.fields.find(f => f.name === 'room_type_preference');
      expect(roomPref).to.exist;
      expect(roomPref.required).to.be.false;
    });
  });

  describe('AC #2: System displays available room types and pricing', () => {
    it('should return available room types with pricing', () => {
      const result = bookingService.submitAvailabilityRequest('+919876543210', {
        check_in_date: '2026-05-10',
        check_out_date: '2026-05-15',
        guest_count: 2
      });

      expect(result.success).to.be.true;
      expect(result.availability.rooms).to.be.an('array');
      expect(result.availability.rooms.length).to.be.greaterThan(0);

      const rooms = result.availability.rooms;
      const roomTypes = rooms.map(r => r.type);
      expect(roomTypes).to.include.members(['Standard', 'Deluxe', 'Suite', 'Family Room']);

      rooms.forEach(room => {
        expect(room).to.have.property('price').that.is.a('number');
        expect(room.price).to.be.greaterThan(0);
      });
    });
  });

  describe('AC #3: Booking confirmation with reference number', () => {
    it('should return confirmation message with reference number', () => {
      const result = bookingService.submitAvailabilityRequest('+919876543210', {
        check_in_date: '2026-05-10',
        check_out_date: '2026-05-15',
        guest_count: 2,
        room_type_preference: 'Suite'
      });

      expect(result.success).to.be.true;
      expect(result.message).to.include(result.request_id);
      expect(result.message).to.include('reference number');
    });

    it('should store booking with contact information', () => {
      const result = bookingService.submitAvailabilityRequest('+919876543210', {
        check_in_date: '2026-05-10',
        check_out_date: '2026-05-15',
        guest_count: 2
      });

      const request = bookingService.getAvailabilityRequest(result.request_id);
      expect(request.phone_number).to.equal('+919876543210');
      expect(request.check_in_date).to.equal('2026-05-10');
      expect(request.check_out_date).to.equal('2026-05-15');
    });
  });
});
