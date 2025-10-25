import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { AircraftTrack } from './entities/aircraft-track.entity';
import { SystemStats } from './entities/system-stats.entity';
import { ArchiveService } from './archive.service';
import { StatsGateway } from './stats.gateway';
import { StatsBackupService } from './stats-backup.service';
import * as https from 'https';
import { Agent } from 'https';
import { v4 as uuidv4 } from 'uuid';
import { xxh64 } from '@node-rs/xxhash';

interface AircraftState {
  hex: string;
  data: any;
  hash: string;
  lastSeen: number;
  lastUploaded: number;
}

@Injectable()
export class AircraftTrackerService {
  private readonly logger = new Logger(AircraftTrackerService.name);
  private aircraftCache = new Map<string, AircraftState>();
  private readonly REAPPEAR_THRESHOLD_MS = 5 * 60 * 1000;
  private readonly POLL_INTERVAL_MS = 500;
  private isRunning = false;
  private pollTimer: NodeJS.Timeout;

  private readonly httpsAgent = new Agent({
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 1,
    maxFreeSockets: 1,
    timeout: 3000,
    scheduling: 'lifo',
    maxCachedSessions: 10,
  });

  private lastETag: string | null = null;
  private lastModified: string | null = null;
  private cachedAircraftData: any = null;
  private pendingRequest: Promise<any> | null = null;

  private fetchStats = {
    total304Responses: 0,
    total200Responses: 0,
    bandwidthSavedBytes: 0,
    totalBytesDownloaded: 0,
  };

  private cachedFullStats: any = null;
  private lastFullStatsUpdate = 0;
  private readonly FULL_STATS_CACHE_MS = 500;

  // Cached total tracks count to avoid expensive COUNT queries
  private cachedTotalTracks = 0;
  private lastTracksCountUpdate = 0;
  private readonly TRACKS_COUNT_CACHE_MS = 5000; // Update every 5 seconds

  // Debounced stats persistence
  private statsPersistTimer: NodeJS.Timeout | null = null;
  private statsDirty = false;
  private readonly STATS_PERSIST_DEBOUNCE_MS = 5000; // Persist every 5 seconds

  // UNENCRYPTED PIPELINE
  private uploadQueue: Array<{
    batch: Array<{ aircraft: any; snapshotTime: number; hex: string }>;
    packageUuid?: string;
    batchId?: string;
  }> = [];
  private activeUploads = 0;
  private readonly MAX_CONCURRENT_UPLOADS = 5;
  private isProcessingQueue = false;
  private uploadProgress: Map<number, { startTime: number; progress: number; status: string }> = new Map();
  private availableSlots: Set<number> = new Set([1, 2, 3, 4, 5]);

  // ENCRYPTED PIPELINE
  private encryptedUploadQueue: Array<{
    batch: Array<{ aircraft: any; snapshotTime: number; hex: string }>;
    packageUuid?: string;
    batchId?: string;
  }> = [];
  private encryptedActiveUploads = 0;
  private readonly MAX_CONCURRENT_ENCRYPTED_UPLOADS = 5;
  private isProcessingEncryptedQueue = false;
  private encryptedUploadProgress: Map<number, { startTime: number; progress: number; status: string }> = new Map();
  private encryptedAvailableSlots: Set<number> = new Set([1, 2, 3, 4, 5]);

  private aircraftBatch: Array<{ aircraft: any; snapshotTime: number; hex: string }> = [];
  private encryptedAircraftBatch: Array<{ aircraft: any; snapshotTime: number; hex: string }> = [];
  private readonly MAX_AIRCRAFT_PER_BATCH = 30;

  private stats = {
    totalUploadsAttempted: 0,
    totalUploadsSucceeded: 0,
    totalUploadsFailed: 0,
    totalRetries: 0,
    totalNewAircraft: 0,
    totalUpdates: 0,
    totalReappeared: 0,
    systemStartTime: 0,
    lastPollTime: 0,
    totalPollCycles: 0,
    currentlyFlying: 0,
    peakTpm: 0,
  };

  private encryptedStats = {
    totalUploadsAttempted: 0,
    totalUploadsSucceeded: 0,
    totalUploadsFailed: 0,
    totalRetries: 0,
    nildbKeysSaved: 0,
  };

  private sessionStats = {
    uploadsSucceeded: 0,
    encryptedUploadsSucceeded: 0,
    pollCycles: 0,
    sessionStartTime: 0,
  };

  // 60-second sliding window with buckets for TPM calculation
  // 12 buckets × 5 seconds = 60 seconds total
  private tpmBuckets: number[] = new Array(12).fill(0);
  private currentBucketIndex: number = 0;
  private lastBucketUpdate: number = 0;
  private readonly BUCKET_SIZE_MS = 5000; // 5 seconds per bucket
  private readonly TOTAL_BUCKETS = 12; // 12 buckets = 60 seconds

  // TPM history for UI graph (last 30 data points, updated every 3 seconds)
  private tpmHistory: number[] = new Array(30).fill(0);
  private lastTpmHistoryUpdate: number = 0;
  private readonly TPM_HISTORY_INTERVAL_MS = 3000; // 3 seconds

  private currentStatsId: number | null = null;

  // Map to store batch->UUID relationship for syncing encrypted uploads
  private batchUuidMap = new Map<string, string>();

  constructor(
    @InjectRepository(AircraftTrack)
    private readonly aircraftTrackRepo: Repository<AircraftTrack>,
    @InjectRepository(SystemStats)
    private readonly systemStatsRepo: Repository<SystemStats>,
    private readonly archiveService: ArchiveService,
    private readonly statsGateway: StatsGateway,
    @Inject(forwardRef(() => StatsBackupService))
    private readonly statsBackupService: StatsBackupService,
  ) {}

