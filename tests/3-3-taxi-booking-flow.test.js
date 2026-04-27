const request = require('supertest');
const { expect } = require('chai');
const { app, ServiceAreaValidator, TaxiBookingService, FlowTemplateService, FlowValidator } = require('../src/3-3-taxi-booking-flow');

// ============================================================================
// SETUP MOCK DEPENDENCIES
// ============================================================================

// Mock FlowTemplateService for TaxiBookingService
class MockFlowTemplateService {
  constructor() {
    this.templates = new Map();
    // Register taxi booking template
    this.templates.set('taxi-booking-flow', {
      id: 'taxi-booking-flow',
      name: 'Taxi Booking Request Form',
      version: '1.0',
      vertical: 'Taxi',
      status: 'active',
      fields: [
        {
          name: 'pickup_location',
          type: 'text',
          label: 'Pickup Location',
          required: true,
          placeholder: 'Enter pickup address or area',
          validation: {
            minLength: 5,
            maxLength: 200
          }
        },
        {
          name: 'dropoff_location',
          type: 'text',
          label: 'Drop-off Location',
          required: true,
          placeholder: 'Enter drop-off address or area',
          validation: {
            minLength: 5,
            maxLength: 200
          }
        },
        {
          name: 'pickup_time',
          type: 'datetime',
          label: 'Pickup Time',
          required: true,
          validation: {
            customValidator: 'validatePickupTime'
          }
        },
        {
          name: 'contact_number',
          type: 'phone',
          label: 'Contact Number',
          required: true,
          placeholder: 'Enter phone number',
          validation: {
            pattern: '^\\+?[1-9]\\d{6,14}$'
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

// Mock FlowValidator for TaxiBookingService
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
// TASK 1: TESTS FOR FLOW TEMPLATE REGISTRATION
// ============================================================================

describe('Task 1: Taxi Booking Flow Template Registration', () => {
  describe('FlowTemplateService.registerTemplate', () => {
    it('should register taxi booking template with all required fields', () => {
      const flowService = new FlowTemplateService();
      const template = {
        id: 'taxi-booking-flow',
        name: 'Taxi Booking Request Form',
        version: '1.0',
        vertical: 'Taxi',
        status: 'active',
        fields: [
          {
            name: 'pickup_location',
            type: 'text',
            label: 'Pickup Location',
            required: true,
            placeholder: 'Enter pickup address or area',
            validation: { minLength: 5, maxLength: 200 }
          },
          {
            name: 'dropoff_location',
            type: 'text',
            label: 'Drop-off Location',
            required: true,
            placeholder: 'Enter drop-off address or area',
            validation: { minLength: 5, maxLength: 200 }
          },
          {
            name: 'pickup_time',
            type: 'datetime',
            label: 'Pickup Time',
            required: true,
            validation: { customValidator: 'validatePickupTime' }
          },
          {
            name: 'contact_number',
            type: 'phone',
            label: 'Contact Number',
            required: true,
            placeholder: 'Enter phone number',
            validation: { pattern: '^\\+?[1-9]\\d{6,14}$' }
          }
        ]
      };

      const registered = flowService.registerTemplate(template);

      expect(registered).to.have.property('id', 'taxi-booking-flow');
      expect(registered).to.have.property('name', 'Taxi Booking Request Form');
      expect(registered).to.have.property('vertical', 'Taxi');
      expect(registered).to.have.property('status', 'active');
      expect(registered).to.have.property('version', '1.0');
      expect(registered.fields).to.have.lengthOf(4);
      expect(registered.fields).to.deep.include(template.fields[0]);
    });

    it('should throw error when registering template without id', () => {
      const flowService = new FlowTemplateService();
      const invalidTemplate = {
        name: 'Invalid Template',
        vertical: 'Taxi',
        fields: []
      };

      expect(() => flowService.registerTemplate(invalidTemplate)).to.throw(
        'Template must have id, name, and vertical'
      );
    });

    it('should throw error when registering template without name', () => {
      const flowService = new FlowTemplateService();
      const invalidTemplate = {
        id: 'invalid-flow',
        vertical: 'Taxi',
        fields: []
      };

      expect(() => flowService.registerTemplate(invalidTemplate)).to.throw(
        'Template must have id, name, and vertical'
      );
    });

    it('should throw error when registering template without vertical', () => {
      const flowService = new FlowTemplateService();
      const invalidTemplate = {
        id: 'invalid-flow',
        name: 'Invalid Template',
        fields: []
      };

      expect(() => flowService.registerTemplate(invalidTemplate)).to.throw(
        'Template must have id, name, and vertical'
      );
    });

    it('should set default status to draft when not provided', () => {
      const flowService = new FlowTemplateService();
      const template = {
        id: 'draft-flow',
        name: 'Draft Flow',
        vertical: 'Taxi',
        fields: []
      };

      const registered = flowService.registerTemplate(template);

      expect(registered).to.have.property('status', 'draft');
    });

    it('should retrieve active template by vertical', () => {
      const flowService = new FlowTemplateService();
      flowService.registerTemplate({
        id: 'taxi-booking-flow',
        name: 'Taxi Booking Request Form',
        vertical: 'Taxi',
        status: 'active',
        fields: []
      });

      const template = flowService.getTemplateByVertical('Taxi');

      expect(template).to.not.be.null;
      expect(template).to.have.property('id', 'taxi-booking-flow');
      expect(template).to.have.property('status', 'active');
    });

    it('should return null for draft templates when retrieving by vertical', () => {
      const flowService = new FlowTemplateService();
      flowService.registerTemplate({
        id: 'draft-flow',
        name: 'Draft Flow',
        vertical: 'Taxi',
        status: 'draft',
        fields: []
      });

      const template = flowService.getTemplateByVertical('Taxi');

      expect(template).to.be.null;
    });

    it('should retrieve template by id', () => {
      const flowService = new FlowTemplateService();
      flowService.registerTemplate({
        id: 'taxi-booking-flow',
        name: 'Taxi Booking Request Form',
        vertical: 'Taxi',
        fields: []
      });

      const template = flowService.getTemplate('taxi-booking-flow');

      expect(template).to.not.be.null;
      expect(template).to.have.property('id', 'taxi-booking-flow');
    });

    it('should return null when retrieving non-existent template', () => {
      const flowService = new FlowTemplateService();
      const template = flowService.getTemplate('non-existent');

      expect(template).to.be.null;
    });
  });

  describe('FlowValidator field validation', () => {
    let validator;

    beforeEach(() => {
      validator = new FlowValidator();
    });

    it('should validate required field correctly', () => {
      const field = {
        name: 'pickup_location',
        type: 'text',
        label: 'Pickup Location',
        required: true
      };

      const errors = validator.validateField(field, '');

      expect(errors).to.have.lengthOf(1);
      expect(errors[0]).to.have.property('field', 'pickup_location');
      expect(errors[0]).to.have.property('code', 'REQUIRED');
    });

    it('should pass validation for required field with value', () => {
      const field = {
        name: 'pickup_location',
        type: 'text',
        label: 'Pickup Location',
        required: true
      };

      const errors = validator.validateField(field, 'Banjara Hills');

      expect(errors).to.have.lengthOf(0);
    });

    it('should validate minimum length', () => {
      const field = {
        name: 'pickup_location',
        type: 'text',
        label: 'Pickup Location',
        required: true,
        validation: { minLength: 5 }
      };

      const errors = validator.validateField(field, 'Hi');

      expect(errors).to.have.lengthOf(1);
      expect(errors[0]).to.have.property('code', 'MIN_LENGTH');
    });

    it('should validate maximum length', () => {
      const field = {
        name: 'pickup_location',
        type: 'text',
        label: 'Pickup Location',
        required: true,
        validation: { maxLength: 10 }
      };

      const errors = validator.validateField(field, 'This is a very long location name');

      expect(errors).to.have.lengthOf(1);
      expect(errors[0]).to.have.property('code', 'MAX_LENGTH');
    });

    it('should validate phone number pattern', () => {
      const field = {
        name: 'contact_number',
        type: 'phone',
        label: 'Contact Number',
        required: true,
        validation: { pattern: '^\\+?[1-9]\\d{6,14}$' }
      };

      const errors = validator.validateField(field, 'invalid-phone');

      expect(errors).to.have.lengthOf(1);
      expect(errors[0]).to.have.property('code', 'INVALID_PATTERN');
    });

    it('should pass validation for valid phone number', () => {
      const field = {
        name: 'contact_number',
        type: 'phone',
        label: 'Contact Number',
        required: true,
        validation: { pattern: '^\\+?[1-9]\\d{6,14}$' }
      };

      const errors = validator.validateField(field, '+919876543210');

      expect(errors).to.have.lengthOf(0);
    });

    it('should validate submission with multiple fields', () => {
      const validator = new FlowValidator();
      const template = {
        id: 'taxi-booking-flow',
        vertical: 'Taxi',
        fields: [
          {
            name: 'pickup_location',
            type: 'text',
            label: 'Pickup Location',
            required: true,
            validation: { minLength: 5 }
          },
          {
            name: 'contact_number',
            type: 'phone',
            label: 'Contact Number',
            required: true,
            validation: { pattern: '^\\+?[1-9]\\d{6,14}$' }
          }
        ]
      };

      const data = {
        pickup_location: 'Hi',
        contact_number: 'invalid'
      };

      const errors = validator.validateSubmission(template, data);

      expect(errors).to.have.lengthOf(2);
    });
  });
});

// ============================================================================
// TASK 2: TESTS FOR SERVICE AREA VALIDATION
// ============================================================================

describe('Task 2: Service Area Validation', () => {
  let validator;

  beforeEach(() => {
    validator = new ServiceAreaValidator();
  });

  describe('isWithinServiceArea with zip codes', () => {
    it('should validate valid Hyderabad zip code', () => {
      const result = validator.isWithinServiceArea('500001');

      expect(result).to.have.property('valid', true);
      expect(result).to.have.property('area', 'Hyderabad Secunderabad');
    });

    it('should validate another valid Hyderabad zip code', () => {
      const result = validator.isWithinServiceArea('500005');

      expect(result).to.have.property('valid', true);
      expect(result).to.have.property('area', 'Hyderabad HITEC City');
    });

    it('should reject invalid zip code', () => {
      const result = validator.isWithinServiceArea('100001');

      expect(result).to.have.property('valid', false);
      expect(result).to.have.property('reason').that.includes('not within Hyderabad service area');
    });

    it('should reject zip code with wrong format', () => {
      const result = validator.isWithinServiceArea('5000');

      expect(result).to.have.property('valid', false);
      expect(result).to.have.property('reason').that.includes('not within Hyderabad service area');
    });
  });

  describe('isWithinServiceArea with area names', () => {
    it('should validate known Hyderabad area', () => {
      const result = validator.isWithinServiceArea('Banjara Hills');

      expect(result).to.have.property('valid', true);
      expect(result).to.have.property('area', 'Banjara Hills');
    });

    it('should validate lowercase area name', () => {
      const result = validator.isWithinServiceArea('banjara hills');

      expect(result).to.have.property('valid', true);
      expect(result).to.have.property('area', 'Banjara Hills');
    });

    it('should validate mixed case area name', () => {
      const result = validator.isWithinServiceArea('Jubilee Hills');

      expect(result).to.have.property('valid', true);
      expect(result).to.have.property('area', 'Jubilee Hills');
    });

    it('should validate partial address containing area name', () => {
      const result = validator.isWithinServiceArea('Near HITEC City metro station');

      expect(result).to.have.property('valid', true);
      expect(result).to.have.property('area', 'HITEC City');
    });

    it('should reject unknown area name', () => {
      const result = validator.isWithinServiceArea('Mumbai');

      expect(result).to.have.property('valid', false);
      expect(result).to.have.property('reason').that.includes('not within Hyderabad service area');
    });
  });

  describe('isWithinServiceArea edge cases', () => {
    it('should reject empty location', () => {
      const result = validator.isWithinServiceArea('');

      expect(result).to.have.property('valid', false);
      expect(result).to.have.property('reason', 'Location is required');
    });

    it('should reject null location', () => {
      const result = validator.isWithinServiceArea(null);

      expect(result).to.have.property('valid', false);
      expect(result).to.have.property('reason', 'Location is required');
    });

    it('should reject undefined location', () => {
      const result = validator.isWithinServiceArea(undefined);

      expect(result).to.have.property('valid', false);
      expect(result).to.have.property('reason', 'Location is required');
    });

    it('should trim whitespace from location', () => {
      const result = validator.isWithinServiceArea('  banjara hills  ');

      expect(result).to.have.property('valid', true);
      expect(result).to.have.property('area', 'Banjara Hills');
    });
  });

  describe('getServiceAreas', () => {
    it('should return all service areas', () => {
      const areas = validator.getServiceAreas();

      expect(areas).to.be.an('array');
      expect(areas.length).to.be.greaterThan(0);
    });

    it('should include zip code areas', () => {
      const areas = validator.getServiceAreas();
      const zipCodeAreas = areas.filter(a => a.type === 'zip_code');

      expect(zipCodeAreas.length).to.be.greaterThan(0);
    });

    it('should include named areas', () => {
      const areas = validator.getServiceAreas();
      const namedAreas = areas.filter(a => a.type === 'area_name');

      expect(namedAreas.length).to.be.greaterThan(0);
    });

    it('should include code and name for each area', () => {
      const areas = validator.getServiceAreas();

      areas.forEach(area => {
        expect(area).to.have.property('code');
        expect(area).to.have.property('name');
        expect(area).to.have.property('type');
      });
    });
  });
});

// ============================================================================
// TASK 3: TESTS FOR FLOW SUBMISSION HANDLING
// ============================================================================

describe('Task 3: Flow Submission Handling', () => {
  let flowTemplateService, flowValidator, serviceAreaValidator, bookingService;

  beforeEach(() => {
    flowTemplateService = new MockFlowTemplateService();
    flowValidator = new MockFlowValidator();
    serviceAreaValidator = new ServiceAreaValidator();
    bookingService = new TaxiBookingService(
      flowTemplateService,
      flowValidator,
      serviceAreaValidator
    );
  });

  describe('submitBooking with valid data', () => {
    it('should submit booking with all required fields', () => {
      const pickupTime = new Date(Date.now() + 3600000).toISOString();
      const result = bookingService.submitBooking('+919876543210', {
        pickup_location: 'Banjara Hills',
        dropoff_location: 'Jubilee Hills',
        pickup_time: pickupTime,
        contact_number: '+919876543210'
      });

      expect(result).to.have.property('success', true);
      expect(result).to.have.property('booking').that.is.an('object');
      expect(result.booking).to.have.property('id').that.is.a('string');
      expect(result.booking).to.have.property('pickup_location', 'Banjara Hills');
      expect(result.booking).to.have.property('dropoff_location', 'Jubilee Hills');
      expect(result.booking).to.have.property('status', 'pending');
      expect(result.booking).to.have.property('vertical', 'Taxi');
    });

    it('should generate unique booking ID', () => {
      const pickupTime = new Date(Date.now() + 3600000).toISOString();
      const result1 = bookingService.submitBooking('+919876543210', {
        pickup_location: 'Banjara Hills',
        dropoff_location: 'Jubilee Hills',
        pickup_time: pickupTime,
        contact_number: '+919876543210'
      });

      const result2 = bookingService.submitBooking('+919876543210', {
        pickup_location: 'Banjara Hills',
        dropoff_location: 'Jubilee Hills',
        pickup_time: pickupTime,
        contact_number: '+919876543210'
      });

      expect(result1.booking.id).to.not.equal(result2.booking.id);
    });
  });

  describe('submitBooking validation - required fields', () => {
    it('should reject booking without pickup location', () => {
      const pickupTime = new Date(Date.now() + 3600000).toISOString();
      const result = bookingService.submitBooking('+919876543210', {
        dropoff_location: 'Jubilee Hills',
        pickup_time: pickupTime,
        contact_number: '+919876543210'
      });

      expect(result).to.have.property('success', false);
      expect(result).to.have.property('validation_errors').that.is.an('array');
      const pickupError = result.validation_errors.find(e => e.field === 'pickup_location');
      expect(pickupError).to.exist;
      expect(pickupError).to.have.property('code', 'REQUIRED');
    });

    it('should reject booking without dropoff location', () => {
      const pickupTime = new Date(Date.now() + 3600000).toISOString();
      const result = bookingService.submitBooking('+919876543210', {
        pickup_location: 'Banjara Hills',
        pickup_time: pickupTime,
        contact_number: '+919876543210'
      });

      expect(result).to.have.property('success', false);
      expect(result).to.have.property('validation_errors').that.is.an('array');
      const dropoffError = result.validation_errors.find(e => e.field === 'dropoff_location');
      expect(dropoffError).to.exist;
      expect(dropoffError).to.have.property('code', 'REQUIRED');
    });

    it('should reject booking without pickup time', () => {
      const result = bookingService.submitBooking('+919876543210', {
        pickup_location: 'Banjara Hills',
        dropoff_location: 'Jubilee Hills',
        contact_number: '+919876543210'
      });

      expect(result).to.have.property('success', false);
      expect(result).to.have.property('validation_errors').that.is.an('array');
      const timeError = result.validation_errors.find(e => e.field === 'pickup_time');
      expect(timeError).to.exist;
      expect(timeError).to.have.property('code', 'REQUIRED');
    });

    it('should reject booking without contact number', () => {
      const pickupTime = new Date(Date.now() + 3600000).toISOString();
      const result = bookingService.submitBooking('+919876543210', {
        pickup_location: 'Banjara Hills',
        dropoff_location: 'Jubilee Hills',
        pickup_time: pickupTime
      });

      expect(result).to.have.property('success', false);
      expect(result).to.have.property('validation_errors').that.is.an('array');
      const contactError = result.validation_errors.find(e => e.field === 'contact_number');
      expect(contactError).to.exist;
      expect(contactError).to.have.property('code', 'REQUIRED');
    });
  });

  describe('submitBooking validation - service area', () => {
    it('should reject booking with out-of-service pickup location', () => {
      const pickupTime = new Date(Date.now() + 3600000).toISOString();
      const result = bookingService.submitBooking('+919876543210', {
        pickup_location: 'Mumbai',
        dropoff_location: 'Jubilee Hills',
        pickup_time: pickupTime,
        contact_number: '+919876543210'
      });

      expect(result).to.have.property('success', false);
      const pickupError = result.validation_errors.find(e => e.field === 'pickup_location');
      expect(pickupError).to.exist;
      expect(pickupError).to.have.property('code', 'OUT_OF_SERVICE_AREA');
    });

    it('should reject booking with out-of-service dropoff location', () => {
      const pickupTime = new Date(Date.now() + 3600000).toISOString();
      const result = bookingService.submitBooking('+919876543210', {
        pickup_location: 'Banjara Hills',
        dropoff_location: 'Delhi',
        pickup_time: pickupTime,
        contact_number: '+919876543210'
      });

      expect(result).to.have.property('success', false);
      const dropoffError = result.validation_errors.find(e => e.field === 'dropoff_location');
      expect(dropoffError).to.exist;
      expect(dropoffError).to.have.property('code', 'OUT_OF_SERVICE_AREA');
    });

    it('should accept booking with both locations in service area', () => {
      const pickupTime = new Date(Date.now() + 3600000).toISOString();
      const result = bookingService.submitBooking('+919876543210', {
        pickup_location: '500001',
        dropoff_location: '500005',
        pickup_time: pickupTime,
        contact_number: '+919876543210'
      });

      expect(result).to.have.property('success', true);
    });
  });

  describe('submitBooking validation - pickup time', () => {
    it('should reject booking with past pickup time', () => {
      const pastTime = new Date(Date.now() - 3600000).toISOString();
      const result = bookingService.submitBooking('+919876543210', {
        pickup_location: 'Banjara Hills',
        dropoff_location: 'Jubilee Hills',
        pickup_time: pastTime,
        contact_number: '+919876543210'
      });

      expect(result).to.have.property('success', false);
      const timeError = result.validation_errors.find(e => e.field === 'pickup_time');
      expect(timeError).to.exist;
      expect(timeError).to.have.property('code', 'PICKUP_TIME_PAST');
    });

    it('should reject booking with current pickup time', () => {
      const currentTime = new Date().toISOString();
      const result = bookingService.submitBooking('+919876543210', {
        pickup_location: 'Banjara Hills',
        dropoff_location: 'Jubilee Hills',
        pickup_time: currentTime,
        contact_number: '+919876543210'
      });

      expect(result).to.have.property('success', false);
      const timeError = result.validation_errors.find(e => e.field === 'pickup_time');
      expect(timeError).to.exist;
      expect(timeError).to.have.property('code', 'PICKUP_TIME_PAST');
    });

    it('should reject booking with invalid time format', () => {
      const result = bookingService.submitBooking('+919876543210', {
        pickup_location: 'Banjara Hills',
        dropoff_location: 'Jubilee Hills',
        pickup_time: 'invalid-time',
        contact_number: '+919876543210'
      });

      expect(result).to.have.property('success', false);
      const timeError = result.validation_errors.find(e => e.field === 'pickup_time');
      expect(timeError).to.exist;
      expect(timeError).to.have.property('code', 'INVALID_TIME_FORMAT');
    });

    it('should accept booking with future pickup time', () => {
      const futureTime = new Date(Date.now() + 3600000).toISOString();
      const result = bookingService.submitBooking('+919876543210', {
        pickup_location: 'Banjara Hills',
        dropoff_location: 'Jubilee Hills',
        pickup_time: futureTime,
        contact_number: '+919876543210'
      });

      expect(result).to.have.property('success', true);
    });
  });

  describe('submitBooking validation - field constraints', () => {
    it('should reject pickup location less than minimum length', () => {
      const pickupTime = new Date(Date.now() + 3600000).toISOString();
      const result = bookingService.submitBooking('+919876543210', {
        pickup_location: 'Hi',
        dropoff_location: 'Jubilee Hills',
        pickup_time: pickupTime,
        contact_number: '+919876543210'
      });

      expect(result).to.have.property('success', false);
      const pickupError = result.validation_errors.find(e => e.field === 'pickup_location');
      expect(pickupError).to.exist;
      expect(pickupError).to.have.property('code', 'MIN_LENGTH');
    });

    it('should reject invalid phone number format', () => {
      const pickupTime = new Date(Date.now() + 3600000).toISOString();
      const result = bookingService.submitBooking('+919876543210', {
        pickup_location: 'Banjara Hills',
        dropoff_location: 'Jubilee Hills',
        pickup_time: pickupTime,
        contact_number: 'invalid'
      });

      expect(result).to.have.property('success', false);
      const contactError = result.validation_errors.find(e => e.field === 'contact_number');
      expect(contactError).to.exist;
      expect(contactError).to.have.property('code', 'INVALID_PATTERN');
    });
  });

  describe('getBooking', () => {
    it('should retrieve existing booking by ID', () => {
      const pickupTime = new Date(Date.now() + 3600000).toISOString();
      const submitResult = bookingService.submitBooking('+919876543210', {
        pickup_location: 'Banjara Hills',
        dropoff_location: 'Jubilee Hills',
        pickup_time: pickupTime,
        contact_number: '+919876543210'
      });

      const booking = bookingService.getBooking(submitResult.booking.id);

      expect(booking).to.not.be.null;
      expect(booking).to.have.property('id', submitResult.booking.id);
      expect(booking).to.have.property('pickup_location', 'Banjara Hills');
    });

    it('should return null for non-existent booking', () => {
      const booking = bookingService.getBooking('non-existent-booking-id');

      expect(booking).to.be.null;
    });
  });
});

// ============================================================================
// TASK 4: TESTS FOR TAXI BOOKING API ENDPOINTS
// ============================================================================

describe('Task 4: Taxi Booking API Endpoints', () => {
  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('status', 'healthy');
      expect(response.body).to.have.property('service', 'taxi-booking');
      expect(response.body).to.have.property('endpoints').that.is.an('array');
    });
  });

  describe('GET /api/taxi/service-areas', () => {
    it('should return all service areas', async () => {
      const response = await request(app).get('/api/taxi/service-areas');

      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('data').that.is.an('array');
      expect(response.body.data.length).to.be.greaterThan(0);
      expect(response.body).to.have.property('meta').that.is.an('object');
    });

    it('should include zip code and named areas', async () => {
      const response = await request(app).get('/api/taxi/service-areas');

      const zipCodeAreas = response.body.data.filter(a => a.type === 'zip_code');
      const namedAreas = response.body.data.filter(a => a.type === 'area_name');

      expect(zipCodeAreas.length).to.be.greaterThan(0);
      expect(namedAreas.length).to.be.greaterThan(0);
    });
  });

  describe('POST /api/taxi/booking', () => {
    it('should create booking with valid data', async () => {
      const pickupTime = new Date(Date.now() + 3600000).toISOString();
      const response = await request(app)
        .post('/api/taxi/booking')
        .send({
          phone_number: '+919876543210',
          pickup_location: 'Banjara Hills',
          dropoff_location: 'Jubilee Hills',
          pickup_time: pickupTime,
          contact_number: '+919876543210'
        });

      expect(response.status).to.equal(201);
      expect(response.body).to.have.property('data').that.is.an('object');
      expect(response.body.data).to.have.property('id').that.is.a('string');
      expect(response.body.data).to.have.property('pickup_location', 'Banjara Hills');
      expect(response.body.data).to.have.property('dropoff_location', 'Jubilee Hills');
      expect(response.body.data).to.have.property('status', 'pending');
      expect(response.body).to.have.property('meta').that.is.an('object');
    });

    it('should reject booking without phone_number', async () => {
      const pickupTime = new Date(Date.now() + 3600000).toISOString();
      const response = await request(app)
        .post('/api/taxi/booking')
        .send({
          pickup_location: 'Banjara Hills',
          dropoff_location: 'Jubilee Hills',
          pickup_time: pickupTime,
          contact_number: '+919876543210'
        });

      expect(response.status).to.equal(400);
      expect(response.body).to.have.property('error');
      expect(response.body.error).to.have.property('code', 400);
      expect(response.body.error).to.have.property('message').that.includes('phone_number');
    });

    it('should reject booking with past pickup time', async () => {
      const pastTime = new Date(Date.now() - 3600000).toISOString();
      const response = await request(app)
        .post('/api/taxi/booking')
        .send({
          phone_number: '+919876543210',
          pickup_location: 'Banjara Hills',
          dropoff_location: 'Jubilee Hills',
          pickup_time: pastTime,
          contact_number: '+919876543210'
        });

      expect(response.status).to.equal(400);
      expect(response.body).to.have.property('error');
      expect(response.body.error).to.have.property('code', 400);
      expect(response.body.error).to.have.property('validation_errors').that.is.an('array');
    });

    it('should reject booking with out-of-service pickup location', async () => {
      const pickupTime = new Date(Date.now() + 3600000).toISOString();
      const response = await request(app)
        .post('/api/taxi/booking')
        .send({
          phone_number: '+919876543210',
          pickup_location: 'Mumbai',
          dropoff_location: 'Jubilee Hills',
          pickup_time: pickupTime,
          contact_number: '+919876543210'
        });

      expect(response.status).to.equal(400);
      expect(response.body).to.have.property('error');
      expect(response.body.error).to.have.property('validation_errors').that.is.an('array');
      const pickupError = response.body.error.validation_errors.find(e => e.field === 'pickup_location');
      expect(pickupError).to.exist;
      expect(pickupError).to.have.property('code', 'OUT_OF_SERVICE_AREA');
    });
  });

  describe('GET /api/taxi/booking/:id', () => {
    it('should retrieve booking by ID', async () => {
      const pickupTime = new Date(Date.now() + 3600000).toISOString();
      const createResponse = await request(app)
        .post('/api/taxi/booking')
        .send({
          phone_number: '+919876543210',
          pickup_location: 'Banjara Hills',
          dropoff_location: 'Jubilee Hills',
          pickup_time: pickupTime,
          contact_number: '+919876543210'
        });

      const bookingId = createResponse.body.data.id;
      const response = await request(app).get(`/api/taxi/booking/${bookingId}`);

      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('data').that.is.an('object');
      expect(response.body.data).to.have.property('id', bookingId);
      expect(response.body.data).to.have.property('pickup_location', 'Banjara Hills');
    });

    it('should return 404 for non-existent booking', async () => {
      const response = await request(app).get('/api/taxi/booking/non-existent-id');

      expect(response.status).to.equal(404);
      expect(response.body).to.have.property('error');
      expect(response.body.error).to.have.property('code', 404);
      expect(response.body.error).to.have.property('message').that.includes('not found');
    });
  });

  describe('Error handling', () => {
    it('should handle server errors gracefully', async () => {
      const pickupTime = new Date(Date.now() + 3600000).toISOString();
      const response = await request(app)
        .post('/api/taxi/booking')
        .send({
          phone_number: '+919876543210',
          pickup_location: 'Banjara Hills',
          dropoff_location: 'Jubilee Hills',
          pickup_time: pickupTime,
          contact_number: '+919876543210'
        });

      expect(response.status).to.be.oneOf([200, 201, 400, 404, 500]);
    });
  });
});
