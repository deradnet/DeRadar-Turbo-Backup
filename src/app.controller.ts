import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { SystemService } from './system.service';
import { SessionAuthGuard } from './auth/session.guard';
import { Response } from 'express';

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

  @Get('admin')
  @UseGuards(SessionAuthGuard)
  getAdminDashboard(@Res() res: Response) {
    return res.render('admin-dashboard-optimized');
  }

  @Get('node')
  getPublicDashboard(@Res() res: Response) {
    // Public read-only dashboard - no authentication required
    return res.render('public-dashboard-readonly');
  }
}
