const { expect } = require('chai');
const request = require('supertest');
const { app, MarketplaceSourceDetector, PMSInventoryValidator, MarketplaceEnquiryService } = require('../src/1-5-marketplace-enquiry-routing');

describe('Marketplace Enquiry Routing Service', () => {
  describe('MarketplaceSourceDetector', () => {
    describe('detectAcquisitionSource', () => {
      it('should detect Airbnb from utm_source', () => {
        const result = MarketplaceSourceDetector.detectAcquisitionSource({ utm_source: 'airbnb' });
        expect(result).to.equal('Airbnb');
      });

      it('should detect Airbnb from referral_source', () => {
        const result = MarketplaceSourceDetector.detectAcquisitionSource({ referral_source: 'AIRBNB' });
        expect(result).to.equal('Airbnb');
      });

      it('should detect Booking.com from utm_source', () => {
        const result = MarketplaceSourceDetector.detectAcquisitionSource({ utm_source: 'booking' });
        expect(result).to.equal('Booking.com');
      });

      it('should detect Agoda from utm_source', () => {
        const result = MarketplaceSourceDetector.detectAcquisitionSource({ utm_source: 'agoda.com' });
        expect(result).to.equal('Agoda');
      });

      it('should detect Agoda from phone prefix', () => {
        const result = MarketplaceSourceDetector.detectAcquisitionSource({ From: '+913333123456' });
        expect(result).to.equal('Agoda');
      });

      it('should return Direct for unknown sources', () => {
        const result = MarketplaceSourceDetector.detectAcquisitionSource({ utm_source: 'unknown' });
        expect(result).to.equal('Direct');
      });

      it('should return Direct for empty object', () => {
        const result = MarketplaceSourceDetector.detectAcquisitionSource({});
        expect(result).to.equal('Direct');
      });

      it('should return Direct for null input', () => {
        const result = MarketplaceSourceDetector.detectAcquisitionSource(null);
        expect(result).to.equal('Direct');
      });

      it('should return Direct for undefined input', () => {
        const result = MarketplaceSourceDetector.detectAcquisitionSource(undefined);
        expect(result).to.equal('Direct');
      });

      it('should return Direct for array input', () => {
        const result = MarketplaceSourceDetector.detectAcquisitionSource([]);
        expect(result).to.equal('Direct');
      });

      it('should return Direct for numeric input', () => {
        const result = MarketplaceSourceDetector.detectAcquisitionSource(42);
        expect(result).to.equal('Direct');
      });

      it('should return Direct for string input', () => {
        const result = MarketplaceSourceDetector.detectAcquisitionSource('not-an-object');
        expect(result).to.equal('Direct');
      });

      it('should not crash on numeric utm_source', () => {
        const result = MarketplaceSourceDetector.detectAcquisitionSource({ utm_source: 123 });
        expect(result).to.equal('Direct');
      });

      it('should not crash on numeric referral_source', () => {
        const result = MarketplaceSourceDetector.detectAcquisitionSource({ referral_source: 456 });
        expect(result).to.equal('Direct');
      });

      it('should not crash on numeric From', () => {
        const result = MarketplaceSourceDetector.detectAcquisitionSource({ From: 789 });
        expect(result).to.equal('Direct');
      });
    });

    describe('validateAcquisitionChannel', () => {
      it('should validate Direct channel', () => {
        expect(MarketplaceSourceDetector.validateAcquisitionChannel('Direct')).to.be.true;
      });

      it('should validate Airbnb channel', () => {
        expect(MarketplaceSourceDetector.validateAcquisitionChannel('Airbnb')).to.be.true;
      });

      it('should validate Booking.com channel', () => {
        expect(MarketplaceSourceDetector.validateAcquisitionChannel('Booking.com')).to.be.true;
      });

      it('should validate Agoda channel', () => {
        expect(MarketplaceSourceDetector.validateAcquisitionChannel('Agoda')).to.be.true;
      });

      it('should reject invalid channel', () => {
        expect(MarketplaceSourceDetector.validateAcquisitionChannel('Invalid')).to.be.false;
      });
    });
  });

  describe('PMSInventoryValidator', () => {
    let validator;

    beforeEach(() => {
      validator = new PMSInventoryValidator();
    });

    describe('syncWithPMS', () => {
      it('should sync with PMS successfully', async () => {
        const result = await validator.syncWithPMS();
        expect(result).to.be.true;
        expect(validator.lastSyncTime).to.be.a('number');
      });

      it('should record sync delay', async () => {
        await validator.syncWithPMS();
        expect(validator.syncDelay).to.be.a('number');
        expect(validator.syncDelay).to.be.at.least(0);
      });
    });

    describe('compareWithMarketplaceData', () => {
      it('should return consistent for Airbnb', async () => {
        await validator.syncWithPMS();
        const result = validator.compareWithMarketplaceData('Airbnb');
        expect(result.consistent).to.be.true;
        expect(result.message).to.include('matches');
        expect(result.marketplaceData).to.be.an('object');
      });

      it('should return consistent for Booking.com', async () => {
        await validator.syncWithPMS();
        const result = validator.compareWithMarketplaceData('Booking.com');
        expect(result.consistent).to.be.true;
      });

      it('should return consistent for Agoda', async () => {
        await validator.syncWithPMS();
        const result = validator.compareWithMarketplaceData('Agoda');
        expect(result.consistent).to.be.true;
      });

      it('should return inconsistent for unknown marketplace', () => {
        const result = validator.compareWithMarketplaceData('Unknown');
        expect(result.consistent).to.be.false;
        expect(result.message).to.include('Unknown');
      });
    });

    describe('getSyncStatus', () => {
      it('should return checking status when no sync has occurred', () => {
        const freshValidator = new PMSInventoryValidator();
        const status = freshValidator.getSyncStatus();
        expect(status.status).to.equal('checking');
        expect(status.message).to.include('please wait');
      });

      it('should return current status after recent sync', async () => {
        await validator.syncWithPMS();
        const status = validator.getSyncStatus();
        expect(status.status).to.equal('current');
        expect(status.message).to.include('up to date');
      });

      it('should return stale status after threshold exceeded', async () => {
        // Manually set lastSyncTime far in the past
        validator.lastSyncTime = Date.now() - 31000;
        const status = validator.getSyncStatus();
        expect(status.status).to.equal('stale');
        expect(status.message).to.include('outdated');
      });

      it('should return current status at exactly the threshold boundary', async () => {
        validator.lastSyncTime = Date.now() - 30000;
        const status = validator.getSyncStatus();
        expect(status.status).to.equal('current');
      });
    });
  });

  describe('MarketplaceEnquiryService', () => {
    let service;

    beforeEach(() => {
      service = new MarketplaceEnquiryService();
      service.resetAnalytics();
    });

    describe('processMarketplaceEnquiry', () => {
      it('should process Direct enquiry', async () => {
        const enquiry = { From: '+919876543210', Message: 'I need a room' };
        const result = await service.processMarketplaceEnquiry(enquiry);
        expect(result.acquisition_channel).to.equal('Direct');
        expect(result.processed_at).to.be.a('string');
        expect(result.sync_status).to.be.an('object');
      });

      it('should process Airbnb enquiry', async () => {
        const enquiry = { From: '+919876543210', Message: 'I need a room', utm_source: 'airbnb' };
        const result = await service.processMarketplaceEnquiry(enquiry);
        expect(result.acquisition_channel).to.equal('Airbnb');
        expect(result.From).to.equal('+919876543210');
      });

      it('should log acquisition for analytics', async () => {
        const initialCount = service.getAcquisitionAnalytics().total;
        const enquiry = { From: '+919876543210', Message: 'Test' };
        await service.processMarketplaceEnquiry(enquiry);
        const finalCount = service.getAcquisitionAnalytics().total;
        expect(finalCount).to.equal(initialCount + 1);
      });

      it('should include SLA tracking info', async () => {
        const enquiry = { From: '+919876543210', Message: 'Test' };
        const result = await service.processMarketplaceEnquiry(enquiry);
        expect(result.sla_tracking).to.be.an('object');
        expect(result.sla_tracking).to.have.property('elapsed_ms');
        expect(result.sla_tracking).to.have.property('within_sla');
      });

      it('should include business_hours flag', async () => {
        const enquiry = { From: '+919876543210', Message: 'Test' };
        const result = await service.processMarketplaceEnquiry(enquiry);
        expect(result).to.have.property('business_hours');
      });
    });

    describe('validateDataConsistency', () => {
      it('should validate Airbnb data consistency', async () => {
        const result = await service.validateDataConsistency('Airbnb');
        expect(result.consistent).to.be.true;
      });

      it('should validate Booking.com data consistency', async () => {
        const result = await service.validateDataConsistency('Booking.com');
        expect(result.consistent).to.be.true;
      });
    });

    describe('getAcquisitionAnalytics', () => {
      it('should return analytics data', async () => {
        await service.processMarketplaceEnquiry({ From: '+911', Message: 'Test', utm_source: 'airbnb' });
        await service.processMarketplaceEnquiry({ From: '+912', Message: 'Test', utm_source: 'booking' });
        const analytics = service.getAcquisitionAnalytics();
        expect(analytics.total).to.equal(2);
        expect(analytics.byChannel.Airbnb).to.equal(1);
        expect(analytics.byChannel['Booking.com']).to.equal(1);
      });

      it('should include recent logs', async () => {
        await service.processMarketplaceEnquiry({ From: '+911', Message: 'Test' });
        const analytics = service.getAcquisitionAnalytics();
        expect(analytics.recentLogs).to.be.an('array');
        expect(analytics.recentLogs.length).to.be.at.least(1);
      });

      it('should return a copy of byChannel to prevent external mutation', async () => {
        const analytics = service.getAcquisitionAnalytics();
        analytics.byChannel.Direct = 999;
        const analyticsAgain = service.getAcquisitionAnalytics();
        expect(analyticsAgain.byChannel.Direct).to.equal(0);
      });
    });

    describe('resetAnalytics', () => {
      it('should reset all analytics counters', async () => {
        await service.processMarketplaceEnquiry({ From: '+911', Message: 'Test' });
        service.resetAnalytics();
        const analytics = service.getAcquisitionAnalytics();
        expect(analytics.total).to.equal(0);
        expect(analytics.logs.length).to.equal(0);
      });
    });
  });

  describe('API Endpoints', () => {
    // Reset service analytics before API endpoint tests
    const service = new MarketplaceEnquiryService();
    service.resetAnalytics();

    describe('POST /api/enquiry/marketplace', () => {
      it('should process marketplace enquiry successfully', async () => {
        const response = await request(app)
          .post('/api/enquiry/marketplace')
          .send({
            From: '+919876543210',
            Message: 'I need a bike rental',
            utm_source: 'airbnb'
          })
          .expect(200);

        expect(response.body).to.have.property('data');
        expect(response.body.data).to.have.property('acquisition_channel', 'Airbnb');
        expect(response.body).to.have.property('meta');
        expect(response.body.meta.processed).to.be.true;
      });

      it('should return 400 for missing From field', async () => {
        const response = await request(app)
          .post('/api/enquiry/marketplace')
          .send({ Message: 'Test' })
          .expect(400);

        expect(response.body).to.have.property('error');
        expect(response.body.error.code).to.equal(400);
        expect(response.body.error.message).to.include('From');
      });

      it('should return 400 for missing Message field', async () => {
        const response = await request(app)
          .post('/api/enquiry/marketplace')
          .send({ From: '+919876543210' })
          .expect(400);

        expect(response.body).to.have.property('error');
        expect(response.body.error.code).to.equal(400);
        expect(response.body.error.message).to.include('Message');
      });

      it('should tag Direct enquiries correctly', async () => {
        const response = await request(app)
          .post('/api/enquiry/marketplace')
          .send({
            From: '+919876543210',
            Message: 'Direct enquiry'
          })
          .expect(200);

        expect(response.body.data.acquisition_channel).to.equal('Direct');
      });
    });

    describe('GET /api/marketplace/validate/:channel', () => {
      it('should validate Airbnb data consistency', async () => {
        const response = await request(app)
          .get('/api/marketplace/validate/Airbnb')
          .expect(200);

        expect(response.body.data.channel).to.equal('Airbnb');
        expect(response.body.data).to.have.property('consistent');
        expect(response.body.data).to.have.property('sync_status');
      });

      it('should validate Booking.com data consistency', async () => {
        const response = await request(app)
          .get('/api/marketplace/validate/Booking.com')
          .expect(200);

        expect(response.body.data.channel).to.equal('Booking.com');
        expect(response.body.data.consistent).to.be.true;
      });

      it('should return 400 for Direct channel', async () => {
        const response = await request(app)
          .get('/api/marketplace/validate/Direct')
          .expect(400);

        expect(response.body.error).to.have.property('message');
      });

      it('should return 400 for invalid channel', async () => {
        const response = await request(app)
          .get('/api/marketplace/validate/Invalid')
          .expect(400);

        expect(response.body.error).to.have.property('message');
        expect(response.body.error.code).to.equal(400);
      });

      it('should handle case-insensitive channel names', async () => {
        const response = await request(app)
          .get('/api/marketplace/validate/airbnb')
          .expect(200);

        expect(response.body.data.channel).to.equal('Airbnb');
      });
    });

    describe('GET /api/analytics/acquisition', () => {
      it('should return acquisition analytics', async () => {
        const response = await request(app)
          .get('/api/analytics/acquisition')
          .expect(200);

        expect(response.body).to.have.property('data');
        expect(response.body.data).to.have.property('total');
        expect(response.body.data).to.have.property('byChannel');
        expect(response.body.data).to.have.property('recentLogs');
        expect(response.body).to.have.property('meta');
      });

      it('should include all acquisition channels', async () => {
        const response = await request(app)
          .get('/api/analytics/acquisition')
          .expect(200);

        expect(response.body.meta.channels).to.include('Direct');
        expect(response.body.meta.channels).to.include('Airbnb');
        expect(response.body.meta.channels).to.include('Booking.com');
        expect(response.body.meta.channels).to.include('Agoda');
      });
    });

    describe('GET /api/marketplace/channels', () => {
      it('should return available acquisition channels', async () => {
        const response = await request(app)
          .get('/api/marketplace/channels')
          .expect(200);

        expect(response.body.data.channels).to.be.an('array');
        expect(response.body.data.channels).to.include('Direct');
        expect(response.body.data.channels).to.include('Airbnb');
        expect(response.body.data).to.have.property('patterns');
      });

      it('should not expose internal pattern details', async () => {
        const response = await request(app)
          .get('/api/marketplace/channels')
          .expect(200);

        // Patterns should indicate existence, not leak actual values
        const airbnbPattern = response.body.data.patterns['Airbnb'];
        expect(airbnbPattern).to.deep.equal({ utmSource: true, referralPrefix: true, phonePrefix: true });
      });
    });

    describe('GET /api/health', () => {
      it('should return health status', async () => {
        const response = await request(app)
          .get('/api/health')
          .expect(200);

        expect(response.body).to.have.property('status', 'healthy');
        expect(response.body).to.have.property('service', 'marketplace-enquiry-routing');
        expect(response.body).to.have.property('endpoints');
        expect(response.body).to.have.property('acquisition_channels');
      });

      it('should list all endpoints', async () => {
        const response = await request(app)
          .get('/api/health')
          .expect(200);

        const endpoints = response.body.endpoints;
        expect(endpoints).to.include('POST /api/enquiry/marketplace');
        expect(endpoints).to.include('GET /api/marketplace/validate/:channel');
        expect(endpoints).to.include('GET /api/analytics/acquisition');
        expect(endpoints).to.include('GET /api/health');
      });

      it('should return uptime as ms since start', async () => {
        const response = await request(app)
          .get('/api/health')
          .expect(200);

        expect(response.body).to.have.property('uptime_ms');
        expect(response.body.uptime_ms).to.be.a('number');
        expect(response.body.uptime_ms).to.be.at.least(0);
      });
    });
  });

  describe('Acceptance Criteria', () => {
    it('AC #1: Marketplace enquiries follow same workflow as direct enquiries', async () => {
      const directResponse = await request(app)
        .post('/api/enquiry/marketplace')
        .send({ From: '+911', Message: 'Direct enquiry' });

      const airbnbResponse = await request(app)
        .post('/api/enquiry/marketplace')
        .send({ From: '+912', Message: 'Airbnb enquiry', utm_source: 'airbnb' });

      // Both should have same response structure
      expect(directResponse.body).to.have.property('data');
      expect(directResponse.body).to.have.property('meta');
      expect(airbnbResponse.body).to.have.property('data');
      expect(airbnbResponse.body).to.have.property('meta');

      // Both should be processed
      expect(directResponse.body.meta.processed).to.be.true;
      expect(airbnbResponse.body.meta.processed).to.be.true;

      // Both should have SLA tracking
      expect(directResponse.body.data).to.have.property('sla_tracking');
      expect(airbnbResponse.body.data).to.have.property('sla_tracking');

      // Both should have classification info
      expect(directResponse.body.data).to.have.property('classification');
      expect(airbnbResponse.body.data).to.have.property('classification');
    });

    it('AC #2: Availability matches marketplace listing', async () => {
      const response = await request(app)
        .get('/api/marketplace/validate/Airbnb')
        .expect(200);

      expect(response.body.data.consistent).to.be.true;
      expect(response.body.data.message).to.include('matches');
    });

    it('AC #3: System identifies acquisition source for analytics', async () => {
      await request(app)
        .post('/api/enquiry/marketplace')
        .send({ From: '+911', Message: 'Test', utm_source: 'booking' });

      const analyticsResponse = await request(app)
        .get('/api/analytics/acquisition')
        .expect(200);

      expect(analyticsResponse.body.data.byChannel['Booking.com']).to.be.at.least(1);
    });
  });
});
