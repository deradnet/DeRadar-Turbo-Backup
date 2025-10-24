import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemStats } from './entities/system-stats.entity';
import { ConfigService } from '@nestjs/config';
import { TurboFactory, TurboAuthenticatedClient } from '@ardrive/turbo-sdk';
import { EncryptionService } from '../common/utils/encryption.service';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface ArweaveStatsBackup {
  timestamp: number;
  stats: {
    system_start_time: number;
    total_uploads_attempted: number;
    total_uploads_succeeded: number;
    total_uploads_failed: number;
    total_retries: number;
    encrypted_uploads_attempted: number;
    encrypted_uploads_succeeded: number;
    encrypted_uploads_failed: number;
    encrypted_retries: number;
    nildb_keys_saved: number;
    total_new_aircraft: number;
    total_updates: number;
    total_reappeared: number;
    total_poll_cycles: number;
  };
  backupId: string;
}

@Injectable()
export class StatsBackupService implements OnModuleInit {
  private readonly logger = new Logger(StatsBackupService.name);
  private turbo: TurboAuthenticatedClient;
  private backupInterval: NodeJS.Timeout;
  private readonly BACKUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly STATS_BACKUP_UUID = 'system-stats-backup';
  private walletAddress: string;
  private initialized = false;

  constructor(
    @InjectRepository(SystemStats)
    private readonly systemStatsRepo: Repository<SystemStats>,
    private readonly configService: ConfigService,
    private readonly encryptionService: EncryptionService,
  ) {}

  async onModuleInit() {
    await this.initializeTurbo();
  }

  private async initializeTurbo() {
    const privateKey = this.configService.get('wallet.private_key');

    if (!privateKey) {
      this.logger.error('No wallet private key found in config - stats backup disabled');
      return;
    }

    this.turbo = TurboFactory.authenticated({ privateKey });

    // Get wallet address from JWK (privateKey is already an object)
    const Arweave = require('arweave');
    const arweave = Arweave.init({});
    this.walletAddress = await arweave.wallets.jwkToAddress(privateKey);

    this.initialized = true;
    this.logger.log(`Stats backup service initialized (wallet: ${this.walletAddress})`);
  }

  /**
   * Start automatic backup every 5 minutes
   */
  startAutoBackup() {
    this.logger.log('Starting automatic stats backup (every 5 minutes)');

    // Do initial backup after 1 minute
    setTimeout(() => {
      this.backupStats().catch(err => {
        this.logger.error(`Initial stats backup failed: ${err.message}`);
      });
    }, 60000);

    // Then backup every 5 minutes
    this.backupInterval = setInterval(() => {
      this.backupStats().catch(err => {
        this.logger.error(`Periodic stats backup failed: ${err.message}`);
      });
    }, this.BACKUP_INTERVAL_MS);
  }

