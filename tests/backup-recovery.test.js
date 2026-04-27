process.env.MOCHA_TEST_MODE = 'true';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_KEY = 'test-key';
process.env.BACKUP_STORAGE_PATH = './test-backups';
process.env.BACKUP_INTERVAL_HOURS = '24';
process.env.BACKUP_RETENTION_DAYS = '30';
process.env.BACKUP_MAX_STORAGE_MB = '1024';

const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');

const {
  app,
  BackupManager,
  BackupStorage,
  BackupMonitor,
  backupManager,
  storage,
} = require('../src/5-3-backup-recovery-system');

// ---------------------------------------------------------------------------
// Helper: create in-memory storage adapter
// ---------------------------------------------------------------------------
function createMemoryAdapter(initialData = []) {
  const store = [...initialData];
  return {
    getAll: async () => [...store],
    upsert: async (data) => {
      const idx = store.findIndex(r => r.id === data.id);
      if (idx >= 0) {
        store[idx] = data;
      } else {
        store.push(data);
      }
    },
    deleteAll: async () => {
      store.length = 0;
    },
    getData: () => store,
  };
}

// ---------------------------------------------------------------------------
// Create test adapters with sample data
// ---------------------------------------------------------------------------
function createTestAdapters() {
  return {
    conversations: createMemoryAdapter([
      { id: 'c1', phone_number: '+911111111111', message: 'Hello', direction: 'incoming', timestamp: '2026-04-23T10:00:00Z' },
      { id: 'c2', phone_number: '+912222222222', message: 'Want to rent a bike', direction: 'incoming', timestamp: '2026-04-23T11:00:00Z' },
    ]),
    customers: createMemoryAdapter([
      { id: 'cust1', phone_number: '+911111111111', profile_data: { bookings: { bike_rental: [] } } },
    ]),
    sync_tracking: createMemoryAdapter([
      { id: 's1', source_system: 'supabase', target_system: 'erpnext', status: 'completed' },
    ]),
    external_references: createMemoryAdapter([
      { id: 'ref1', supabase_entity_id: 'cust1', target_system: 'erpnext', target_entity_id: '456' },
    ]),
  };
}

// Register adapters on the module-level singleton for API tests
before(() => {
  const adapters = createTestAdapters();
  Object.entries(adapters).forEach(([name, adapter]) => {
    storage.registerAdapter(name, adapter);
  });
});

