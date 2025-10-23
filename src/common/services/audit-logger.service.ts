import { Injectable, Logger } from '@nestjs/common';
import { appendFileSync } from 'fs';
import { join } from 'path';

interface AuditLogEvent {
  timestamp: string;
  type: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  user?: string;
  ip?: string;
  userAgent?: string;
  endpoint?: string;
  method?: string;
  details?: any;
  success?: boolean;
  errorMessage?: string;
}

@Injectable()
export class AuditLoggerService {
  private readonly logger = new Logger('AUDIT');
  private readonly logDir = process.env.AUDIT_LOG_DIR || './database';
  private readonly logPath = join(this.logDir, 'audit.log');

  constructor() {
    // /data directory is already created by Docker, no need to create it
    this.logger.log(`Audit logs will be written to: ${this.logPath}`);
  }

  private writeLog(event: AuditLogEvent) {
    const logEntry = {
      ...event,
      timestamp: event.timestamp || new Date().toISOString(),
    };

    // Console log with color coding
    const logLevel = event.severity === 'critical' || event.severity === 'error' ? 'error' :
                     event.severity === 'warning' ? 'warn' : 'log';
    this.logger[logLevel](JSON.stringify(logEntry));

    // File log
    try {
      appendFileSync(this.logPath, JSON.stringify(logEntry) + '\n', 'utf-8');
    } catch (error) {
      this.logger.error(`Failed to write audit log to file: ${error.message}`);
    }
  }

  logFailedLogin(username: string, ip: string, userAgent: string, reason?: string) {
    this.writeLog({
      timestamp: new Date().toISOString(),
      type: 'FAILED_LOGIN',
      severity: 'warning',
      user: username,
      ip,
      userAgent,
      endpoint: '/auth/login',
      method: 'POST',
      success: false,
      details: {
        reason: reason || 'Invalid credentials',
        attemptedUsername: username,
      },
    });
  }

  logSuccessfulLogin(username: string, ip: string, userAgent: string) {
    this.writeLog({
      timestamp: new Date().toISOString(),
      type: 'SUCCESSFUL_LOGIN',
      severity: 'info',
      user: username,
      ip,
      userAgent,
      endpoint: '/auth/login',
      method: 'POST',
      success: true,
      details: {
        message: 'User successfully authenticated',
      },
    });
  }

  logLogout(username: string, ip: string, userAgent: string) {
    this.writeLog({
      timestamp: new Date().toISOString(),
      type: 'LOGOUT',
      severity: 'info',
      user: username,
      ip,
      userAgent,
      endpoint: '/auth/logout',
      method: 'GET',
      success: true,
    });
  }

  logAdminAction(
    action: string,
    user: string,
    ip: string,
    userAgent: string,
    endpoint: string,
    details: any,
    success: boolean = true,
  ) {
    this.writeLog({
      timestamp: new Date().toISOString(),
      type: 'ADMIN_ACTION',
      severity: success ? 'info' : 'error',
      user,
      ip,
      userAgent,
      endpoint,
      method: 'POST',
      success,
      details: {
        action,
        ...details,
      },
    });
  }

  logRateLimitExceeded(ip: string, userAgent: string, endpoint: string) {
    this.writeLog({
      timestamp: new Date().toISOString(),
      type: 'RATE_LIMIT_EXCEEDED',
      severity: 'warning',
      ip,
      userAgent,
      endpoint,
      success: false,
      details: {
        message: 'Rate limit exceeded',
        action: 'Request blocked',
      },
    });
  }

  logValidationError(ip: string, userAgent: string, endpoint: string, errors: string[]) {
    this.writeLog({
      timestamp: new Date().toISOString(),
      type: 'VALIDATION_ERROR',
      severity: 'warning',
      ip,
      userAgent,
      endpoint,
      success: false,
      details: {
        errors,
        message: 'Invalid input detected',
      },
    });
  }

  logUnauthorizedAccess(ip: string, userAgent: string, endpoint: string, method: string) {
    this.writeLog({
      timestamp: new Date().toISOString(),
      type: 'UNAUTHORIZED_ACCESS',
      severity: 'warning',
      ip,
      userAgent,
      endpoint,
      method,
      success: false,
      details: {
        message: 'Attempt to access protected resource without authentication',
      },
    });
  }

  logSecurityEvent(
    type: string,
    severity: 'info' | 'warning' | 'error' | 'critical',
    ip: string,
    userAgent: string,
    details: any,
  ) {
    this.writeLog({
      timestamp: new Date().toISOString(),
      type,
      severity,
      ip,
      userAgent,
      details,
    });
  }

  logWalletSignatureDebug(
    walletAddress: string,
    message: string,
    clientSignature: string,
    serverSignature: string,
    match: boolean,
  ) {
    this.writeLog({
      timestamp: new Date().toISOString(),
      type: 'WALLET_SIGNATURE_DEBUG',
      severity: match ? 'info' : 'warning',
      user: walletAddress,
      success: match,
      details: {
        message,
        messageLength: message.length,
        clientSignature: {
          length: clientSignature.length,
          first100: clientSignature.substring(0, 100),
          last50: clientSignature.substring(clientSignature.length - 50),
          full: clientSignature,
        },
        serverSignature: {
          length: serverSignature.length,
          first100: serverSignature.substring(0, 100),
          last50: serverSignature.substring(serverSignature.length - 50),
          full: serverSignature,
        },
        signaturesMatch: match,
      },
    });
  }
}
