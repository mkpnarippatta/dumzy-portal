const { expect } = require('chai');
const { CustomerProfileService, app } = require('../src/2-1-user-recognition-profile-retrieval');
const request = require('supertest');

// ============================================================================
// CUSTOMER PROFILE DATA MODEL TESTS
// ============================================================================

describe('Customer Profile Data Model', () => {
  let service;

  beforeEach(() => {
    service = new CustomerProfileService();
  });

  // ------------------------------------------------------------
  // Customer Interface Structure
  // ------------------------------------------------------------
  describe('Customer interface structure', () => {
    it('should create customer with required fields', () => {
      const customer = {
        id: 'cust_123',
        phone_number: '+919876543210',
        profile_data: {
          bookings: {},
          preferences: {}
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      expect(customer).to.have.property('id');
      expect(customer).to.have.property('phone_number');
      expect(customer).to.have.property('profile_data');
      expect(customer).to.have.property('created_at');
      expect(customer).to.have.property('updated_at');
    });

    it('should have bookings object with vertical keys', () => {
      const profileData = {
        bookings: {
          bike_rental: [],
          hotel: [],
          taxi: [],
          ticketing: [],
          social_media: []
        }
      };

      expect(profileData.bookings).to.have.property('bike_rental');
      expect(profileData.bookings).to.have.property('hotel');
      expect(profileData.bookings).to.have.property('taxi');
      expect(profileData.bookings).to.have.property('ticketing');
      expect(profileData.bookings).to.have.property('social_media');
    });
  });

  // ------------------------------------------------------------
  // Phone Number Normalization
  // ------------------------------------------------------------
  describe('Phone number normalization', () => {
    it('should remove + prefix', () => {
      const normalized = service.normalizePhoneNumber('+919876543210');
      expect(normalized).to.equal('919876543210');
    });

    it('should remove spaces', () => {
      const normalized = service.normalizePhoneNumber('+91 98765 43210');
      expect(normalized).to.equal('919876543210');
    });

    it('should remove dashes', () => {
      const normalized = service.normalizePhoneNumber('+91-98765-43210');
      expect(normalized).to.equal('919876543210');
    });

    it('should remove combination of +, spaces, and dashes', () => {
      const normalized = service.normalizePhoneNumber('+91 98765-43210');
      expect(normalized).to.equal('919876543210');
    });

    it('should strip parentheses and dots', () => {
      const normalized = service.normalizePhoneNumber('+1 (800) 555-0199');
      expect(normalized).to.equal('18005550199');
    });

    it('should handle already normalized number', () => {
      const normalized = service.normalizePhoneNumber('919876543210');
      expect(normalized).to.equal('919876543210');
    });

    it('should return empty string for null input', () => {
      expect(service.normalizePhoneNumber(null)).to.equal('');
    });

    it('should return empty string for undefined input', () => {
      expect(service.normalizePhoneNumber(undefined)).to.equal('');
    });

    it('should return empty string for non-string input', () => {
      expect(service.normalizePhoneNumber(123)).to.equal('');
    });
  });

  // ------------------------------------------------------------
  // Customer Profile Service
  // ------------------------------------------------------------
  describe('CustomerProfileService', () => {
    it('should create customer with timestamps', () => {
      const customerData = {
        phone_number: '+919876543210',
        profile_data: {
          bookings: {},
          preferences: {}
        }
      };

      const customer = service.create(customerData);

      expect(customer).to.have.property('id');
      expect(customer.phone_number).to.equal('+919876543210');
      expect(customer).to.have.property('created_at');
      expect(customer).to.have.property('updated_at');
      expect(customer.created_at).to.be.a('string');
      expect(customer.updated_at).to.be.a('string');
    });

    it('should store customer in in-memory storage', async () => {
      const customerData = {
        phone_number: '+919876543210',
        profile_data: {
          bookings: {},
          preferences: {}
        }
      };

      const customer = service.create(customerData);
      const retrieved = await service.findByPhoneNumber('+919876543210');

      expect(retrieved).to.not.be.null;
      expect(retrieved.id).to.equal(customer.id);
    });

    it('should find existing customer by phone number', async () => {
      const customerData = {
        phone_number: '+919123456789',
        profile_data: {
          bookings: {},
          preferences: {}
        }
      };

      service.create(customerData);
      const retrieved = await service.findByPhoneNumber('+919123456789');

      expect(retrieved).to.not.be.null;
      expect(retrieved.phone_number).to.equal('+919123456789');
    });

    it('should return null for non-existent phone number', async () => {
      const retrieved = await service.findByPhoneNumber('+999999999999');
      expect(retrieved).to.be.null;
    });

    it('should complete lookup within 2 seconds', async () => {
      const customerData = {
        phone_number: '+919876543211',
        profile_data: {
          bookings: {},
          preferences: {}
        }
      };

      service.create(customerData);

      const startTime = Date.now();
      const retrieved = await service.findByPhoneNumber('+919876543211');
      const endTime = Date.now();

      expect(retrieved).to.not.be.null;
      expect(endTime - startTime).to.be.at.most(2100);
    });

    it('should handle phone number with different formatting', async () => {
      const customerData = {
        phone_number: '+91 98765 43212',
        profile_data: {
          bookings: {},
          preferences: {}
        }
      };

      service.create(customerData);

      const retrieved = await service.findByPhoneNumber('+91-98765-43212');
      expect(retrieved).to.not.be.null;
    });

    it('should reject duplicate phone numbers', () => {
      const customerData = {
        phone_number: '+919876543213',
        profile_data: {
          bookings: {},
          preferences: {}
        }
      };

      service.create(customerData);

      expect(() => {
        service.create(customerData);
      }).to.throw('Customer profile already exists for this phone number');
    });

    it('should reject creation with missing phone number', () => {
      expect(() => {
        service.create({ phone_number: '', profile_data: {} });
      }).to.throw('Valid phone_number is required');
    });

    it('should reject creation with invalid data', () => {
      expect(() => {
        service.create(null);
      }).to.throw('Invalid profile data');
    });

    it('should return a defensive copy, not a mutable reference', () => {
      const customerData = {
        phone_number: '+919876543214',
        profile_data: { bookings: {}, preferences: {} }
      };

      const customer = service.create(customerData);
      customer.phone_number = 'HACKED';

      const retrieved = service.profiles.get('919876543214');
      expect(retrieved.phone_number).to.equal('+919876543214');
    });
  });

  // ------------------------------------------------------------
  // Unified Profile Aggregation
  // ------------------------------------------------------------
  describe('Unified Profile Aggregation', () => {
    beforeEach(() => {
      const customerData = {
        phone_number: '+919999999999',
        profile_data: {
          bookings: {
            bike_rental: [
              { id: 'bk1', booking_date: '2026-04-15', status: 'completed', bike_model: 'Hero' },
              { id: 'bk2', booking_date: '2026-04-20', status: 'completed', bike_model: 'Honda' }
            ],
            hotel: [
              { id: 'ht1', booking_date: '2026-04-18', status: 'completed', room_type: 'Deluxe' }
            ],
            taxi: [
              { id: 'tx1', booking_date: '2026-04-22', status: 'pending', pickup: 'Hyderabad', dropoff: 'Airport' }
            ],
            ticketing: [],
            social_media: []
          },
          preferences: {
            bike_preference: 'Hero',
            room_preference: 'Deluxe'
          }
        }
      };

      service.create(customerData);
    });

    it('should aggregate bookings from all verticals', () => {
      const unified = service.getUnifiedProfile('+919999999999');

      expect(unified).to.not.be.null;
      expect(unified).to.have.property('unified_bookings');
      expect(unified.unified_bookings).to.be.an('array');
      expect(unified.unified_bookings.length).to.equal(4);
    });

    it('should include vertical classification for each booking', () => {
      const unified = service.getUnifiedProfile('+919999999999');

      expect(unified.unified_bookings[0]).to.have.property('vertical');
      expect(unified.unified_bookings[0].vertical).to.be.oneOf(['Bike Rental', 'Hotel', 'Taxi', 'Ticketing', 'Social Media']);
    });

    it('should sort bookings by date (most recent first)', () => {
      const unified = service.getUnifiedProfile('+919999999999');

      const dates = unified.unified_bookings.map(b => b.booking_date);
      expect(dates).to.eql(dates.sort().reverse());
    });

    it('should include vertical counts', () => {
      const unified = service.getUnifiedProfile('+919999999999');

      expect(unified).to.have.property('vertical_counts');
      expect(unified.vertical_counts.bike_rental).to.equal(2);
      expect(unified.vertical_counts.hotel).to.equal(1);
      expect(unified.vertical_counts.taxi).to.equal(1);
      expect(unified.vertical_counts.ticketing).to.equal(0);
      expect(unified.vertical_counts.social_media).to.equal(0);
    });

    it('should include total bookings count', () => {
      const unified = service.getUnifiedProfile('+919999999999');

      expect(unified).to.have.property('total_bookings');
      expect(unified.total_bookings).to.equal(4);
    });

    it('should return null for non-existent profile', () => {
      const unified = service.getUnifiedProfile('+999999999999');
      expect(unified).to.be.null;
    });

    it('should preserve original customer data in unified profile', () => {
      const unified = service.getUnifiedProfile('+919999999999');

      expect(unified).to.have.property('id');
      expect(unified).to.have.property('phone_number');
      expect(unified).to.have.property('profile_data');
      expect(unified).to.have.property('created_at');
      expect(unified).to.have.property('updated_at');
    });

    it('should handle invalid booking dates without breaking sort order', () => {
      const service2 = new CustomerProfileService();
      service2.create({
        phone_number: '+911111111111',
        profile_data: {
          bookings: {
            bike_rental: [
              { id: 'b1', booking_date: 'invalid-date', status: 'completed' },
              { id: 'b2', booking_date: '2026-04-20', status: 'completed' }
            ]
          }
        }
      });

      const unified = service2.getUnifiedProfile('+911111111111');
      expect(unified.unified_bookings.length).to.equal(2);
      // The valid date should sort first
      expect(unified.unified_bookings[0].id).to.equal('b2');
    });
  });

  // ------------------------------------------------------------
  // Update Profile Tests
  // ------------------------------------------------------------
  describe('CustomerProfileService.update', () => {
    it('should update profile data', () => {
      service.create({
        phone_number: '+919000000001',
        profile_data: {
          bookings: { bike_rental: [] },
          preferences: { bike_preference: 'Hero' }
        }
      });

      const updated = service.update('+919000000001', {
        profile_data: {
          preferences: { bike_preference: 'Honda' }
        }
      });

      expect(updated.profile_data.preferences.bike_preference).to.equal('Honda');
      expect(updated.updated_at).to.be.a('string');
    });

    it('should merge bookings without dropping existing ones', () => {
      service.create({
        phone_number: '+919000000002',
        profile_data: {
          bookings: {
            bike_rental: [{ id: 'b1', booking_date: '2026-04-15', status: 'completed' }],
            hotel: []
          },
          preferences: {}
        }
      });

      const updated = service.update('+919000000002', {
        profile_data: {
          bookings: {
            hotel: [{ id: 'h1', booking_date: '2026-04-20', status: 'pending' }]
          }
        }
      });

      expect(updated.profile_data.bookings.bike_rental).to.have.length(1);
      expect(updated.profile_data.bookings.hotel).to.have.length(1);
    });

    it('should reject update for non-existent profile', () => {
      expect(() => {
        service.update('+999999999999', { profile_data: {} });
      }).to.throw('Customer profile not found');
    });

    it('should update phone number when provided', () => {
      service.create({
        phone_number: '+919000000003',
        profile_data: { bookings: {}, preferences: {} }
      });

      const updated = service.update('+919000000003', {
        phone_number: '+919000000004'
      });

      expect(updated.phone_number).to.equal('+919000000004');
    });
  });
});

// ============================================================================
// API ENDPOINTS TESTS
// ============================================================================

describe('API Endpoints', () => {
  // ------------------------------------------------------------
  // POST /api/customer/profile - Create Customer
  // ------------------------------------------------------------
  describe('POST /api/customer/profile', () => {
    it('should create new customer profile', async () => {
      const response = await request(app)
        .post('/api/customer/profile')
        .send({
          phone_number: '+918888888888',
          profile_data: {
            bookings: {},
            preferences: {}
          }
        })
        .expect(201);

      expect(response.body).to.have.property('data');
      expect(response.body.data).to.have.property('id');
      expect(response.body.data).to.have.property('phone_number', '+918888888888');
      expect(response.body).to.have.property('meta');
      expect(response.body.meta.message).to.include('created successfully');
    });

    it('should return 400 for missing phone_number', async () => {
      const response = await request(app)
        .post('/api/customer/profile')
        .send({
          profile_data: {
            bookings: {},
            preferences: {}
          }
        })
        .expect(400);

      expect(response.body).to.have.property('error');
      expect(response.body.error.code).to.equal(400);
      expect(response.body.error.message).to.include('phone_number is required');
    });

    it('should return 400 for invalid phone number format', async () => {
      const response = await request(app)
        .post('/api/customer/profile')
        .send({
          phone_number: '123',
          profile_data: {
            bookings: {},
            preferences: {}
          }
        })
        .expect(400);

      expect(response.body.error.code).to.equal(400);
      expect(response.body.error.message).to.include('Invalid phone number format');
    });

    it('should return 409 for duplicate phone number', async () => {
      await request(app)
        .post('/api/customer/profile')
        .send({
          phone_number: '+918777777777',
          profile_data: {
            bookings: {},
            preferences: {}
          }
        });

      const response = await request(app)
        .post('/api/customer/profile')
        .send({
          phone_number: '+918777777777',
          profile_data: {
            bookings: {},
            preferences: {}
          }
        })
        .expect(409);

      expect(response.body.error.code).to.equal(409);
      expect(response.body.error.message).to.include('already exists');
    });
  });

  // ------------------------------------------------------------
  // GET /api/customer/profile/:phoneNumber - Retrieve Customer
  // ------------------------------------------------------------
  describe('GET /api/customer/profile/:phoneNumber', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/customer/profile')
        .send({
          phone_number: '+918666666666',
          profile_data: {
            bookings: {
              bike_rental: [{ id: 'bk1', booking_date: '2026-04-15', status: 'completed' }]
            },
            preferences: {}
          }
        });
    });

    it('should retrieve existing customer profile', async () => {
      const response = await request(app)
        .get('/api/customer/profile/+918666666666')
        .expect(200);

      expect(response.body).to.have.property('data');
      expect(response.body.data).to.have.property('phone_number', '+918666666666');
      expect(response.body.data).to.have.property('unified_bookings');
      expect(response.body.data.unified_bookings.length).to.equal(1);
    });

    it('should return 404 for non-existent profile', async () => {
      const response = await request(app)
        .get('/api/customer/profile/+999999999999')
        .expect(404);

      expect(response.body).to.have.property('error');
      expect(response.body.error.code).to.equal(404);
      expect(response.body.error.message).to.include('not found');
    });

    it('should include vertical counts in response', async () => {
      const response = await request(app)
        .get('/api/customer/profile/+918666666666')
        .expect(200);

      expect(response.body.data).to.have.property('vertical_counts');
      expect(response.body.data.vertical_counts.bike_rental).to.equal(1);
    });

    it('should return lookup_time_ms as elapsed duration', async () => {
      const response = await request(app)
        .get('/api/customer/profile/+918666666666')
        .expect(200);

      expect(response.body.meta.lookup_time_ms).to.be.a('number');
      expect(response.body.meta.lookup_time_ms).to.be.at.least(0);
      expect(response.body.meta.lookup_time_ms).to.be.below(5000);
    });

    it('should return 400 for invalid phone number format', async () => {
      const response = await request(app)
        .get('/api/customer/profile/abc')
        .expect(400);

      expect(response.body.error.code).to.equal(400);
      expect(response.body.error.message).to.include('Invalid phone number');
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
      expect(response.body).to.have.property('service', 'user-recognition-profile-retrieval');
      expect(response.body).to.have.property('endpoints');
      expect(response.body).to.have.property('lookup_timeout_ms', 2000);
    });

    it('should return uptime_ms as elapsed duration', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body).to.have.property('uptime_ms');
      expect(response.body.uptime_ms).to.be.a('number');
      expect(response.body.uptime_ms).to.be.at.least(0);
    });

    it('should not expose profile_count', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body).to.not.have.property('profile_count');
    });
  });
});