// ---------------------------------------------------------------------------
// BackupStorage
// ---------------------------------------------------------------------------
describe('BackupStorage', () => {
  let testStorage;

  beforeEach(() => {
    testStorage = new BackupStorage({});
  });

  describe('writeBackup / readBackup', () => {
    it('should write and read a backup record', async () => {
      const manifest = {
        version: 1,
        type: 'full',
        createdAt: new Date().toISOString(),
        status: 'completed',
      };
      const tableData = { conversations: [{ id: '1', message: 'test' }] };

      await testStorage.writeBackup('bkp-1', manifest, tableData);

      const record = await testStorage.readBackup('bkp-1');
      expect(record).to.not.be.null;
      expect(record.backupId).to.equal('bkp-1');
      expect(record.version).to.equal(1);
      expect(record.data).to.deep.equal(tableData);
    });

    it('should return null for unknown backup', async () => {
      const record = await testStorage.readBackup('nonexistent');
      expect(record).to.be.null;
    });
  });

  describe('listBackups', () => {
    it('should return backups sorted newest first', async () => {
      await testStorage.writeBackup('bkp-old', { version: 1, createdAt: '2026-04-01T00:00:00Z', type: 'full', status: 'completed' }, {});
      await testStorage.writeBackup('bkp-new', { version: 1, createdAt: '2026-04-24T00:00:00Z', type: 'full', status: 'completed' }, {});

      const list = await testStorage.listBackups();
      expect(list).to.have.length(2);
      expect(list[0].backupId).to.equal('bkp-new');
      expect(list[1].backupId).to.equal('bkp-old');
    });

    it('should exclude data from listed records', async () => {
      await testStorage.writeBackup('bkp-1', { version: 1, createdAt: new Date().toISOString(), type: 'full', status: 'completed' }, { conversations: [] });
      const list = await testStorage.listBackups();
      expect(list[0]).to.not.have.property('data');
    });

    it('should return empty array when no backups exist', async () => {
      const list = await testStorage.listBackups();
      expect(list).to.deep.equal([]);
    });
  });

  describe('deleteBackup', () => {
    it('should delete a specific backup', async () => {
      await testStorage.writeBackup('bkp-1', { version: 1, createdAt: '2026-04-24T00:00:00Z', type: 'full', status: 'completed' }, {});
      await testStorage.deleteBackup('bkp-1');
      const record = await testStorage.readBackup('bkp-1');
      expect(record).to.be.null;
    });

    it('should not error when deleting nonexistent backup', async () => {
      await testStorage.deleteBackup('nonexistent');
    });
  });

  describe('enforceRetention', () => {
    it('should delete backups older than retention days', async () => {
      await testStorage.writeBackup('bkp-old', { version: 1, createdAt: '2026-03-01T00:00:00Z', type: 'full', status: 'completed' }, {});
      await testStorage.writeBackup('bkp-current', { version: 1, createdAt: '2026-04-23T00:00:00Z', type: 'full', status: 'completed' }, {});

      const deleted = await testStorage.enforceRetention(30);
      expect(deleted).to.include('bkp-old');
      expect(deleted).to.not.include('bkp-current');
    });

    it('should not delete backups within retention period', async () => {
      await testStorage.writeBackup('bkp-1', { version: 1, createdAt: '2026-04-23T00:00:00Z', type: 'full', status: 'completed' }, {});
      const deleted = await testStorage.enforceRetention(30);
      expect(deleted).to.deep.equal([]);
    });
  });

  describe('getStorageUsage', () => {
    it('should return storage usage summary', async () => {
      await testStorage.writeBackup('bkp-1', { version: 1, createdAt: '2026-04-23T00:00:00Z', type: 'full', status: 'completed', sizeBytes: 1000 }, {});
      await testStorage.writeBackup('bkp-2', { version: 1, createdAt: '2026-04-24T00:00:00Z', type: 'full', status: 'completed', sizeBytes: 2000 }, {});

      const usage = await testStorage.getStorageUsage();
      expect(usage.totalBackups).to.equal(2);
      expect(usage.totalSizeBytes).to.equal(3000);
      expect(usage.oldestTimestamp).to.equal('2026-04-23T00:00:00.000Z');
      expect(usage.newestTimestamp).to.equal('2026-04-24T00:00:00.000Z');
    });

    it('should return zeros when no backups', async () => {
      const usage = await testStorage.getStorageUsage();
      expect(usage.totalBackups).to.equal(0);
      expect(usage.totalSizeBytes).to.equal(0);
      expect(usage.oldestTimestamp).to.be.null;
    });
  });

  describe('change log (PITR)', () => {
    it('should record mutations', () => {
      testStorage.recordMutation('conversations', 'INSERT', { id: 'm1', message: 'test' });
      const log = testStorage.getChangeLog();
      expect(log).to.have.length(1);
      expect(log[0].table).to.equal('conversations');
      expect(log[0].operation).to.equal('INSERT');
      expect(log[0].data.id).to.equal('m1');
    });

    it('should generate checksum for each log entry', () => {
      testStorage.recordMutation('customers', 'UPSERT', { id: 'c1' });
      const log = testStorage.getChangeLog();
      expect(log[0]).to.have.property('checksum');
      expect(log[0].checksum).to.have.length(64); // sha256 hex
    });

    it('should filter entries since a given timestamp', () => {
      testStorage.recordMutation('conversations', 'INSERT', { id: 'm1' });
      testStorage.recordMutation('conversations', 'INSERT', { id: 'm2' });

      const since = new Date(Date.now() + 1000).toISOString();
      const later = testStorage.getChangeLogSince(since);
      expect(later).to.have.length(0);
    });

    it('should clear all entries', () => {
      testStorage.recordMutation('conversations', 'INSERT', { id: 'm1' });
      testStorage.clearChangeLog();
      expect(testStorage.getChangeLog()).to.have.length(0);
    });
  });
});

