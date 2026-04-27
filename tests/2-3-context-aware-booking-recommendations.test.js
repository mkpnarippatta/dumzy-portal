require('../tests/helpers/setup');
const { expect } = require('chai');
const { RecommendationEngine, CustomerProfileService, app } = require('../src/2-3-context-aware-booking-recommendations');
const request = require('supertest');

// ============================================================================
// RECOMMENDATION ENGINE TESTS
// ============================================================================

describe('Recommendation Engine', () => {
  let recommendationEngine;
  let customerProfileService;

  beforeEach(() => {
    customerProfileService = new CustomerProfileService();
    recommendationEngine = new RecommendationEngine(customerProfileService);
  });

  // ------------------------------------------------------------
  // New Customer Detection
  // ------------------------------------------------------------
  describe('New Customer Detection', () => {
    it('should identify customer as new when no profile exists', () => {
      const recommendations = recommendationEngine.getRecommendations('+999999999999');

      expect(recommendations).to.have.property('is_new_customer', true);
      expect(recommendations.preferences).to.be.an('array').that.is.empty;
      expect(recommendations.contextual_message).to.be.null;
    });

    it('should identify customer as new when profile has no bookings', () => {
      customerProfileService.create({
        phone_number: '+919876543210',
        profile_data: {
          bookings: {},
          preferences: {}
        }
      });

      const recommendations = recommendationEngine.getRecommendations('+919876543210');

      expect(recommendations.is_new_customer).to.equal(true);
      expect(recommendations.preferences).to.be.an('array').that.is.empty;
    });
  });

  // ------------------------------------------------------------
  // Customer Profile Service - Phone Normalization
  // ------------------------------------------------------------
  describe('Phone Normalization', () => {
    it('should return empty string for null phone', () => {
      expect(customerProfileService.normalizePhoneNumber(null)).to.equal('');
    });

    it('should return empty string for undefined phone', () => {
      expect(customerProfileService.normalizePhoneNumber(undefined)).to.equal('');
    });

    it('should return empty string for non-string phone', () => {
      expect(customerProfileService.normalizePhoneNumber(12345)).to.equal('');
    });

    it('should return empty string for empty phone', () => {
      expect(customerProfileService.normalizePhoneNumber('')).to.equal('');
    });

    it('should strip parentheses and dots from phone number', () => {
      expect(customerProfileService.normalizePhoneNumber('+1 (555) 123-4567')).to.equal('15551234567');
    });

    it('should strip dots from phone number', () => {
      expect(customerProfileService.normalizePhoneNumber('555.123.4567')).to.equal('5551234567');
    });
  });

  // ------------------------------------------------------------
  // Preference Extraction (AC #1, #2)
  // ------------------------------------------------------------
  describe('Preference Extraction', () => {
    it('should extract preferences from booking history', () => {
      const phoneNumber = '+919876543211';

      customerProfileService.create({
        phone_number: phoneNumber,
        profile_data: {
          bookings: {
            bike_rental: [
              { id: 'bk1', booking_date: '2026-04-15', status: 'completed', bike_model: 'Hero' },
              { id: 'bk2', booking_date: '2026-04-18', status: 'completed', bike_model: 'Hero' }
            ],
            hotel: [
              { id: 'ht1', booking_date: '2026-04-20', status: 'completed', room_type: 'Deluxe' },
              { id: 'ht2', booking_date: '2026-04-21', status: 'completed', room_type: 'Deluxe' }
            ],
            taxi: [],
            ticketing: [],
            social_media: []
          },
          preferences: {}
        }
      });

      const recommendations = recommendationEngine.getRecommendations(phoneNumber);

      expect(recommendations.is_new_customer).to.equal(false);
      expect(recommendations.preferences).to.have.length(2);
      const verticals = recommendations.preferences.map(p => p.vertical);
      expect(verticals).to.include('Bike Rental');
      expect(verticals).to.include('Hotel');
    });

    it('should require minimum 2 bookings to establish pattern', () => {
      const phoneNumber = '+919876543212';

      customerProfileService.create({
        phone_number: phoneNumber,
        profile_data: {
          bookings: {
            bike_rental: [
              { id: 'bk1', booking_date: '2026-04-15', status: 'completed', bike_model: 'Hero' }
            ],
            hotel: [],
            taxi: [],
            ticketing: [],
            social_media: []
          },
          preferences: {}
        }
      });

      const recommendations = recommendationEngine.getRecommendations(phoneNumber);

      expect(recommendations.preferences).to.have.length(0);
    });

    it('should filter to last 5 bookings per vertical', () => {
      const phoneNumber = '+919876543213';
      const bookings = [];

      for (let i = 1; i <= 7; i++) {
        bookings.push({
          id: `bk${i}`,
          booking_date: `2026-04-${10 + i}`,
          status: 'completed',
          bike_model: i <= 5 ? 'Hero' : 'Honda'
        });
      }

      customerProfileService.create({
        phone_number: phoneNumber,
        profile_data: {
          bookings: {
            bike_rental: bookings,
            hotel: [],
            taxi: [],
            ticketing: [],
            social_media: []
          },
          preferences: {}
        }
      });

      const preferences = recommendationEngine.extractPreferences(
        customerProfileService.getUnifiedProfile(phoneNumber)
      );

      expect(preferences[0].booking_count).to.be.at.most(5);
    });

    it('should return defensive copies to prevent mutation of internal state', () => {
      const phoneNumber = '+919876543224';

      customerProfileService.create({
        phone_number: phoneNumber,
        profile_data: {
          bookings: {
            bike_rental: [
              { id: 'bk1', booking_date: '2026-04-22', status: 'completed', bike_model: 'Hero' },
              { id: 'bk2', booking_date: '2026-04-23', status: 'completed', bike_model: 'Hero' }
            ],
            hotel: [],
            taxi: [],
            ticketing: [],
            social_media: []
          },
          preferences: {}
        }
      });

      const firstCall = recommendationEngine.getRecommendations(phoneNumber);
      if (firstCall.preferences.length > 0) {
        firstCall.preferences[0].value = 'Mutated';
      }

      const secondCall = recommendationEngine.getRecommendations(phoneNumber);
      const bikePref = secondCall.preferences.find(p => p.vertical === 'Bike Rental');
      expect(bikePref).to.not.be.undefined;
      expect(bikePref.value).to.equal('Hero');
    });
  });

  // ------------------------------------------------------------
  // Bike Rental Preference Detection (AC #1)
  // ------------------------------------------------------------
  describe('Bike Rental Preference Detection', () => {
    it('should detect bike model preference from multiple bookings', () => {
      const phoneNumber = '+919876543214';

      customerProfileService.create({
        phone_number: phoneNumber,
        profile_data: {
          bookings: {
            bike_rental: [
              { id: 'bk1', booking_date: '2026-04-10', status: 'completed', bike_model: 'Hero' },
              { id: 'bk2', booking_date: '2026-04-15', status: 'completed', bike_model: 'Hero' },
              { id: 'bk3', booking_date: '2026-04-20', status: 'completed', bike_model: 'Honda' }
            ],
            hotel: [],
            taxi: [],
            ticketing: [],
            social_media: []
          },
          preferences: {}
        }
      });

      const recommendations = recommendationEngine.getRecommendations(phoneNumber);

      const bikePref = recommendations.preferences.find(p => p.vertical === 'Bike Rental');
      expect(bikePref).to.not.be.undefined;
      expect(bikePref.type).to.equal('bike_model');
      expect(bikePref.value).to.equal('Hero');
      expect(bikePref.booking_count).to.equal(3);
      expect(bikePref.confidence).to.be.greaterThan(0.5);
    });

    it('should reference previous bike model in contextual message (AC #1)', () => {
      const phoneNumber = '+919876543215';

      customerProfileService.create({
        phone_number: phoneNumber,
        profile_data: {
          bookings: {
            bike_rental: [
              { id: 'bk1', booking_date: '2026-04-20', status: 'completed', bike_model: 'Honda Activa' },
              { id: 'bk2', booking_date: '2026-04-21', status: 'completed', bike_model: 'Honda Activa' }
            ],
            hotel: [],
            taxi: [],
            ticketing: [],
            social_media: []
          },
          preferences: {}
        }
      });

      const recommendations = recommendationEngine.getRecommendations(phoneNumber);

      expect(recommendations.contextual_message).to.include('Honda Activa');
      expect(recommendations.contextual_message).to.include('want another one');
    });

    it('should calculate confidence based on frequency and recency', () => {
      const phoneNumber = '+919876543216';

      customerProfileService.create({
        phone_number: phoneNumber,
        profile_data: {
          bookings: {
            bike_rental: [
              { id: 'bk1', booking_date: '2026-04-19', status: 'completed', bike_model: 'Hero' },
              { id: 'bk2', booking_date: '2026-04-20', status: 'completed', bike_model: 'Hero' },
              { id: 'bk3', booking_date: '2026-04-21', status: 'completed', bike_model: 'Hero' }
            ],
            hotel: [],
            taxi: [],
            ticketing: [],
            social_media: []
          },
          preferences: {}
        }
      });

      const recommendations = recommendationEngine.getRecommendations(phoneNumber);
      const bikePref = recommendations.preferences.find(p => p.vertical === 'Bike Rental');

      // Higher frequency (3/3 = 1.0) + recent booking = high confidence
      expect(bikePref.confidence).to.be.greaterThan(0.7);
    });

    it('should have lower confidence for older bookings', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 76);
      const dateStr = oldDate.toISOString().split('T')[0];

      const bookings = [
        { id: 'bk1', booking_date: dateStr, status: 'completed', bike_model: 'Hero' },
        { id: 'bk2', booking_date: dateStr, status: 'completed', bike_model: 'Hero' }
      ];

      const pref = recommendationEngine.detectBikePreference(bookings);

      expect(pref).to.not.be.null;
      // 76 days old, same model: recency=1-76/90≈0.156, frequency=1.0
      // confidence = (1.0*0.4)+(0.156*0.6) = 0.4+0.093 = 0.493 < 0.5
      expect(pref.confidence).to.be.lessThan(0.5);
    });
  });

  // ------------------------------------------------------------
  // Hotel Preference Detection (AC #2)
  // ------------------------------------------------------------
  describe('Hotel Preference Detection', () => {
    it('should detect room type preference from multiple bookings', () => {
      const phoneNumber = '+919876543218';

      customerProfileService.create({
        phone_number: phoneNumber,
        profile_data: {
          bookings: {
            bike_rental: [],
            hotel: [
              { id: 'ht1', booking_date: '2026-04-10', status: 'completed', room_type: 'Deluxe' },
              { id: 'ht2', booking_date: '2026-04-15', status: 'completed', room_type: 'Deluxe' },
              { id: 'ht3', booking_date: '2026-04-20', status: 'completed', room_type: 'Suite' }
            ],
            taxi: [],
            ticketing: [],
            social_media: []
          },
          preferences: {}
        }
      });

      const recommendations = recommendationEngine.getRecommendations(phoneNumber);

      const hotelPref = recommendations.preferences.find(p => p.vertical === 'Hotel');
      expect(hotelPref).to.not.be.undefined;
      expect(hotelPref.type).to.equal('room_type');
      expect(hotelPref.value).to.equal('Deluxe');
      expect(hotelPref.booking_count).to.equal(3);
    });

    it('should reference previous room type in contextual message (AC #2)', () => {
      const phoneNumber = '+919876543219';

      customerProfileService.create({
        phone_number: phoneNumber,
        profile_data: {
          bookings: {
            bike_rental: [],
            hotel: [
              { id: 'ht1', booking_date: '2026-04-20', status: 'completed', room_type: 'Premium Suite' },
              { id: 'ht2', booking_date: '2026-04-21', status: 'completed', room_type: 'Premium Suite' }
            ],
            taxi: [],
            ticketing: [],
            social_media: []
          },
          preferences: {}
        }
      });

      const recommendations = recommendationEngine.getRecommendations(phoneNumber);

      expect(recommendations.contextual_message).to.include('Premium Suite');
      expect(recommendations.contextual_message).to.include('want something similar');
    });

    it('should default to Standard room type if not specified', () => {
      const phoneNumber = '+919876543220';

      customerProfileService.create({
        phone_number: phoneNumber,
        profile_data: {
          bookings: {
            bike_rental: [],
            hotel: [
              { id: 'ht1', booking_date: '2026-04-20', status: 'completed' },
              { id: 'ht2', booking_date: '2026-04-21', status: 'completed' }
            ],
            taxi: [],
            ticketing: [],
            social_media: []
          },
          preferences: {}
        }
      });

      const recommendations = recommendationEngine.getRecommendations(phoneNumber);

      const hotelPref = recommendations.preferences.find(p => p.vertical === 'Hotel');
      expect(hotelPref).to.not.be.undefined;
      expect(hotelPref.value).to.equal('Standard');
    });
  });

  // ------------------------------------------------------------
  // Cross-Vertical Preference Awareness
  // ------------------------------------------------------------
  describe('Cross-Vertical Preference Awareness', () => {
    it('should extract preferences from all verticals', () => {
      const phoneNumber = '+919876543221';

      customerProfileService.create({
        phone_number: phoneNumber,
        profile_data: {
          bookings: {
            bike_rental: [
              { id: 'bk1', booking_date: '2026-04-10', status: 'completed', bike_model: 'Hero' },
              { id: 'bk2', booking_date: '2026-04-15', status: 'completed', bike_model: 'Hero' }
            ],
            hotel: [
              { id: 'ht1', booking_date: '2026-04-16', status: 'completed', room_type: 'Deluxe' },
              { id: 'ht2', booking_date: '2026-04-17', status: 'completed', room_type: 'Deluxe' }
            ],
            taxi: [
              { id: 'tx1', booking_date: '2026-04-18', status: 'completed', pickup: 'Location A' },
              { id: 'tx2', booking_date: '2026-04-19', status: 'completed', pickup: 'Location A' }
            ],
            ticketing: [],
            social_media: []
          },
          preferences: {}
        }
      });

      const recommendations = recommendationEngine.getRecommendations(phoneNumber);

      const verticals = recommendations.preferences.map(p => p.vertical);
      expect(verticals).to.include('Bike Rental');
      expect(verticals).to.include('Hotel');
      // Taxi not implemented yet in MVP
    });

    it('should return preferences sorted by confidence', () => {
      const phoneNumber = '+919876543222';

      customerProfileService.create({
        phone_number: phoneNumber,
        profile_data: {
          bookings: {
            bike_rental: [
              { id: 'bk1', booking_date: '2026-04-10', status: 'completed', bike_model: 'Hero' },
              { id: 'bk2', booking_date: '2026-04-11', status: 'completed', bike_model: 'Hero' }
            ],
            hotel: [
              { id: 'ht1', booking_date: '2026-04-20', status: 'completed', room_type: 'Deluxe' },
              { id: 'ht2', booking_date: '2026-04-21', status: 'completed', room_type: 'Deluxe' }
            ],
            taxi: [],
            ticketing: [],
            social_media: []
          },
          preferences: {}
        }
      });

      const recommendations = recommendationEngine.getRecommendations(phoneNumber);

      expect(recommendations.preferences).to.have.length(2);
      expect(recommendations.preferences[0].confidence).to.be.greaterThan(recommendations.preferences[1].confidence);
    });
  });

  // ------------------------------------------------------------
  // Confidence Threshold
  // ------------------------------------------------------------
  describe('Confidence Threshold', () => {
    it('should exclude preferences below confidence threshold', () => {
      const phoneNumber = '+919876543223';

      // 2 bookings, different models (frequency 0.5), ~65 days old (recency ~0.28)
      // confidence = (0.5 * 0.4) + (0.28 * 0.6) = 0.2 + 0.168 = 0.368 < 0.5
      const sixtyFiveDaysAgo = new Date();
      sixtyFiveDaysAgo.setDate(sixtyFiveDaysAgo.getDate() - 65);

      customerProfileService.create({
        phone_number: phoneNumber,
        profile_data: {
          bookings: {
            bike_rental: [
              { id: 'bk1', booking_date: sixtyFiveDaysAgo.toISOString().split('T')[0], status: 'completed', bike_model: 'Hero' },
              { id: 'bk2', booking_date: sixtyFiveDaysAgo.toISOString().split('T')[0], status: 'completed', bike_model: 'Honda' }
            ],
            hotel: [],
            taxi: [],
            ticketing: [],
            social_media: []
          },
          preferences: {}
        }
      });

      const recommendations = recommendationEngine.getRecommendations(phoneNumber);

      // Low confidence should be excluded
      const bikePref = recommendations.preferences.find(p => p.vertical === 'Bike Rental');
      expect(bikePref).to.be.undefined;
    });
  });
});

