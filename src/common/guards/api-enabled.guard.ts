import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class ApiEnabledGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const apiEnabled = this.configService.get<boolean>('api.enabled') || false;
    if (!apiEnabled) {
      const req: Request = context.switchToHttp().getRequest();
      console.warn(`API call blocked: ${req.method} ${req.url}`);
      req.res?.status(404).send();
    }
    return apiEnabled;
  }
}