// ---------------------------------------------------------------------------
// BackupManager
// ---------------------------------------------------------------------------
describe('BackupManager', () => {
  let manager;
  let testStorage;
  let adapters;

  beforeEach(() => {
    adapters = createTestAdapters();
    testStorage = new BackupStorage(adapters);
    manager = new BackupManager(testStorage, {
      tables: ['conversations', 'customers', 'sync_tracking', 'external_references'],
      backupIntervalMs: 24 * 60 * 60 * 1000,
    });
  });

  afterEach(() => {
    if (manager._scheduleTimer) {
      clearInterval(manager._scheduleTimer);
      manager._scheduleTimer = null;
    }
    sinon.restore();
  });

  describe('executeBackup', () => {
    it('should create a completed backup with metadata', async () => {
      const result = await manager.executeBackup();
      expect(result.backup.status).to.equal('completed');
      expect(result.backup.backupId).to.match(/^bkp-/);
      expect(result.backup.type).to.equal('full');
      expect(result.backup.version).to.equal(1);
      expect(result.backup.checksumSha256).to.have.length(64);
      expect(result.backup.sizeBytes).to.be.a('number').and.at.least(0);
      expect(result.backup.durationMs).to.be.a('number').and.at.least(0);
    });

    it('should include all tracked tables with row counts', async () => {
      const result = await manager.executeBackup();
      const tables = result.backup.tables;
      expect(tables).to.have.all.keys(['conversations', 'customers', 'sync_tracking', 'external_references']);
      expect(tables.conversations.rowCount).to.equal(2);
      expect(tables.customers.rowCount).to.equal(1);
      expect(tables.sync_tracking.rowCount).to.equal(1);
      expect(tables.external_references.rowCount).to.equal(1);
    });

    it('should generate unique backup IDs for each backup', async () => {
      const r1 = await manager.executeBackup();
      const r2 = await manager.executeBackup();
      expect(r1.backup.backupId).to.not.equal(r2.backup.backupId);
    });

    it('should reject concurrent backup operations', async () => {
      manager._running = true;
      try {
        await manager.executeBackup();
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.message).to.include('already in progress');
      }
    });

    it('should handle empty tables gracefully', async () => {
      const emptyAdapters = {
        conversations: createMemoryAdapter([]),
        customers: createMemoryAdapter([]),
        sync_tracking: createMemoryAdapter([]),
        external_references: createMemoryAdapter([]),
      };
      const emptyStorage = new BackupStorage(emptyAdapters);
      const emptyManager = new BackupManager(emptyStorage);

      const result = await emptyManager.executeBackup();
      expect(result.backup.status).to.equal('completed');
      expect(result.backup.tables.conversations.rowCount).to.equal(0);
    });

    it('should skip untracked tables gracefully', async () => {
      const partialAdapters = {
        conversations: createMemoryAdapter([{ id: 'c1' }]),
      };
      const partialStorage = new BackupStorage(partialAdapters);
      const partialManager = new BackupManager(partialStorage);
      const result = await partialManager.executeBackup();
      expect(result.backup.status).to.equal('completed');
    });
  });

  describe('backup integrity verification', () => {
    it('should store correct SHA-256 checksum', async () => {
      const result = await manager.executeBackup();
      const status = await manager.getBackupStatus(result.backup.backupId);
      expect(status).to.not.be.null;
      expect(status.checksumSha256).to.equal(result.backup.checksumSha256);
    });

    it('should detect checksum mismatch via dry-run', async () => {
      const result = await manager.executeBackup();
      const record = await testStorage.readBackup(result.backup.backupId);

      // Tamper with the data
      record.data.conversations.push({ id: 'tampered', message: 'HAXXOR' });

      const dryRun = await manager.dryRunRestore(result.backup.backupId);
      expect(dryRun.integrityValid).to.be.false;
      expect(dryRun.integrityError).to.include('Checksum mismatch');
    });
  });

  describe('scheduleBackup', () => {
    it('should set an interval timer', () => {
      const timer = manager.scheduleBackup();
      expect(timer).to.not.be.null;
      expect(manager._scheduleTimer).to.equal(timer);
      clearInterval(timer);
      manager._scheduleTimer = null;
    });

    it('should replace existing timer on re-schedule', () => {
      const t1 = manager.scheduleBackup();
      const t2 = manager.scheduleBackup();
      expect(t1).to.not.equal(t2);
      clearInterval(t2);
      manager._scheduleTimer = null;
    });

    it('stopSchedule should clear the timer', () => {
      manager.scheduleBackup();
      expect(manager._scheduleTimer).to.not.be.null;
      manager.stopSchedule();
      expect(manager._scheduleTimer).to.be.null;
    });

    it('should call executeBackup when interval fires', (done) => {
      const spy = sinon.spy(manager, 'executeBackup');
      // Use a very short interval
      manager._scheduleTimer = setInterval(() => {
        manager.executeBackup().catch(() => {});
      }, 50);

      const settleTimer = setTimeout(() => {
        clearInterval(manager._scheduleTimer);
        manager._scheduleTimer = null;
        expect(spy.called).to.be.true;
        spy.restore();
        // Let any in-flight async operations settle before calling done
        setImmediate(() => done());
      }, 120);
    });
  });

  describe('getAvailableBackups / getBackupStatus', () => {
    it('should list all backups', async () => {
      await manager.executeBackup();
      await manager.executeBackup();
      const list = await manager.getAvailableBackups();
      expect(list).to.have.length(2);
    });

    it('should return empty list when no backups', async () => {
      const list = await manager.getAvailableBackups();
      expect(list).to.deep.equal([]);
    });

    it('should return status for a specific backup', async () => {
      const result = await manager.executeBackup();
      const status = await manager.getBackupStatus(result.backup.backupId);
      expect(status).to.not.be.null;
      expect(status.backupId).to.equal(result.backup.backupId);
      expect(status.status).to.equal('completed');
      expect(status).to.not.have.property('data');
    });

    it('should return null for unknown backup', async () => {
      const status = await manager.getBackupStatus('nonexistent');
      expect(status).to.be.null;
    });
  });

  describe('restoreFromBackup', () => {
    it('should restore data from a completed backup', async () => {
      const result = await manager.executeBackup();

      // Clear adapters to simulate data loss, then restore
      const restoreAdapters = createTestAdapters();
      // Clear the data
      Object.values(restoreAdapters).forEach(a => a.deleteAll());

      const restoreStorage = new BackupStorage(restoreAdapters);
      const restoreManager = new BackupManager(restoreStorage);

      // Copy the backup from original storage
      const record = await testStorage.readBackup(result.backup.backupId);
      await restoreStorage.writeBackup(result.backup.backupId, record, record.data);

      const restoreResult = await restoreManager.restoreFromBackup(result.backup.backupId);
      expect(restoreResult.status).to.equal('completed');
      expect(restoreResult.tables.conversations.restored).to.equal(2);
      expect(restoreResult.tables.customers.restored).to.equal(1);

      // Verify data was actually restored
      const convAdapter = restoreAdapters.conversations;
      const restoredData = convAdapter.getData();
      expect(restoredData).to.have.length(2);
    });

    it('should reject restore from non-existent backup', async () => {
      try {
        await manager.restoreFromBackup('nonexistent');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.message).to.include('not found');
      }
    });

    it('should reject restore from failed backup', async () => {
      const failedStorage = new BackupStorage({});
      await failedStorage.writeBackup('bkp-fail', {
        backupId: 'bkp-fail', version: 1, type: 'full', status: 'failed', createdAt: new Date().toISOString(),
      }, {});
      const failedManager = new BackupManager(failedStorage);

      try {
        await failedManager.restoreFromBackup('bkp-fail');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.message).to.include('cannot restore');
      }
    });

    it('should restore tables in correct order: customers first, then external_refs, conversations, sync_tracking', async () => {
      const result = await manager.executeBackup();
      const restoreResult = await manager.restoreFromBackup(result.backup.backupId);
      expect(restoreResult.tables).to.have.all.keys(['customers', 'external_references', 'conversations', 'sync_tracking']);
    });
  });

  describe('pointInTimeRecovery', () => {
    it('should replay change log entries up to the target timestamp', async () => {
      // Fully self-contained test — no dependency on beforeEach state
      const adapters = createTestAdapters();
      const storage = new BackupStorage(adapters);
      const manager = new BackupManager(storage);

      // Create a backup with known data
      const result = await manager.executeBackup();
      expect(result.backup.status).to.equal('completed');

      // Add mutations after backup
      manager.recordMutation('conversations', 'INSERT', { id: 'c3', message: 'Post-backup' });
      manager.recordMutation('conversations', 'INSERT', { id: 'c4', message: 'Another post-backup' });
      expect(storage.getChangeLog()).to.have.length(2);

      // Target timestamp after mutations
      const targetTimestamp = new Date(Date.now() + 5000).toISOString();

      const pitrResult = await manager.pointInTimeRecovery(targetTimestamp);
      expect(pitrResult.status).to.equal('completed');
      expect(pitrResult.replayedEntries).to.equal(2);
      expect(pitrResult.backupId).to.equal(result.backup.backupId);

      // Verify data was restored (2 original + 2 replayed)
      const convAdapter = adapters.conversations;
      expect(convAdapter.getData()).to.have.length(4);

      // Stop schedule if active
      manager.stopSchedule();
    });

    it('should validate target timestamp', async () => {
      try {
        await manager.pointInTimeRecovery('not-a-date');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.message).to.include('Invalid');
      }
    });

    it('should fail when no backup exists before target', async () => {
      try {
        await manager.pointInTimeRecovery('2025-01-01T00:00:00Z');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.message).to.include('No full backup found');
      }
    });
  });

  describe('dryRunRestore', () => {
    it('should validate a valid backup', async () => {
      const result = await manager.executeBackup();
      const dryRun = await manager.dryRunRestore(result.backup.backupId);
      expect(dryRun.integrityValid).to.be.true;
      expect(dryRun.canRestore).to.be.true;
    });

    it('should report error for non-existent backup', async () => {
      try {
        await manager.dryRunRestore('nonexistent');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.message).to.include('not found');
      }
    });

    it('should report table-level restore capability', async () => {
      const result = await manager.executeBackup();
      const dryRun = await manager.dryRunRestore(result.backup.backupId);
      expect(dryRun.tables.conversations).to.not.be.undefined;
      expect(dryRun.tables.conversations.rowCount).to.equal(2);
    });
  });

  describe('recovery operations tracking', () => {
    it('should track a successful recovery operation', async () => {
      const result = await manager.executeBackup();
      const restoreResult = await manager.restoreFromBackup(result.backup.backupId);
      const ops = manager.getRecoveryOperations();
      expect(ops).to.have.length(1);
      expect(ops[0].id).to.equal(restoreResult.recoveryId);
      expect(ops[0].status).to.equal('completed');
    });

    it('should return specific recovery operation by id', async () => {
      const result = await manager.executeBackup();
      const restoreResult = await manager.restoreFromBackup(result.backup.backupId);
      const op = manager.getRecoveryOperation(restoreResult.recoveryId);
      expect(op).to.not.be.null;
      expect(op.status).to.equal('completed');
    });

    it('should return null for unknown recovery operation', () => {
      const op = manager.getRecoveryOperation('nonexistent');
      expect(op).to.be.null;
    });
  });

  describe('recordMutation', () => {
    it('should add entry to change log', () => {
      manager.recordMutation('conversations', 'UPSERT', { id: 'test-1' });
      const log = testStorage.getChangeLog();
      expect(log).to.have.length(1);
      expect(log[0].operation).to.equal('UPSERT');
    });
  });

  describe('retention enforcement on backup', () => {
    it('should delete old backups when creating new one', async () => {
      const retStorage = new BackupStorage(adapters);
      const retManager = new BackupManager(retStorage, { retentionDays: 30 });

      // Manually add an old backup
      await retStorage.writeBackup('bkp-old', {
        backupId: 'bkp-old', version: 1, type: 'full', createdAt: '2026-01-01T00:00:00Z',
        status: 'completed', sizeBytes: 100, durationMs: 10, checksumSha256: 'abc', tables: {},
      }, {});

      // Create a new backup — should trigger retention
      const result = await retManager.executeBackup();
      expect(result.retentionDeleted).to.include('bkp-old');

      const remaining = await retManager.getAvailableBackups();
      expect(remaining).to.have.length(1);
      expect(remaining[0].backupId).to.equal(result.backup.backupId);
    });
  });
});