  async startTracking() {
    if (this.isRunning) {
      this.logger.warn('Tracking already running');
      return;
    }

    this.isRunning = true;

    // Try to restore stats from Arweave backup if database is empty
    if (this.statsBackupService) {
      await this.statsBackupService.restoreStatsFromBackup();
    }

    await this.loadOrCreateStats();

    // Start automatic backup to Arweave every 5 minutes
    if (this.statsBackupService) {
      this.statsBackupService.startAutoBackup();
    }

    this.logger.log('[INIT] Starting real-time aircraft tracking...');
    this.logger.log(`[INFO] Polling interval: ${this.POLL_INTERVAL_MS}ms`);
    this.logger.log(`[INFO] Reappearance threshold: ${this.REAPPEAR_THRESHOLD_MS / 1000}s`);

    await this.loadExistingTracks();
    this.startPolling();

    await this.broadcastStatsUpdate();
  }

  private async loadOrCreateStats() {
    const existingStats = await this.systemStatsRepo.findOne({
      where: {},
      order: { id: 'DESC' },
    });

    if (existingStats) {
      this.currentStatsId = existingStats.id;
      const currentTime = Date.now();
      this.stats = {
        totalUploadsAttempted: existingStats.total_uploads_attempted,
        totalUploadsSucceeded: existingStats.total_uploads_succeeded,
        totalUploadsFailed: existingStats.total_uploads_failed,
        totalRetries: existingStats.total_retries,
        totalNewAircraft: existingStats.total_new_aircraft,
        totalUpdates: existingStats.total_updates,
        totalReappeared: existingStats.total_reappeared,
        systemStartTime: currentTime,
        lastPollTime: currentTime,
        totalPollCycles: existingStats.total_poll_cycles,
        currentlyFlying: 0,
        peakTpm: parseFloat(existingStats.peak_tpm?.toString() || '0'),
      };

      this.encryptedStats = {
        totalUploadsAttempted: existingStats.encrypted_uploads_attempted || 0,
        totalUploadsSucceeded: existingStats.encrypted_uploads_succeeded || 0,
        totalUploadsFailed: existingStats.encrypted_uploads_failed || 0,
        totalRetries: existingStats.encrypted_retries || 0,
        nildbKeysSaved: existingStats.nildb_keys_saved || 0,
      };

      await this.systemStatsRepo.update(this.currentStatsId, {
        system_start_time: currentTime,
      });

      this.sessionStats = {
        uploadsSucceeded: 0,
        encryptedUploadsSucceeded: 0,
        pollCycles: 0,
        sessionStartTime: currentTime,
      };
      this.logger.log(`[INFO] Loaded existing stats from database (ID: ${this.currentStatsId}) - Uptime reset`);
    } else {
      const currentTime = Date.now();
      const newStats = await this.systemStatsRepo.save({
        system_start_time: currentTime,
        total_uploads_attempted: 0,
        total_uploads_succeeded: 0,
        total_uploads_failed: 0,
        total_retries: 0,
        encrypted_uploads_attempted: 0,
        encrypted_uploads_succeeded: 0,
        encrypted_uploads_failed: 0,
        encrypted_retries: 0,
        nildb_keys_saved: 0,
        total_new_aircraft: 0,
        total_updates: 0,
        total_reappeared: 0,
        total_poll_cycles: 0,
      });
      this.currentStatsId = newStats.id;
      this.stats.systemStartTime = currentTime;
      this.stats.currentlyFlying = 0;

      this.sessionStats = {
        uploadsSucceeded: 0,
        encryptedUploadsSucceeded: 0,
        pollCycles: 0,
        sessionStartTime: currentTime,
      };
      this.logger.log(`[INFO] Created new stats record (ID: ${this.currentStatsId})`);
    }
  }

  private scheduleStatsPersist() {
    this.statsDirty = true;

    if (!this.statsPersistTimer) {
      this.statsPersistTimer = setTimeout(() => {
        if (this.statsDirty) {
          this.persistStats();
          this.statsDirty = false;
        }
        this.statsPersistTimer = null;
      }, this.STATS_PERSIST_DEBOUNCE_MS);
    }
  }

  private async persistStats() {
    if (!this.currentStatsId) return;

    try {
      await this.systemStatsRepo.update(this.currentStatsId, {
        total_uploads_attempted: this.stats.totalUploadsAttempted,
        total_uploads_succeeded: this.stats.totalUploadsSucceeded,
        total_uploads_failed: this.stats.totalUploadsFailed,
        total_retries: this.stats.totalRetries,
        encrypted_uploads_attempted: this.encryptedStats.totalUploadsAttempted,
        encrypted_uploads_succeeded: this.encryptedStats.totalUploadsSucceeded,
        encrypted_uploads_failed: this.encryptedStats.totalUploadsFailed,
        encrypted_retries: this.encryptedStats.totalRetries,
        nildb_keys_saved: this.encryptedStats.nildbKeysSaved,
        total_new_aircraft: this.stats.totalNewAircraft,
        total_updates: this.stats.totalUpdates,
        total_reappeared: this.stats.totalReappeared,
        total_poll_cycles: this.stats.totalPollCycles,
        peak_tpm: this.stats.peakTpm,
      });
    } catch (error) {
      this.logger.error(`Failed to persist stats: ${error.message}`);
    }
  }

  /**
   * Update TPM buckets
   * Called on each successful upload
   */
  private updateTpmEMA() {
    const now = Date.now();

    // Initialize on first upload
    if (this.lastBucketUpdate === 0) {
      this.lastBucketUpdate = now;
      this.tpmBuckets[this.currentBucketIndex] = 1;
      return;
    }

    // Calculate time elapsed since last bucket update
    const elapsed = now - this.lastBucketUpdate;

    // Rotate buckets if 5+ seconds have passed
    if (elapsed >= this.BUCKET_SIZE_MS) {
      const bucketsToRotate = Math.min(
        Math.floor(elapsed / this.BUCKET_SIZE_MS),
        this.TOTAL_BUCKETS
      );

      // Rotate and clear old buckets
      for (let i = 0; i < bucketsToRotate; i++) {
        this.currentBucketIndex = (this.currentBucketIndex + 1) % this.TOTAL_BUCKETS;
        this.tpmBuckets[this.currentBucketIndex] = 0;
      }

      this.lastBucketUpdate = now;
    }

    // Increment current bucket
    this.tpmBuckets[this.currentBucketIndex]++;
  }

