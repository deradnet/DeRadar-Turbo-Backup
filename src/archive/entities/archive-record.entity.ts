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
  source: string;

  @Column()
  timestamp: string;

  @CreateDateColumn()
  createdAt: Date;
}