// ---------------------------------------------------------------------------
// BackupMonitor
// ---------------------------------------------------------------------------
describe('BackupMonitor', () => {
  let manager;
  let testStorage;
  let monitor;
  let adapters;

  beforeEach(() => {
    adapters = createTestAdapters();
    testStorage = new BackupStorage(adapters);
    manager = new BackupManager(testStorage);
    monitor = new BackupMonitor(manager);
  });

  describe('getBackupSummary', () => {
    it('should return summary with zero values when no backups', async () => {
      const summary = await monitor.getBackupSummary();
      expect(summary.totalBackups).to.equal(0);
      expect(summary.completedBackups).to.equal(0);
      expect(summary.failedBackups).to.equal(0);
      expect(summary.lastBackupStatus).to.equal('none');
    });

    it('should return accurate summary after backups', async () => {
      await manager.executeBackup();
      const summary = await monitor.getBackupSummary();
      expect(summary.totalBackups).to.equal(1);
      expect(summary.completedBackups).to.equal(1);
      expect(summary.lastBackupStatus).to.equal('completed');
      expect(summary.trackedTables).to.include.members(['conversations', 'customers']);
    });

    it('should calculate storage usage percentage', async () => {
      const summary = await monitor.getBackupSummary();
      expect(summary.storageQuotaMB).to.equal(1024);
      expect(summary.storageUsedPercent).to.be.at.least(0);
    });
  });

  describe('checkScheduleAdherence', () => {
    it('should report non-adherent when no backups exist', async () => {
      const result = await monitor.checkScheduleAdherence();
      expect(result.adherent).to.be.false;
      expect(result.alerts).to.have.length(1);
      expect(result.alerts[0].type).to.equal('schedule_missed');
    });

    it('should report adherent when backups are recent', async () => {
      await manager.executeBackup();
      const result = await monitor.checkScheduleAdherence();
      expect(result.hoursSinceLastBackup).to.be.at.least(0);
    });
  });

  describe('checkStorageQuota', () => {
    it('should not alert when under quota', async () => {
      const result = await monitor.checkStorageQuota();
      expect(result.alerts).to.deep.equal([]);
    });
  });

  describe('generateAlertsForBackup', () => {
    it('should generate success alert for completed backup', async () => {
      const backupResult = await manager.executeBackup();
      const alerts = await monitor.generateAlertsForBackup(backupResult);
      expect(alerts).to.have.length(1);
      expect(alerts[0].type).to.equal('backup_success');
      expect(alerts[0].backupId).to.equal(backupResult.backup.backupId);
    });

    it('should generate failure alert for failed backup', async () => {
      const fakeResult = {
        backup: {
          backupId: 'bkp-fail',
          status: 'failed',
          errorMessage: 'Test error',
          tables: {},
        },
        retentionDeleted: [],
      };
      const alerts = await monitor.generateAlertsForBackup(fakeResult);
      expect(alerts).to.have.length(1);
      expect(alerts[0].type).to.equal('backup_failure');
      expect(alerts[0].message).to.include('Test error');
    });

    it('should include retentionDeleted in success details', async () => {
      const backupResult = await manager.executeBackup();
      const alerts = await monitor.generateAlertsForBackup(backupResult);
      expect(alerts[0].details.retentionDeleted).to.deep.equal([]);
    });
  });
});

