import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Response } from 'express';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse<Response>();

    const isAuthenticated = !!request.session?.user;

    if (!isAuthenticated) {
      // Check if this is an HTML page request (like /admin)
      // If so, redirect to login instead of returning 403 JSON
      const acceptsHtml = request.accepts('html');
      const isPageRequest = !request.path.includes('/api') &&
                           !request.path.includes('/tracking/') &&
                           acceptsHtml;

      if (isPageRequest) {
        response.redirect('/auth/login');
        return false;
      }
    }

    return isAuthenticated;
  }
}
