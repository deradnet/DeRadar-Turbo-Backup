import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  constructor(private readonly configService: ConfigService) {}

  validateUser(username: string, password: string) {
    const user = this.configService.get<object>('auth');
    if (
      !user ||
      user['username'] !== username ||
      user['password'] !== password
    ) {
      return null;
    }
    // Return only safe user data (exclude password and secret)
    return {
      user: {
        username: user['username'],
      },
    };
  }
}
