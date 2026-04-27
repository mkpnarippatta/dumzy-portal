const express = require('express');

// ============================================================================
// BIKE AVAILABILITY SERVICE (AC: #2)
// ============================================================================

class BikeAvailabilityService {
  constructor() {
    // Simulated bike inventory for MVP
    this.bikeInventory = new Map([
      ['Hero', { total: 5, available: 5 }],
      ['Honda', { total: 3, available: 3 }],
      ['Bajaj', { total: 4, available: 4 }],
      ['TVS', { total: 2, available: 2 }],
      ['Royal Enfield', { total: 3, available: 3 }]
    ]);

    // Simulated bookings for date range checking
    this.bookings = [];
  }

  checkAvailability(pickupDate, returnDate, bikeModel = null) {
    const availableBikes = [];

    for (const [model, inventory] of this.bikeInventory.entries()) {
      // Filter by bike model if specified
      if (bikeModel && model !== bikeModel) {
        continue;
      }

      // Check if bikes are available for this date range
      const bookedCount = this.countBookingsForModel(model, pickupDate, returnDate);

      const available = Math.max(0, inventory.total - bookedCount);

      if (available > 0) {
        availableBikes.push({
          model: model,
          available: available,
          total: inventory.total
        });
      }
    }

    return availableBikes;
  }

  countBookingsForModel(model, pickupDate, returnDate) {
    // Simulated - in real implementation, query ERPNext Rental Module
    // Uses range overlap: a booking for any overlapping date range reduces availability
    return this.bookings.filter(b =>
      b.bike_model === model &&
      b.pickup_date <= returnDate &&
      b.return_date >= pickupDate
    ).length;
  }

  bookBike(model, pickupDate, returnDate, phoneNumber) {
    this.bookings.push({
      bike_model: model,
      pickup_date: pickupDate,
      return_date: returnDate,
      phone_number: phoneNumber,
      booked_at: new Date().toISOString()
    });
  }
}

// ============================================================================
// BIKE BOOKING SERVICE (AC: #1, #3)
// ============================================================================

class BikeBookingService {
  constructor(flowTemplateService, flowValidator, bikeAvailabilityService) {
    this.flowTemplateService = flowTemplateService;
    this.flowValidator = flowValidator;
    this.bikeAvailabilityService = bikeAvailabilityService;
    this.bookings = new Map(); // In-memory for MVP, ERPNext in Phase 2
  }

