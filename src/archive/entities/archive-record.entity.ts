import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity()
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

  @Column({ type: 'simple-json', nullable: true })
  icao_addresses: string[]; // Array of ICAO addresses in this batch

  @CreateDateColumn()
  createdAt: Date;
}
