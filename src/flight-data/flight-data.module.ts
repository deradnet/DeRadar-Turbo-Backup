import { Module } from '@nestjs/common';
import { FlightDataService } from './flight-data.service';
import { HttpModule } from '@nestjs/axios';
import { ArchiveModule } from '../archive/archive.module';

@Module({
  imports: [HttpModule, ArchiveModule],
  providers: [FlightDataService],
})
export class FlightDataModule {}
