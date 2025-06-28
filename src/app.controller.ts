import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { SystemService } from './system.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly systemService: SystemService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getSystemInfo() {
    return this.systemService.getSystemInfo();
  }
}
