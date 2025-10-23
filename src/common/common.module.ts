import { Module } from '@nestjs/common';
import { AuditLoggerService } from './services/audit-logger.service';
import { EncryptionService } from './utils/encryption.service';
import { AuditExceptionFilter } from './filters/audit-exception.filter';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [AuditLoggerService, EncryptionService, AuditExceptionFilter],
  exports: [AuditLoggerService, EncryptionService, AuditExceptionFilter],
})
export class CommonModule {}
