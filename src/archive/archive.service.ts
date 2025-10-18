import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TurboFactory } from '@ardrive/turbo-sdk';
import { InjectRepository } from '@nestjs/typeorm';
import { ArchiveRecord } from './entities/archive-record.entity';
import { Repository } from 'typeorm';
import Arweave from 'arweave';
import { paginate } from '../common/utils/paginate';
import { Request } from 'express';
import { TurboAuthenticatedClient } from '@ardrive/turbo-sdk/lib/types/common/turbo';
import { ConfigService } from '@nestjs/config';
import * as parquet from 'parquetjs';

@Injectable()
export class ArchiveService {
  private readonly turbo: TurboAuthenticatedClient;
  private arweave: Arweave;

  constructor(
    @InjectRepository(ArchiveRecord)
    private readonly archiveRepo: Repository<ArchiveRecord>,
    private readonly configService: ConfigService,
  ) {
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
    });
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
  async uploadBatchParquet(aircraftList: any[], snapshotTime: number): Promise<string> {
    const tmpDir = os.tmpdir();
    const timestamp = Date.now();
    const filePath = path.join(tmpDir, `batch-${timestamp}.parquet`);

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

    // Helper functions
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

    const safeInt64 = (value: any): number | null => {
      if (value === null || value === undefined) return null;
      const num = Number(value);
      return isNaN(num) ? null : num;
    };

    try {
      // Create Parquet writer
      const writer = await parquet.ParquetWriter.openFile(schema, filePath, {
        compression: 'SNAPPY',
      });

      // Write each aircraft as a row
      for (const aircraft of aircraftList) {
        // Skip aircraft without hex (should never happen, but safety check)
        if (!aircraft.hex) {
          continue;
        }

        try {
          const row = {
            snapshot_timestamp: snapshotTimestamp,
            snapshot_total_messages: aircraftList.length,
            icao_address: aircraft.hex,
            callsign: safeString(aircraft.flight),
            registration: safeString(aircraft.r),
            aircraft_type: safeString(aircraft.t),
            type_description: safeString(aircraft.desc),
            emitter_category: safeString(aircraft.category),
            latitude: safeNumber(aircraft.lat),
            longitude: safeNumber(aircraft.lon),
            position_source: safeString(aircraft.type),
            altitude_baro_ft: safeNumber(aircraft.alt_baro),
            altitude_geom_ft: safeNumber(aircraft.alt_geom),
            vertical_rate_baro_fpm: safeNumber(aircraft.baro_rate),
            vertical_rate_geom_fpm: safeNumber(aircraft.geom_rate),
            ground_speed_kts: safeNumber(aircraft.gs),
            indicated_airspeed_kts: safeNumber(aircraft.ias),
            true_airspeed_kts: safeNumber(aircraft.tas),
            mach_number: safeNumber(aircraft.mach),
            track_degrees: safeNumber(aircraft.track),
            track_rate_deg_sec: safeNumber(aircraft.track_rate),
            magnetic_heading_degrees: safeNumber(aircraft.mag_heading),
            true_heading_degrees: safeNumber(aircraft.true_heading),
            roll_degrees: safeNumber(aircraft.roll),
            wind_direction_degrees: safeNumber(aircraft.wd),
            wind_speed_kts: safeNumber(aircraft.ws),
            outside_air_temp_c: safeNumber(aircraft.oat),
            total_air_temp_c: safeNumber(aircraft.tat),
            nav_qnh_mb: safeNumber(aircraft.nav_qnh),
            nav_altitude_mcp_ft: safeNumber(aircraft.nav_altitude_mcp),
            nav_altitude_fms_ft: safeNumber(aircraft.nav_altitude_fms),
            nav_heading_degrees: safeNumber(aircraft.nav_heading),
            squawk_code: safeString(aircraft.squawk),
            emergency_status: safeString(aircraft.emergency),
            spi_flag: safeBoolean(aircraft.spi),
            alert_flag: safeBoolean(aircraft.alert),
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
            messages_received: safeInt64(aircraft.messages),
            last_seen_seconds: safeNumber(aircraft.seen),
            last_position_seen_seconds: safeNumber(aircraft.seen_pos),
            rssi_dbm: safeNumber(aircraft.rssi),
            distance_from_receiver_nm: safeNumber(aircraft.dst),
            bearing_from_receiver_degrees: safeNumber(aircraft.dir),
            database_flags: safeNumber(aircraft.dbFlags),
          };

          await writer.appendRow(row);
        } catch (rowError) {
          // Log problematic aircraft data for debugging
          console.error(`Failed to write row for aircraft ${aircraft.hex}:`, rowError.message);
          console.error('Aircraft data:', JSON.stringify(aircraft, null, 2));
          throw rowError;
        }
      }

      await writer.close();

      const fileSize = fs.statSync(filePath).size;
      const fileSizeKB = (fileSize / 1024).toFixed(2);

      // Log file details for debugging
      console.log(`Created Parquet file: ${filePath}, Size: ${fileSizeKB}KB, Rows: ${aircraftList.length}`);

      // Collect all aircraft ICAOs and callsigns for tags
      const icaoList = aircraftList.map(a => a.hex).filter(Boolean);
      const callsignList = aircraftList.map(a => safeString(a.flight)).filter(Boolean);

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
      ];

      // Add individual ICAO tags for each aircraft (max 75 aircraft = ~1500 bytes)
      const icaoTags = icaoList.map(icao => ({ name: 'ICAO', value: sanitizeTagValue(icao || '') }));

      // Add individual Callsign tags for each aircraft with callsign (max 75 = ~1800 bytes)
      const callsignTags = callsignList.map(callsign => ({ name: 'Callsign', value: sanitizeTagValue(callsign || '') }));

      // Combine all tags (base ~300 bytes + icao ~1500 + callsign ~1800 = ~3600 bytes, well under 4096 limit)
      const allTags = [...baseTags, ...icaoTags, ...callsignTags];

      console.log(`Uploading with ${allTags.length} tags (${baseTags.length} base + ${icaoTags.length} ICAO + ${callsignTags.length} callsign)`);

      // Upload to Arweave with comprehensive tags
      try {
        const { id: txId } = await this.turbo.uploadFile({
          fileStreamFactory: () => fs.createReadStream(filePath),
          fileSizeFactory: () => fileSize,
          dataItemOpts: {
            tags: allTags,
          },
        });

        // Save to database with full metadata
        await this.create({
          txId,
          source: 'aircraft-parquet-batch',
          timestamp: utcTimestamp,
          aircraft_count: aircraftList.length,
          file_size_kb: fileSizeKB,
          format: 'Parquet',
          icao_addresses: icaoList,
        });

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

  async findAll({
    offset = 0,
    limit = 10,
    req,
  }: {
    offset?: number;
    limit?: number;
    req: Request;
  }) {
    return paginate(this.archiveRepo, { offset, limit, req });
  }

  async create(record: Partial<ArchiveRecord>): Promise<ArchiveRecord> {
    const newRecord = this.archiveRepo.create(record);
    return this.archiveRepo.save(newRecord);
  }

  async getDataByTX(id: string): Promise<string> {
    const data = await this.arweave.transactions.getData(id, {
      decode: true,
      string: true,
    });

    return data as string;
  }
}
