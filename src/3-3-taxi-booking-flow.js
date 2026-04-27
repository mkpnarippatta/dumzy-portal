const express = require('express');

// ============================================================================
// SERVICE AREA VALIDATOR (AC: #2)
// ============================================================================

class ServiceAreaValidator {
  constructor() {
    // Hyderabad service areas (MVP - can be extended)
    this.serviceAreas = new Map([
      // Zip codes
      ['500001', 'Hyderabad Secunderabad'],
      ['500002', 'Hyderabad Begumpet'],
      ['500003', 'Hyderabad Banjara Hills'],
      ['500004', 'Hyderabad Jubilee Hills'],
      ['500005', 'Hyderabad HITEC City'],
      ['500006', 'Hyderabad Gachibowli'],
      ['500007', 'Hyderabad Madhapur'],
      ['500008', 'Hyderabad Kondapur'],
      ['500009', 'Hyderabad Manikonda'],
      ['500010', 'Hyderabad Miyapur'],
      // Named areas
      ['banjara hills', 'Banjara Hills'],
      ['jubilee hills', 'Jubilee Hills'],
      ['hitec city', 'HITEC City'],
      ['gachibowli', 'Gachibowli'],
      ['madhapur', 'Madhapur'],
      ['kondapur', 'Kondapur'],
      ['manikonda', 'Manikonda'],
      ['miyapur', 'Miyapur'],
      ['secunderabad', 'Secunderabad'],
      ['begumpet', 'Begumpet']
    ]);
  }

  isWithinServiceArea(location) {
    if (!location) return { valid: false, reason: 'Location is required' };

    const normalizedLocation = location.toLowerCase().trim();

    // Check if location is a zip code
    if (/^\d{6}$/.test(normalizedLocation)) {
      if (this.serviceAreas.has(normalizedLocation)) {
        return { valid: true, area: this.serviceAreas.get(normalizedLocation) };
      }
      return { valid: false, reason: 'Zip code not within Hyderabad service area' };
    }

    // Check if location contains a service area name (check named areas only)
    for (const [key, area] of this.serviceAreas.entries()) {
      // Skip zip codes when doing partial match
      if (/^\d{6}$/.test(key)) continue;

      if (normalizedLocation.includes(key)) {
        return { valid: true, area };
      }
    }

    return { valid: false, reason: 'Location not within Hyderabad service area' };
  }

  getServiceAreas() {
    return Array.from(this.serviceAreas.entries()).map(([code, name]) => ({
      code,
      name,
      type: /^\d{6}$/.test(code) ? 'zip_code' : 'area_name'
    }));
  }
}

// ============================================================================
// TAXI BOOKING SERVICE (AC: #1, #3)
// ============================================================================

class TaxiBookingService {
  constructor(flowTemplateService, flowValidator, serviceAreaValidator) {
    this.flowTemplateService = flowTemplateService;
    this.flowValidator = flowValidator;
    this.serviceAreaValidator = serviceAreaValidator;
    this.bookings = new Map(); // In-memory for MVP, ERPNext in Phase 2
  }

