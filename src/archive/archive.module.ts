import { Module } from '@nestjs/common';
import { ArchiveService } from './archive.service';
import { ArchiveController } from './archive.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArchiveRecord } from './entities/archive-record.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ArchiveRecord])],
  providers: [ArchiveService],
  controllers: [ArchiveController],
  exports: [ArchiveService],
})
export class ArchiveModule {}