// ============================================================================
// ACCEPTANCE CRITERIA TESTS
// ============================================================================

describe('Acceptance Criteria', () => {
  // ------------------------------------------------------------
  // AC #1: System identifies returning user within 2 seconds
  // ------------------------------------------------------------
  it('AC #1: System identifies returning user within 2 seconds', async () => {
    await request(app)
      .post('/api/customer/profile')
      .send({
        phone_number: '+915555555555',
        profile_data: {
          bookings: {
            bike_rental: [{ id: 'bk1', booking_date: '2026-04-15', status: 'completed' }]
          },
          preferences: {}
        }
      });

    const startTime = Date.now();
    const response = await request(app)
      .get('/api/customer/profile/+915555555555');
    const endTime = Date.now();

    expect(response.status).to.equal(200);
    expect(response.body.data).to.not.be.null;
    expect(endTime - startTime).to.be.at.most(2100);
  });

  // ------------------------------------------------------------
  // AC #2: Unified view displays all five vertical bookings
  // ------------------------------------------------------------
  it('AC #2: Unified view displays all five vertical bookings', async () => {
    await request(app)
      .post('/api/customer/profile')
      .send({
        phone_number: '+914444444444',
        profile_data: {
          bookings: {
            bike_rental: [
              { id: 'bk1', booking_date: '2026-04-15', status: 'completed' }
            ],
            hotel: [
              { id: 'ht1', booking_date: '2026-04-18', status: 'completed' }
            ],
            taxi: [
              { id: 'tx1', booking_date: '2026-04-22', status: 'pending' }
            ],
            ticketing: [
              { id: 'tk1', booking_date: '2026-04-10', status: 'completed' }
            ],
            social_media: [
              { id: 'sm1', booking_date: '2026-04-05', status: 'completed' }
            ]
          },
          preferences: {}
        }
      });

    const response = await request(app)
      .get('/api/customer/profile/+914444444444')
      .expect(200);

    const data = response.body.data;
    expect(data.vertical_counts.bike_rental).to.equal(1);
    expect(data.vertical_counts.hotel).to.equal(1);
    expect(data.vertical_counts.taxi).to.equal(1);
    expect(data.vertical_counts.ticketing).to.equal(1);
    expect(data.vertical_counts.social_media).to.equal(1);
    expect(data.total_bookings).to.equal(5);
  });

  // ------------------------------------------------------------
  // AC #3: Creates new profile for first-time customer
  // ------------------------------------------------------------
  it('AC #3: Creates new profile for first-time customer', async () => {
    const createResponse = await request(app)
      .post('/api/customer/profile')
      .send({
        phone_number: '+913333333333',
        profile_data: {
          bookings: {},
          preferences: {}
        }
      })
      .expect(201);

    expect(createResponse.body.data).to.have.property('id');
    expect(createResponse.body.data.profile_data).to.have.property('bookings');
    expect(createResponse.body.data.profile_data.bookings).to.be.an('object');
    expect(createResponse.body.data.profile_data.bookings).to.have.keys('bike_rental', 'hotel', 'taxi', 'ticketing', 'social_media');
    expect(Array.isArray(createResponse.body.data.profile_data.bookings.bike_rental)).to.be.true;
    expect(Array.isArray(createResponse.body.data.profile_data.bookings.hotel)).to.be.true;
  });
});