  /**
   * Stop automatic backup
   */
  stopAutoBackup() {
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
      this.logger.log('Stopped automatic stats backup');
    }
  }

  /**
   * Backup current system stats to Arweave
   */
  async backupStats(): Promise<string | null> {
    try {
      if (!this.initialized) {
        this.logger.warn('Service not initialized yet, skipping backup');
        return null;
      }

      // Get latest stats from database
      const stats = await this.systemStatsRepo.findOne({
        where: {},
        order: { id: 'DESC' },
      });

      if (!stats) {
        this.logger.warn('No stats to backup');
        return null;
      }

      // Create backup object
      const backup: ArweaveStatsBackup = {
        timestamp: Date.now(),
        stats: {
          system_start_time: stats.system_start_time,
          total_uploads_attempted: stats.total_uploads_attempted,
          total_uploads_succeeded: stats.total_uploads_succeeded,
          total_uploads_failed: stats.total_uploads_failed,
          total_retries: stats.total_retries,
          encrypted_uploads_attempted: stats.encrypted_uploads_attempted,
          encrypted_uploads_succeeded: stats.encrypted_uploads_succeeded,
          encrypted_uploads_failed: stats.encrypted_uploads_failed,
          encrypted_retries: stats.encrypted_retries,
          nildb_keys_saved: stats.nildb_keys_saved,
          total_new_aircraft: stats.total_new_aircraft,
          total_updates: stats.total_updates,
          total_reappeared: stats.total_reappeared,
          total_poll_cycles: stats.total_poll_cycles,
        },
        backupId: crypto.randomBytes(8).toString('hex'),
      };

      // Convert to JSON
      const backupJson = JSON.stringify(backup, null, 2);

      // Create temporary file
      const tmpDir = os.tmpdir();
      const tmpFilePath = path.join(tmpDir, `stats-backup-${Date.now()}.json`);
      fs.writeFileSync(tmpFilePath, backupJson);

      // Encrypt the file
      const encryptionResult = this.encryptionService.encryptFile(tmpFilePath, this.STATS_BACKUP_UUID);

      const encryptedFileSize = fs.statSync(encryptionResult.encryptedFilePath).size;

      // Upload to Arweave with tags
      const { id: txId } = await this.turbo.uploadFile({
        fileStreamFactory: () => fs.createReadStream(encryptionResult.encryptedFilePath),
        fileSizeFactory: () => encryptedFileSize,
        dataItemOpts: {
          tags: [
            { name: 'Content-Type', value: 'application/octet-stream' },
            { name: 'App-Name', value: 'DeradNetworkBackup' },
            { name: 'Type', value: 'stats-backup' },
            { name: 'Backup-Type', value: 'system-stats' },
            { name: 'Timestamp', value: String(backup.timestamp) },
            { name: 'Backup-ID', value: backup.backupId },
            { name: 'Encrypted', value: 'true' },
            { name: 'Encryption-Algorithm', value: 'AES-256-GCM' },
          ],
        },
      });

      // Cleanup
      if (fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath);
      if (fs.existsSync(encryptionResult.encryptedFilePath)) fs.unlinkSync(encryptionResult.encryptedFilePath);

      this.logger.log(`📊 Stats backed up to Arweave: ${txId} (backup: ${backup.backupId})`);
      return txId;
    } catch (error) {
      this.logger.error(`Failed to backup stats: ${error.message}`);
      return null;
    }
  }

  /**
   * Query Arweave for the latest stats backup for this node
   */
  async queryLatestBackup(): Promise<ArweaveStatsBackup | null> {
    try {
      if (!this.initialized) {
        this.logger.warn('Service not initialized yet, skipping query');
        return null;
      }

      this.logger.log(`Querying Arweave for stats backup (wallet: ${this.walletAddress})...`);

      const query = `
        query {
          transactions(
            owners: ["${this.walletAddress}"]
            tags: [
              { name: "App-Name", values: ["DeradNetworkBackup"] }
              { name: "Type", values: ["stats-backup"] }
            ]
            first: 1
            sort: HEIGHT_DESC
          ) {
            edges {
              node {
                id
                tags {
                  name
                  value
                }
              }
            }
          }
        }
      `;

      const response = await fetch('https://arweave.net/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      const result = await response.json();

      if (!result.data?.transactions?.edges?.length) {
        this.logger.log('No backup found on Arweave');
        return null;
      }

      const txId = result.data.transactions.edges[0].node.id;
      this.logger.log(`Found backup: ${txId}`);

      // Download and decrypt the backup
      const encryptedData = await fetch(`https://arweave.net/${txId}`);
      const encryptedBuffer = Buffer.from(await encryptedData.arrayBuffer());

      // Write to temp file for decryption
      const tmpDir = os.tmpdir();
      const encryptedFilePath = path.join(tmpDir, `backup-${txId}.enc`);
      fs.writeFileSync(encryptedFilePath, encryptedBuffer);

      // Decrypt
      const decryptedBuffer = this.encryptionService.decryptFile(encryptedFilePath, this.STATS_BACKUP_UUID);

      // Cleanup
      if (fs.existsSync(encryptedFilePath)) fs.unlinkSync(encryptedFilePath);

      // Parse JSON
      const backup: ArweaveStatsBackup = JSON.parse(decryptedBuffer.toString());
      this.logger.log(`✅ Successfully retrieved and decrypted stats backup from ${new Date(backup.timestamp).toISOString()}`);

      return backup;
    } catch (error) {
      this.logger.error(`Failed to query/restore backup: ${error.message}`);
      return null;
    }
  }

  /**
   * Restore stats from Arweave backup
   * If database has stats, compare timestamps and keep the most recent
   */
  async restoreStatsFromBackup(): Promise<boolean> {
    try {
      const backup = await this.queryLatestBackup();

      if (!backup) {
        this.logger.log('No backup to restore - this is a new node');
        return false;
      }

      // Check if database already has stats
      const existingStats = await this.systemStatsRepo.findOne({
        where: {},
        order: { id: 'DESC' },
      });

      if (existingStats) {
        // Compare timestamps - use the most up-to-date stats
        const dbTimestamp = existingStats.updated_at.getTime();
        const backupTimestamp = backup.timestamp;

        if (dbTimestamp >= backupTimestamp) {
          this.logger.log(`Database stats are more recent (DB: ${new Date(dbTimestamp).toISOString()} >= Backup: ${new Date(backupTimestamp).toISOString()}) - keeping database stats`);
          return false;
        }

        // Backup is newer - update existing record
        this.logger.log(`Backup stats are more recent (Backup: ${new Date(backupTimestamp).toISOString()} > DB: ${new Date(dbTimestamp).toISOString()}) - updating from backup`);

        await this.systemStatsRepo.update(existingStats.id, {
          total_uploads_attempted: backup.stats.total_uploads_attempted,
          total_uploads_succeeded: backup.stats.total_uploads_succeeded,
          total_uploads_failed: backup.stats.total_uploads_failed,
          total_retries: backup.stats.total_retries,
          encrypted_uploads_attempted: backup.stats.encrypted_uploads_attempted,
          encrypted_uploads_succeeded: backup.stats.encrypted_uploads_succeeded,
          encrypted_uploads_failed: backup.stats.encrypted_uploads_failed,
          encrypted_retries: backup.stats.encrypted_retries,
          nildb_keys_saved: backup.stats.nildb_keys_saved,
          total_new_aircraft: backup.stats.total_new_aircraft,
          total_updates: backup.stats.total_updates,
          total_reappeared: backup.stats.total_reappeared,
          total_poll_cycles: backup.stats.total_poll_cycles,
        });

        this.logger.log(`✅ Stats updated from Arweave backup (uploads: ${backup.stats.total_uploads_succeeded}, encrypted: ${backup.stats.encrypted_uploads_succeeded}, nilDB keys: ${backup.stats.nildb_keys_saved})`);
        return true;
      }

      // No existing stats - create new record from backup
      const restoredStats = await this.systemStatsRepo.save({
        system_start_time: Date.now(), // Reset start time to now
        total_uploads_attempted: backup.stats.total_uploads_attempted,
        total_uploads_succeeded: backup.stats.total_uploads_succeeded,
        total_uploads_failed: backup.stats.total_uploads_failed,
        total_retries: backup.stats.total_retries,
        encrypted_uploads_attempted: backup.stats.encrypted_uploads_attempted,
        encrypted_uploads_succeeded: backup.stats.encrypted_uploads_succeeded,
        encrypted_uploads_failed: backup.stats.encrypted_uploads_failed,
        encrypted_retries: backup.stats.encrypted_retries,
        nildb_keys_saved: backup.stats.nildb_keys_saved,
        total_new_aircraft: backup.stats.total_new_aircraft,
        total_updates: backup.stats.total_updates,
        total_reappeared: backup.stats.total_reappeared,
        total_poll_cycles: backup.stats.total_poll_cycles,
      });

      this.logger.log(`✅ Stats restored from Arweave backup (ID: ${restoredStats.id})`);
      this.logger.log(`   - Total uploads: ${backup.stats.total_uploads_succeeded}`);
      this.logger.log(`   - Encrypted uploads: ${backup.stats.encrypted_uploads_succeeded}`);
      this.logger.log(`   - nilDB keys: ${backup.stats.nildb_keys_saved}`);

      return true;
    } catch (error) {
      this.logger.error(`Failed to restore stats from backup: ${error.message}`);
      return false;
    }
  }
}
