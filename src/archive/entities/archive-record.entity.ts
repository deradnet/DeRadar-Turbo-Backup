import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity()
@Index('IDX_archive_package_uuid', ['packageUuid'], {
  unique: false,
})
@Index('IDX_archive_created_at', ['createdAt'], {
  unique: false,
})
@Index('IDX_archive_id_created_at', ['id', 'createdAt'], {
  unique: false,
})
export class ArchiveRecord {
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

  @Column({ type: 'simple-json', nullable: true, select: false })
  icao_addresses: string[]; // Array of ICAO addresses in this batch - lazy loaded to improve performance

  @Column({ nullable: true })
  packageUuid: string; // UUID for encryption key derivation

  @CreateDateColumn()
  createdAt: Date;
}