  /**
   * Get current TPM from buckets (60-second sliding window)
   */
  private getCurrentTpm(): number {
    if (this.lastBucketUpdate === 0) {
      return 0;
    }

    // Sum all buckets - this gives us transactions in the last 60 seconds
    const totalUploads = this.tpmBuckets.reduce((sum, count) => sum + count, 0);

    // Total uploads in 60 seconds = TPM (Transactions Per Minute)
    const currentTpm = totalUploads;

    // Update TPM history every 3 seconds for UI graph
    const now = Date.now();
    if (now - this.lastTpmHistoryUpdate >= this.TPM_HISTORY_INTERVAL_MS) {
      this.tpmHistory.shift(); // Remove oldest
      this.tpmHistory.push(currentTpm); // Add newest
      this.lastTpmHistoryUpdate = now;
    }

    return currentTpm;
  }

  stopTracking() {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }

    // Stop automatic backup
    if (this.statsBackupService) {
      this.statsBackupService.stopAutoBackup();
    }

    const totalRequests = this.fetchStats.total200Responses + this.fetchStats.total304Responses;
    if (totalRequests > 0) {
      const cacheSavings = ((this.fetchStats.total304Responses / totalRequests) * 100).toFixed(1);
      this.logger.log(`[INFO] Final fetch statistics:`);
      this.logger.log(`   Total requests: ${totalRequests}`);
      this.logger.log(`   Full downloads: ${this.fetchStats.total200Responses} (${(this.fetchStats.totalBytesDownloaded / 1024 / 1024).toFixed(1)}MB)`);
      this.logger.log(`   Cached responses: ${this.fetchStats.total304Responses} (${cacheSavings}% cache hit)`);
      this.logger.log(`   Bandwidth saved: ${(this.fetchStats.bandwidthSavedBytes / 1024 / 1024).toFixed(1)}MB`);
    }

    this.lastETag = null;
    this.lastModified = null;
    this.cachedAircraftData = null;
    this.pendingRequest = null;

