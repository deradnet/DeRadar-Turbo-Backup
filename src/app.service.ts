import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AircraftTrackerService } from './archive/aircraft-tracker.service';

@Injectable()
export class AppService implements OnModuleInit {
  private readonly logger = new Logger(AppService.name);

  constructor(
    private readonly aircraftTracker: AircraftTrackerService,
  ) {}

  /**
   * Auto-start real-time aircraft tracking when application boots
   */
  async onModuleInit() {
    try {
      this.logger.log('[INIT] Starting Real-Time Aircraft Tracking System...');
      await this.aircraftTracker.startTracking();
      this.logger.log('[SUCCESS] Real-Time Aircraft Tracking System started successfully!');
      this.logger.log('[INFO] System will poll every 1 second and upload changed aircraft');
    } catch (error) {
      this.logger.error('[ERROR] Failed to start aircraft tracking:', error);
      // Don't crash the app, just log the error
    }
  }

  getHello(): string {
    return 'Derad Flight Server API - Real-Time Aircraft Tracking Active';
  }
}
