require('../helpers/setup');
const { expect } = require('chai');
const request = require('supertest');
const { app: app3_1, FlowTemplateService, FlowValidator, FlowSubmissionService } = require('../../src/3-1-whatsapp-flow-framework-setup');
const { app: app3_3, ServiceAreaValidator, TaxiBookingService } = require('../../src/3-3-taxi-booking-flow');
const { app: app3_4, HotelBookingService, PMSAvailabilityService } = require('../../src/3-4-hotel-availability-booking-confirmation');

describe('Flow 6: Structured Data Collection', () => {
  describe('Step 1: Flow framework via 3-1', () => {
    it('Registers a new flow template', async () => {
      const res = await request(app3_1)
        .post('/api/flow/templates')
        .send({
          id: 'test-flow',
          name: 'Test Flow',
          vertical: 'Ticketing',
          version: '1.0',
          status: 'active',
          fields: [
            { name: 'full_name', type: 'text', label: 'Full Name', required: true },
            { name: 'email', type: 'email', label: 'Email', required: true },
            { name: 'ticket_count', type: 'text', label: 'Ticket Count', required: false },
          ],
        });

      expect(res.status).to.equal(201);
      expect(res.body.data.id).to.equal('test-flow');
      expect(res.body.data.vertical).to.equal('Ticketing');
      expect(res.body.data.status).to.equal('active');
    });

    it('Gets active template by vertical', async () => {
      const res = await request(app3_1).get('/api/flow/templates/Ticketing');

      expect(res.status).to.equal(200);
      expect(res.body.data.id).to.equal('test-flow');
    });

    it('Submits flow data against a template', async () => {
      const res = await request(app3_1)
        .post('/api/flow/submit')
        .send({
          flow_id: 'test-flow',
          phone_number: '+91987654321',
          data: { full_name: 'Test User', email: 'test@example.com', ticket_count: '2' },
        });

      expect(res.status).to.equal(201);
      expect(res.body.data.id).to.exist;
      expect(res.body.data.status).to.equal('validated');
      expect(res.body.data.validation_errors).to.be.an('array').that.is.empty;
    });

    it('Gets submission by ID', async () => {
      const submitRes = await request(app3_1)
        .post('/api/flow/submit')
        .send({
          flow_id: 'test-flow',
          phone_number: '+91987654322',
          data: { full_name: 'User Two', email: 'user2@example.com' },
        });

      const submissionId = submitRes.body.data.id;

      const res = await request(app3_1).get(`/api/flow/submission/${submissionId}`);

      expect(res.status).to.equal(200);
      expect(res.body.data.id).to.equal(submissionId);
      expect(res.body.data.phone_number).to.equal('+91987654322');
    });

    it('Returns 404 for missing template vertical', async () => {
      const res = await request(app3_1).get('/api/flow/templates/NonExistent');

      expect(res.status).to.equal(404);
      expect(res.body.error.message).to.equal('No active template found for this vertical');
    });

    it('Returns 404 for missing submission', async () => {
      const res = await request(app3_1).get('/api/flow/submission/nonexistent-id');

      expect(res.status).to.equal(404);
      expect(res.body.error.message).to.equal('Submission not found');
    });

    it('Rejects submission with missing required fields', async () => {
      const res = await request(app3_1)
        .post('/api/flow/submit')
        .send({});

      expect(res.status).to.equal(400);
    });

    it('Rejects template with invalid status', async () => {
      const res = await request(app3_1)
        .post('/api/flow/templates')
        .send({ id: 'bad-status', name: 'Bad', vertical: 'Test', status: 'invalid' });

      expect(res.status).to.equal(400);
    });
  });

  describe('Step 2: Taxi booking flow via 3-3', () => {
    it('Returns service areas', async () => {
      const res = await request(app3_3).get('/api/taxi/service-areas');

      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
      expect(res.body.data.length).to.be.at.least(10);
      expect(res.body.meta.total_areas).to.be.at.least(10);
    });

    it('Creates taxi booking with valid data', async () => {
      const res = await request(app3_3)
        .post('/api/taxi/booking')
        .send({
          phone_number: '+91987654321',
          pickup_location: 'Madhapur',
          dropoff_location: 'Gachibowli',
          pickup_time: new Date(Date.now() + 86400000).toISOString(),
          contact_number: '+91987654321',
        });

      expect(res.status).to.equal(201);
      expect(res.body.data.id).to.exist;
      expect(res.body.data.status).to.equal('pending');
      expect(res.body.data.pickup_location).to.equal('Madhapur');
    });

    it('Gets booking by ID', async () => {
      const createRes = await request(app3_3)
        .post('/api/taxi/booking')
        .send({
          phone_number: '+91987654321',
          pickup_location: 'Jubilee Hills',
          dropoff_location: 'HITEC City',
          pickup_time: new Date(Date.now() + 86400000 * 2).toISOString(),
          contact_number: '+91987654321',
        });

      const bookingId = createRes.body.data.id;

      const res = await request(app3_3).get(`/api/taxi/booking/${bookingId}`);

      expect(res.status).to.equal(200);
      expect(res.body.data.id).to.equal(bookingId);
      expect(res.body.data.pickup_location).to.equal('Jubilee Hills');
    });

    it('Returns 404 for non-existent booking', async () => {
      const res = await request(app3_3).get('/api/taxi/booking/nonexistent-id');

      expect(res.status).to.equal(404);
      expect(res.body.error.message).to.equal('Booking not found');
    });

    it('Rejects booking with missing phone_number', async () => {
      const res = await request(app3_3)
        .post('/api/taxi/booking')
        .send({ pickup_location: 'Madhapur', dropoff_location: 'Gachibowli', pickup_time: new Date(Date.now() + 86400000).toISOString(), contact_number: '+91987654321' });

      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.equal('phone_number is required');
    });

    it('Rejects booking with out-of-service-area pickup', async () => {
      const res = await request(app3_3)
        .post('/api/taxi/booking')
        .send({
          phone_number: '+91987654321',
          pickup_location: 'Mumbai',
          dropoff_location: 'Gachibowli',
          pickup_time: new Date(Date.now() + 86400000).toISOString(),
          contact_number: '+91987654321',
        });

      expect(res.status).to.equal(400);
    });
  });

  describe('Step 3: Hotel availability and booking via 3-4', () => {
    const futureDate = () => {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      return d.toISOString().split('T')[0];
    };

    const dayAfter = (dateStr) => {
      const d = new Date(dateStr);
      d.setDate(d.getDate() + 3);
      return d.toISOString().split('T')[0];
    };

    it('Queries hotel availability with valid dates', async () => {
      const checkIn = futureDate();
      const checkOut = dayAfter(checkIn);

      const res = await request(app3_4)
        .post('/api/hotel/availability')
        .send({
          phone_number: '+91987654321',
          check_in_date: checkIn,
          check_out_date: checkOut,
          guest_count: 2,
        });

      expect(res.status).to.equal(200);
      expect(res.body.data.success).to.be.true;
      expect(res.body.data.request_id).to.exist;
      expect(res.body.data.availability.rooms).to.be.an('array');
      expect(res.body.data.availability.total_rooms).to.equal(4);
    });

    it('Submits booking request for available dates', async () => {
      const checkIn = futureDate();
      const checkOut = dayAfter(checkIn);

      const availRes = await request(app3_4)
        .post('/api/hotel/availability')
        .send({
          phone_number: '+91987654321',
          check_in_date: checkIn,
          check_out_date: checkOut,
          guest_count: 2,
        });

      const requestId = availRes.body.data.request_id;

      const res = await request(app3_4)
        .post('/api/hotel/booking')
        .send({ phone_number: '+91987654321', request_id: requestId });

      expect(res.status).to.equal(200);
      expect(res.body.data.success).to.be.true;
      expect(res.body.data.request_id).to.equal(requestId);
    });

    it('Gets booking status by ID', async () => {
      const checkIn = futureDate();
      const checkOut = dayAfter(checkIn);

      const availRes = await request(app3_4)
        .post('/api/hotel/availability')
        .send({
          phone_number: '+91987654322',
          check_in_date: checkIn,
          check_out_date: checkOut,
          guest_count: 1,
        });

      const requestId = availRes.body.data.request_id;

      const res = await request(app3_4).get(`/api/hotel/booking/${requestId}`);

      expect(res.status).to.equal(200);
      expect(res.body.data.request_id).to.equal(requestId);
      expect(res.body.data.phone_number).to.equal('+91987654322');
    });

    it('Returns 404 for non-existent booking', async () => {
      const res = await request(app3_4).get('/api/hotel/booking/nonexistent-id');

      expect(res.status).to.equal(404);
      expect(res.body.error.message).to.equal('Booking not found');
    });

    it('Returns 404 for non-existent request_id on booking', async () => {
      const res = await request(app3_4)
        .post('/api/hotel/booking')
        .send({ phone_number: '+91987654321', request_id: 'nonexistent' });

      expect(res.status).to.equal(404);
      expect(res.body.error.message).to.equal('Availability request not found');
    });

    it('Rejects availability query with missing phone_number', async () => {
      const res = await request(app3_4)
        .post('/api/hotel/availability')
        .send({ check_in_date: futureDate(), check_out_date: dayAfter(futureDate()), guest_count: 2 });

      expect(res.status).to.equal(400);
    });

    it('Rejects availability query with past check-in date', async () => {
      const res = await request(app3_4)
        .post('/api/hotel/availability')
        .send({
          phone_number: '+91987654321',
          check_in_date: '2020-01-01',
          check_out_date: '2020-01-03',
          guest_count: 2,
        });

      expect(res.status).to.equal(400);
    });

    it('Rejects hotel booking with missing request_id', async () => {
      const res = await request(app3_4)
        .post('/api/hotel/booking')
        .send({ phone_number: '+91987654321' });

      expect(res.status).to.equal(400);
    });
  });

  describe('Edge cases', () => {
    it('FlowValidator validates required fields', () => {
      const validator = new FlowValidator();
      const errors = validator.validateField({ name: 'test', type: 'text', label: 'Test', required: true }, undefined);

      expect(errors).to.be.an('array').with.length(1);
      expect(errors[0].code).to.equal('REQUIRED');
    });

    it('FlowTemplateService throws for invalid template', () => {
      const service = new FlowTemplateService();

      expect(() => service.registerTemplate(null)).to.throw();
      expect(() => service.registerTemplate({})).to.throw();
      expect(() => service.registerTemplate({ id: 'test' })).to.throw();
    });

    it('FlowSubmissionService throws for missing template', () => {
      const templateService = new FlowTemplateService();
      const validator = new FlowValidator();
      const submissionService = new FlowSubmissionService(templateService, validator);

      expect(() => submissionService.submitFlow('nonexistent', '+91987654321', {})).to.throw('Flow template not found');
    });

    it('ServiceAreaValidator validates locations', () => {
      const validator = new ServiceAreaValidator();

      const valid = validator.isWithinServiceArea('Madhapur');
      expect(valid.valid).to.be.true;

      const invalid = validator.isWithinServiceArea('Mumbai');
      expect(invalid.valid).to.be.false;

      const empty = validator.isWithinServiceArea(null);
      expect(empty.valid).to.be.false;
    });

    it('PMSAvailabilityService validates dates and caches results', () => {
      const pms = new PMSAvailabilityService();

      const withPastDate = pms.queryAvailability({ check_in_date: '2020-01-01', check_out_date: '2020-01-03', guest_count: 1 });
      expect(withPastDate.success).to.be.false;

      const withInvalidDate = pms.queryAvailability({ check_in_date: 'not-a-date', check_out_date: '2020-01-03', guest_count: 1 });
      expect(withInvalidDate.success).to.be.false;

      const withReversedDates = pms.queryAvailability({ check_in_date: '2026-06-10', check_out_date: '2026-06-05', guest_count: 1 });
      expect(withReversedDates.success).to.be.false;
    });

    it('HotelBookingService validates check-in and check-out dates', () => {
      const service = new HotelBookingService(new (require('../../src/3-4-hotel-availability-booking-confirmation').FlowTemplateService)(), new (require('../../src/3-4-hotel-availability-booking-confirmation').FlowValidator)(), new PMSAvailabilityService());

      const checkInErrors = service.validateCheckInDate('invalid-date');
      expect(checkInErrors).to.be.an('array').with.length(1);
      expect(checkInErrors[0].code).to.equal('INVALID_DATE');

      const checkOutErrors = service.validateCheckOutDate('2026-06-10', '2026-06-05');
      expect(checkOutErrors).to.be.an('array').with.length(1);
      expect(checkOutErrors[0].code).to.equal('CHECK_OUT_BEFORE_CHECK_IN');
    });
  });
});
