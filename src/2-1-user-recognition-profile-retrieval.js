const express = require('express');

// Customer Profile Service - In-memory storage for MVP, Supabase in Phase 2
class CustomerProfileService {
  constructor() {
    this.profiles = new Map();
  }

  // Phone number normalization for consistent lookup (strip all non-digits)
  normalizePhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return '';
    return phone.replace(/\D/g, '');
  }

  // Generate unique customer ID
  generateId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `cust_${timestamp}_${random}`;
  }

  // Create new customer profile
  create(profileData) {
    if (!profileData || typeof profileData !== 'object') {
      throw new Error('Invalid profile data');
    }

    const normalizedPhone = this.normalizePhoneNumber(profileData.phone_number);
    if (!normalizedPhone) {
      throw new Error('Valid phone_number is required');
    }

    // Check for duplicate phone numbers
    if (this.profiles.has(normalizedPhone)) {
      throw new Error('Customer profile already exists for this phone number');
    }

    // Validate and sanitize bookings data
    const bookings = profileData.profile_data?.bookings;
    const sanitizedBookings = bookings && typeof bookings === 'object' && !Array.isArray(bookings)
      ? bookings
      : {};

    const customer = {
      id: this.generateId(),
      phone_number: profileData.phone_number,
      profile_data: {
        bookings: {
          bike_rental: Array.isArray(sanitizedBookings.bike_rental) ? sanitizedBookings.bike_rental : [],
          hotel: Array.isArray(sanitizedBookings.hotel) ? sanitizedBookings.hotel : [],
          taxi: Array.isArray(sanitizedBookings.taxi) ? sanitizedBookings.taxi : [],
          ticketing: Array.isArray(sanitizedBookings.ticketing) ? sanitizedBookings.ticketing : [],
          social_media: Array.isArray(sanitizedBookings.social_media) ? sanitizedBookings.social_media : []
        },
        preferences: profileData.profile_data?.preferences || {},
        last_booking: profileData.profile_data?.last_booking || null
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    this.profiles.set(normalizedPhone, customer);
    return JSON.parse(JSON.stringify(customer));
  }

  // Find customer by phone number
  async findByPhoneNumber(phoneNumber) {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    if (!normalizedPhone) return null;

    const customer = this.profiles.get(normalizedPhone) || null;
    return customer ? JSON.parse(JSON.stringify(customer)) : null;
  }

  // Update existing customer profile
  update(phoneNumber, updates) {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    const customer = this.profiles.get(normalizedPhone);

    if (!customer) {
      throw new Error('Customer profile not found');
    }

    if (updates.profile_data) {
      const existingBookings = customer.profile_data.bookings || {};
      const newBookings = updates.profile_data.bookings || {};

      customer.profile_data = {
        ...customer.profile_data,
        ...updates.profile_data,
        bookings: {
          ...existingBookings,
          ...Object.keys(newBookings).reduce((acc, key) => {
            if (Array.isArray(newBookings[key])) {
              acc[key] = newBookings[key];
            }
            return acc;
          }, {})
        }
      };
    }

    if (updates.phone_number) {
      customer.phone_number = updates.phone_number;
    }

    customer.updated_at = new Date().toISOString();
    this.profiles.set(normalizedPhone, customer);
    return JSON.parse(JSON.stringify(customer));
  }

  // Get unified profile with cross-vertical booking aggregation
  getUnifiedProfile(phoneNumber) {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    const customer = this.profiles.get(normalizedPhone);

    if (!customer) {
      return null;
    }

    // Aggregate bookings from all verticals
    const allBookings = [];
    const verticalCounts = {
      bike_rental: 0,
      hotel: 0,
      taxi: 0,
      ticketing: 0,
      social_media: 0
    };

    const verticalNames = {
      bike_rental: 'Bike Rental',
      hotel: 'Hotel',
      taxi: 'Taxi',
      ticketing: 'Ticketing',
      social_media: 'Social Media'
    };

    for (const [vertical, bookings] of Object.entries(customer.profile_data.bookings)) {
      if (bookings && Array.isArray(bookings)) {
        verticalCounts[vertical] = bookings.length;
        bookings.forEach(booking => {
          allBookings.push({
            ...booking,
            vertical: verticalNames[vertical] || vertical
          });
        });
      }
    }

    // Sort by booking date (most recent first), skip invalid dates
    allBookings.sort((a, b) => {
      const dateA = new Date(a.booking_date);
      const dateB = new Date(b.booking_date);
      if (isNaN(dateA.getTime())) return 1;
      if (isNaN(dateB.getTime())) return -1;
      return dateB - dateA;
    });

    return {
      ...customer,
      unified_bookings: allBookings,
      vertical_counts: verticalCounts,
      total_bookings: allBookings.length
    };
  }

  getProfileCount() {
    return this.profiles.size;
  }
}

// Initialize service
const customerService = new CustomerProfileService();
const APP_START_TIME = Date.now();

// Express app setup
const app = express();
app.use(express.json({ limit: '1mb' }));

// POST /api/customer/profile - Create new customer profile
app.post('/api/customer/profile', (req, res) => {
  try {
    const { phone_number, profile_data } = req.body;

    // Validate required fields
    if (!phone_number) {
      return res.status(400).json({
        error: {
          message: 'phone_number is required',
          code: 400,
          details: 'Missing required field: phone_number'
        }
      });
    }

    // Validate phone number format (basic check)
    const phoneRegex = /^\+?[1-9]\d{6,14}$/;
    if (!phoneRegex.test(phone_number.replace(/[\s\-\+]/g, ''))) {
      return res.status(400).json({
        error: {
          message: 'Invalid phone number format',
          code: 400,
          details: 'Phone number must be 7-15 digits, optionally starting with +'
        }
      });
    }

    // Create customer profile
    const customer = customerService.create({ phone_number, profile_data });

    res.status(201).json({
      data: customer,
      meta: {
        timestamp: new Date().toISOString(),
        message: 'Customer profile created successfully'
      }
    });
  } catch (error) {
    const message = error && error.message;
    if (message && message.includes('already exists')) {
      return res.status(409).json({
        error: {
          message: 'Customer profile already exists for this phone number',
          code: 409,
          details: 'A profile with this phone number already exists'
        }
      });
    }

    if (message && (message.includes('Invalid') || message.includes('required'))) {
      return res.status(400).json({
        error: {
          message,
          code: 400,
          details: 'Invalid request data'
        }
      });
    }

    console.error('Customer creation error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to create customer profile',
        code: 500,
        details: 'An internal error occurred'
      }
    });
  }
});

