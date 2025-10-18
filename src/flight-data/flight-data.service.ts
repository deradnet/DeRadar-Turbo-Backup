import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { Cron } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';
import { AircraftData, AntennaConfig } from './types';
import { ArchiveService } from '../archive/archive.service';
import { Mutex } from 'async-mutex';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FlightDataService {
  private readonly logger = new Logger(FlightDataService.name);
  private readonly urls: AntennaConfig[] = [];

  private readonly mutex = new Mutex();

  constructor(
    private readonly httpService: HttpService,
    private readonly archiveService: ArchiveService,
    private readonly config: ConfigService,
  ) {
    this.urls = this.config.get('antennas') as AntennaConfig[];
  }

  /**
   * OLD BATCH SYSTEM - DISABLED
   * Replaced by real-time per-aircraft tracking
   * To re-enable: uncomment @Cron decorator
   */
  // @Cron('*/60 * * * * *')
  async fetchAircraftData() {
    const release = await this.mutex.acquire();

    try {
      for (const antenna of this.urls) {
        if (!antenna.enabled) {
          this.logger.log(`[${antenna.id}] Antenna is disabled, skipping.`);
          continue;
        }
        try {
          const response = await firstValueFrom(
            this.httpService.get(antenna.url),
          );
          const data: AircraftData = response.data as AircraftData;

          const aircraftCount = data.aircraft?.length || 0;
          this.logger.log(`[${antenna.id}] Aircraft count: ${aircraftCount}`);

          if (aircraftCount === 0) {
            this.logger.log(
              `[${antenna.id}] No aircraft data, skipping upload.`,
            );
            continue;
          }

          const txId = await this.archiveService.uploadParquet({
            source: antenna.id,
            timestamp: new Date().toISOString(),
            ...data,
          });

          this.logger.log(`[${antenna.id}] Uploaded: ${txId}`);
        } catch (err) {
          this.logger.error(
            `[${antenna.id}] Error fetching data`,
            err instanceof Error ? err.message : JSON.stringify(err),
          );
        }
      }
    } finally {
      release();
    }
  }
}
