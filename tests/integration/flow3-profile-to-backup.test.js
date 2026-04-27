require('../helpers/setup');
const { expect } = require('chai');
const request = require('supertest');
const sinon = require('sinon');
const { app: app2_1, CustomerProfileService } = require('../../src/2-1-user-recognition-profile-retrieval');
const { app: app2_2, ConversationHistoryService } = require('../../src/2-2-conversation-history-persistence');
const { app: app2_3, RecommendationEngine } = require('../../src/2-3-context-aware-booking-recommendations');
const { app: app5_1, SupabaseConversationStorage } = require('../../src/5-1-supabase-conversation-storage');
const { app: app5_3, BackupManager, BackupStorage } = require('../../src/5-3-backup-recovery-system');
const { customerProfile, conversationMessage } = require('../helpers/fixtures');

describe('Flow 3: Customer Profile → Recommendations → Conversation History → Backup', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Step 1: Customer profile creation and retrieval via 2-1', () => {
    it('Creates customer profile via HTTP', async () => {
      const res = await request(app2_1)
        .post('/api/customer/profile')
        .send(customerProfile());

      expect(res.status).to.equal(201);
      expect(res.body.data.id).to.exist;
      expect(res.body.data.phone_number).to.equal('+91987654321');
    });

    it('Retrieves customer profile by phone', async () => {
      await request(app2_1)
        .post('/api/customer/profile')
        .send(customerProfile({ phone_number: '+91987654399' }));

      const res = await request(app2_1)
        .get('/api/customer/profile/+91987654399');

      expect(res.status).to.equal(200);
      expect(res.body.data.phone_number).to.equal('+91987654399');
    });

    it('Returns 404 for non-existent customer', async () => {
      const res = await request(app2_1)
        .get('/api/customer/profile/+919999999999');

      expect(res.status).to.equal(404);
    });

    it('Rejects duplicate phone number', async () => {
      await request(app2_1)
        .post('/api/customer/profile')
        .send(customerProfile({ phone_number: '+91987654398' }));

      const res = await request(app2_1)
        .post('/api/customer/profile')
        .send(customerProfile({ phone_number: '+91987654398' }));

      expect(res.status).to.equal(409);
    });
  });

  describe('Step 2: Conversation history persistence via 2-2', () => {
    it('Stores message via HTTP', async () => {
      const res = await request(app2_2)
        .post('/api/conversation/message')
        .send(conversationMessage());

      expect(res.status).to.equal(201);
      expect(res.body.data.id).to.exist;
    });

    it('Retrieves history for phone number', async () => {
      await request(app2_2)
        .post('/api/conversation/message')
        .send(conversationMessage({ phone_number: '+91987654321', content: 'Test message' }));

      const res = await request(app2_2)
        .get('/api/conversation/history/+91987654321');

      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
    });

    it('Returns empty array for phone with no history', async () => {
      const res = await request(app2_2)
        .get('/api/conversation/history/+91987654999');

      expect(res.status).to.equal(200);
      expect(res.body.data).to.deep.equal([]);
    });
  });

  describe('Step 3: Recommendations generation via 2-3', () => {
    it('Generates recommendations for customer with booking history', () => {
      const profileService = new CustomerProfileService();
      const engine = new RecommendationEngine(profileService);
      profileService.create(customerProfile());

      const recs = engine.getRecommendations('+91987654321');

      expect(recs.is_new_customer).to.be.false;
      expect(recs.preferences).to.be.an('array');
    });

    it('Returns new customer flag for unknown phone', () => {
      const profileService = new CustomerProfileService();
      const engine = new RecommendationEngine(profileService);

      const recs = engine.getRecommendations('+91987654999');
      expect(recs.is_new_customer).to.be.true;
      expect(recs.contextual_message).to.be.null;
    });

    it('Returns bike rental preference for Hero repeat booker', () => {
      const profileService = new CustomerProfileService();
      const engine = new RecommendationEngine(profileService);
      profileService.create(customerProfile());

      const recs = engine.getRecommendations('+91987654321');

      const bikePref = recs.preferences.find(p => p.vertical === 'Bike Rental');
      expect(bikePref).to.exist;
      expect(bikePref.value).to.equal('Hero');
      expect(bikePref.confidence).to.be.at.least(0.5);
    });
  });

  describe('Step 4: Supabase conversation storage via 5-1', () => {
    it('Stores message via HTTP with mocked Supabase', async () => {
      sandbox.stub(SupabaseConversationStorage.prototype, 'insertMessage')
        .resolves({ id: 'msg-test-1', phone_number: '+91987654321', message: 'Test', created_at: new Date().toISOString() });

      const res = await request(app5_1)
        .post('/api/conversations')
        .send({ phone_number: '+91987654321', message: 'Test booking message' });

      expect(res.status).to.equal(201);
      expect(res.body.data.id).to.equal('msg-test-1');
    });

    it('Rejects messages without phone_number', async () => {
      const res = await request(app5_1)
        .post('/api/conversations')
        .send({ message: 'Missing phone' });

      expect(res.status).to.equal(400);
    });
  });

  describe('Step 5: Backup and recovery via 5-3', () => {
    it('BackupManager creates backup with correct metadata', async () => {
      const storage = new BackupStorage();
      const manager = new BackupManager(storage);

      const result = await manager.executeBackup();

      expect(result.backup.backupId).to.exist;
      expect(result.backup.status).to.equal('completed');

      const backups = await storage.listBackups();
      expect(backups.length).to.be.at.least(1);
    });

    it('Restores from backup by ID', async () => {
      const storage = new BackupStorage();
      const manager = new BackupManager(storage);

      const result = await manager.executeBackup();
      const backupId = result.backup.backupId;

      const status = await manager.getBackupStatus(backupId);
      expect(status.status).to.equal('completed');

      const restoreResult = await manager.restoreFromBackup(backupId);
      expect(restoreResult.status).to.equal('completed');
    });

    it('Dry-run restore validates without applying', async () => {
      const storage = new BackupStorage();
      const manager = new BackupManager(storage);

      const result = await manager.executeBackup();
      const dryResult = await manager.dryRunRestore(result.backup.backupId);

      expect(dryResult.integrityValid).to.be.true;
    });

    it('Throws when restoring unknown backup', async () => {
      const storage = new BackupStorage();
      const manager = new BackupManager(storage);

      try {
        await manager.restoreFromBackup('nonexistent-backup-id');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.message).to.include('not found');
      }
    });
  });

  describe('Edge cases', () => {
    it('Rejects profile with missing phone_number', async () => {
      const res = await request(require('../../src/2-1-user-recognition-profile-retrieval').app)
        .post('/api/customer/profile')
        .send({});

      expect(res.status).to.equal(400);
    });

    it('Returns empty recommendations for profile with no bookings', async () => {
      const { CustomerProfileService } = require('../../src/2-1-user-recognition-profile-retrieval');
      const { RecommendationEngine } = require('../../src/2-3-context-aware-booking-recommendations');
      const profileService = new CustomerProfileService();
      const engine = new RecommendationEngine(profileService);
      profileService.create({ phone_number: '+91987654000', profile_data: { bookings: {}, preferences: {} } });

      const recs = engine.getRecommendations('+91987654000');

      expect(recs.is_new_customer).to.be.true;
      expect(recs.preferences).to.be.an('array').that.is.empty;
    });
  });
});
