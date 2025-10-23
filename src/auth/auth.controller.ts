import {
  Controller,
  Post,
  Req,
  Body,
  UnauthorizedException,
  Get,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { WalletLoginDto } from './dto/wallet-login.dto';
import { WalletAuthService } from './services/wallet-auth.service';
import { AuditLoggerService } from '../common/services/audit-logger.service';
import { Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly walletAuthService: WalletAuthService,
    private readonly auditLogger: AuditLoggerService,
  ) {}

  @Get('login')
  getLoginPage(@Res() res: Response) {
    return res.render('admin-login');
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 login attempts per minute
  async login(@Req() req, @Body() loginDto: LoginDto) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    const user = this.authService.validateUser(loginDto.username, loginDto.password);

    if (!user) {
      // Log failed login attempt
      this.auditLogger.logFailedLogin(
        loginDto.username,
        ip,
        userAgent,
        'Invalid credentials',
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    req.session.user = user;

    // Explicitly save the session to ensure cookie is set
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });

    // Log successful login
    this.auditLogger.logSuccessfulLogin(loginDto.username, ip, userAgent);

    return { message: 'Login successful', user };
  }

  @Get('wallet/challenge')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async getWalletChallenge() {
    const challenge = this.walletAuthService.generateChallenge();
    const nodeWallet = this.walletAuthService.getNodeWalletAddress();

    return {
      ...challenge,
      nodeWallet,
    };
  }

  @Post('wallet/login')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 login attempts per minute
  async walletLogin(@Req() req, @Body() walletLoginDto: WalletLoginDto) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    const user = await this.walletAuthService.validateWalletLogin(
      walletLoginDto.walletAddress,
      walletLoginDto.signature,
      walletLoginDto.nonce,
    );

    if (!user) {
      // Log failed login attempt
      this.auditLogger.logFailedLogin(
        walletLoginDto.walletAddress,
        ip,
        userAgent,
        'Invalid wallet signature',
      );
      throw new UnauthorizedException('Invalid wallet signature');
    }

    req.session.user = user;

    // Explicitly save the session to ensure cookie is set
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });

    // Log successful login
    this.auditLogger.logSuccessfulLogin(
      walletLoginDto.walletAddress,
      ip,
      userAgent,
    );

    return { message: 'Wallet login successful', user };
  }

  @Get('logout')
  logout(@Req() req, @Res() res: Response) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const username = req.session?.user?.user?.username || req.session?.user?.user?.walletAddress || 'unknown';

    // Log logout
    this.auditLogger.logLogout(username, ip, userAgent);

    // Delete user data from session first
    delete req.session.user;

    // Destroy session on server and clear cookie on client
    req.session.destroy((err: Error) => {
      if (err) {
        // Even if destroy fails, we already deleted the user
        // Clear cookie anyway
        res.clearCookie('connect.sid', { path: '/' });
        return res.status(500).json({ message: 'Logout failed', error: err.message });
      }

      // Clear the session cookie on client side
      res.clearCookie('connect.sid', {
        path: '/',
      });

      // Return success response
      return res.json({ message: 'Logout successful' });
    });
  }
}