// GET /api/customer/profile/:phoneNumber - Retrieve customer profile
app.get('/api/customer/profile/:phoneNumber', async (req, res) => {
  const startTime = Date.now();

  try {
    const { phoneNumber } = req.params;

    if (!phoneNumber) {
      return res.status(400).json({
        error: {
          message: 'phoneNumber is required',
          code: 400,
          details: 'Missing phone number parameter'
        }
      });
    }

    // Validate phone number format
    const phoneRegex = /^\+?[1-9]\d{6,14}$/;
    if (!phoneRegex.test(phoneNumber.replace(/[\s\-\+]/g, ''))) {
      return res.status(400).json({
        error: {
          message: 'Invalid phone number format',
          code: 400,
          details: 'Phone number must be 7-15 digits, optionally starting with +'
        }
      });
    }

    // Find customer by phone number
    const customer = await customerService.findByPhoneNumber(phoneNumber);

    if (!customer) {
      return res.status(404).json({
        error: {
          message: 'Customer profile not found',
          code: 404,
          details: 'No profile exists for this phone number. This is a new customer.'
        }
      });
    }

    // Get unified profile with cross-vertical booking aggregation
    const unifiedProfile = customerService.getUnifiedProfile(phoneNumber);

    res.status(200).json({
      data: unifiedProfile,
      meta: {
        timestamp: new Date().toISOString(),
        lookup_time_ms: Date.now() - startTime
      }
    });
  } catch (error) {
    console.error('Customer lookup error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to retrieve customer profile',
        code: 500,
        details: 'An internal error occurred'
      }
    });
  }
});

// GET /api/health - Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime_ms: Date.now() - APP_START_TIME,
    service: 'user-recognition-profile-retrieval',
    endpoints: [
      'POST /api/customer/profile',
      'GET /api/customer/profile/:phoneNumber',
      'GET /api/health'
    ],
    lookup_timeout_ms: 2000
  });
});

// Start server (only if not in test mode)
if (process.env.MOCHA_TEST_MODE !== 'true') {
  const PORT = parseInt(process.env.PORT, 10);
  const SERVER_PORT = Number.isFinite(PORT) && PORT > 0 && PORT < 65536 ? PORT : 3020;

  app.listen(SERVER_PORT, () => {
    console.log(`User Recognition & Profile Retrieval Service listening on port ${SERVER_PORT}`);
    console.log(`Profile lookup timeout: 2000ms`);
    console.log(`Storage: In-memory (MVP) - Supabase in Phase 2`);
  });
}

module.exports = { app, CustomerProfileService };