// ---------------------------------------------------------------------------
// Express API Endpoints
// ---------------------------------------------------------------------------
describe('API Endpoints', () => {
  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).to.equal(200);
      expect(res.body.data.status).to.equal('ok');
      expect(res.body.data.service).to.equal('backup-recovery-system');
    });
  });

  describe('POST /api/backup/execute', () => {
    it('should execute a backup and return metadata', async () => {
      const res = await request(app).post('/api/backup/execute');
      expect(res.status).to.equal(201);
      expect(res.body.data.backupId).to.match(/^bkp-/);
      expect(res.body.data.status).to.equal('completed');
      expect(res.body.data.checksum).to.have.length(64);
      expect(res.body.data.tables).to.have.property('conversations');
      expect(res.body.data.alerts).to.be.an('array');
    });
  });

  describe('GET /api/backup/list', () => {
    it('should list all backups', async () => {
      const res = await request(app).get('/api/backup/list');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.property('backups');
      expect(res.body.data).to.have.property('total');
    });
  });

  describe('GET /api/backup/status/:id', () => {
    it('should return status for a valid backup', async () => {
      const execRes = await request(app).post('/api/backup/execute');
      const backupId = execRes.body.data.backupId;

      const res = await request(app).get(`/api/backup/status/${backupId}`);
      expect(res.status).to.equal(200);
      expect(res.body.data.backupId).to.equal(backupId);
      expect(res.body.data.status).to.equal('completed');
    });

    it('should return 404 for unknown backup', async () => {
      const res = await request(app).get('/api/backup/status/nonexistent');
      expect(res.status).to.equal(404);
      expect(res.body.error.message).to.include('not found');
    });
  });

  describe('POST /api/backup/restore', () => {
    it('should restore from a valid backup', async () => {
      const execRes = await request(app).post('/api/backup/execute');
      const backupId = execRes.body.data.backupId;

      const res = await request(app).post('/api/backup/restore').send({ backup_id: backupId });
      expect(res.status).to.equal(200);
      expect(res.body.data.status).to.equal('completed');
      expect(res.body.data.tables).to.have.property('conversations');
    });

    it('should return 400 when backup_id missing', async () => {
      const res = await request(app).post('/api/backup/restore').send({});
      expect(res.status).to.equal(400);
    });

    it('should return 404 for non-existent backup', async () => {
      const res = await request(app).post('/api/backup/restore').send({ backup_id: 'nonexistent' });
      expect(res.status).to.equal(404);
    });
  });

  describe('POST /api/backup/restore/pitr', () => {
    it('should validate target_timestamp is required', async () => {
      const res = await request(app).post('/api/backup/restore/pitr').send({});
      expect(res.status).to.equal(400);
    });

    it('should return 400 for invalid timestamp', async () => {
      const res = await request(app).post('/api/backup/restore/pitr').send({ target_timestamp: 'invalid' });
      expect(res.status).to.equal(400);
    });
  });

  describe('POST /api/backup/restore/dry-run', () => {
    it('should dry-run a valid backup', async () => {
      const execRes = await request(app).post('/api/backup/execute');
      const backupId = execRes.body.data.backupId;

      const res = await request(app).post('/api/backup/restore/dry-run').send({ backup_id: backupId });
      expect(res.status).to.equal(200);
      expect(res.body.data.integrityValid).to.be.true;
      expect(res.body.data.canRestore).to.be.true;
    });

    it('should return 400 when backup_id missing', async () => {
      const res = await request(app).post('/api/backup/restore/dry-run').send({});
      expect(res.status).to.equal(400);
    });
  });

  describe('GET /api/backup/monitor', () => {
    it('should return monitor data', async () => {
      const res = await request(app).get('/api/backup/monitor');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.property('summary');
      expect(res.body.data).to.have.property('schedule_adherence');
      expect(res.body.data).to.have.property('storage_status');
      expect(res.body.data).to.have.property('recovery_operations');
    });
  });

  describe('GET /api/backup/recovery-operations', () => {
    it('should list recovery operations', async () => {
      const res = await request(app).get('/api/backup/recovery-operations');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.have.property('operations');
      expect(res.body.data).to.have.property('total');
    });
  });
});