    this.httpsAgent.destroy();
    this.logger.log('[INFO] Aircraft tracking stopped');
  }

  private async loadExistingTracks() {
    const recentTracks = await this.aircraftTrackRepo.find({
      where: { status: 'active' },
      order: { last_seen: 'DESC' },
      take: 1000,
    });

    this.logger.log(`[INFO] Loaded ${recentTracks.length} existing aircraft tracks`);
  }

  private startPolling() {
    const poll = async () => {
      if (!this.isRunning) return;

      try {
        await this.pollAndProcess();
      } catch (error) {
        this.logger.error(`Polling error: ${error.message}`);
      }

      this.pollTimer = setTimeout(poll, this.POLL_INTERVAL_MS);
    };

    poll();
  }

  private async broadcastStatsUpdate() {
    if (!this.isRunning) return;

    try {
      const now = Date.now();

      if (this.cachedFullStats && (now - this.lastFullStatsUpdate) < this.FULL_STATS_CACHE_MS) {
        this.statsGateway.broadcastStats(this.cachedFullStats);
      } else {

        const stats = await this.getStats();
        this.cachedFullStats = { success: true, stats };
        this.lastFullStatsUpdate = now;
        this.statsGateway.broadcastStats(this.cachedFullStats);
      }
    } catch (error) {
      this.logger.error(`WebSocket broadcast error: ${error.message}`);
    }
  }

  private async pollAndProcess() {
    const startTime = Date.now();
    this.stats.totalPollCycles++;
    this.sessionStats.pollCycles++;
    this.stats.lastPollTime = startTime;

    const aircraftData = await this.fetchAircraftData();
    if (!aircraftData || !aircraftData.aircraft) {
      this.logger.warn('No aircraft data received');
      return;
    }

    this.stats.currentlyFlying = aircraftData.aircraft.length;

    const currentHexSet = new Set<string>();
    const seenInThisPoll = new Set<string>();
    let newCount = 0;
    let updatedCount = 0;
    let reappearedCount = 0;

    for (const aircraft of aircraftData.aircraft) {
      const hex = aircraft.hex;

      if (seenInThisPoll.has(hex)) {
        this.logger.warn(`[WARN] Duplicate aircraft in API response: ${hex} - skipping`);
        continue;
      }
      seenInThisPoll.add(hex);
      currentHexSet.add(hex);

      const cached = this.aircraftCache.get(hex);
      const now = Date.now();

      const currentHash = this.calculateAircraftHash(aircraft);

      if (!cached) {

        this.logger.log(`[NEW] [POLL] Detected NEW aircraft: ${hex}, queuing handler...`);
        this.handleNewAircraft(aircraft, aircraftData.now, currentHash);
        newCount++;
        this.stats.totalNewAircraft++;
      } else {
        const timeSinceLastSeen = now - cached.lastSeen;

        if (timeSinceLastSeen > this.REAPPEAR_THRESHOLD_MS) {

          this.logger.debug(`[REAPPEAR] Aircraft reappeared: ${hex} (was gone for ${Math.round(timeSinceLastSeen / 1000)}s)`);
          this.handleReappearedAircraft(aircraft, aircraftData.now, currentHash);
          reappearedCount++;
          this.stats.totalReappeared++;
        } else if (currentHash !== cached.hash) {

          this.logger.debug(`[UPDATE] Aircraft updated: ${hex}`);
          this.handleUpdatedAircraft(aircraft, aircraftData.now, currentHash, cached);
          updatedCount++;
          this.stats.totalUpdates++;
        } else {

          cached.lastSeen = now;
        }
      }
    }

    this.markMissingAircraftAsOutOfRange(currentHexSet);

    // Process both pipelines in parallel for better throughput
    const batchPromises: Promise<void>[] = [];

    if (this.aircraftBatch.length > 0) {
      batchPromises.push(this.processBatch());
    }

    if (this.encryptedAircraftBatch.length > 0) {
      batchPromises.push(this.processEncryptedBatch());
    }

    if (batchPromises.length > 0) {
      await Promise.all(batchPromises);
    }

    const totalChanges = newCount + updatedCount + reappearedCount;
    if (totalChanges > 0) {
      this.logger.log(`[POLL] Detected ${totalChanges} changes: ${newCount} new, ${updatedCount} updated, ${reappearedCount} reappeared (batch size: ${this.aircraftBatch.length}, queue size: ${this.uploadQueue.length}, active: ${this.activeUploads})`);

      this.broadcastStatsUpdate();

      this.scheduleStatsPersist();
    }
    const processingTime = Date.now() - startTime;
    if (processingTime > 500) {
      this.logger.warn(`[WARN] Slow processing: ${processingTime}ms for ${aircraftData.aircraft.length} aircraft`);
    }
  }

  private async fetchAircraftData(): Promise<any> {
    if (this.pendingRequest) {
      return this.pendingRequest;
    }

    this.pendingRequest = new Promise((resolve, reject) => {
      const headers: any = {
        'Connection': 'keep-alive',
      };

      if (this.lastETag) {
        headers['If-None-Match'] = this.lastETag;
      }
      if (this.lastModified) {
        headers['If-Modified-Since'] = this.lastModified;
      }

      const req = https.get(
        'https://antenna-1.derad.org/aircraft.json',
        {
          agent: this.httpsAgent,
          headers,
        },
        (res) => {
          if (res.statusCode === 304) {
            this.fetchStats.total304Responses++;
            this.fetchStats.bandwidthSavedBytes += this.cachedAircraftData ? JSON.stringify(this.cachedAircraftData).length : 0;

            if (this.fetchStats.total304Responses % 100 === 0) {
              this.logger.log(`[BANDWIDTH] Optimization: ${this.fetchStats.total304Responses} 304 responses, saved ${(this.fetchStats.bandwidthSavedBytes / 1024 / 1024).toFixed(1)}MB`);
            }

            req.destroy();
            resolve(this.cachedAircraftData);
            return;
          }

          this.fetchStats.total200Responses++;
          let data = '';
          let bytesReceived = 0;

          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            data += chunk;
            bytesReceived += Buffer.byteLength(chunk, 'utf8');
          });

          res.on('end', () => {
            try {
              const parsedData = JSON.parse(data);

              this.fetchStats.totalBytesDownloaded += bytesReceived;

              this.lastETag = res.headers['etag'] || null;
              this.lastModified = res.headers['last-modified'] || null;
              this.cachedAircraftData = parsedData;

              if (this.fetchStats.total200Responses % 100 === 0) {
                const totalRequests = this.fetchStats.total200Responses + this.fetchStats.total304Responses;
                const cacheSavings = totalRequests > 0 ? ((this.fetchStats.total304Responses / totalRequests) * 100).toFixed(1) : '0';
                this.logger.log(`[FETCH] Stats: ${this.fetchStats.total200Responses} full downloads (${(this.fetchStats.totalBytesDownloaded / 1024 / 1024).toFixed(1)}MB), ${this.fetchStats.total304Responses} cached (${cacheSavings}% cache hit rate)`);
              }

              resolve(parsedData);
            } catch (error) {
              this.cachedAircraftData = null;
              this.lastETag = null;
              this.lastModified = null;
              reject(error);
            }
          });

          res.on('error', reject);
        },
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });

    try {
      const result = await this.pendingRequest;
      return result;
    } finally {
      this.pendingRequest = null;
    }
  }

  private calculateAircraftHash(aircraft: any): string {
    // Use xxHash64 for 10x faster hashing (vs MD5)
    // Direct string concatenation is faster than JSON.stringify
    const str = `${aircraft.lat}|${aircraft.lon}|${aircraft.alt_baro}|${aircraft.alt_geom}|${aircraft.gs}|${aircraft.track}|${aircraft.baro_rate}|${aircraft.squawk}|${aircraft.emergency}|${aircraft.flight}`;
    return xxh64(str).toString(16);
  }

  private async handleNewAircraft(aircraft: any, snapshotTime: number, hash: string) {
    const now = Date.now();
    const hex = aircraft.hex;

    this.logger.log(`[HANDLER-START] handleNewAircraft called for ${hex}`);

    if (this.aircraftCache.has(hex)) {

      this.logger.warn(`[HANDLER-SKIP] ${hex} already in cache, skipping duplicate handler`);
      return;
    }

    this.logger.log(`[HANDLER-CACHE] Adding ${hex} to cache`);
    this.aircraftCache.set(hex, {
      hex,
      data: aircraft,
      hash,
      lastSeen: now,
      lastUploaded: now,
    });

    this.logger.debug(`[HANDLER-BATCH] Adding ${hex} to batch`);
    this.addToBatch(aircraft, snapshotTime, hex);
  }

  private async handleReappearedAircraft(aircraft: any, snapshotTime: number, hash: string) {
    const now = Date.now();
    const hex = aircraft.hex;

    this.aircraftCache.set(hex, {
      hex,
      data: aircraft,
      hash,
      lastSeen: now,
      lastUploaded: now,
    });

    this.logger.debug(`[HANDLER-BATCH] Adding reappeared ${hex} to batch`);
    this.addToBatch(aircraft, snapshotTime, hex);
  }

  private async handleUpdatedAircraft(
    aircraft: any,
    snapshotTime: number,
    hash: string,
    cached: AircraftState,
  ) {
    const now = Date.now();
    const hex = aircraft.hex;

    cached.data = aircraft;
    cached.hash = hash;
    cached.lastSeen = now;
    cached.lastUploaded = now;

    this.logger.debug(`[HANDLER-BATCH] Adding updated ${hex} to batch`);
    this.addToBatch(aircraft, snapshotTime, hex);
  }

  private markMissingAircraftAsOutOfRange(currentHexSet: Set<string>) {
    const now = Date.now();
    const outOfRangeHexes: string[] = [];

    for (const [hex, cached] of this.aircraftCache.entries()) {
      if (!currentHexSet.has(hex)) {
        const timeSinceLastSeen = now - cached.lastSeen;

        if (timeSinceLastSeen > this.REAPPEAR_THRESHOLD_MS) {
          this.logger.debug(`[OUT-OF-RANGE] Aircraft out of range: ${hex}`);
          this.aircraftCache.delete(hex);
          outOfRangeHexes.push(hex);
        }
      }
    }

    // Bulk update all out-of-range aircraft in single query
    if (outOfRangeHexes.length > 0) {
      this.aircraftTrackRepo
        .update({ hex: In(outOfRangeHexes) }, { status: 'out_of_range', last_seen: now })
        .catch((err) => this.logger.error(`Failed to update out-of-range status: ${err.message}`));
    }
  }

  private addToBatch(aircraft: any, snapshotTime: number, hex: string) {
    // Add to BOTH pipelines - upload both encrypted and unencrypted versions
    this.aircraftBatch.push({ aircraft, snapshotTime, hex });
    this.addToEncryptedBatch(aircraft, snapshotTime, hex);
  }

  private async processBatch() {
    if (this.aircraftBatch.length === 0) return;

    const totalAircraft = this.aircraftBatch.length;
    const batches: Array<typeof this.aircraftBatch> = [];

    for (let i = 0; i < this.aircraftBatch.length; i += this.MAX_AIRCRAFT_PER_BATCH) {
      const batch = this.aircraftBatch.slice(i, i + this.MAX_AIRCRAFT_PER_BATCH);
      batches.push(batch);
    }

    this.aircraftBatch = [];

    if (batches.length > 1) {
      this.logger.log(`📦 [BATCH] Split ${totalAircraft} aircraft into ${batches.length} batches of max ${this.MAX_AIRCRAFT_PER_BATCH} aircraft (Turbo SDK tag limit)`);
    }

    // Generate a single UUID for each batch (will be shared between encrypted and unencrypted versions)
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const packageUuid = uuidv4();

      // Create a unique batch identifier based on timestamp and first aircraft hex
      const batchId = `${batch[0].snapshotTime}-${batch[0].hex}-${i}`;
      this.batchUuidMap.set(batchId, packageUuid);

      this.uploadQueue.push({ batch, packageUuid, batchId });
    }

    if (batches.length > 0) {
      this.broadcastStatsUpdate();
    }

    this.processQueue();
  }

  private async processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.uploadQueue.length > 0 && this.activeUploads < this.MAX_CONCURRENT_UPLOADS && this.availableSlots.size > 0) {
      const queueItem = this.uploadQueue.shift();
      if (!queueItem) break;

      const slotId = Array.from(this.availableSlots)[0];
      this.availableSlots.delete(slotId);

      this.activeUploads++;
      const queueSize = this.uploadQueue.length;
      this.logger.debug(`[QUEUE] Processing batch upload in slot ${slotId} (${this.activeUploads}/${this.MAX_CONCURRENT_UPLOADS} active, ${queueSize} queued)`);

      this.uploadProgress.set(slotId, {
        startTime: Date.now(),
        progress: 0,
        status: 'uploading'
      });

      this.broadcastStatsUpdate();

      this.executeWithRetry(() => this.uploadBatch(queueItem.batch, slotId, queueItem.packageUuid), `batch-${Date.now()}`, slotId)
        .finally(() => {
          this.activeUploads--;
          this.uploadProgress.delete(slotId);
          this.availableSlots.add(slotId);

          this.broadcastStatsUpdate();

          this.scheduleStatsPersist();

          this.processQueue();
        });
    }

    this.isProcessingQueue = false;
  }

  // ==================== ENCRYPTED PIPELINE ====================

  private addToEncryptedBatch(aircraft: any, snapshotTime: number, hex: string) {
    this.encryptedAircraftBatch.push({ aircraft, snapshotTime, hex });
  }

  private async processEncryptedBatch() {
    if (this.encryptedAircraftBatch.length === 0) return;

    const totalAircraft = this.encryptedAircraftBatch.length;
    const batches: Array<typeof this.encryptedAircraftBatch> = [];

    for (let i = 0; i < this.encryptedAircraftBatch.length; i += this.MAX_AIRCRAFT_PER_BATCH) {
      const batch = this.encryptedAircraftBatch.slice(i, i + this.MAX_AIRCRAFT_PER_BATCH);
      batches.push(batch);
    }

    this.encryptedAircraftBatch = [];

    if (batches.length > 1) {
      this.logger.log(`🔒 [ENCRYPTED BATCH] Split ${totalAircraft} aircraft into ${batches.length} batches of max ${this.MAX_AIRCRAFT_PER_BATCH} aircraft (Turbo SDK tag limit)`);
    }

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      // Generate the same batch identifier to retrieve the UUID
      const batchId = `${batch[0].snapshotTime}-${batch[0].hex}-${i}`;
      const packageUuid = this.batchUuidMap.get(batchId) || uuidv4(); // Use existing UUID or generate new if not found

      this.encryptedUploadQueue.push({ batch, packageUuid, batchId });
    }

    if (batches.length > 0) {
      this.broadcastStatsUpdate();
    }

    this.processEncryptedQueue();
  }

  private async processEncryptedQueue() {
    if (this.isProcessingEncryptedQueue) return;
    this.isProcessingEncryptedQueue = true;

    while (this.encryptedUploadQueue.length > 0 && this.encryptedActiveUploads < this.MAX_CONCURRENT_ENCRYPTED_UPLOADS && this.encryptedAvailableSlots.size > 0) {
      const queueItem = this.encryptedUploadQueue.shift();
      if (!queueItem) break;

      const slotId = Array.from(this.encryptedAvailableSlots)[0];
      this.encryptedAvailableSlots.delete(slotId);

      this.encryptedActiveUploads++;
      const queueSize = this.encryptedUploadQueue.length;
      this.logger.debug(`🔒 [ENCRYPTED QUEUE] Processing batch upload in slot ${slotId} (${this.encryptedActiveUploads}/${this.MAX_CONCURRENT_ENCRYPTED_UPLOADS} active, ${queueSize} queued)`);

      this.encryptedUploadProgress.set(slotId, {
        startTime: Date.now(),
        progress: 0,
        status: 'uploading'
      });

      this.broadcastStatsUpdate();

      this.executeWithRetry(() => this.uploadEncryptedBatch(queueItem.batch, slotId, queueItem.packageUuid), `encrypted-batch-${Date.now()}`, slotId, 1, 5, true)
        .finally(() => {
          this.encryptedActiveUploads--;
          this.encryptedUploadProgress.delete(slotId);
          this.encryptedAvailableSlots.add(slotId);

          this.broadcastStatsUpdate();

          this.scheduleStatsPersist();

          this.processEncryptedQueue();
        });
    }

    this.isProcessingEncryptedQueue = false;
  }

  // ==================== END ENCRYPTED PIPELINE ====================

  private async executeWithRetry(
    uploadFn: () => Promise<void>,
    hex: string,
    slotId?: number,
    attempt: number = 1,
    maxAttempts: number = 5,
    isEncrypted: boolean = false,
  ): Promise<void> {
    try {
      // Only increment totalUploadsAttempted on the FIRST attempt, not on retries
      // This ensures: totalUploadsAttempted = totalUploadsSucceeded + totalUploadsFailed
      if (attempt === 1) {
        if (isEncrypted) {
          this.encryptedStats.totalUploadsAttempted++;
        } else {
          this.stats.totalUploadsAttempted++;
        }
      }

      const progressMap = isEncrypted ? this.encryptedUploadProgress : this.uploadProgress;
      if (slotId && progressMap.has(slotId)) {
        const progress = progressMap.get(slotId);
        if (progress) {
          progress.progress = 5;
          progress.status = 'uploading';
        }
      }

      await uploadFn();

      if (isEncrypted) {
        this.encryptedStats.totalUploadsSucceeded++;
        this.sessionStats.encryptedUploadsSucceeded++;
      } else {
        this.stats.totalUploadsSucceeded++;
        this.sessionStats.uploadsSucceeded++;
      }

      // Update TPM EMA
      this.updateTpmEMA();

      if (slotId && progressMap.has(slotId)) {
        const progress = progressMap.get(slotId);
        if (progress) {
          progress.progress = 100;
          progress.status = 'completed';
        }
      }
    } catch (error) {
      if (attempt >= maxAttempts) {
        if (isEncrypted) {
          this.encryptedStats.totalUploadsFailed++;
        } else {
          this.stats.totalUploadsFailed++;
        }
        this.logger.error(`[RETRY] Failed after ${maxAttempts} attempts for ${hex}: ${error.message}`);

        const progressMap = isEncrypted ? this.encryptedUploadProgress : this.uploadProgress;
        if (slotId && progressMap.has(slotId)) {
          const progress = progressMap.get(slotId);
          if (progress) {
            progress.status = 'failed';
          }
        }

        return;
      }

      if (isEncrypted) {
        this.encryptedStats.totalRetries++;
      } else {
        this.stats.totalRetries++;
      }
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 16000);
      this.logger.warn(`[RETRY] Attempt ${attempt}/${maxAttempts} failed for ${hex}, retrying in ${backoffMs}ms: ${error.message}`);

      const progressMap = isEncrypted ? this.encryptedUploadProgress : this.uploadProgress;
      if (slotId && progressMap.has(slotId)) {
        const progress = progressMap.get(slotId);
        if (progress) {
          progress.status = 'retrying';
        }
      }

      await new Promise(resolve => setTimeout(resolve, backoffMs));
      return this.executeWithRetry(uploadFn, hex, slotId, attempt + 1, maxAttempts, isEncrypted);
    }
  }

  private async uploadBatch(batch: Array<{ aircraft: any; snapshotTime: number; hex: string }>, slotId?: number, packageUuid?: string): Promise<void> {
    if (batch.length === 0) return;

    const timestamp = batch[0].snapshotTime;
    const aircraftList = batch.map(item => item.aircraft);

    this.logger.log(`📦 [BATCH] Uploading ${batch.length} aircraft in batch (slot ${slotId || 'N/A'})`);

    if (slotId && this.uploadProgress.has(slotId)) {
      const progress = this.uploadProgress.get(slotId);
      if (progress) {
        progress.progress = 20;
      }
    }

    try {

      if (slotId && this.uploadProgress.has(slotId)) {
        const progress = this.uploadProgress.get(slotId);
        if (progress) {
          progress.progress = 40;
        }
      }

      const txId = await this.archiveService.uploadBatchParquet(aircraftList, timestamp, packageUuid);

      if (slotId && this.uploadProgress.has(slotId)) {
        const progress = this.uploadProgress.get(slotId);
        if (progress) {
          progress.progress = 70;
        }
      }

      this.logger.log(`[BATCH] Uploaded ${batch.length} aircraft → ${txId}`);

      // Bulk database operations - single query instead of N+1
      const now = Date.now();
      const hexList = batch.map(item => item.hex);

      // Single bulk lookup for all aircraft in batch
      const existingTracks = await this.aircraftTrackRepo.find({
        where: { hex: In(hexList) }
      });
      const existingMap = new Map(existingTracks.map(track => [track.hex, track]));

      const toUpdate: AircraftTrack[] = [];
      const toInsert: any[] = [];

      for (const item of batch) {
        const existing = existingMap.get(item.hex);

        if (existing) {
          // Update existing aircraft
          existing.last_seen = now;
          existing.last_uploaded = now;
          existing.last_tx_id = txId;
          existing.upload_count += 1;
          existing.total_updates += 1;
          existing.callsign = item.aircraft.flight?.trim() || existing.callsign;
          existing.last_position = {
            latitude: item.aircraft.lat,
            longitude: item.aircraft.lon,
            altitude_baro_ft: item.aircraft.alt_baro,
          };
          toUpdate.push(existing);
        } else {
          // New aircraft - prepare for bulk insert
          toInsert.push({
            hex: item.hex,
            callsign: item.aircraft.flight?.trim() || null,
            registration: item.aircraft.r || null,
            aircraft_type: item.aircraft.t || null,
            first_seen: now,
            last_seen: now,
            last_uploaded: now,
            last_tx_id: txId,
            upload_count: 1,
            total_updates: 0,
            status: 'active',
            last_position: {
              latitude: item.aircraft.lat,
              longitude: item.aircraft.lon,
              altitude_baro_ft: item.aircraft.alt_baro,
            },
          });
        }
      }

      // Bulk save operations
      // CRITICAL: Use save() for both update and insert to avoid UNIQUE constraint violations
      // in parallel processing. save() automatically handles UPSERT.
      const allTracks = [...toUpdate, ...toInsert];
      if (allTracks.length > 0) {
        await this.aircraftTrackRepo.save(allTracks);
      }

      if (slotId && this.uploadProgress.has(slotId)) {
        const progress = this.uploadProgress.get(slotId);
        if (progress) {
          progress.progress = 95;
        }
      }
    } catch (error) {
      this.logger.error(`[BATCH] Failed to upload batch: ${error.message}`);
      throw error;
    }
  }

  private async uploadEncryptedBatch(batch: Array<{ aircraft: any; snapshotTime: number; hex: string }>, slotId?: number, packageUuid?: string): Promise<void> {
    if (batch.length === 0) return;

    const timestamp = batch[0].snapshotTime;
    const aircraftList = batch.map(item => item.aircraft);

    this.logger.log(`🔒 [ENCRYPTED BATCH] Uploading ${batch.length} aircraft in encrypted batch (slot ${slotId || 'N/A'})`);

    if (slotId && this.encryptedUploadProgress.has(slotId)) {
      const progress = this.encryptedUploadProgress.get(slotId);
      if (progress) {
        progress.progress = 20;
      }
    }

    try {

      if (slotId && this.encryptedUploadProgress.has(slotId)) {
        const progress = this.encryptedUploadProgress.get(slotId);
        if (progress) {
          progress.progress = 40;
        }
      }

      const result = await this.archiveService.uploadBatchParquetEncrypted(aircraftList, timestamp, packageUuid);
      const txId = result.txId;

      // nilDB key storage happens asynchronously in the background
      // We increment the counter optimistically since the upload succeeded
      // (actual nilDB success/failure is logged separately)
      this.encryptedStats.nildbKeysSaved++;
      this.logger.log(`🔒 nilDB key storage initiated (total: ${this.encryptedStats.nildbKeysSaved})`);


      if (slotId && this.encryptedUploadProgress.has(slotId)) {
        const progress = this.encryptedUploadProgress.get(slotId);
        if (progress) {
          progress.progress = 70;
        }
      }

      this.logger.log(`🔒 [ENCRYPTED BATCH] Uploaded ${batch.length} aircraft → ${txId}`);

      // Bulk database operations - single query instead of N+1
      const now = Date.now();
      const hexList = batch.map(item => item.hex);

      // Single bulk lookup for all aircraft in batch
      const existingTracks = await this.aircraftTrackRepo.find({
        where: { hex: In(hexList) }
      });
      const existingMap = new Map(existingTracks.map(track => [track.hex, track]));

      const toUpdate: AircraftTrack[] = [];
      const toInsert: any[] = [];

      for (const item of batch) {
        const existing = existingMap.get(item.hex);

        if (existing) {
          // Update existing aircraft
          existing.last_seen = now;
          existing.last_uploaded = now;
          existing.last_tx_id = txId;
          existing.upload_count += 1;
          existing.total_updates += 1;
          existing.callsign = item.aircraft.flight?.trim() || existing.callsign;
          existing.last_position = {
            latitude: item.aircraft.lat,
            longitude: item.aircraft.lon,
            altitude_baro_ft: item.aircraft.alt_baro,
          };
          toUpdate.push(existing);
        } else {
          // New aircraft - prepare for bulk insert
          toInsert.push({
            hex: item.hex,
            callsign: item.aircraft.flight?.trim() || null,
            registration: item.aircraft.r || null,
            aircraft_type: item.aircraft.t || null,
            first_seen: now,
            last_seen: now,
            last_uploaded: now,
            last_tx_id: txId,
            upload_count: 1,
            total_updates: 0,
            status: 'active',
            last_position: {
              latitude: item.aircraft.lat,
              longitude: item.aircraft.lon,
              altitude_baro_ft: item.aircraft.alt_baro,
            },
          });
        }
      }

      // Bulk save operations
      // CRITICAL: Use save() for both update and insert to avoid UNIQUE constraint violations
      // in parallel processing. save() automatically handles UPSERT.
      const allTracks = [...toUpdate, ...toInsert];
      if (allTracks.length > 0) {
        await this.aircraftTrackRepo.save(allTracks);
      }

      if (slotId && this.encryptedUploadProgress.has(slotId)) {
        const progress = this.encryptedUploadProgress.get(slotId);
        if (progress) {
          progress.progress = 95;
        }
      }
    } catch (error) {
      this.logger.error(`🔒 [ENCRYPTED BATCH] Failed to upload encrypted batch: ${error.message}`);
      throw error;
    }
  }

  async getStats() {
    const now = Date.now();

    // Only update count every 5 seconds to avoid expensive COUNT queries
    if (now - this.lastTracksCountUpdate > this.TRACKS_COUNT_CACHE_MS) {
      this.cachedTotalTracks = await this.aircraftTrackRepo.count();
      this.lastTracksCountUpdate = now;
    }

    const totalTracks = this.cachedTotalTracks;
    const cachedAircraft = this.aircraftCache.size;
    const currentlyFlying = this.stats.currentlyFlying;

    const uptimeSeconds = this.stats.systemStartTime > 0 ? Math.floor((now - this.stats.systemStartTime) / 1000) : 0;
    const successRate = this.stats.totalUploadsAttempted > 0
      ? ((this.stats.totalUploadsSucceeded / this.stats.totalUploadsAttempted) * 100).toFixed(2)
      : '0.00';

    return {

      system: {
        is_running: this.isRunning,
        uptime_seconds: uptimeSeconds,
        uptime_formatted: this.formatUptime(uptimeSeconds),
        system_start_time: this.stats.systemStartTime,
        last_poll_time: this.stats.lastPollTime,
        total_poll_cycles: this.stats.totalPollCycles,
        poll_interval_ms: this.POLL_INTERVAL_MS,
        reappear_threshold_seconds: this.REAPPEAR_THRESHOLD_MS / 1000,
      },

      aircraft: {
        total_tracked_all_time: totalTracks,
        currently_active: currentlyFlying,
        in_memory_cache: cachedAircraft,
        total_new: this.stats.totalNewAircraft,
        total_updates: this.stats.totalUpdates,
        total_reappeared: this.stats.totalReappeared,
      },

      queue: {
        queue_size: this.uploadQueue.length,
        active_uploads: this.activeUploads,
        max_concurrent: this.MAX_CONCURRENT_UPLOADS,
        available_slots: this.MAX_CONCURRENT_UPLOADS - this.activeUploads,
        is_processing: this.isProcessingQueue,
        upload_progress: Array.from(this.uploadProgress.entries()).map(([slotId, data]) => ({
          slot_id: slotId,
          progress: data.progress,
          status: data.status,
          elapsed_ms: Date.now() - data.startTime,
        })),
      },

      encrypted_queue: {
        queue_size: this.encryptedUploadQueue.length,
        active_uploads: this.encryptedActiveUploads,
        max_concurrent: this.MAX_CONCURRENT_ENCRYPTED_UPLOADS,
        available_slots: this.MAX_CONCURRENT_ENCRYPTED_UPLOADS - this.encryptedActiveUploads,
        is_processing: this.isProcessingEncryptedQueue,
        upload_progress: Array.from(this.encryptedUploadProgress.entries()).map(([slotId, data]) => ({
          slot_id: slotId,
          progress: data.progress,
          status: data.status,
          elapsed_ms: Date.now() - data.startTime,
        })),
        total_attempted: this.encryptedStats.totalUploadsAttempted,
        total_succeeded: this.encryptedStats.totalUploadsSucceeded,
        total_failed: this.encryptedStats.totalUploadsFailed,
        total_retries: this.encryptedStats.totalRetries,
      },

      uploads: {
        total_attempted: this.stats.totalUploadsAttempted,
        total_succeeded: this.stats.totalUploadsSucceeded,
        total_failed: this.stats.totalUploadsFailed,
        total_retries: this.stats.totalRetries,
        success_rate_percent: parseFloat(successRate),
        average_retries_per_upload: this.stats.totalUploadsAttempted > 0
          ? (this.stats.totalRetries / this.stats.totalUploadsAttempted).toFixed(2)
          : '0.00',
      },

      performance: {
        tpm: (() => {
          // Get current TPM from EMA
          const currentTpm = this.getCurrentTpm();

          // Track peak TPM
          if (currentTpm > this.stats.peakTpm) {
            this.stats.peakTpm = currentTpm;
            this.scheduleStatsPersist();
          }

          // Show rounded number if >= 1, otherwise show 2 decimals
          return currentTpm >= 1 ? Math.round(currentTpm).toString() : currentTpm.toFixed(2);
        })(),

        peak_tpm: (() => {
          const peak = this.stats.peakTpm;
          return peak >= 1 ? Math.round(peak).toString() : peak.toFixed(2);
        })(),

        tpm_history: this.tpmHistory, // Last 30 TPM values for graph

        polls_per_minute: (() => {
          if (this.sessionStats.pollCycles === 0) return '0.00';
          const sessionUptimeSeconds = Math.floor((Date.now() - this.sessionStats.sessionStartTime) / 1000);
          if (sessionUptimeSeconds === 0) return '0.00';
          return ((this.sessionStats.pollCycles / sessionUptimeSeconds) * 60).toFixed(2);
        })(),

        changes_per_poll: this.stats.totalPollCycles > 0
          ? ((this.stats.totalNewAircraft + this.stats.totalUpdates + this.stats.totalReappeared) / this.stats.totalPollCycles).toFixed(2)
          : '0.00',
      },

      nildb: {
        keys_saved: this.encryptedStats.nildbKeysSaved,
      },
    };
  }

  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    return parts.join(' ');
  }
}
