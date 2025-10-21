import { Module } from '@nestjs/common';
import { AuditLoggerService } from './services/audit-logger.service';

@Module({
  providers: [AuditLoggerService],
  exports: [AuditLoggerService],
})
export class CommonModule {}
