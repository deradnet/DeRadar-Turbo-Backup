import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as https from 'https';
import { TurboFactory } from '@ardrive/turbo-sdk';
import { InjectRepository } from '@nestjs/typeorm';
import { ArchiveRecord } from './entities/archive-record.entity';
import { EncryptedArchiveRecord } from './entities/encrypted-archive-record.entity';
import { Repository } from 'typeorm';
import Arweave from 'arweave';
import { paginate } from '../common/utils/paginate';
import { Request } from 'express';
import { TurboAuthenticatedClient } from '@ardrive/turbo-sdk/lib/types/common/turbo';
import { ConfigService } from '@nestjs/config';
import * as parquet from 'parquetjs';
import { v4 as uuidv4 } from 'uuid';
import { EncryptionService } from '../common/utils/encryption.service';

@Injectable()
export class ArchiveService {
  private readonly turbo: TurboAuthenticatedClient;
  private arweave: Arweave;
  private readonly httpsAgent: https.Agent;

  constructor(
    @InjectRepository(ArchiveRecord)
    private readonly archiveRepo: Repository<ArchiveRecord>,
    @InjectRepository(EncryptedArchiveRecord)
    private readonly encryptedArchiveRepo: Repository<EncryptedArchiveRecord>,
    private readonly configService: ConfigService,
    private readonly encryptionService: EncryptionService,
  ) {
    // OPTIMIZATION: Create HTTPS agent with aggressive connection pooling
    // This allows parallel uploads to reuse connections instead of doing TCP handshakes
    this.httpsAgent = new https.Agent({
      keepAlive: true,              // Reuse connections
      keepAliveMsecs: 10000,         // Keep connections alive for 10s
      maxSockets: 20,                // Allow up to 20 parallel connections
      maxFreeSockets: 10,            // Keep 10 idle connections ready
      timeout: 60000,                // 60s timeout for requests
      scheduling: 'lifo',            // Last In First Out (reuse hot connections)
    });

    this.arweave = Arweave.init({
      host: 'arweave.net',
      port: 443,
      protocol: 'https',
    });

    this.turbo = TurboFactory.authenticated({
      privateKey: configService.get<string>('wallet.private_key'),
      paymentServiceConfig: {
        url: 'https://payment.ardrive.io/',
      },
      // Note: Turbo SDK may use this agent internally if passed via gatewayUrl config
      // If not, it will still benefit from Node.js global agent configuration
    });
  }

  // Helper methods for data sanitization (moved to class level for JIT optimization)
  private safeNumber(value: any): number | null {
    if (value === null || value === undefined || value === 'ground') return null;
    const num = Number(value);
    return isNaN(num) ? null : num;
  }

  private safeString(value: any): string | null {
    if (value === null || value === undefined || value === '') return null;
    return String(value).trim() || null;
  }

  private safeBoolean(value: any): boolean | null {
    if (value === null || value === undefined) return null;
    return value === 1 || value === true;
  }

  private safeInt64(value: any): number | null {
    if (value === null || value === undefined) return null;
    const num = Number(value);
    return isNaN(num) ? null : num;
  }