// ============================================================================
// API ENDPOINTS TESTS
// ============================================================================

describe('API Endpoints', () => {
  let customerProfileService;

  beforeEach(() => {
    customerProfileService = new CustomerProfileService();
  });

  // ------------------------------------------------------------
  // GET /api/recommendations/:phoneNumber - Get Recommendations
  // ------------------------------------------------------------
  describe('GET /api/recommendations/:phoneNumber', () => {
    beforeEach(async () => {
      // Create customer with booking history via test endpoint
      await request(app)
        .post('/api/test/customer')
        .send({
          phone_number: '+918666666666',
          profile_data: {
            bookings: {
              bike_rental: [
                { id: 'bk1', booking_date: '2026-04-15', status: 'completed', bike_model: 'Hero' },
                { id: 'bk2', booking_date: '2026-04-20', status: 'completed', bike_model: 'Hero' }
              ],
              hotel: [],
              taxi: [],
              ticketing: [],
              social_media: []
            },
            preferences: {}
          }
        });
    });

    it('should get recommendations for existing customer', async () => {
      const response = await request(app)
        .get('/api/recommendations/+918666666666')
        .expect(200);

      expect(response.body).to.have.property('data');
      expect(response.body.data).to.have.property('is_new_customer', false);
      expect(response.body.data).to.have.property('preferences');
      expect(response.body.data.preferences).to.be.an('array');
    });

    it('should return new customer response for non-existent phone', async () => {
      const response = await request(app)
        .get('/api/recommendations/+999999999999')
        .expect(200);

      expect(response.body.data.is_new_customer).to.equal(true);
      expect(response.body.data.preferences).to.be.an('array').that.is.empty;
      expect(response.body.data.contextual_message).to.be.null;
    });

    it('should include contextual message when preferences found', async () => {
      const response = await request(app)
        .get('/api/recommendations/+918666666666')
        .expect(200);

      expect(response.body.data).to.have.property('contextual_message');
      expect(response.body.data.contextual_message).to.not.be.null;
    });
  });

  // ------------------------------------------------------------
  // GET /api/recommendations/:phoneNumber/:vertical - Vertical Specific
  // ------------------------------------------------------------
  describe('GET /api/recommendations/:phoneNumber/:vertical', () => {
    beforeEach(async () => {
      // Create customer with booking history via test endpoint
      await request(app)
        .post('/api/test/customer')
        .send({
          phone_number: '+918666666666',
          profile_data: {
            bookings: {
              bike_rental: [
                { id: 'bk1', booking_date: '2026-04-15', status: 'completed', bike_model: 'Hero' },
                { id: 'bk2', booking_date: '2026-04-20', status: 'completed', bike_model: 'Hero' }
              ],
              hotel: [
                { id: 'ht1', booking_date: '2026-04-16', status: 'completed', room_type: 'Deluxe' },
                { id: 'ht2', booking_date: '2026-04-21', status: 'completed', room_type: 'Deluxe' }
              ],
              taxi: [],
              ticketing: [],
              social_media: []
            },
            preferences: {}
          }
        });
    });

    it('should get bike rental specific recommendations', async () => {
      const response = await request(app)
        .get('/api/recommendations/+918666666666/bike-rental')
        .expect(200);

      expect(response.body.data.vertical).to.equal('bike-rental');
      expect(response.body.data.preference).to.not.be.null;
      expect(response.body.data.preference.vertical).to.equal('Bike Rental');
    });

    it('should get hotel specific recommendations', async () => {
      // Create a customer with only hotel bookings
      await request(app)
        .post('/api/test/customer')
        .send({
          phone_number: '+918777777777',
          profile_data: {
            bookings: {
              bike_rental: [],
              hotel: [
                { id: 'ht1', booking_date: '2026-04-16', status: 'completed', room_type: 'Deluxe' },
                { id: 'ht2', booking_date: '2026-04-21', status: 'completed', room_type: 'Deluxe' }
              ],
              taxi: [],
              ticketing: [],
              social_media: []
            },
            preferences: {}
          }
        });

      const response = await request(app)
        .get('/api/recommendations/+918777777777/hotel')
        .expect(200);

      expect(response.body.data.vertical).to.equal('hotel');
      expect(response.body.data.preference).to.not.be.null;
      expect(response.body.data.preference.vertical).to.equal('Hotel');
    });

    it('should return null preference for vertical with insufficient data', async () => {
      const response = await request(app)
        .get('/api/recommendations/+918666666666/taxi')
        .expect(200);

      expect(response.body.data.preference).to.be.null;
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
      expect(response.body).to.have.property('service', 'context-aware-booking-recommendations');
      expect(response.body).to.have.property('endpoints');
      expect(response.body).to.have.property('confidence_threshold', 0.5);
      expect(response.body).to.have.property('recent_booking_days', 90);
      expect(response.body).to.have.property('uptime_ms');
      expect(response.body.uptime_ms).to.be.a('number').that.is.at.least(0);
    });
  });
});

