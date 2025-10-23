import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuditLoggerService } from '../services/audit-logger.service';

@Injectable()
@Catch()
export class AuditExceptionFilter implements ExceptionFilter {
  constructor(private readonly auditLogger: AuditLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    const ip = request.ip || request.connection.remoteAddress || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    const endpoint = request.url;
    const method = request.method;

    // Extract validation errors
    let errors: string[] = [];
    if (typeof message === 'object' && 'message' in message) {
      if (Array.isArray(message.message)) {
        errors = message.message;
      } else if (typeof message.message === 'string') {
        errors = [message.message];
      }
    }

    // Log validation errors for auth endpoints
    if (endpoint.includes('/auth/') && status === HttpStatus.BAD_REQUEST) {
      // Extract wallet address or username from request body
      const body = request.body as any;
      const identifier = body?.walletAddress || body?.username || 'unknown';

      this.auditLogger.logValidationError(ip, userAgent, endpoint, errors);

      // Also log as failed login attempt if it's a login endpoint
      if (endpoint.includes('/login')) {
        this.auditLogger.logFailedLogin(
          identifier,
          ip,
          userAgent,
          `Validation failed: ${errors.join(', ')}`,
        );
      }
    }

    // Log unauthorized access attempts
    if (status === HttpStatus.UNAUTHORIZED) {
      const body = request.body as any;
      const identifier = body?.walletAddress || body?.username || 'unknown';

      this.auditLogger.logUnauthorizedAccess(ip, userAgent, endpoint, method);
    }

    // Log rate limit exceeded
    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      this.auditLogger.logRateLimitExceeded(ip, userAgent, endpoint);
    }

    // Return the error response
    response.status(status).json(
      typeof message === 'object'
        ? message
        : {
            statusCode: status,
            message,
            timestamp: new Date().toISOString(),
            path: endpoint,
          },
    );
  }
}