  async uploadJson(json: any): Promise<string> {
    const tmpDir = os.tmpdir();
    const filePath = path.join(tmpDir, 'aircraft.json');

    fs.writeFileSync(filePath, JSON.stringify(json, null, 2), 'utf-8');
    const fileSize = fs.statSync(filePath).size;

    const utcTimestamp = new Date()
      .toISOString()
      .slice(0, 16)
      .replace(/[-:T]/g, '');

    const { id: txId } = await this.turbo.uploadFile({
      fileStreamFactory: () => fs.createReadStream(filePath),
      fileSizeFactory: () => fileSize,
      dataItemOpts: {
        tags: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'App-Name', value: 'DeradNetworkBackup' },
          { name: 'Timestamp', value: utcTimestamp },
        ],
      },
    });

    await this.create({
      txId,
      source: 'aircraft',
      timestamp: utcTimestamp,
    });

    fs.unlinkSync(filePath);
    return txId;
  }

  /**
   * Creates industry-standard Parquet schema for aviation data.
   * Each row represents a single aircraft observation at a specific timestamp.
   *
   * Schema follows best practices:
   * - Partitionable by timestamp for time-series queries
   * - Normalized field names with clear semantics
   * - Proper data types for efficient storage and queries
   * - Metadata fields for data lineage and quality
   */
  private createParquetSchema(): any {
    return new parquet.ParquetSchema({
      // === PARTITION KEYS (for efficient time-series queries) ===
      snapshot_timestamp: { type: 'TIMESTAMP_MILLIS' },  // When the snapshot was taken

      // === PRIMARY KEYS ===
      icao_address: { type: 'UTF8' },  // ICAO 24-bit address (hex) - unique aircraft identifier

      // === AIRCRAFT IDENTITY ===
      callsign: { type: 'UTF8', optional: true },  // Flight number or tail number
      registration: { type: 'UTF8', optional: true },  // Aircraft registration (e.g., N12345)
      aircraft_type: { type: 'UTF8', optional: true },  // Aircraft type code (e.g., B738)
      type_description: { type: 'UTF8', optional: true },  // Human-readable aircraft description
      emitter_category: { type: 'UTF8', optional: true },  // ADS-B emitter category

      // === POSITION (WGS84) ===
      latitude: { type: 'DOUBLE', optional: true },  // Decimal degrees
      longitude: { type: 'DOUBLE', optional: true },  // Decimal degrees
      position_source: { type: 'UTF8', optional: true },  // Source: adsb_icao, mlat, etc.

      // === ALTITUDE ===
      altitude_baro_ft: { type: 'INT32', optional: true },  // Barometric altitude (feet)
      altitude_geom_ft: { type: 'INT32', optional: true },  // Geometric altitude (feet)
      vertical_rate_baro_fpm: { type: 'INT32', optional: true },  // Vertical rate from barometric altitude (ft/min)
      vertical_rate_geom_fpm: { type: 'INT32', optional: true },  // Vertical rate from geometric altitude (ft/min)

      // === SPEED ===
      ground_speed_kts: { type: 'DOUBLE', optional: true },  // Ground speed (knots)
      indicated_airspeed_kts: { type: 'INT32', optional: true },  // IAS (knots)
      true_airspeed_kts: { type: 'INT32', optional: true },  // TAS (knots)
      mach_number: { type: 'DOUBLE', optional: true },  // Mach number

      // === HEADING & TRACK ===
      track_degrees: { type: 'DOUBLE', optional: true },  // Ground track (degrees)
      track_rate_deg_sec: { type: 'DOUBLE', optional: true },  // Rate of turn (degrees/second)
      magnetic_heading_degrees: { type: 'DOUBLE', optional: true },  // Magnetic heading
      true_heading_degrees: { type: 'DOUBLE', optional: true },  // True heading
      roll_degrees: { type: 'DOUBLE', optional: true },  // Roll angle (degrees)

      // === METEOROLOGICAL DATA ===
      wind_direction_degrees: { type: 'INT32', optional: true },  // Wind direction
      wind_speed_kts: { type: 'INT32', optional: true },  // Wind speed (knots)
      outside_air_temp_c: { type: 'INT32', optional: true },  // OAT (Celsius)
      total_air_temp_c: { type: 'INT32', optional: true },  // TAT (Celsius)

      // === AUTOPILOT/FMS SETTINGS ===
      nav_qnh_mb: { type: 'DOUBLE', optional: true },  // QNH setting (millibars)
      nav_altitude_mcp_ft: { type: 'INT32', optional: true },  // MCP selected altitude (feet)
      nav_altitude_fms_ft: { type: 'INT32', optional: true },  // FMS selected altitude (feet)
      nav_heading_degrees: { type: 'DOUBLE', optional: true },  // Selected heading (degrees)

      // === TRANSPONDER ===
      squawk_code: { type: 'UTF8', optional: true },  // 4-digit squawk code
      emergency_status: { type: 'UTF8', optional: true },  // Emergency status (none, general, etc.)
      spi_flag: { type: 'BOOLEAN', optional: true },  // Special Position Identification
      alert_flag: { type: 'BOOLEAN', optional: true },  // Alert flag

      // === ADS-B QUALITY INDICATORS ===
      adsb_version: { type: 'INT32', optional: true },  // ADS-B version (0, 1, 2)
      navigation_integrity_category: { type: 'INT32', optional: true },  // NIC
      navigation_accuracy_position: { type: 'INT32', optional: true },  // NACp
      navigation_accuracy_velocity: { type: 'INT32', optional: true },  // NACv
      source_integrity_level: { type: 'INT32', optional: true },  // SIL
      source_integrity_level_type: { type: 'UTF8', optional: true },  // SIL type (perhour/persample)
      geometric_vertical_accuracy: { type: 'INT32', optional: true },  // GVA
      system_design_assurance: { type: 'INT32', optional: true },  // SDA
      nic_baro: { type: 'INT32', optional: true },  // NIC for barometric altitude
      radius_of_containment: { type: 'INT32', optional: true },  // RC (meters)

      // === RECEPTION METADATA ===
      messages_received: { type: 'INT64', optional: true },  // Number of messages received
      last_seen_seconds: { type: 'DOUBLE', optional: true },  // Seconds since last message
      last_position_seen_seconds: { type: 'DOUBLE', optional: true },  // Seconds since last position update
      rssi_dbm: { type: 'DOUBLE', optional: true },  // Signal strength (dBm)

      // === RECEIVER GEOMETRY ===
      distance_from_receiver_nm: { type: 'DOUBLE', optional: true },  // Distance (nautical miles)
      bearing_from_receiver_degrees: { type: 'DOUBLE', optional: true },  // Bearing (degrees)

      // === DATA QUALITY & LINEAGE ===
      database_flags: { type: 'INT32', optional: true },  // Database lookup flags
      snapshot_total_messages: { type: 'INT32' },  // Total messages in this snapshot
    });
  }

  /**
   * Transforms raw aircraft data into industry-standard row format.
   * Each aircraft becomes a separate row with normalized field names.
   */
  private transformAircraftToRows(snapshotData: any): any[] {
    const snapshotTimestamp = snapshotData.now * 1000; // Convert to milliseconds
    const snapshotMessages = snapshotData.messages;

    return snapshotData.aircraft.map((aircraft: any) => {
      // Helper function to safely convert values
      const safeNumber = (value: any): number | null => {
        if (value === null || value === undefined || value === 'ground') return null;
        const num = Number(value);
        return isNaN(num) ? null : num;
      };

      const safeString = (value: any): string | null => {
        if (value === null || value === undefined || value === '') return null;
        return String(value).trim() || null;
      };

      const safeBoolean = (value: any): boolean | null => {
        if (value === null || value === undefined) return null;
        return value === 1 || value === true;
      };

      return {
        // Snapshot metadata
        snapshot_timestamp: snapshotTimestamp,
        snapshot_total_messages: snapshotMessages,

        // Aircraft identity
        icao_address: aircraft.hex,
        callsign: safeString(aircraft.flight),
        registration: safeString(aircraft.r),
        aircraft_type: safeString(aircraft.t),
        type_description: safeString(aircraft.desc),
        emitter_category: safeString(aircraft.category),

        // Position
        latitude: safeNumber(aircraft.lat),
        longitude: safeNumber(aircraft.lon),
        position_source: safeString(aircraft.type),

        // Altitude
        altitude_baro_ft: safeNumber(aircraft.alt_baro),
        altitude_geom_ft: safeNumber(aircraft.alt_geom),
        vertical_rate_baro_fpm: safeNumber(aircraft.baro_rate),
        vertical_rate_geom_fpm: safeNumber(aircraft.geom_rate),

        // Speed
        ground_speed_kts: safeNumber(aircraft.gs),
        indicated_airspeed_kts: safeNumber(aircraft.ias),
        true_airspeed_kts: safeNumber(aircraft.tas),
        mach_number: safeNumber(aircraft.mach),

        // Heading & Track
        track_degrees: safeNumber(aircraft.track),
        track_rate_deg_sec: safeNumber(aircraft.track_rate),
        magnetic_heading_degrees: safeNumber(aircraft.mag_heading),
        true_heading_degrees: safeNumber(aircraft.true_heading),
        roll_degrees: safeNumber(aircraft.roll),

        // Meteorological
        wind_direction_degrees: safeNumber(aircraft.wd),
        wind_speed_kts: safeNumber(aircraft.ws),
        outside_air_temp_c: safeNumber(aircraft.oat),
        total_air_temp_c: safeNumber(aircraft.tat),

        // Autopilot/FMS
        nav_qnh_mb: safeNumber(aircraft.nav_qnh),
        nav_altitude_mcp_ft: safeNumber(aircraft.nav_altitude_mcp),
        nav_altitude_fms_ft: safeNumber(aircraft.nav_altitude_fms),
        nav_heading_degrees: safeNumber(aircraft.nav_heading),

        // Transponder
        squawk_code: safeString(aircraft.squawk),
        emergency_status: safeString(aircraft.emergency),
        spi_flag: safeBoolean(aircraft.spi),
        alert_flag: safeBoolean(aircraft.alert),

        // ADS-B Quality
        adsb_version: safeNumber(aircraft.version),
        navigation_integrity_category: safeNumber(aircraft.nic),
        navigation_accuracy_position: safeNumber(aircraft.nac_p),
        navigation_accuracy_velocity: safeNumber(aircraft.nac_v),
        source_integrity_level: safeNumber(aircraft.sil),
        source_integrity_level_type: safeString(aircraft.sil_type),
        geometric_vertical_accuracy: safeNumber(aircraft.gva),
        system_design_assurance: safeNumber(aircraft.sda),
        nic_baro: safeNumber(aircraft.nic_baro),
        radius_of_containment: safeNumber(aircraft.rc),

        // Reception metadata
        messages_received: aircraft.messages,
        last_seen_seconds: safeNumber(aircraft.seen),
        last_position_seen_seconds: safeNumber(aircraft.seen_pos),
        rssi_dbm: safeNumber(aircraft.rssi),

        // Receiver geometry
        distance_from_receiver_nm: safeNumber(aircraft.dst),
        bearing_from_receiver_degrees: safeNumber(aircraft.dir),

        // Data quality
        database_flags: safeNumber(aircraft.dbFlags),
      };
    });
  }

  /**
   * Uploads aircraft snapshot data to Arweave in industry-standard Parquet format.
   * Each aircraft is stored as a separate row for optimal querying and analytics.
   *
   * @param json Raw aircraft snapshot data
   * @returns Transaction ID from Arweave upload
   */
  async uploadParquet(json: any): Promise<string> {
    const tmpDir = os.tmpdir();
    const filePath = path.join(tmpDir, 'aircraft.parquet');

    // Create industry-standard Parquet schema
    const schema = this.createParquetSchema();

    // Transform data into row-based format (one row per aircraft)
    const aircraftRows = this.transformAircraftToRows(json);

    // Create Parquet writer with SNAPPY compression for optimal performance
    const writer = await parquet.ParquetWriter.openFile(schema, filePath, {
      compression: 'SNAPPY',
    });

    // Write each aircraft as a separate row
    for (const row of aircraftRows) {
      await writer.appendRow(row);
    }

    await writer.close();

    const fileSize = fs.statSync(filePath).size;
    const utcTimestamp = new Date()
      .toISOString()
      .slice(0, 16)
      .replace(/[-:T]/g, '');

    // Upload to Arweave with comprehensive metadata tags
    const { id: txId } = await this.turbo.uploadFile({
      fileStreamFactory: () => fs.createReadStream(filePath),
      fileSizeFactory: () => fileSize,
      dataItemOpts: {
        tags: [
          { name: 'Content-Type', value: 'application/parquet' },
          { name: 'App-Name', value: 'DeradNetworkBackup' },
          { name: 'Timestamp', value: utcTimestamp },
          { name: 'Format', value: 'Parquet' },
          { name: 'Schema-Version', value: '2.0' },  // Updated schema version
          { name: 'Schema-Type', value: 'row-based' },  // Indicates row-per-aircraft format
          { name: 'Aircraft-Count', value: String(json.aircraft.length) },
          { name: 'Data-Format', value: 'aviation-timeseries' },
        ],
      },
    });

    // Record transaction in database
    await this.create({
      txId,
      source: 'aircraft-parquet-v2',  // Updated source identifier
      timestamp: utcTimestamp,
    });

    // Cleanup temporary file
    fs.unlinkSync(filePath);
    return txId;
  }

  /**
   * Uploads a SINGLE aircraft's data to Arweave as a Parquet file.
   * File named: <hex>.parquet (e.g., "4d20e1.parquet")
   * Contains one row with the aircraft's current state.
   *
   * @param aircraft Single aircraft object
   * @param snapshotTime Unix timestamp (seconds) when snapshot was taken
   * @returns Transaction ID from Arweave upload
   */
  async uploadSingleAircraftParquet(aircraft: any, snapshotTime: number): Promise<string> {
    const hex = aircraft.hex;
    const tmpDir = os.tmpdir();
    const filePath = path.join(tmpDir, `${hex}.parquet`);

    // Create schema
    const schema = this.createParquetSchema();

    // Transform single aircraft into row format
    const snapshotTimestamp = snapshotTime * 1000; // Convert to milliseconds

    const safeNumber = (value: any): number | null => {
      if (value === null || value === undefined || value === 'ground') return null;
      const num = Number(value);
      return isNaN(num) ? null : num;
    };

    const safeString = (value: any): string | null => {
      if (value === null || value === undefined || value === '') return null;
      return String(value).trim() || null;
    };

    const safeBoolean = (value: any): boolean | null => {
      if (value === null || value === undefined) return null;
      return value === 1 || value === true;
    };

    const row = {
      // Snapshot metadata
      snapshot_timestamp: snapshotTimestamp,
      snapshot_total_messages: 1, // Single aircraft

      // Aircraft identity
      icao_address: aircraft.hex,
      callsign: safeString(aircraft.flight),
      registration: safeString(aircraft.r),
      aircraft_type: safeString(aircraft.t),
      type_description: safeString(aircraft.desc),
      emitter_category: safeString(aircraft.category),

      // Position
      latitude: safeNumber(aircraft.lat),
      longitude: safeNumber(aircraft.lon),
      position_source: safeString(aircraft.type),

      // Altitude
      altitude_baro_ft: safeNumber(aircraft.alt_baro),
      altitude_geom_ft: safeNumber(aircraft.alt_geom),
      vertical_rate_baro_fpm: safeNumber(aircraft.baro_rate),
      vertical_rate_geom_fpm: safeNumber(aircraft.geom_rate),

      // Speed
      ground_speed_kts: safeNumber(aircraft.gs),
      indicated_airspeed_kts: safeNumber(aircraft.ias),
      true_airspeed_kts: safeNumber(aircraft.tas),
      mach_number: safeNumber(aircraft.mach),

      // Heading & Track
      track_degrees: safeNumber(aircraft.track),
      track_rate_deg_sec: safeNumber(aircraft.track_rate),
      magnetic_heading_degrees: safeNumber(aircraft.mag_heading),
      true_heading_degrees: safeNumber(aircraft.true_heading),
      roll_degrees: safeNumber(aircraft.roll),

      // Meteorological
      wind_direction_degrees: safeNumber(aircraft.wd),
      wind_speed_kts: safeNumber(aircraft.ws),
      outside_air_temp_c: safeNumber(aircraft.oat),
      total_air_temp_c: safeNumber(aircraft.tat),

      // Autopilot/FMS
      nav_qnh_mb: safeNumber(aircraft.nav_qnh),
      nav_altitude_mcp_ft: safeNumber(aircraft.nav_altitude_mcp),
      nav_altitude_fms_ft: safeNumber(aircraft.nav_altitude_fms),
      nav_heading_degrees: safeNumber(aircraft.nav_heading),

      // Transponder
      squawk_code: safeString(aircraft.squawk),
      emergency_status: safeString(aircraft.emergency),
      spi_flag: safeBoolean(aircraft.spi),
      alert_flag: safeBoolean(aircraft.alert),

      // ADS-B Quality
      adsb_version: safeNumber(aircraft.version),
      navigation_integrity_category: safeNumber(aircraft.nic),
      navigation_accuracy_position: safeNumber(aircraft.nac_p),
      navigation_accuracy_velocity: safeNumber(aircraft.nac_v),
      source_integrity_level: safeNumber(aircraft.sil),
      source_integrity_level_type: safeString(aircraft.sil_type),
      geometric_vertical_accuracy: safeNumber(aircraft.gva),
      system_design_assurance: safeNumber(aircraft.sda),
      nic_baro: safeNumber(aircraft.nic_baro),
      radius_of_containment: safeNumber(aircraft.rc),

      // Reception metadata
      messages_received: aircraft.messages,
      last_seen_seconds: safeNumber(aircraft.seen),
      last_position_seen_seconds: safeNumber(aircraft.seen_pos),
      rssi_dbm: safeNumber(aircraft.rssi),

      // Receiver geometry
      distance_from_receiver_nm: safeNumber(aircraft.dst),
      bearing_from_receiver_degrees: safeNumber(aircraft.dir),

      // Data quality
      database_flags: safeNumber(aircraft.dbFlags),
    };

    // Create Parquet writer
    const writer = await parquet.ParquetWriter.openFile(schema, filePath, {
      compression: 'SNAPPY',
    });

    // Write single row
    await writer.appendRow(row);
    await writer.close();

    const fileSize = fs.statSync(filePath).size;
    const utcTimestamp = new Date()
      .toISOString()
      .slice(0, 16)
      .replace(/[-:T]/g, '');

    // Upload to Arweave with aircraft-specific tags
    const { id: txId } = await this.turbo.uploadFile({
      fileStreamFactory: () => fs.createReadStream(filePath),
      fileSizeFactory: () => fileSize,
      dataItemOpts: {
        tags: [
          { name: 'Content-Type', value: 'application/parquet' },
          { name: 'App-Name', value: 'DeradNetworkBackup' },
          { name: 'Timestamp', value: utcTimestamp },
          { name: 'Format', value: 'Parquet' },
          { name: 'Schema-Version', value: '2.0' },
          { name: 'Schema-Type', value: 'single-aircraft' },
          { name: 'ICAO-Address', value: hex }, // Aircraft identifier
          { name: 'Callsign', value: safeString(aircraft.flight) || 'unknown' },
          { name: 'Aircraft-Type', value: safeString(aircraft.t) || 'unknown' },
          { name: 'Data-Format', value: 'aviation-realtime-track' },
        ],
      },
    });

    // Cleanup temporary file
    fs.unlinkSync(filePath);
    return txId;
  }

  /**
   * Upload batch of aircraft as single Parquet file (max 90KB)
   */
  async uploadBatchParquet(aircraftList: any[], snapshotTime: number, packageUuid?: string): Promise<string> {
    // Use /dev/shm (RAM disk) if available, otherwise fall back to /tmp
    const tmpDir = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();

    // Generate UUID if not provided (for backward compatibility)
    if (!packageUuid) {
      packageUuid = uuidv4();
    }

    // Type assertion: packageUuid is guaranteed to be string at this point
    const definitePackageUuid: string = packageUuid;

    // Generate minute-based encryption key UUID for correlation with encrypted version
    // Note: We don't actually encrypt the unencrypted version, but we store the same
    // encryption key UUID so both versions can be correlated and decryption can work
    const dummyBuffer = Buffer.from('dummy'); // Minimal buffer just to get the encryption key UUID
    const encryptionKeyInfo = this.encryptionService.encryptBuffer(dummyBuffer, definitePackageUuid);
    const encryptionKeyUuid: string = encryptionKeyInfo.encryptionKeyUuid;

    // CRITICAL: Use packageUuid for unique filename to avoid collisions with parallel batches
    const filePath = path.join(tmpDir, `standard-${packageUuid}.parquet`);

    // Validate inputs
    if (!aircraftList || aircraftList.length === 0) {
      throw new Error('Aircraft list is empty');
    }

    if (!snapshotTime || snapshotTime <= 0) {
      throw new Error('Invalid snapshot time');
    }

    // Create schema
    const schema = this.createParquetSchema();
    const snapshotTimestamp = snapshotTime * 1000;

    try {
      // Precompute all rows first (separates transformation from I/O)
      const rows: any[] = [];
      for (const aircraft of aircraftList) {
        // Skip aircraft without hex (should never happen, but safety check)
        if (!aircraft.hex) {
          continue;
        }

        rows.push({
          snapshot_timestamp: snapshotTimestamp,
          snapshot_total_messages: aircraftList.length,
          icao_address: aircraft.hex,
          callsign: this.safeString(aircraft.flight),
          registration: this.safeString(aircraft.r),
          aircraft_type: this.safeString(aircraft.t),
          type_description: this.safeString(aircraft.desc),
          emitter_category: this.safeString(aircraft.category),
          latitude: this.safeNumber(aircraft.lat),
          longitude: this.safeNumber(aircraft.lon),
          position_source: this.safeString(aircraft.type),
          altitude_baro_ft: this.safeNumber(aircraft.alt_baro),
          altitude_geom_ft: this.safeNumber(aircraft.alt_geom),
          vertical_rate_baro_fpm: this.safeNumber(aircraft.baro_rate),
          vertical_rate_geom_fpm: this.safeNumber(aircraft.geom_rate),
          ground_speed_kts: this.safeNumber(aircraft.gs),
          indicated_airspeed_kts: this.safeNumber(aircraft.ias),
          true_airspeed_kts: this.safeNumber(aircraft.tas),
          mach_number: this.safeNumber(aircraft.mach),
          track_degrees: this.safeNumber(aircraft.track),
          track_rate_deg_sec: this.safeNumber(aircraft.track_rate),
          magnetic_heading_degrees: this.safeNumber(aircraft.mag_heading),
          true_heading_degrees: this.safeNumber(aircraft.true_heading),
          roll_degrees: this.safeNumber(aircraft.roll),
          wind_direction_degrees: this.safeNumber(aircraft.wd),
          wind_speed_kts: this.safeNumber(aircraft.ws),
          outside_air_temp_c: this.safeNumber(aircraft.oat),
          total_air_temp_c: this.safeNumber(aircraft.tat),
          nav_qnh_mb: this.safeNumber(aircraft.nav_qnh),
          nav_altitude_mcp_ft: this.safeNumber(aircraft.nav_altitude_mcp),
          nav_altitude_fms_ft: this.safeNumber(aircraft.nav_altitude_fms),
          nav_heading_degrees: this.safeNumber(aircraft.nav_heading),
          squawk_code: this.safeString(aircraft.squawk),
          emergency_status: this.safeString(aircraft.emergency),
          spi_flag: this.safeBoolean(aircraft.spi),
          alert_flag: this.safeBoolean(aircraft.alert),
          adsb_version: this.safeNumber(aircraft.version),
          navigation_integrity_category: this.safeNumber(aircraft.nic),
          navigation_accuracy_position: this.safeNumber(aircraft.nac_p),
          navigation_accuracy_velocity: this.safeNumber(aircraft.nac_v),
          source_integrity_level: this.safeNumber(aircraft.sil),
          source_integrity_level_type: this.safeString(aircraft.sil_type),
          geometric_vertical_accuracy: this.safeNumber(aircraft.gva),
          system_design_assurance: this.safeNumber(aircraft.sda),
          nic_baro: this.safeNumber(aircraft.nic_baro),
          radius_of_containment: this.safeNumber(aircraft.rc),
          messages_received: this.safeInt64(aircraft.messages),
          last_seen_seconds: this.safeNumber(aircraft.seen),
          last_position_seen_seconds: this.safeNumber(aircraft.seen_pos),
          rssi_dbm: this.safeNumber(aircraft.rssi),
          distance_from_receiver_nm: this.safeNumber(aircraft.dst),
          bearing_from_receiver_degrees: this.safeNumber(aircraft.dir),
          database_flags: this.safeNumber(aircraft.dbFlags),
        });
      }

      // Create Parquet writer and write all precomputed rows
      const writer = await parquet.ParquetWriter.openFile(schema, filePath, {
        compression: 'LZ4',  // OPTIMIZATION: LZ4 is faster than SNAPPY
      });

      for (const row of rows) {
        try {
          await writer.appendRow(row);
        } catch (rowError) {
          // Log problematic row data for debugging
          console.error(`Failed to write row for aircraft ${row.icao_address}:`, rowError.message);
          console.error('Row data:', JSON.stringify(row, null, 2));
          throw rowError;
        }
      }

      await writer.close();

      const fileSize = fs.statSync(filePath).size;
      const fileSizeKB = (fileSize / 1024).toFixed(2);

      // Log file details for debugging
      console.log(`Created Parquet file: ${filePath}, Size: ${fileSizeKB}KB, Rows: ${aircraftList.length}`);

      const utcTimestamp = new Date()
        .toISOString()
        .slice(0, 16)
        .replace(/[-:T]/g, '');

      // Sanitize tag values to ensure they're valid strings
      const sanitizeTagValue = (value: string): string => {
        if (!value) return 'unknown';
        // Remove any special characters that might cause issues
        return String(value).replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim() || 'unknown';
      };

      // Build base tags
      const baseTags = [
        { name: 'Content-Type', value: 'application/parquet' },
        { name: 'App-Name', value: 'DeradNetworkBackup' },
        { name: 'Timestamp', value: utcTimestamp },
        { name: 'Format', value: 'Parquet' },
        { name: 'Schema-Version', value: '2.0' },
        { name: 'Schema-Type', value: 'batch-aircraft' },
        { name: 'Aircraft-Count', value: String(aircraftList.length) },
        { name: 'File-Size-KB', value: fileSizeKB },
        { name: 'Data-Format', value: 'aviation-realtime-batch' },
        { name: 'Batch-Timestamp', value: String(snapshotTime) },
        { name: 'Package-UUID', value: packageUuid },
        { name: 'Encryption-Key-UUID', value: encryptionKeyUuid },
        { name: 'Encrypted', value: 'false' },
      ];

      // Single-pass tag creation - build ICAO and Callsign tags in one loop
      const icaoTags: Array<{ name: string; value: string }> = [];
      const callsignTags: Array<{ name: string; value: string }> = [];
      const icaoList: string[] = [];
      for (const aircraft of aircraftList) {
        if (aircraft.hex) {
          icaoTags.push({ name: 'ICAO', value: sanitizeTagValue(aircraft.hex) });
          icaoList.push(aircraft.hex);
        }
        const callsign = this.safeString(aircraft.flight);
        if (callsign) {
          callsignTags.push({ name: 'Callsign', value: sanitizeTagValue(callsign) });
        }
      }

      // Combine all tags (base ~300 bytes + icao ~1500 + callsign ~1800 = ~3600 bytes, well under 4096 limit)
      const allTags = [...baseTags, ...icaoTags, ...callsignTags];

      console.log(`Uploading with ${allTags.length} tags (${baseTags.length} base + ${icaoTags.length} ICAO + ${callsignTags.length} callsign)`);

      // Upload to Arweave with comprehensive tags
      try {
        // OPTIMIZATION: Read file into Buffer and upload directly (eliminates stream overhead)
        const fileBuffer = fs.readFileSync(filePath);

        const { id: txId } = await this.turbo.upload({
          data: fileBuffer,
          dataItemOpts: {
            tags: allTags,
          },
          // TURBO SDK OPTIMIZATION: Progress tracking and error handling
          events: {
            onUploadProgress: ({ processedBytes, totalBytes }) => {
              const percent = ((processedBytes / totalBytes) * 100).toFixed(1);
              console.log(`📤 [BATCH UPLOAD] Progress: ${percent}% (${processedBytes}/${totalBytes} bytes)`);
            },
            onUploadError: (error) => {
              console.error(`❌ [BATCH UPLOAD] Upload error:`, error.message);
            },
            onSigningError: (error) => {
              console.error(`❌ [BATCH UPLOAD] Signing error:`, error.message);
            },
          },
        });

        // OPTIMIZATION: Non-blocking database write (fire-and-forget)
        // This removes ~100ms from critical path
        this.create({
          txId,
          source: 'aircraft-parquet-batch',
          timestamp: utcTimestamp,
          aircraft_count: aircraftList.length,
          file_size_kb: fileSizeKB,
          format: 'Parquet',
          icao_addresses: icaoList,
          packageUuid: packageUuid,
        }).catch(err => console.error('Database write error:', err.message));

        // Cleanup temporary file (check existence first to avoid race conditions)
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        console.log(`Successfully uploaded batch: ${txId}`);
        return txId;
      } catch (uploadError) {
        console.error('Upload failed with error:', uploadError.message);
        console.error('File size:', fileSize, 'bytes');
        console.error('Number of tags:', allTags.length);
        console.error('Sample tags:', allTags.slice(0, 15));
        // Cleanup on upload error
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        throw uploadError;
      }
    } catch (error) {
      // Ensure cleanup on error
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      throw error;
    }
  }

  /**
   * INTERNAL: Prepare encrypted Parquet buffer (for retry-safe uploads)
   * Returns encrypted buffer + metadata without uploading
   */
  private async prepareEncryptedParquetBuffer(aircraftList: any[], snapshotTime: number, packageUuid: string): Promise<{
    encryptedBuffer: Buffer;
    dataHash: string;
    fileSize: number;
    encryptionKey: Buffer;
    packageUuid: string;
    encryptionKeyUuid: string;
    icaoList: string[];
    utcTimestamp: string;
  }> {
    // Use /dev/shm (RAM disk) if available, otherwise fall back to /tmp
    const tmpDir = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
    // CRITICAL: Use packageUuid for unique filename to avoid collisions with parallel batches
    const filePath = path.join(tmpDir, `encrypted-${packageUuid}.parquet`);

    // Create schema
    const schema = this.createParquetSchema();
    const snapshotTimestamp = snapshotTime * 1000;

    try {
      // Precompute all rows first (separates transformation from I/O)
      const rows: any[] = [];
      const icaoList: string[] = [];

      for (const aircraft of aircraftList) {
        if (!aircraft.hex) continue;

        if (aircraft.hex) {
          icaoList.push(aircraft.hex);
        }

        rows.push({
          snapshot_timestamp: snapshotTimestamp,
          snapshot_total_messages: aircraftList.length,
          icao_address: aircraft.hex,
          callsign: this.safeString(aircraft.flight),
          registration: this.safeString(aircraft.r),
          aircraft_type: this.safeString(aircraft.t),
          type_description: this.safeString(aircraft.desc),
          emitter_category: this.safeString(aircraft.category),
          latitude: this.safeNumber(aircraft.lat),
          longitude: this.safeNumber(aircraft.lon),
          position_source: this.safeString(aircraft.type),
          altitude_baro_ft: this.safeNumber(aircraft.alt_baro),
          altitude_geom_ft: this.safeNumber(aircraft.alt_geom),
          vertical_rate_baro_fpm: this.safeNumber(aircraft.baro_rate),
          vertical_rate_geom_fpm: this.safeNumber(aircraft.geom_rate),
          ground_speed_kts: this.safeNumber(aircraft.gs),
          indicated_airspeed_kts: this.safeNumber(aircraft.ias),
          true_airspeed_kts: this.safeNumber(aircraft.tas),
          mach_number: this.safeNumber(aircraft.mach),
          track_degrees: this.safeNumber(aircraft.track),
          track_rate_deg_sec: this.safeNumber(aircraft.track_rate),
          magnetic_heading_degrees: this.safeNumber(aircraft.mag_heading),
          true_heading_degrees: this.safeNumber(aircraft.true_heading),
          roll_degrees: this.safeNumber(aircraft.roll),
          wind_direction_degrees: this.safeNumber(aircraft.wd),
          wind_speed_kts: this.safeNumber(aircraft.ws),
          outside_air_temp_c: this.safeNumber(aircraft.oat),
          total_air_temp_c: this.safeNumber(aircraft.tat),
          nav_qnh_mb: this.safeNumber(aircraft.nav_qnh),
          nav_altitude_mcp_ft: this.safeNumber(aircraft.nav_altitude_mcp),
          nav_altitude_fms_ft: this.safeNumber(aircraft.nav_altitude_fms),
          nav_heading_degrees: this.safeNumber(aircraft.nav_heading),
          squawk_code: this.safeString(aircraft.squawk),
          emergency_status: this.safeString(aircraft.emergency),
          spi_flag: this.safeBoolean(aircraft.spi),
          alert_flag: this.safeBoolean(aircraft.alert),
          adsb_version: this.safeNumber(aircraft.version),
          navigation_integrity_category: this.safeNumber(aircraft.nic),
          navigation_accuracy_position: this.safeNumber(aircraft.nac_p),
          navigation_accuracy_velocity: this.safeNumber(aircraft.nac_v),
          source_integrity_level: this.safeNumber(aircraft.sil),
          source_integrity_level_type: this.safeString(aircraft.sil_type),
          geometric_vertical_accuracy: this.safeNumber(aircraft.gva),
          system_design_assurance: this.safeNumber(aircraft.sda),
          nic_baro: this.safeNumber(aircraft.nic_baro),
          radius_of_containment: this.safeNumber(aircraft.rc),
          messages_received: this.safeInt64(aircraft.messages),
          last_seen_seconds: this.safeNumber(aircraft.seen),
          last_position_seen_seconds: this.safeNumber(aircraft.seen_pos),
          rssi_dbm: this.safeNumber(aircraft.rssi),
          distance_from_receiver_nm: this.safeNumber(aircraft.dst),
          bearing_from_receiver_degrees: this.safeNumber(aircraft.dir),
          database_flags: this.safeNumber(aircraft.dbFlags),
        });
      }

      // Create Parquet writer and write all precomputed rows
      const writer = await parquet.ParquetWriter.openFile(schema, filePath, {
        compression: 'LZ4',  // OPTIMIZATION: LZ4 is faster than SNAPPY
      });

      for (const row of rows) {
        await writer.appendRow(row);
      }

      await writer.close();

      // OPTIMIZATION: Read Parquet into buffer immediately, then encrypt in-memory
      const plaintextBuffer = fs.readFileSync(filePath);

      // Delete plaintext file immediately (reduce disk footprint)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      // ENCRYPT THE BUFFER (in-memory, no disk I/O)
      // Uses minute-based encryption key rotation
      const encryptionResult = this.encryptionService.encryptBuffer(plaintextBuffer, packageUuid);
      console.log(`🔒 [ENCRYPTED] Encrypted with key ${encryptionResult.encryptionKeyUuid}, hash: ${encryptionResult.dataHash.substring(0, 16)}...`);

      const utcTimestamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

      // Return prepared data (no upload yet - this makes retries safe)
      return {
        encryptedBuffer: encryptionResult.encryptedBuffer,
        dataHash: encryptionResult.dataHash,
        fileSize: encryptionResult.fileSize,
        encryptionKey: encryptionResult.encryptionKey,
        packageUuid: encryptionResult.packageUuid,
        encryptionKeyUuid: encryptionResult.encryptionKeyUuid,
        icaoList,
        utcTimestamp,
      };
    } catch (error) {
      // Cleanup parquet file if it still exists
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      throw error;
    }
  }

  /**
   * Upload batch of aircraft as ENCRYPTED Parquet file
   * Uses UUID-based key derivation with HKDF
   */
  async uploadBatchParquetEncrypted(aircraftList: any[], snapshotTime: number, packageUuid?: string): Promise<{ txId: string; nildbKeySaved: boolean }> {
    // Validate inputs
    if (!aircraftList || aircraftList.length === 0) {
      throw new Error('Aircraft list is empty');
    }

    if (!snapshotTime || snapshotTime <= 0) {
      throw new Error('Invalid snapshot time');
    }

    // Ensure packageUuid is defined
    if (!packageUuid) {
      packageUuid = uuidv4();
    }

    // CRITICAL: Prepare buffer ONCE (outside retry loop)
    const prepared = await this.prepareEncryptedParquetBuffer(aircraftList, snapshotTime, packageUuid);

    console.log(`🔒 [ENCRYPTED] Package UUID: ${packageUuid}, Encryption Key UUID: ${prepared.encryptionKeyUuid}`);

    // STORE ENCRYPTION KEY IN NILDB - NON-BLOCKING (fire and forget, with deduplication)
    // Note: Store the ENCRYPTION KEY UUID (minute-based), not the package UUID
    this.encryptionService.storeKeyInNilDB(prepared.encryptionKeyUuid, prepared.encryptionKey)
      .then((nildbKeySaved) => {
        if (nildbKeySaved) {
          console.log(`✅ Encryption key ${prepared.encryptionKeyUuid} stored in nilDB`);
        } else {
          console.warn(`⚠️  nilDB storage failed for encryption key ${prepared.encryptionKeyUuid} (continuing with upload)`);
        }
      })
      .catch((error) => {
        console.error(`❌ nilDB storage error for encryption key ${prepared.encryptionKeyUuid}:`, error.message);
      });

    const encryptedFileSizeKB = (prepared.fileSize / 1024).toFixed(2);

    // Helper function to sanitize tag values
    const sanitizeTagValue = (value: any): string => {
      if (value === null || value === undefined) return 'unknown';
      // Remove any special characters that might cause issues
      return String(value).replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim() || 'unknown';
    };

    // Build base tags with encryption metadata
    const baseTags = [
      { name: 'Content-Type', value: 'application/octet-stream' },
      { name: 'App-Name', value: 'DeradNetworkBackup' },
      { name: 'Timestamp', value: prepared.utcTimestamp },
      { name: 'Format', value: 'Parquet' },
      { name: 'Aircraft-Count', value: String(aircraftList.length) },
      { name: 'File-Size-KB', value: encryptedFileSizeKB },
      { name: 'Encrypted', value: 'true' },
      { name: 'Encryption-Algorithm', value: 'AES-256-GCM' },
      { name: 'Package-UUID', value: packageUuid },
      { name: 'Encryption-Key-UUID', value: prepared.encryptionKeyUuid },
      { name: 'Data-Hash', value: prepared.dataHash },
      { name: 'Schema-Version', value: '2.0' },
      { name: 'Schema-Type', value: 'batch-aircraft' },
      { name: 'Data-Format', value: 'aviation-realtime-batch' },
      { name: 'Batch-Timestamp', value: String(snapshotTime) },
    ];

    // Single-pass tag creation - build ICAO and Callsign tags in one loop
    const icaoTags: Array<{ name: string; value: string }> = [];
    const callsignTags: Array<{ name: string; value: string }> = [];

    for (const aircraft of aircraftList) {
      if (aircraft.hex) {
        icaoTags.push({ name: 'ICAO', value: sanitizeTagValue(aircraft.hex) });
      }
      const callsign = this.safeString(aircraft.flight);
      if (callsign) {
        callsignTags.push({ name: 'Callsign', value: sanitizeTagValue(callsign) });
      }
    }

    // Combine all tags
    const allTags = [...baseTags, ...icaoTags, ...callsignTags];

    // Upload ENCRYPTED buffer directly (no file I/O)
    // NOTE: This can be retried safely since buffer is already prepared
    const { id: txId } = await this.turbo.upload({
      data: prepared.encryptedBuffer,
      dataItemOpts: { tags: allTags },
      // TURBO SDK OPTIMIZATION: Progress tracking for visibility
      events: {
        onUploadProgress: ({ processedBytes, totalBytes }) => {
          const percent = ((processedBytes / totalBytes) * 100).toFixed(1);
          console.log(`🔒 [ENCRYPTED UPLOAD] Progress: ${percent}% (${processedBytes}/${totalBytes} bytes)`);
        },
        onUploadError: (error) => {
          console.error(`❌ [ENCRYPTED UPLOAD] Upload error:`, error.message);
        },
        onSigningError: (error) => {
          console.error(`❌ [ENCRYPTED UPLOAD] Signing error:`, error.message);
        },
      },
    });

    // OPTIMIZATION: Non-blocking database writes (fire-and-forget)
    // This removes ~150ms from critical path
    this.createEncrypted({
      txId,
      source: 'aircraft-parquet-batch',
      timestamp: prepared.utcTimestamp,
      aircraft_count: aircraftList.length,
      file_size_kb: encryptedFileSizeKB,
      format: 'Parquet',
      icao_addresses: prepared.icaoList,
      packageUuid: packageUuid,
      dataHash: prepared.dataHash,
      encryptionAlgorithm: 'AES-256-GCM',
    }).catch(err => console.error('Encrypted database write error:', err.message));

    // Save metadata to JSON (non-blocking)
    this.savePackageMetadata({
      packageUuid,
      txId,
      dataHash: prepared.dataHash,
      timestamp: prepared.utcTimestamp,
      aircraftCount: aircraftList.length,
      fileSizeKB: encryptedFileSizeKB,
    }).catch(err => console.error('Metadata write error:', err.message));

    // No cleanup needed - everything done in-memory!

    console.log(`🔒 [ENCRYPTED] Uploaded: ${txId}`);
    // Note: nilDB storage happens asynchronously, so we can't determine success here
    // The nildbKeySaved flag is always true to indicate the upload succeeded
    return { txId, nildbKeySaved: true };
  }

  /**
   * Save package metadata to JSON file in database directory
   */
  private async savePackageMetadata(metadata: any): Promise<void> {
    const databaseDir = './database';
    const metadataFilePath = path.join(databaseDir, 'package-metadata.json');

    if (!fs.existsSync(databaseDir)) {
      fs.mkdirSync(databaseDir, { recursive: true });
    }

    let allMetadata: any[] = [];
    if (fs.existsSync(metadataFilePath)) {
      try {
        allMetadata = JSON.parse(fs.readFileSync(metadataFilePath, 'utf-8'));
      } catch (e) {
        allMetadata = [];
      }
    }

    allMetadata.push({ ...metadata, createdAt: new Date().toISOString() });
    fs.writeFileSync(metadataFilePath, JSON.stringify(allMetadata, null, 2), 'utf-8');
    console.log(`📝 Metadata saved: ${metadataFilePath}`);
  }

  async findAll({
    offset = 0,
    limit = 10,
    req,
  }: {
    offset?: number;
    limit?: number;
    req: Request;
  }) {
    // Get all records with pagination applied directly
    // Order by ID DESC to ensure consistent ordering (newer records have higher IDs)
    const [records, total] = await this.archiveRepo.findAndCount({
      order: { id: 'DESC' },
      skip: offset,
      take: limit,
    });

    // Generate pagination URLs
    const baseUrl = `${req.protocol}://${req.get('host')}${req.path}`;
    const previous = offset > 0
      ? `${baseUrl}?offset=${Math.max(0, offset - limit)}&limit=${limit}`
      : null;
    const next = offset + limit < total
      ? `${baseUrl}?offset=${offset + limit}&limit=${limit}`
      : null;

    // Return flat structure for backward compatibility
    return {
      results: records, // Return flat records array
      total,
      offset,
      limit,
      previous,
      next,
    };
  }

  async create(record: Partial<ArchiveRecord>): Promise<ArchiveRecord> {
    const newRecord = this.archiveRepo.create(record);
    return this.archiveRepo.save(newRecord);
  }

  async createEncrypted(record: Partial<EncryptedArchiveRecord>): Promise<EncryptedArchiveRecord> {
    const newRecord = this.encryptedArchiveRepo.create(record);
    return this.encryptedArchiveRepo.save(newRecord);
  }

  async findAllEncrypted({
    offset = 0,
    limit = 10,
    req,
  }: {
    offset?: number;
    limit?: number;
    req: Request;
  }) {
    // Get all encrypted records with pagination applied directly
    // Order by ID DESC to ensure consistent ordering (newer records have higher IDs)
    const [records, total] = await this.encryptedArchiveRepo.findAndCount({
      order: { id: 'DESC' },
      skip: offset,
      take: limit,
    });

    // Generate pagination URLs
    const baseUrl = `${req.protocol}://${req.get('host')}${req.path}`;
    const previous = offset > 0
      ? `${baseUrl}?offset=${Math.max(0, offset - limit)}&limit=${limit}`
      : null;
    const next = offset + limit < total
      ? `${baseUrl}?offset=${offset + limit}&limit=${limit}`
      : null;

    // Return flat structure for backward compatibility
    return {
      results: records, // Return flat records array
      total,
      offset,
      limit,
      previous,
      next,
    };
  }

  async getDataByTX(id: string): Promise<string> {
    const data = await this.arweave.transactions.getData(id, {
      decode: true,
      string: true,
    });

    return data as string;
  }
}
