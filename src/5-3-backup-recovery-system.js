require('dotenv').config();
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Backup Storage — manages backup file persistence with retention
// ---------------------------------------------------------------------------
class BackupStorage {
  constructor(adapters = {}) {
    this.adapters = adapters; // table name → { getAll(), upsert(data), deleteAll() }
    this.backups = new Map(); // backupId → BackupRecord
    this.changeLog = []; // append-only WAL for PITR
  }

  async writeBackup(backupId, manifest, tableData) {
    this.backups.set(backupId, { ...manifest, backupId, data: tableData });
  }

  async readBackup(backupId) {
    const record = this.backups.get(backupId);
    if (!record) return null;
    return record;
  }

  async listBackups() {
    const list = Array.from(this.backups.values())
      .map((record) => {
        const { data, ...rest } = record;
        return rest;
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return list;
  }

  async deleteBackup(backupId) {
    this.backups.delete(backupId);
  }

  async enforceRetention(retentionDays) {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const toDelete = [];
    for (const [id, record] of this.backups) {
      if (new Date(record.createdAt).getTime() < cutoff) {
        toDelete.push(id);
      }
    }
    for (const id of toDelete) {
      this.backups.delete(id);
    }
    return toDelete;
  }

  async getStorageUsage() {
    const records = Array.from(this.backups.values());
    const totalSize = records.reduce((sum, r) => sum + (r.sizeBytes || 0), 0);
    const timestamps = records.map(r => new Date(r.createdAt).getTime()).filter(t => !isNaN(t));
    return {
      totalBackups: records.length,
      totalSizeBytes: totalSize,
      oldestTimestamp: timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : null,
      newestTimestamp: timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null,
    };
  }

  registerAdapter(tableName, adapter) {
    this.adapters[tableName] = adapter;
  }

  // ---- Change log for PITR ----
  recordMutation(table, operation, data) {
    this.changeLog.push({
      timestamp: new Date().toISOString(),
      table,
      operation,
      data: JSON.parse(JSON.stringify(data)),
      checksum: crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex'),
    });
  }

  getChangeLog() {
    return [...this.changeLog];
  }

  clearChangeLog() {
    this.changeLog = [];
  }

  getChangeLogSince(timestamp) {
    const since = new Date(timestamp).getTime();
    // Use >= because changeLog is cleared after each backup completes, so
    // any entries present were added after the backup finished. Using strict >
    // would miss entries recorded within the same millisecond as backup createdAt.
    return this.changeLog.filter(entry => new Date(entry.timestamp).getTime() >= since);
  }
}

// ---------------------------------------------------------------------------
// Backup Manager — orchestration of backup and recovery operations
// ---------------------------------------------------------------------------
class BackupManager {
  constructor(storage, options = {}) {
    this.storage = storage;
    this.adapters = storage.adapters;
    this.trackedTables = options.tables || ['conversations', 'customers', 'sync_tracking', 'external_references'];
    this.backupIntervalMs = (parseInt(process.env.BACKUP_INTERVAL_HOURS, 10) || 24) * 60 * 60 * 1000;
    this.retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS, 10) || 30;
    this._scheduleTimer = null;
    this._running = false;
    this._recoveryOperations = []; // RecoveryOperation records
    this._backupQueue = []; // for concurrent operation handling
  }

  // ---- SHA-256 helper ----
  _checksum(data) {
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }

  // ---- Backup ID generation ----
  _generateBackupId() {
    return `bkp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  _generateNotificationId() {
    return `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  _generateRecoveryId() {
    return `rec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ---- Execute a full backup ----
  async executeBackup() {
    if (this._running) {
      throw new Error('A backup operation is already in progress');
    }

    this._running = true;
    const backupId = this._generateBackupId();
    const startTime = Date.now();
    const backupRecord = {
      backupId,
      version: 1,
      type: 'full',
      createdAt: new Date(startTime).toISOString(),
      status: 'in_progress',
      sizeBytes: 0,
      durationMs: 0,
      checksumSha256: '',
      tables: {},
      errorMessage: null,
    };

    try {
      const tableData = {};

      for (const table of this.trackedTables) {
        const adapter = this.adapters[table];
        if (!adapter) {
          backupRecord.tables[table] = { rowCount: 0, checksum: null, skipped: true };
          continue;
        }

        const rows = await adapter.getAll();
        const rowsChecksum = this._checksum(rows || []);
        backupRecord.tables[table] = {
          rowCount: (rows || []).length,
          checksum: rowsChecksum,
        };
        tableData[table] = rows || [];
      }

      const fullData = { manifest: backupRecord, tables: tableData };
      const fullChecksum = this._checksum(fullData);

      backupRecord.checksumSha256 = fullChecksum;
      backupRecord.sizeBytes = Buffer.byteLength(JSON.stringify(fullData), 'utf-8');
      backupRecord.durationMs = Date.now() - startTime;
      backupRecord.status = 'completed';

      // Clear old change log entries before this backup (they're captured in the snapshot)
      this.storage.clearChangeLog();

      await this.storage.writeBackup(backupId, backupRecord, tableData);

      // Enforce retention policy
      const deleted = await this.storage.enforceRetention(this.retentionDays);

      this._running = false;
      return { backup: backupRecord, retentionDeleted: deleted };
    } catch (err) {
      backupRecord.status = 'failed';
      backupRecord.errorMessage = err.message;
      backupRecord.durationMs = Date.now() - startTime;

      await this.storage.writeBackup(backupId, backupRecord, {});
      this._running = false;
      throw err;
    }
  }

  // ---- Schedule backups at interval ----
  scheduleBackup() {
    if (this._scheduleTimer) {
      clearInterval(this._scheduleTimer);
    }

    this._scheduleTimer = setInterval(async () => {
      try {
        await this.executeBackup();
      } catch (err) {
        console.error('Scheduled backup failed:', err.message);
      }
    }, this.backupIntervalMs);

    return this._scheduleTimer;
  }

  stopSchedule() {
    if (this._scheduleTimer) {
      clearInterval(this._scheduleTimer);
      this._scheduleTimer = null;
    }
  }

  // ---- List available backups ----
  async getAvailableBackups() {
    const backups = await this.storage.listBackups();
    return backups;
  }

  async getBackupStatus(backupId) {
    const record = await this.storage.readBackup(backupId);
    if (!record) return null;
    const { data, ...meta } = record;
    return meta;
  }

  // ---- Restore from a specific backup ----
  async restoreFromBackup(backupId) {
    const record = await this.storage.readBackup(backupId);
    if (!record) {
      throw new Error(`Backup ${backupId} not found`);
    }
    if (record.status !== 'completed') {
      throw new Error(`Backup ${backupId} has status "${record.status}", cannot restore from incomplete backup`);
    }

    // Verify integrity before restore
    const integrityCheck = this._verifyIntegrity(record);
    if (!integrityCheck.valid) {
      throw new Error(`Backup integrity check failed: ${integrityCheck.error}`);
    }

    const recoveryId = this._generateRecoveryId();
    const recoveryOp = {
      id: recoveryId,
      backupId,
      type: 'full_restore',
      status: 'in_progress',
      targetTimestamp: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      errorMessage: null,
    };
    this._recoveryOperations.push(recoveryOp);

    try {
      const tableData = record.data || {};
      const results = {};

      // Restore in dependency order
      const restoreOrder = ['customers', 'external_references', 'conversations', 'sync_tracking'];

      for (const table of restoreOrder) {
        const adapter = this.adapters[table];
        if (!adapter || !tableData[table]) {
          results[table] = { restored: 0, skipped: true };
          continue;
        }

        // Clear existing data, then insert backup data
        await adapter.deleteAll();
        for (const row of tableData[table]) {
          await adapter.upsert(row);
        }
        results[table] = { restored: tableData[table].length };
      }

      recoveryOp.status = 'completed';
      recoveryOp.completedAt = new Date().toISOString();

      return {
        recoveryId,
        backupId,
        status: 'completed',
        tables: results,
      };
    } catch (err) {
      recoveryOp.status = 'failed';
      recoveryOp.errorMessage = err.message;
      recoveryOp.completedAt = new Date().toISOString();

      throw new Error(`Restore failed: ${err.message}`);
    }
  }

  // ---- Point-in-Time Recovery ----
  async pointInTimeRecovery(targetTimestamp) {
    const targetTime = new Date(targetTimestamp).getTime();
    if (isNaN(targetTime)) {
      throw new Error(`Invalid target timestamp: ${targetTimestamp}`);
    }

    // Find the latest full backup before the target timestamp
    const backups = await this.storage.listBackups();
    const fullBackups = backups
      .filter(b => b.type === 'full' && b.status === 'completed')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const latestBefore = fullBackups.find(b => new Date(b.createdAt).getTime() <= targetTime);
    if (!latestBefore) {
      throw new Error(`No full backup found before ${targetTimestamp}`);
    }

    // Restore from the full backup
    const restoreResult = await this.restoreFromBackup(latestBefore.backupId);

    // Replay change log entries from backup time to target timestamp
    const changeLog = this.storage.getChangeLogSince(latestBefore.createdAt);
    const replayed = [];
    let replayFailed = false;
    let replayError = null;

    for (const entry of changeLog) {
      if (new Date(entry.timestamp).getTime() > targetTime) break;

      const adapter = this.adapters[entry.table];
      if (adapter) {
        try {
          if (entry.operation === 'INSERT' || entry.operation === 'UPSERT') {
            await adapter.upsert(entry.data);
          }
          replayed.push(entry);
        } catch (err) {
          replayFailed = true;
          replayError = err.message;
          break;
        }
      }
    }

    const recoveryId = this._generateRecoveryId();
    const recoveryOp = {
      id: recoveryId,
      backupId: latestBefore.backupId,
      type: 'pitr',
      status: replayFailed ? 'partially_completed' : 'completed',
      targetTimestamp,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      errorMessage: replayError || null,
    };
    this._recoveryOperations.push(recoveryOp);

    return {
      recoveryId,
      backupId: latestBefore.backupId,
      backupTimestamp: latestBefore.createdAt,
      targetTimestamp,
      status: recoveryOp.status,
      replayedEntries: replayed.length,
      totalEntriesConsidered: changeLog.length,
      error: replayError,
    };
  }

  // ---- Dry-run restore ----
  async dryRunRestore(backupId) {
    const record = await this.storage.readBackup(backupId);
    if (!record) {
      throw new Error(`Backup ${backupId} not found`);
    }

    const integrityCheck = this._verifyIntegrity(record);
    const tableData = record.data || {};
    const tableReports = {};

    for (const table of this.trackedTables) {
      const adapter = this.adapters[table];
      const rows = tableData[table] || [];
      tableReports[table] = {
        rowCount: rows.length,
        adapterAvailable: !!adapter,
        canRestore: adapter && rows.length > 0,
      };
    }

    return {
      backupId,
      backupTimestamp: record.createdAt,
      backupStatus: record.status,
      integrityValid: integrityCheck.valid,
      integrityError: integrityCheck.error || null,
      tables: tableReports,
      canRestore: integrityCheck.valid && Object.values(tableReports).some(r => r.canRestore),
    };
  }

  // ---- Integrity check ----
  _verifyIntegrity(record) {
    const tableData = record.data || {};
    const recomputedManifest = { ...record, data: undefined };

    for (const [table, info] of Object.entries(record.tables || {})) {
      const rows = tableData[table] || [];
      const expectedChecksum = this._checksum(rows);
      if (info.checksum && info.checksum !== expectedChecksum) {
        return {
          valid: false,
          error: `Checksum mismatch for table "${table}": expected ${info.checksum}, got ${expectedChecksum}`,
        };
      }
    }

    return { valid: true, error: null };
  }

  // ---- Recovery operations tracking ----
  getRecoveryOperations() {
    return [...this._recoveryOperations];
  }

  getRecoveryOperation(recoveryId) {
    return this._recoveryOperations.find(op => op.id === recoveryId) || null;
  }

  // ---- Mutation recording (called by data layer) ----
  recordMutation(table, operation, data) {
    this.storage.recordMutation(table, operation, data);
  }
}

// ---------------------------------------------------------------------------
// Backup Monitor — health tracking and alerting
// ---------------------------------------------------------------------------
class BackupMonitor {
  constructor(backupManager) {
    this.backupManager = backupManager;
  }

  async getBackupSummary() {
    const backups = await this.backupManager.getAvailableBackups();
    const completed = backups.filter(b => b.status === 'completed');
    const failed = backups.filter(b => b.status === 'failed');
    const inProgress = backups.filter(b => b.status === 'in_progress');
    const totalSize = completed.reduce((sum, b) => sum + (b.sizeBytes || 0), 0);

    const timestamps = completed.map(b => new Date(b.createdAt).getTime()).filter(t => !isNaN(t));
    const newestTimestamp = timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null;
    const oldestTimestamp = timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : null;

    const maxStorageMb = parseInt(process.env.BACKUP_MAX_STORAGE_MB, 10) || 1024;

    return {
      totalBackups: backups.length,
      completedBackups: completed.length,
      failedBackups: failed.length,
      inProgressBackups: inProgress.length,
      totalSizeBytes: totalSize,
      totalSizeMB: Math.round((totalSize / (1024 * 1024)) * 100) / 100,
      storageQuotaMB: maxStorageMb,
      storageUsedPercent: maxStorageMb > 0 ? Math.round((totalSize / (1024 * 1024) / maxStorageMb) * 10000) / 100 : 0,
      newestBackup: newestTimestamp,
      oldestBackup: oldestTimestamp,
      lastBackupStatus: completed.length > 0 ? 'completed' : (failed.length > 0 ? 'failed' : 'none'),
      trackedTables: this.backupManager.trackedTables,
    };
  }

  async checkScheduleAdherence() {
    const backups = await this.backupManager.getAvailableBackups();
    const completed = backups.filter(b => b.status === 'completed');

    if (completed.length === 0) {
      return {
        adherent: false,
        hoursSinceLastBackup: null,
        alerts: [{
          type: 'schedule_missed',
          message: 'No backups have been created yet',
        }],
      };
    }

    const newest = completed.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    const hoursSince = (Date.now() - new Date(newest.createdAt).getTime()) / (1000 * 60 * 60);
    const intervalHours = parseInt(process.env.BACKUP_INTERVAL_HOURS, 10) || 24;
    const thresholdHours = intervalHours + 2; // 2-hour grace period
    const alerts = [];

    if (hoursSince > thresholdHours) {
      alerts.push({
        type: 'schedule_missed',
        message: `Last backup was ${Math.round(hoursSince * 10) / 10} hours ago (threshold: ${thresholdHours}h)`,
        hoursSinceLastBackup: Math.round(hoursSince * 10) / 10,
      });
    }

    return {
      adherent: alerts.length === 0,
      hoursSinceLastBackup: Math.round(hoursSince * 10) / 10,
      intervalHours,
      alerts,
    };
  }

  async checkStorageQuota() {
    const summary = await this.getBackupSummary();
    const alerts = [];

    if (summary.storageUsedPercent >= 90) {
      alerts.push({
        type: 'storage_quota_warning',
        message: `Storage at ${summary.storageUsedPercent}% of ${summary.storageQuotaMB}MB quota`,
        usedPercent: summary.storageUsedPercent,
        quotaMB: summary.storageQuotaMB,
      });
    }

    return { alerts, storageUsedPercent: summary.storageUsedPercent };
  }

  async generateAlertsForBackup(backupResult) {
    const alerts = [];
    const backup = backupResult.backup;
    const now = new Date().toISOString();

    if (backup.status === 'completed') {
      alerts.push({
        id: this.backupManager._generateNotificationId(),
        type: 'backup_success',
        backupId: backup.backupId,
        message: `Daily backup completed successfully`,
        details: {
          sizeBytes: backup.sizeBytes,
          durationMs: backup.durationMs,
          tables: backup.tables,
          retentionDeleted: backupResult.retentionDeleted,
        },
        createdAt: now,
        acknowledged: false,
      });
    } else {
      alerts.push({
        id: this.backupManager._generateNotificationId(),
        type: 'backup_failure',
        backupId: backup.backupId,
        message: `Backup failed: ${backup.errorMessage || 'Unknown error'}`,
        details: {
          errorMessage: backup.errorMessage,
          tables: backup.tables,
        },
        createdAt: now,
        acknowledged: false,
      });
    }

    return alerts;
  }
}

// ---------------------------------------------------------------------------
// Express App
// ---------------------------------------------------------------------------
const storage = new BackupStorage({});
const backupManager = new BackupManager(storage);
const backupMonitor = new BackupMonitor(backupManager);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    data: {
      status: 'ok',
      service: 'backup-recovery-system',
      timestamp: new Date().toISOString(),
    },
    meta: { timestamp: Date.now() },
  });
});

// POST /api/backup/execute — trigger immediate on-demand backup
app.post('/api/backup/execute', async (req, res) => {
  try {
    const result = await backupManager.executeBackup();
    const alerts = await backupMonitor.generateAlertsForBackup(result);

    res.status(201).json({
      data: {
        backupId: result.backup.backupId,
        status: result.backup.status,
        createdAt: result.backup.createdAt,
        sizeBytes: result.backup.sizeBytes,
        durationMs: result.backup.durationMs,
        checksum: result.backup.checksumSha256,
        tables: result.backup.tables,
        retentionDeleted: result.retentionDeleted,
        alerts,
      },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    const status = error.message.includes('already in progress') ? 409 : 500;
    res.status(status).json({
      error: { message: error.message, code: status },
    });
  }
});

// GET /api/backup/list — list available backups
app.get('/api/backup/list', async (req, res) => {
  try {
    const backups = await backupManager.getAvailableBackups();

    res.json({
      data: {
        backups,
        total: backups.length,
      },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to list backups', code: 500, details: error.message },
    });
  }
});

// GET /api/backup/status/:id — check backup status
app.get('/api/backup/status/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const status = await backupManager.getBackupStatus(id);

    if (!status) {
      return res.status(404).json({
        error: { message: `Backup ${id} not found`, code: 404 },
      });
    }

    res.json({
      data: status,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get backup status', code: 500, details: error.message },
    });
  }
});

// POST /api/backup/restore — initiate full restore
app.post('/api/backup/restore', async (req, res) => {
  try {
    const { backup_id } = req.body;

    if (!backup_id) {
      return res.status(400).json({
        error: { message: 'backup_id is required', code: 400 },
      });
    }

    const result = await backupManager.restoreFromBackup(backup_id);

    res.json({
      data: result,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({
      error: { message: error.message, code: status, details: error.message },
    });
  }
});

// POST /api/backup/restore/pitr — point-in-time recovery
app.post('/api/backup/restore/pitr', async (req, res) => {
  try {
    const { target_timestamp } = req.body;

    if (!target_timestamp) {
      return res.status(400).json({
        error: { message: 'target_timestamp is required', code: 400 },
      });
    }

    const result = await backupManager.pointInTimeRecovery(target_timestamp);

    const status = result.status === 'partially_completed' ? 207 : 200;
    res.status(status).json({
      data: result,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    const status = error.message.includes('not found') || error.message.includes('Invalid') ? 400 : 500;
    res.status(status).json({
      error: { message: error.message, code: status },
    });
  }
});

// POST /api/backup/restore/dry-run — validate restore without executing
app.post('/api/backup/restore/dry-run', async (req, res) => {
  try {
    const { backup_id } = req.body;

    if (!backup_id) {
      return res.status(400).json({
        error: { message: 'backup_id is required', code: 400 },
      });
    }

    const result = await backupManager.dryRunRestore(backup_id);

    res.json({
      data: result,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({
      error: { message: error.message, code: status, details: error.message },
    });
  }
});

// GET /api/backup/monitor — backup health dashboard
app.get('/api/backup/monitor', async (req, res) => {
  try {
    const [summary, schedule, storageStatus] = await Promise.all([
      backupMonitor.getBackupSummary(),
      backupMonitor.checkScheduleAdherence(),
      backupMonitor.checkStorageQuota(),
    ]);

    res.json({
      data: {
        summary,
        schedule_adherence: schedule,
        storage_status: storageStatus,
        recovery_operations: backupManager.getRecoveryOperations(),
      },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get backup monitor data', code: 500, details: error.message },
    });
  }
});

// GET /api/backup/recovery-operations — list recovery operations
app.get('/api/backup/recovery-operations', (req, res) => {
  try {
    res.json({
      data: {
        operations: backupManager.getRecoveryOperations(),
        total: backupManager.getRecoveryOperations().length,
      },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to list recovery operations', code: 500 },
    });
  }
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: { message: 'Internal server error', code: 500 },
  });
});

// Start server only if not in test mode
const PORT = process.env.PORT || 3002;
if (process.env.MOCHA_TEST_MODE !== 'true') {
  app.listen(PORT, () => {
    console.log(`Backup and recovery service running on port ${PORT}`);
  });
}

module.exports = {
  app,
  BackupManager,
  BackupStorage,
  BackupMonitor,
  backupManager,
  storage,
};
