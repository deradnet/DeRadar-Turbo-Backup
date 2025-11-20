import { Module } from '@nestjs/common';
import { ArchiveService } from './archive.service';
import { ArchiveController } from './archive.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArchiveRecord } from './entities/archive-record.entity';
import { EncryptedArchiveRecord } from './entities/encrypted-archive-record.entity';
import { AircraftTrack } from './entities/aircraft-track.entity';
import { SystemStats } from './entities/system-stats.entity';
import { HttpModule } from '@nestjs/axios';
import { AircraftTrackerService } from './aircraft-tracker.service';
import { StatsGateway } from './stats.gateway';
import { StatsBackupService } from './stats-backup.service';
import { CommonModule } from '../common/common.module';
import { NodeRegistrationService } from './node-registration.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ArchiveRecord, EncryptedArchiveRecord, AircraftTrack, SystemStats]),
    HttpModule,
    CommonModule,
  ],
  providers: [ArchiveService, AircraftTrackerService, StatsGateway, StatsBackupService, NodeRegistrationService],
  controllers: [ArchiveController],
  exports: [ArchiveService, AircraftTrackerService, StatsBackupService, NodeRegistrationService],
})
export class ArchiveModule {}
