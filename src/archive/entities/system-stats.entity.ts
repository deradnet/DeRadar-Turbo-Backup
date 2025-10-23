import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('system_stats')
export class SystemStats {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'bigint' })
  system_start_time: number;

  @Column({ type: 'integer', default: 0 })
  total_uploads_attempted: number;

  @Column({ type: 'integer', default: 0 })
  total_uploads_succeeded: number;

  @Column({ type: 'integer', default: 0 })
  total_uploads_failed: number;

  @Column({ type: 'integer', default: 0 })
  total_retries: number;

  @Column({ type: 'integer', default: 0 })
  encrypted_uploads_attempted: number;

  @Column({ type: 'integer', default: 0 })
  encrypted_uploads_succeeded: number;

  @Column({ type: 'integer', default: 0 })
  encrypted_uploads_failed: number;

  @Column({ type: 'integer', default: 0 })
  encrypted_retries: number;

  @Column({ type: 'integer', default: 0 })
  total_new_aircraft: number;

  @Column({ type: 'integer', default: 0 })
  total_updates: number;

  @Column({ type: 'integer', default: 0 })
  total_reappeared: number;

  @Column({ type: 'integer', default: 0 })
  total_poll_cycles: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