  generateBookingId() {
    return `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  submitBooking(phoneNumber, data) {
    const template = this.flowTemplateService.getTemplateByVertical('Taxi');

    if (!template) {
      return {
        success: false,
        validation_errors: [{
          field: 'template',
          message: 'Taxi Flow template not found',
          code: 'TEMPLATE_NOT_FOUND'
        }]
      };
    }

    // Validate using Flow framework
    const validationErrors = this.flowValidator.validateSubmission(template, data);

    // Service area validation: pickup location
    const pickupValidation = this.serviceAreaValidator.isWithinServiceArea(data.pickup_location);
    if (!pickupValidation.valid) {
      validationErrors.push({
        field: 'pickup_location',
        message: pickupValidation.reason,
        code: 'OUT_OF_SERVICE_AREA'
      });
    }

    // Service area validation: drop-off location
    const dropoffValidation = this.serviceAreaValidator.isWithinServiceArea(data.dropoff_location);
    if (!dropoffValidation.valid) {
      validationErrors.push({
        field: 'dropoff_location',
        message: dropoffValidation.reason,
        code: 'OUT_OF_SERVICE_AREA'
      });
    }

    // Custom validation: pickup time in future
    const pickupTimeErrors = this.validatePickupTime(data.pickup_time);
    validationErrors.push(...pickupTimeErrors);

    if (validationErrors.length > 0) {
      return {
        success: false,
        validation_errors: validationErrors
      };
    }

    // Create booking/lead
    const booking = {
      id: this.generateBookingId(),
      phone_number: phoneNumber,
      pickup_location: data.pickup_location,
      dropoff_location: data.dropoff_location,
      pickup_time: data.pickup_time,
      contact_number: data.contact_number,
      status: 'pending',
      vertical: 'Taxi',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    this.bookings.set(booking.id, booking);

    // In Phase 2: Create Lead in ERPNext CRM with Taxi tag
    // erpnextCRM.createLead({ ...booking, vertical: 'Taxi' });

    return {
      success: true,
      booking: booking,
      message: 'Taxi booking request submitted successfully'
    };
  }

  validatePickupTime(pickupTime) {
    const errors = [];
    const now = new Date();

    const pickup = new Date(pickupTime);

    if (isNaN(pickup.getTime())) {
      errors.push({
        field: 'pickup_time',
        message: 'Invalid pickup time format',
        code: 'INVALID_TIME_FORMAT'
      });
      return errors;
    }

    if (pickup <= now) {
      errors.push({
        field: 'pickup_time',
        message: 'Pickup time must be in the future',
        code: 'PICKUP_TIME_PAST'
      });
    }

    return errors;
  }

  getBooking(bookingId) {
    return this.bookings.get(bookingId) || null;
  }
}

// ============================================================================
// FLOW TEMPLATE SERVICE (Reused from Story 3.1)
// ============================================================================

class FlowTemplateService {
  constructor() {
    this.templates = new Map();
  }

  generateId() {
    return `flow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] || null;
  }

  getTemplate(templateId) {
    return this.templates.get(templateId) || null;
  }
}

// ============================================================================
// FLOW VALIDATOR (Reused from Story 3.1)
// ============================================================================

class FlowValidator {
  isValidPhone(value) {
    const phoneRegex = /^\+?[1-9]\d{6,14}$/;
    return phoneRegex.test(value.replace(/[\s\-\+]/g, ''));
  }

