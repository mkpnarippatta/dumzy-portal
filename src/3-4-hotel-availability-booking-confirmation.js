const express = require('express');

// ============================================================================
// PMS AVAILABILITY SERVICE (AC: #2)
// ============================================================================

class PMSAvailabilityService {
  constructor() {
    // Simulated PMS API endpoint (MVP)
    this.pmsApiEndpoint = process.env.PMS_API_ENDPOINT || '/api/pms/availability';
    this.pmsApiKey = process.env.PMS_API_KEY || 'test-key';

    // Room types with pricing (simulated Cloudbeds/Ezee Absolute)
    this.roomTypes = {
      'Standard': { name: 'Standard Room', price: 2500, capacity: 2 },
      'Deluxe': { name: 'Deluxe Room', price: 3500, capacity: 2 },
      'Suite': { name: 'Suite', price: 5000, capacity: 3 },
      'Family Room': { name: 'Family Room', price: 6000, capacity: 4 }
    };

    // Availability cache with 30-second TTL
    this.cache = new Map();
    this.cacheTTL = 30000; // 30 seconds in milliseconds

    // Simulate PMS slow response (> 5 seconds)
    this.simulateSlowResponse = false;
  }

  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Get available room types for preferences
  getRoomTypes() {
    return Object.entries(this.roomTypes).map(([code, room]) => ({
      code,
      ...room
    }));
  }

  queryAvailability({ check_in_date, check_out_date, guest_count }) {
    const cacheKey = `${check_in_date}:${check_out_date}:${guest_count}`;

    // Check cache
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        return {
          success: true,
          cached: true,
          ...cached.data
        };
      }
    }

    // Validate dates
    const checkIn = new Date(check_in_date);
    const checkOut = new Date(check_out_date);
    const today = new Date();

    // Check for invalid date format
    if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) {
      return {
        success: false,
        error: {
          message: 'Invalid date format',
          code: 'INVALID_DATE'
        }
      };
    }

    // Check if check-in is in past
    if (checkIn <= today) {
      return {
        success: false,
        error: {
          message: 'Check-in date must be in the future',
          code: 'PAST_CHECK_IN_DATE'
        }
      };
    }

    // Check if check-out is before or equal to check-in
    if (checkOut <= checkIn) {
      return {
        success: false,
        error: {
          message: 'Check-out date must be after check-in date',
          code: 'CHECK_OUT_BEFORE_CHECK_IN'
        }
      };
    }

    // Simulate PMS availability query
    const daysDifference = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));

    // Simulate slow response detection (> 5 seconds)
    const responseTime = this.simulateSlowResponse ? 6000 : 200;

    // Determine if showing "checking availability" status
    const checkingAvailability = this.simulateSlowResponse;

    const availabilityData = {
      rooms: [
        {
          type: 'Standard',
          name: 'Standard Room',
          price: 2500,
          available: true,
          capacity: 2
        },
        {
          type: 'Deluxe',
          name: 'Deluxe Room',
          price: 3500,
          available: true,
          capacity: 2
        },
        {
          type: 'Suite',
          name: 'Suite',
          price: 5000,
          available: true,
          capacity: 3
        },
        {
          type: 'Family Room',
          name: 'Family Room',
          price: 6000,
          available: true,
          capacity: 4
        }
      ],
      total_rooms: 4,
      dates: {
        check_in: check_in_date,
        check_out: check_out_date,
        nights: daysDifference
      },
      checking_availability: checkingAvailability,
      response_time_ms: responseTime
    };

    // Store in cache
    this.cache.set(cacheKey, {
      timestamp: Date.now(),
      data: availabilityData
    });

    return {
      success: true,
      ...availabilityData
    };
  }

  setSlowResponse(enabled) {
    this.simulateSlowResponse = enabled;
  }
}

// ============================================================================
// HOTEL BOOKING SERVICE (AC: #1, #2, #3 - Phase 1)
// ============================================================================

