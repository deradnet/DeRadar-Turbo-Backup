import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

/**
 * Tracks individual aircraft uploads to Arweave.
 * Each aircraft gets its own Parquet file and transaction.
 */
@Entity('aircraft_tracks')
export class AircraftTrack {
  @PrimaryColumn()
  hex: string; // ICAO address (e.g., "4d20e1")

  @Column({ type: 'text', nullable: true })
  callsign: string; // Last known callsign

  @Column({ type: 'text', nullable: true })
  registration: string; // Aircraft registration

  @Column({ type: 'text', nullable: true })
  aircraft_type: string; // Aircraft type code

  @Column({ type: 'bigint' })
  first_seen: number; // Unix timestamp (ms) when first detected

  @Column({ type: 'bigint' })
  last_seen: number; // Unix timestamp (ms) when last seen

  @Column({ type: 'bigint' })
  last_uploaded: number; // Unix timestamp (ms) of last upload

  @Column({ type: 'text' })
  last_tx_id: string; // Most recent Arweave transaction ID

  @Column({ type: 'integer', default: 1 })
  upload_count: number; // Total number of uploads for this aircraft

  @Column({ type: 'integer', default: 0 })
  total_updates: number; // Number of state changes detected

  @Column({ type: 'text', nullable: true })
  @Index()
  status: string; // 'active', 'out_of_range', 'reappeared'

  @Column({ type: 'simple-json', nullable: true })
  last_position: {
    latitude: number;
    longitude: number;
    altitude_baro_ft: number;
  };
}