  validateField(field, value) {
    const errors = [];

    // Required check (whitespace-only strings treated as empty)
    const isEmpty = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    if (field.required && isEmpty) {
      errors.push({
        field: field.name,
        message: `${field.label} is required`,
        code: 'REQUIRED'
      });
      return errors;
    }

    // Skip validation if not required and empty
    if (!field.required && isEmpty) {
      return errors;
    }

    const stringValue = String(value);

    // Length validation (check before type and pattern)
    if (field.validation?.minLength && stringValue.length < field.validation.minLength) {
      errors.push({
        field: field.name,
        message: `Minimum ${field.validation.minLength} characters required`,
        code: 'MIN_LENGTH'
      });
    }

    if (field.validation?.maxLength && stringValue.length > field.validation.maxLength) {
      errors.push({
        field: field.name,
        message: `Maximum ${field.validation.maxLength} characters allowed`,
        code: 'MAX_LENGTH'
      });
    }

    // Pattern validation for phone fields with explicit pattern
    if (field.validation?.pattern && field.type === 'phone') {
      // Unify with isValidPhone sanitization: strip spaces, dashes, plus signs
      const sanitized = typeof value === 'string' ? stringValue.replace(/[\s\-]/g, '') : stringValue;
      if (!new RegExp(field.validation.pattern).test(sanitized)) {
        errors.push({
          field: field.name,
          message: 'Invalid format',
          code: 'INVALID_PATTERN'
        });
      }
    } else if (field.type === 'phone' && !this.isValidPhone(value)) {
      // Type-based validation for phone fields without explicit pattern
      errors.push({
        field: field.name,
        message: 'Invalid phone number format',
        code: 'INVALID_PHONE'
      });
    }

    // Pattern validation for non-phone fields
    if (field.validation?.pattern && field.type !== 'phone' && !new RegExp(field.validation.pattern).test(stringValue)) {
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
// EXPRESS APP SETUP
// ============================================================================

const flowTemplateService = new FlowTemplateService();
const flowValidator = new FlowValidator();
const serviceAreaValidator = new ServiceAreaValidator();
const taxiBookingService = new TaxiBookingService(
  flowTemplateService,
  flowValidator,
  serviceAreaValidator
);

// Register Taxi Booking Flow Template (AC: #1)
const taxiBookingFlowTemplate = {
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
};

flowTemplateService.registerTemplate(taxiBookingFlowTemplate);

const app = express();
app.use(express.json());

// GET /api/taxi/service-areas - Get available service areas (AC: #2)
app.get('/api/taxi/service-areas', (req, res) => {
  try {
    const areas = serviceAreaValidator.getServiceAreas();

    res.status(200).json({
      data: areas,
      meta: {
        timestamp: new Date().toISOString(),
        total_areas: areas.length
      }
    });
  } catch (error) {
    console.error('Service areas retrieval error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to retrieve service areas',
        code: 500,
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

// POST /api/taxi/booking - Submit taxi booking (AC: #1, #3)
app.post('/api/taxi/booking', (req, res) => {
  try {
    const { phone_number, pickup_location, dropoff_location, pickup_time, contact_number } = req.body;

    if (!phone_number) {
      return res.status(400).json({
        error: {
          message: 'phone_number is required',
          code: 400,
          details: 'Missing required field: phone_number'
        }
      });
    }

    if (!pickup_location) {
      return res.status(400).json({
        error: {
          message: 'pickup_location is required',
          code: 400,
          details: 'Missing required field: pickup_location'
        }
      });
    }

    if (!dropoff_location) {
      return res.status(400).json({
        error: {
          message: 'dropoff_location is required',
          code: 400,
          details: 'Missing required field: dropoff_location'
        }
      });
    }

    if (!pickup_time) {
      return res.status(400).json({
        error: {
          message: 'pickup_time is required',
          code: 400,
          details: 'Missing required field: pickup_time'
        }
      });
    }

    if (!contact_number) {
      return res.status(400).json({
        error: {
          message: 'contact_number is required',
          code: 400,
          details: 'Missing required field: contact_number'
        }
      });
    }

    const result = taxiBookingService.submitBooking(phone_number, {
      pickup_location,
      dropoff_location,
      pickup_time,
      contact_number
    });

    if (!result.success) {
      return res.status(400).json({
        error: {
          message: 'Booking validation failed',
          code: 400,
          validation_errors: result.validation_errors
        }
      });
    }

    res.status(201).json({
      data: result.booking,
      meta: {
        timestamp: new Date().toISOString(),
        message: result.message
      }
    });
  } catch (error) {
    console.error('Taxi booking error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to create booking',
        code: 500,
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

// GET /api/taxi/booking/:id - Get booking status
app.get('/api/taxi/booking/:id', (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        error: {
          message: 'booking id is required',
          code: 400,
          details: 'Missing path parameter: id'
        }
      });
    }

    const booking = taxiBookingService.getBooking(id);

    if (!booking) {
      return res.status(404).json({
        error: {
          message: 'Booking not found',
          code: 404,
          details: `No booking found with id: ${id}`
        }
      });
    }

    res.status(200).json({
      data: booking,
      meta: {
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Booking retrieval error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to retrieve booking',
        code: 500,
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

// GET /api/health - Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime: Date.now(),
    service: 'taxi-booking',
    endpoints: [
      'GET /api/taxi/service-areas',
      'POST /api/taxi/booking',
      'GET /api/taxi/booking/:id',
      'GET /api/health'
    ],
    template_count: flowTemplateService.templates.size,
    booking_count: taxiBookingService.bookings.size,
    service_area_count: serviceAreaValidator.getServiceAreas().length
  });
});

// Start server (only if not in test mode)
if (process.env.MOCHA_TEST_MODE !== 'true') {
  const PORT = process.env.PORT || 3026;

  app.listen(PORT, () => {
    console.log(`Taxi Booking Service listening on port ${PORT}`);
    console.log(`Storage: In-memory (MVP) - ERPNext CRM in Phase 2`);
  });
}

module.exports = { app, ServiceAreaValidator, TaxiBookingService, FlowTemplateService, FlowValidator };


