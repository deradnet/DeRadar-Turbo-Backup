import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('encrypted_archive_records')
@Index('IDX_encrypted_package_uuid', ['packageUuid'], {
  unique: false,
})
export class EncryptedArchiveRecord {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  txId: string;

  @Column()
  source: string; // 'aircraft-parquet-batch', 'aircraft-parquet-v2', 'aircraft'

  @Column()
  timestamp: string;

  @Column({ type: 'integer', nullable: true })
  aircraft_count: number; // Number of aircraft in this upload

  @Column({ type: 'text', nullable: true })
  file_size_kb: string; // File size in KB

  @Column({ type: 'text', nullable: true })
  format: string; // 'Parquet', 'JSON'

  @Column({ type: 'simple-json', nullable: true })
  icao_addresses: string[]; // Array of ICAO addresses in this batch

  @Column({ nullable: true })
  packageUuid: string; // UUID for encryption key derivation

  @Column({ type: 'text', nullable: true })
  dataHash: string; // SHA-256 hash of the original data

  @Column({ type: 'text', nullable: true })
  encryptionAlgorithm: string; // Algorithm used for encryption (e.g., 'AES-256-GCM')

  @CreateDateColumn()
  createdAt: Date;
}