class HotelBookingService {
  constructor(flowTemplateService, flowValidator, pmsService) {
    this.flowTemplateService = flowTemplateService;
    this.flowValidator = flowValidator;
    this.pmsService = pmsService;
    this.requests = new Map(); // In-memory storage for Phase 2 PMS booking
  }

  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  submitAvailabilityRequest(phoneNumber, data) {
    const template = this.flowTemplateService.getTemplateByVertical('Hotel');

    if (!template) {
      return {
        success: false,
        validation_errors: [{
          field: 'template',
          message: 'Hotel Flow template not found',
          code: 'TEMPLATE_NOT_FOUND'
        }]
      };
    }

    // Validate using Flow framework
    const validationErrors = this.flowValidator.validateSubmission(template, data);

    // Custom validation: check-in date must be in future
    const checkInErrors = this.validateCheckInDate(data.check_in_date);
    validationErrors.push(...checkInErrors);

    // Custom validation: check-out date must be after check-in date
    const checkOutErrors = this.validateCheckOutDate(data.check_in_date, data.check_out_date);
    validationErrors.push(...checkOutErrors);

    if (validationErrors.length > 0) {
      return {
        success: false,
        validation_errors: validationErrors
      };
    }

    // Query PMS for availability
    const pmsResult = this.pmsService.queryAvailability({
      check_in_date: data.check_in_date,
      check_out_date: data.check_out_date,
      guest_count: data.guest_count || 1
    });

    if (!pmsResult.success) {
      validationErrors.push({
        field: 'check_in_date',
        message: pmsResult.error.message || 'No availability for selected dates',
        code: 'PMS_UNAVAILABLE'
      });
      return {
        success: false,
        validation_errors: validationErrors
      };
    }

    // Create availability request record
    const requestId = this.generateRequestId();
    const requestRecord = {
      id: requestId,
      phone_number: phoneNumber,
      check_in_date: data.check_in_date,
      check_out_date: data.check_out_date,
      guest_count: data.guest_count,
      room_type_preference: data.room_type_preference,
      availability: pmsResult,
      created_at: new Date().toISOString()
    };

    this.requests.set(requestId, requestRecord);

    // Return confirmation message (Phase 1 - actual booking in Phase 2)
    const message = `Your availability request has been received. We've found ${pmsResult.total_rooms} room types available from ${pmsResult.dates.nights} nights. Use reference number ${requestId} to book your preferred room.`;

    return {
      success: true,
      request_id: requestId,
      message: message,
      availability: pmsResult
    };
  }

  validateCheckInDate(checkInDate) {
    const errors = [];
    const today = new Date();

    if (!checkInDate) {
      errors.push({
        field: 'check_in_date',
        message: 'Check-in date is required',
        code: 'REQUIRED'
      });
      return errors;
    }

    const checkIn = new Date(checkInDate);

    if (isNaN(checkIn.getTime())) {
      errors.push({
        field: 'check_in_date',
        message: 'Invalid check-in date format',
        code: 'INVALID_DATE'
      });
      return errors;
    }

    // Check-in must be strictly in future (not today)
    if (checkIn <= today) {
      errors.push({
        field: 'check_in_date',
        message: 'Check-in date must be in the future',
        code: 'PAST_CHECK_IN_DATE'
      });
    }

    return errors;
  }

  validateCheckOutDate(checkInDate, checkOutDate) {
    const errors = [];

    if (!checkOutDate) {
      errors.push({
        field: 'check_out_date',
        message: 'Check-out date is required',
        code: 'REQUIRED'
      });
      return errors;
    }

    if (!checkInDate) {
      errors.push({
        field: 'check_out_date',
        message: 'Check-in date is required for check-out validation',
        code: 'REQUIRED_CHECK_IN_DATE'
      });
      return errors;
    }

    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);

    if (isNaN(checkOut.getTime())) {
      errors.push({
        field: 'check_out_date',
        message: 'Invalid check-out date format',
        code: 'INVALID_DATE'
      });
      return errors;
    }

    if (checkOut <= checkIn) {
      errors.push({
        field: 'check_out_date',
        message: 'Check-out date must be after check-in date',
        code: 'CHECK_OUT_BEFORE_CHECK_IN'
      });
    }