// ============================================================================
// ACCEPTANCE CRITERIA TESTS
// ============================================================================

describe('Acceptance Criteria', () => {
  let customerProfileService;

  beforeEach(() => {
    customerProfileService = new CustomerProfileService();
  });

  // ------------------------------------------------------------
  // AC #1: System references previous bike model preference
  // ------------------------------------------------------------
  it('AC #1: System references previous bike model preference', () => {
    const phoneNumber = '+915555555555';
    const recommendationEngine = new RecommendationEngine(customerProfileService);

    // Customer booked bike last weekend
    const lastWeekend = new Date();
    lastWeekend.setDate(lastWeekend.getDate() - 7);
    lastWeekend.setDate(lastWeekend.getDate() - (lastWeekend.getDay() === 0 ? 0 : lastWeekend.getDay()));

    customerProfileService.create({
      phone_number: phoneNumber,
      profile_data: {
        bookings: {
          bike_rental: [
            {
              id: 'bk1',
              booking_date: lastWeekend.toISOString().split('T')[0],
              status: 'completed',
              bike_model: 'Hero Splendor'
            },
            {
              id: 'bk2',
              booking_date: lastWeekend.toISOString().split('T')[0],
              status: 'completed',
              bike_model: 'Hero Splendor'
            }
          ],
          hotel: [],
          taxi: [],
          ticketing: [],
          social_media: []
        },
        preferences: {}
      }
    });

    const recommendations = recommendationEngine.getRecommendations(phoneNumber);

    expect(recommendations.is_new_customer).to.equal(false);
    expect(recommendations.contextual_message).to.include('Hero Splendor');
    expect(recommendations.contextual_message).to.include('want another one');
  });

  // ------------------------------------------------------------
  // AC #2: System displays hotel room type from previous booking
  // ------------------------------------------------------------
  it('AC #2: System displays hotel room type from previous booking', () => {
    const phoneNumber = '+914444444444';
    const recommendationEngine = new RecommendationEngine(customerProfileService);

    customerProfileService.create({
      phone_number: phoneNumber,
      profile_data: {
        bookings: {
          bike_rental: [],
          hotel: [
            {
              id: 'ht1',
              booking_date: '2026-04-10',
              status: 'completed',
              room_type: 'Deluxe Suite'
            },
            {
              id: 'ht2',
              booking_date: '2026-04-15',
              status: 'completed',
              room_type: 'Deluxe Suite'
            }
          ],
          taxi: [],
          ticketing: [],
          social_media: []
        },
        preferences: {}
      }
    });

    const recommendations = recommendationEngine.getRecommendations(phoneNumber);

    expect(recommendations.is_new_customer).to.equal(false);
    expect(recommendations.contextual_message).to.include('Deluxe Suite');
    expect(recommendations.contextual_message).to.include('want something similar');
  });

  // ------------------------------------------------------------
  // AC #3: No assumptions for new customers
  // ------------------------------------------------------------
  it('AC #3: System collects information without making assumptions for new customers', () => {
    const phoneNumber = '+913333333333';
    const recommendationEngine = new RecommendationEngine(customerProfileService);

    // New customer with no booking history
    customerProfileService.create({
      phone_number: phoneNumber,
      profile_data: {
        bookings: {},
        preferences: {}
      }
    });

    const recommendations = recommendationEngine.getRecommendations(phoneNumber);

    expect(recommendations.is_new_customer).to.equal(true);
    expect(recommendations.preferences).to.be.an('array').that.is.empty;
    expect(recommendations.contextual_message).to.be.null;
  });

  it('AC #3: Non-existent customer treated as new', () => {
    const phoneNumber = '+913333333334';
    const recommendationEngine = new RecommendationEngine(customerProfileService);

    const recommendations = recommendationEngine.getRecommendations(phoneNumber);

    expect(recommendations.is_new_customer).to.equal(true);
    expect(recommendations.preferences).to.be.an('array').that.is.empty;
    expect(recommendations.contextual_message).to.be.null;
  });
});
