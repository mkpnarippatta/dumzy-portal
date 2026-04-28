const express = require('express');
const supabaseStorage = require('./lib/supabase-storage');

const VALID_ROLES = ['user', 'bot', 'agent'];
const VALID_VERTICALS = ['Bike Rental', 'Hotel', 'Taxi', 'Ticketing', 'Social Media', 'Unknown'];

// Customer Profile Service - Reused from Story 2.1
class CustomerProfileService {
  constructor() {
    this.profiles = new Map();
  }

  normalizePhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return '';
    return phone.replace(/\D/g, '');
  }

  generateId() {
    return `cust_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  create(profileData) {
    if (!profileData || typeof profileData !== 'object') {
      throw new Error('Invalid profile data');
    }

    const normalizedPhone = this.normalizePhoneNumber(profileData.phone_number);

    if (this.profiles.has(normalizedPhone)) {
      throw new Error('Customer profile already exists for this phone number');
    }

    const customer = {
      id: this.generateId(),
      phone_number: profileData.phone_number,
      profile_data: {
        bookings: profileData.profile_data?.bookings && Object.keys(profileData.profile_data.bookings).length > 0
          ? profileData.profile_data.bookings
          : {
              bike_rental: [],
              hotel: [],
              taxi: [],
              ticketing: [],
              social_media: []
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

  // Seed in-memory cache from Supabase for a phone number (async, called by route handlers)
  async seedFromSupabase(phoneNumber) {
    if (process.env.MOCHA_TEST_MODE === 'true' || !supabaseStorage.isAvailable()) return;

    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    if (!normalizedPhone || this.profiles.has(normalizedPhone)) return;

    try {
      const supabaseCustomer = await supabaseStorage.getCustomer(phoneNumber);
      if (!supabaseCustomer) return;

      const profileData = {
        bookings: supabaseCustomer.profile_data?.bookings || {
          bike_rental: [], hotel: [], taxi: [], ticketing: [], social_media: [],
        },
        preferences: supabaseCustomer.profile_data?.preferences || {},
        last_booking: supabaseCustomer.profile_data?.last_booking || null,
      };

      // Enrich bookings from enquiry history
      const enquiries = await supabaseStorage.listEnquiries({ phone_number: phoneNumber, limit: 50 });
      for (const enq of enquiries) {
        if (!enq.data) continue;
        const vKey = (enq.vertical || '').toLowerCase().replace(/\s+/g, '_');
        if (profileData.bookings[vKey]) {
          profileData.bookings[vKey].push({ booking_date: (enq.created_at || '').split('T')[0], ...enq.data });
        }
      }

      this.profiles.set(normalizedPhone, {
        id: supabaseCustomer.id,
        phone_number: supabaseCustomer.phone_number,
        profile_data: profileData,
        created_at: supabaseCustomer.created_at,
        updated_at: supabaseCustomer.updated_at,
      });
    } catch (_) { /* Supabase unavailable */ }
  }

  getUnifiedProfile(phoneNumber) {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    const customer = this.profiles.get(normalizedPhone);

    if (!customer) {
      return null;
    }

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

    allBookings.sort((a, b) => {
      const dateA = new Date(a.booking_date);
      const dateB = new Date(b.booking_date);
      if (isNaN(dateA.getTime())) return 1;
      if (isNaN(dateB.getTime())) return -1;
      return dateB - dateA;
    });

    const unified = {
      ...customer,
      unified_bookings: allBookings,
      vertical_counts: verticalCounts,
      total_bookings: allBookings.length
    };
    return JSON.parse(JSON.stringify(unified));
  }
}

// Recommendation Engine - Context-Aware Booking Recommendations
class RecommendationEngine {
  constructor(customerProfileService) {
    this.customerProfileService = customerProfileService;
    this.RECENT_BOOKING_DAYS = 90;
    this.MIN_BOOKINGS_FOR_PATTERN = 2;
    this.CONFIDENCE_THRESHOLD = 0.5;
  }

  // Get conversation history signals for richer recommendations
  async getConversationSignals(phoneNumber) {
    if (process.env.MOCHA_TEST_MODE === 'true' || !supabaseStorage.isAvailable()) return null;
    try {
      const messages = await supabaseStorage.getMessages(phoneNumber, 20);
      if (!messages || messages.length === 0) return null;

      const verticalMentions = {};
      for (const msg of messages) {
        if (msg.vertical_tag && msg.vertical_tag !== 'Unknown') {
          verticalMentions[msg.vertical_tag] = (verticalMentions[msg.vertical_tag] || 0) + 1;
        }
      }

      return Object.keys(verticalMentions).length > 0
        ? { mentioned_verticals: verticalMentions, recent_message_count: messages.length }
        : null;
    } catch {
      return null;
    }
  }

  // Get recommendations for phone number
  getRecommendations(phoneNumber) {
    const customer = this.customerProfileService.getUnifiedProfile(phoneNumber);

    if (!customer) {
      return {
        is_new_customer: true,
        preferences: [],
        contextual_message: null
      };
    }

    const preferences = this.extractPreferences(customer);

    // Check if customer has any bookings
    const hasBookings = Object.values(customer.profile_data.bookings).some(
      bookings => bookings && bookings.length > 0
    );

    if (!hasBookings) {
      return {
        is_new_customer: true,
        preferences: [],
        contextual_message: null
      };
    }

    const contextualMessage = this.generateContextualMessage(preferences);

    return {
      is_new_customer: false,
      preferences: preferences,
      contextual_message: contextualMessage
    };
  }

  // Get recommendation for specific vertical
  getRecommendationForVertical(phoneNumber, vertical) {
    const recommendations = this.getRecommendations(phoneNumber);

    const verticalMapping = {
      'bike-rental': 'Bike Rental',
      'hotel': 'Hotel',
      'taxi': 'Taxi',
      'ticketing': 'Ticketing',
      'social-media': 'Social Media'
    };

    const targetVertical = verticalMapping[vertical] || vertical;
    const preference = recommendations.preferences.find(p => p.vertical === targetVertical);

    return {
      phone_number: phoneNumber,
      vertical: vertical,
      preference: preference || null,
      is_new_customer: recommendations.is_new_customer
    };
  }

  // Extract preferences from booking history
  extractPreferences(customer) {
    const preferences = [];
    const verticals = ['bike_rental', 'hotel', 'taxi', 'ticketing', 'social_media'];

    for (const vertical of verticals) {
      const bookings = customer.profile_data.bookings[vertical] || [];
      const recentBookings = this.filterRecentBookings(bookings);

      if (recentBookings.length >= this.MIN_BOOKINGS_FOR_PATTERN) {
        const preference = this.detectVerticalPreference(vertical, recentBookings);
        if (preference && preference.confidence >= this.CONFIDENCE_THRESHOLD) {
          preferences.push(preference);
        }
      }
    }

    return preferences.sort((a, b) => b.confidence - a.confidence);
  }

  // Filter bookings to recent ones
  filterRecentBookings(bookings) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.RECENT_BOOKING_DAYS);

    const recent = bookings.filter(b => {
      const d = new Date(b.booking_date);
      return !isNaN(d.getTime()) && d >= cutoffDate;
    });

    // Sort descending to get most recent first, then take top 5
    recent.sort((a, b) => {
      const dateA = new Date(a.booking_date);
      const dateB = new Date(b.booking_date);
      if (isNaN(dateA.getTime())) return 1;
      if (isNaN(dateB.getTime())) return -1;
      return dateB - dateA;
    });

    return recent.slice(0, 5);
  }

  // Detect preference for specific vertical
  detectVerticalPreference(vertical, bookings) {
    if (vertical === 'bike_rental') {
      return this.detectBikePreference(bookings);
    } else if (vertical === 'hotel') {
      return this.detectHotelPreference(bookings);
    }
    return null;
  }

  // Detect bike rental preference
  detectBikePreference(bookings) {
    const modelCounts = {};
    const today = new Date();

    bookings.forEach(booking => {
      const model = booking.bike_model || 'Unknown';
      modelCounts[model] = (modelCounts[model] || 0) + 1;
    });

    const topModel = Object.entries(modelCounts)
      .sort((a, b) => b[1] - a[1])[0];

    if (!topModel) return null;

    const [model, count] = topModel;
    const frequency = count / bookings.length;

    // Bookings are sorted most-recent-first from filterRecentBookings
    const lastBooking = bookings[0];
    const lastDate = new Date(lastBooking.booking_date);
    if (isNaN(lastDate.getTime())) return null;

    const daysSinceLast = (today - lastDate) / (1000 * 60 * 60 * 24);
    const recencyScore = Math.max(0, 1 - (daysSinceLast / 90));

    const confidence = (frequency * 0.4) + (recencyScore * 0.6);

    return {
      vertical: 'Bike Rental',
      type: 'bike_model',
      value: model,
      confidence: confidence,
      last_booked: lastBooking.booking_date,
      booking_count: bookings.length
    };
  }

  // Detect hotel preference
  detectHotelPreference(bookings) {
    const roomCounts = {};
    const today = new Date();

    bookings.forEach(booking => {
      const roomType = booking.room_type || 'Standard';
      roomCounts[roomType] = (roomCounts[roomType] || 0) + 1;
    });

    const topRoom = Object.entries(roomCounts)
      .sort((a, b) => b[1] - a[1])[0];

    if (!topRoom) return null;

    const [roomType, count] = topRoom;
    const frequency = count / bookings.length;

    // Bookings are sorted most-recent-first from filterRecentBookings
    const lastBooking = bookings[0];
    const lastDate = new Date(lastBooking.booking_date);
    if (isNaN(lastDate.getTime())) return null;

    const daysSinceLast = (today - lastDate) / (1000 * 60 * 60 * 24);
    const recencyScore = Math.max(0, 1 - (daysSinceLast / 90));

    const confidence = (frequency * 0.4) + (recencyScore * 0.6);

    return {
      vertical: 'Hotel',
      type: 'room_type',
      value: roomType,
      confidence: confidence,
      last_booked: lastBooking.booking_date,
      booking_count: bookings.length
    };
  }

  // Generate contextual message for bot
  generateContextualMessage(preferences) {
    if (preferences.length === 0) return null;

    const topPreference = [...preferences].sort((a, b) => b.confidence - a.confidence)[0];

    if (!topPreference.last_booked) return null;
    const lastDate = new Date(topPreference.last_booked);
    if (isNaN(lastDate.getTime())) return null;

    const formattedDate = lastDate.toLocaleDateString('en-IN', {
      month: 'short',
      day: 'numeric'
    });

    if (topPreference.vertical === 'Bike Rental') {
      return `You booked a ${topPreference.value} on ${formattedDate} — want another one?`;
    } else if (topPreference.vertical === 'Hotel') {
      return `You booked a ${topPreference.value} last time — want something similar?`;
    }

    return null;
  }
}

// Initialize services as singletons
const customerService = new CustomerProfileService();
const recommendationEngine = new RecommendationEngine(customerService);
const APP_START_TIME = Date.now();

// Express app setup
const app = express();
app.use(express.json({ limit: '1mb' }));

// GET /api/recommendations/:phoneNumber - Get recommendations
app.get('/api/recommendations/:phoneNumber', async (req, res) => {
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

    // Seed from Supabase so recommendations use real data
    await customerService.seedFromSupabase(phoneNumber);

    const recommendations = recommendationEngine.getRecommendations(phoneNumber);

    // Enrich with conversation signals if available
    let conversationSignals = null;
    if (process.env.MOCHA_TEST_MODE !== 'true') {
      conversationSignals = await recommendationEngine.getConversationSignals(phoneNumber);
    }

    res.status(200).json({
      data: { ...recommendations, conversation_signals: conversationSignals },
      meta: {
        timestamp: new Date().toISOString(),
        phone_number: phoneNumber
      }
    });
  } catch (error) {
    console.error('Recommendation error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to get recommendations',
        code: 500,
        details: 'An internal error occurred'
      }
    });
  }
});

// GET /api/recommendations/:phoneNumber/:vertical - Get vertical-specific recommendation
app.get('/api/recommendations/:phoneNumber/:vertical', async (req, res) => {
  try {
    const { phoneNumber, vertical } = req.params;

    if (!phoneNumber || !vertical) {
      return res.status(400).json({
        error: {
          message: 'phoneNumber and vertical are required',
          code: 400,
          details: 'Missing required parameters'
        }
      });
    }

    await customerService.seedFromSupabase(phoneNumber);
    const recommendation = recommendationEngine.getRecommendationForVertical(phoneNumber, vertical);

    res.status(200).json({
      data: recommendation,
      meta: {
        timestamp: new Date().toISOString(),
        phone_number: phoneNumber,
        vertical: vertical
      }
    });
  } catch (error) {
    console.error('Vertical recommendation error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to get vertical recommendation',
        code: 500,
        details: 'An internal error occurred'
      }
    });
  }
});

// Test-only endpoint to create customer profiles (registered only in test mode)
if (process.env.MOCHA_TEST_MODE === 'true') {
  app.post('/api/test/customer', (req, res) => {
    try {
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: { message: 'Request body is required', code: 400 } });
      }
      const { phone_number, profile_data } = req.body;
      const customer = customerService.create({ phone_number, profile_data });
      res.status(201).json({
        data: customer,
        meta: { timestamp: new Date().toISOString(), message: 'Test customer created' },
      });
    } catch (error) {
      const msg = error && error.message;
      if (msg && msg.includes('already exists')) {
        return res.status(409).json({ error: { message: msg, code: 409 } });
      }
      res.status(500).json({ error: { message: 'Failed to create test customer', code: 500, details: 'An internal error occurred' } });
    }
  });
}

// GET /api/health - Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime_ms: Date.now() - APP_START_TIME,
    service: 'context-aware-booking-recommendations',
    endpoints: [
      'GET /api/recommendations/:phoneNumber',
      'GET /api/recommendations/:phoneNumber/:vertical',
      'GET /api/health'
    ],
    confidence_threshold: 0.5,
    recent_booking_days: 90,
    min_bookings_for_pattern: 2
  });
});

// Start server (only if not in test mode)
if (process.env.MOCHA_TEST_MODE !== 'true') {
  const PORT = process.env.PORT || 3022;

  app.listen(PORT, () => {
    console.log(`Context-Aware Booking Recommendations Service listening on port ${PORT}`);
    console.log(`Confidence threshold: ${recommendationEngine.CONFIDENCE_THRESHOLD}`);
    console.log(`Recent booking window: ${recommendationEngine.RECENT_BOOKING_DAYS} days`);
  });
}

module.exports = { app, RecommendationEngine, CustomerProfileService };