    return errors;
  }

  getAvailabilityRequest(requestId) {
    return this.requests.get(requestId) || null;
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

    // Pattern validation (check after length)
    if (field.validation?.pattern && !new RegExp(field.validation.pattern).test(stringValue)) {
      errors.push({
        field: field.name,
        message: 'Invalid format',
        code: 'INVALID_PATTERN'
      });
    }

    // Select field options validation
    if (field.validation?.options && !field.validation.options.includes(stringValue)) {
      errors.push({
        field: field.name,
        message: `Invalid option for ${field.label}`,
        code: 'INVALID_OPTION'
      });
    }

    // Number validation (min/max)
    if (field.type === 'number') {
      const numValue = Number(value);
      if (field.validation?.min && numValue < field.validation.min) {
        errors.push({
          field: field.name,
          message: `Minimum value is ${field.validation.min}`,
          code: 'MIN_VALUE'
        });
      }
      if (field.validation?.max && numValue > field.validation.max) {
        errors.push({
          field: field.name,
          message: `Maximum value is ${field.validation.max}`,
          code: 'MAX_VALUE'
        });
      }
    }

    // Date validation
    if (field.type === 'date') {
      const dateValue = new Date(value);
      if (isNaN(dateValue.getTime())) {
        errors.push({
          field: field.name,
          message: 'Invalid date format',
          code: 'INVALID_DATE'
        });
      }
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

function isValidDateString(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(str);
  return d instanceof Date && !isNaN(d);
}

const flowTemplateService = new FlowTemplateService();
const flowValidator = new FlowValidator();
const pmsService = new PMSAvailabilityService();
const hotelBookingService = new HotelBookingService(
  flowTemplateService,
  flowValidator,
  pmsService
);

// Register Hotel Availability Flow Template (AC: #1)
const hotelAvailabilityFlowTemplate = {
  id: 'hotel-availability-flow',
  name: 'Hotel Availability Request Form',
  version: '1.0',
  vertical: 'Hotel',
  status: 'active',
  fields: [
    {
      name: 'check_in_date',
      type: 'date',
      label: 'Check-in Date',
      required: true,
      placeholder: 'Select check-in date',
      validation: {
        customValidator: 'validateCheckInDate'
      }
    },
    {
      name: 'check_out_date',
      type: 'date',
      label: 'Check-out Date',
      required: true,
      placeholder: 'Select check-out date',
      validation: {
        customValidator: 'validateCheckOutDate'
      }
    },
    {
      name: 'guest_count',
      type: 'number',
      label: 'Number of Guests',
      required: true,
      placeholder: 'Enter number of guests',
      validation: {
        min: 1,
        max: 10
      }
    },
    {
      name: 'room_type_preference',
      type: 'select',
      label: 'Room Type Preference',
      required: false,
      placeholder: 'Select room type (optional)',
      validation: {
        options: ['Standard', 'Deluxe', 'Suite', 'Family Room']
      }
    }
  ]
};

flowTemplateService.registerTemplate(hotelAvailabilityFlowTemplate);

const app = express();
app.use(express.json());

// POST /api/hotel/availability - Query hotel availability (AC: #2)
app.post('/api/hotel/availability', (req, res) => {
  try {
    const { phone_number, check_in_date, check_out_date, guest_count, room_type_preference } = req.body;

    if (!phone_number) {
      return res.status(400).json({
        error: {
          message: 'phone_number is required',
          code: 400,
          details: 'Missing required field: phone_number'
        }
      });
    }

    if (!check_in_date) {
      return res.status(400).json({
        error: {
          message: 'check_in_date is required',
          code: 400,
          details: 'Missing required field: check_in_date'
        }
      });
    }

    if (!check_out_date) {
      return res.status(400).json({
        error: {
          message: 'check_out_date is required',
          code: 400,
          details: 'Missing required field: check_out_date'
        }
      });
    }

    if (!guest_count) {
      return res.status(400).json({
        error: {
          message: 'guest_count is required',
          code: 400,
          details: 'Missing required field: guest_count'
        }
      });
    }

    if (!isValidDateString(check_in_date) || !isValidDateString(check_out_date)) {
      return res.status(400).json({
        error: {
          message: 'Invalid date format',
          code: 400,
          details: 'Dates must be valid YYYY-MM-DD format'
        }
      });
    }

    const result = hotelBookingService.submitAvailabilityRequest(phone_number, {
      check_in_date,
      check_out_date,
      guest_count,
      room_type_preference: room_type_preference || null
    });

    if (!result.success) {
      return res.status(400).json({
        error: {
          message: 'Availability query validation failed',
          code: 400,
          validation_errors: result.validation_errors
        }
      });
    }

    res.status(200).json({
      data: {
        success: true,
        request_id: result.request_id,
        message: result.message,
        availability: result.availability
      },
      meta: {
        timestamp: new Date().toISOString(),
        total_rooms: result.availability.total_rooms
      }
    });
  } catch (error) {
    console.error('Hotel availability error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to query hotel availability',
        code: 500,
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

// POST /api/hotel/booking - Submit hotel booking (AC: #3 - Phase 2 placeholder)
app.post('/api/hotel/booking', (req, res) => {
  try {
    const { phone_number, request_id } = req.body;

    if (!phone_number) {
      return res.status(400).json({
        error: {
          message: 'phone_number is required',
          code: 400,
          details: 'Missing required field: phone_number'
        }
      });
    }

    if (!request_id) {
      return res.status(400).json({
        error: {
          message: 'request_id is required',
          code: 400,
          details: 'Missing required field: request_id'
        }
      });
    }

    // Retrieve the availability request
    const availabilityRequest = hotelBookingService.getAvailabilityRequest(request_id);

    if (!availabilityRequest) {
      return res.status(404).json({
        error: {
          message: 'Availability request not found',
          code: 404,
          details: `No availability request found with id: ${request_id}`
        }
      });
    }

    // Phase 2: PMS booking integration will be implemented separately
    // For now, return a success response indicating Phase 2 is coming
    res.status(200).json({
      data: {
        success: true,
        message: 'Booking confirmation feature is under development. Your availability request has been recorded for Phase 2 PMS integration.',
        request_id: request_id,
        phase: '1 - Availability Request'
      },
      meta: {
        timestamp: new Date().toISOString(),
        note: 'Direct PMS booking will be available in Phase 2'
      }
    });
  } catch (error) {
    console.error('Hotel booking error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to submit hotel booking',
        code: 500,
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

// GET /api/hotel/booking/:id - Get booking status
app.get('/api/hotel/booking/:id', (req, res) => {
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

    const request = hotelBookingService.getAvailabilityRequest(id);

    if (!request) {
      return res.status(404).json({
        error: {
          message: 'Booking not found',
          code: 404,
          details: `No booking found with id: ${id}`
        }
      });
    }

    res.status(200).json({
      data: {
        request_id: id,
        phone_number: request.phone_number,
        check_in_date: request.check_in_date,
        check_out_date: request.check_out_date,
        guest_count: request.guest_count,
        room_type_preference: request.room_type_preference,
        created_at: request.created_at,
        status: 'pending',
        note: 'Phase 2: PMS booking will be completed when availability request is processed'
      },
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
    service: 'hotel-availability',
    endpoints: [
      'POST /api/hotel/availability',
      'POST /api/hotel/booking',
      'GET /api/hotel/booking/:id',
      'GET /api/health'
    ],
    template_count: flowTemplateService.templates.size,
    request_count: hotelBookingService.requests.size,
    cache_entries: pmsService.cache.size
  });
});

// Start server (only if not in test mode)
if (process.env.MOCHA_TEST_MODE !== 'true') {
  const PORT = process.env.PORT || 3027;

  app.listen(PORT, () => {
    console.log(`Hotel Availability & Booking Service listening on port ${PORT}`);
    console.log(`Storage: In-memory (Phase 1) - PMS Integration in Phase 2`);
  });
}

module.exports = { app, HotelBookingService, PMSAvailabilityService, FlowTemplateService, FlowValidator };