  generateBookingId() {
    return `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  submitBooking(phoneNumber, data) {
    const template = this.flowTemplateService.getTemplateByVertical('Bike Rental');

    if (!template) {
      return {
        success: false,
        validation_errors: [{
          field: 'template',
          message: 'Bike Rental Flow template not found',
          code: 'TEMPLATE_NOT_FOUND'
        }]
      };
    }

    // Validate using Flow framework
    const validationErrors = this.flowValidator.validateSubmission(template, data);

    // Custom validation: pickup date in future
    const pickupDateErrors = this.validatePickupDate(data.pickup_date);
    validationErrors.push(...pickupDateErrors);

    // Custom validation: return date after pickup
    const returnDateErrors = this.validateReturnDate(data.pickup_date, data.return_date);
    validationErrors.push(...returnDateErrors);

    if (validationErrors.length > 0) {
      return {
        success: false,
        validation_errors: validationErrors
      };
    }

    // Check bike availability
    const availability = this.bikeAvailabilityService.checkAvailability(
      data.pickup_date,
      data.return_date,
      data.bike_model
    );

    const selectedBike = availability.find(b => b.model === data.bike_model);
    if (!selectedBike || selectedBike.available <= 0) {
      validationErrors.push({
        field: 'bike_model',
        message: `No ${data.bike_model} bikes available for selected dates`,
        code: 'NO_AVAILABILITY'
      });

      return {
        success: false,
        validation_errors: validationErrors
      };
    }

    // Create booking
    const booking = {
      id: this.generateBookingId(),
      phone_number: phoneNumber,
      pickup_date: data.pickup_date,
      return_date: data.return_date,
      bike_model: data.bike_model,
      id_document_type: data.id_document_type,
      id_number: data.id_number,
      status: 'confirmed',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    this.bookings.set(booking.id, booking);

    // Book the bike in availability service
    this.bikeAvailabilityService.bookBike(
      data.bike_model,
      data.pickup_date,
      data.return_date,
      phoneNumber
    );

    // In Phase 2: Create order in ERPNext Rental Module
    // erpnextRentalModule.createOrder(booking);

    return {
      success: true,
      booking: booking,
      message: 'Booking confirmed successfully'
    };
  }

  validatePickupDate(pickupDate) {
    const errors = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const pickup = new Date(pickupDate);
    pickup.setHours(0, 0, 0, 0);

    if (pickup.getTime() <= today.getTime()) {
      errors.push({
        field: 'pickup_date',
        message: 'Pickup date must be in the future',
        code: 'PICKUP_DATE_PAST'
      });
    }

    return errors;
  }

  validateReturnDate(pickupDate, returnDate) {
    const errors = [];
    const pickup = new Date(pickupDate);
    const returnD = new Date(returnDate);

    if (returnD <= pickup) {
      errors.push({
        field: 'return_date',
        message: 'Return date must be after pickup date',
        code: 'RETURN_DATE_BEFORE_PICKUP'
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
    if (field.validation?.pattern && !new RegExp(field.validation.pattern, 'i').test(String(value))) {
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

function isValidDateString(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(str);
  return d instanceof Date && !isNaN(d);
}

const flowTemplateService = new FlowTemplateService();
const flowValidator = new FlowValidator();
const bikeAvailabilityService = new BikeAvailabilityService();
const bikeBookingService = new BikeBookingService(
  flowTemplateService,
  flowValidator,
  bikeAvailabilityService
);

// Register Bike Rental Flow Template (AC: #1)
const bikeRentalFlowTemplate = {
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
      required: true,
      validation: {
        customValidator: 'validatePickupDate'
      }
    },
    {
      name: 'return_date',
      type: 'date',
      label: 'Return Date',
      required: true,
      validation: {
        customValidator: 'validateReturnDate'
      }
    },
    {
      name: 'bike_model',
      type: 'select',
      label: 'Bike Model Preference',
      required: true,
      placeholder: 'Select bike model',
      validation: {
        options: ['Hero', 'Honda', 'Bajaj', 'TVS', 'Royal Enfield']
      }
    },
    {
      name: 'id_document_type',
      type: 'select',
      label: 'ID Document Type',
      required: true,
      validation: {
        options: ['Aadhaar', 'Driving License', 'Passport']
      }
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
};

flowTemplateService.registerTemplate(bikeRentalFlowTemplate);

const app = express();
app.use(express.json());

// GET /api/bike/availability - Check bike availability (AC: #2)
app.get('/api/bike/availability', (req, res) => {
  try {
    const { pickup_date, return_date, bike_model } = req.query;

    if (!pickup_date) {
      return res.status(400).json({
        error: {
          message: 'pickup_date is required',
          code: 400,
          details: 'Missing query parameter: pickup_date'
        }
      });
    }

    if (!return_date) {
      return res.status(400).json({
        error: {
          message: 'return_date is required',
          code: 400,
          details: 'Missing query parameter: return_date'
        }
      });
    }

    if (!isValidDateString(pickup_date) || !isValidDateString(return_date)) {
      return res.status(400).json({
        error: {
          message: 'Invalid date format',
          code: 400,
          details: 'Dates must be valid YYYY-MM-DD format'
        }
      });
    }

    const availability = bikeAvailabilityService.checkAvailability(
      pickup_date,
      return_date,
      bike_model || null
    );

    res.status(200).json({
      data: availability,
      meta: {
        timestamp: new Date().toISOString(),
        pickup_date,
        return_date,
        bike_model: bike_model || 'all'
      }
    });
  } catch (error) {
    console.error('Bike availability check error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to check bike availability',
        code: 500,
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

// POST /api/bike/booking - Submit bike booking (AC: #3)
app.post('/api/bike/booking', (req, res) => {
  try {
    const { phone_number, pickup_date, return_date, bike_model, id_document_type, id_number } = req.body;

    if (!phone_number) {
      return res.status(400).json({
        error: {
          message: 'phone_number is required',
          code: 400,
          details: 'Missing required field: phone_number'
        }
      });
    }

    if (!pickup_date) {
      return res.status(400).json({
        error: {
          message: 'pickup_date is required',
          code: 400,
          details: 'Missing required field: pickup_date'
        }
      });
    }

    if (!return_date) {
      return res.status(400).json({
        error: {
          message: 'return_date is required',
          code: 400,
          details: 'Missing required field: return_date'
        }
      });
    }

    if (!bike_model) {
      return res.status(400).json({
        error: {
          message: 'bike_model is required',
          code: 400,
          details: 'Missing required field: bike_model'
        }
      });
    }

    if (!id_document_type) {
      return res.status(400).json({
        error: {
          message: 'id_document_type is required',
          code: 400,
          details: 'Missing required field: id_document_type'
        }
      });
    }

    if (!id_number) {
      return res.status(400).json({
        error: {
          message: 'id_number is required',
          code: 400,
          details: 'Missing required field: id_number'
        }
      });
    }

    if (!isValidDateString(pickup_date) || !isValidDateString(return_date)) {
      return res.status(400).json({
        error: {
          message: 'Invalid date format',
          code: 400,
          details: 'Dates must be valid YYYY-MM-DD format'
        }
      });
    }

    const result = bikeBookingService.submitBooking(phone_number, {
      pickup_date,
      return_date,
      bike_model,
      id_document_type,
      id_number
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
    console.error('Bike booking error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to create booking',
        code: 500,
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

// GET /api/bike/booking/:id - Get booking status
app.get('/api/bike/booking/:id', (req, res) => {
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

    const booking = bikeBookingService.getBooking(id);

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
    service: 'bike-rental-booking',
    endpoints: [
      'GET /api/bike/availability',
      'POST /api/bike/booking',
      'GET /api/bike/booking/:id',
      'GET /api/health'
    ],
    template_count: flowTemplateService.templates.size,
    booking_count: bikeBookingService.bookings.size
  });
});

// Start server (only if not in test mode)
if (process.env.MOCHA_TEST_MODE !== 'true') {
  const PORT = process.env.PORT || 3025;

  app.listen(PORT, () => {
    console.log(`Bike Rental Booking Service listening on port ${PORT}`);
    console.log(`Storage: In-memory (MVP) - ERPNext Rental Module in Phase 2`);
  });
}

module.exports = { app, BikeAvailabilityService, BikeBookingService, FlowTemplateService, FlowValidator };


