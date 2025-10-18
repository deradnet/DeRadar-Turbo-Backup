import {
  Controller,
  Post,
  Req,
  Body,
  UnauthorizedException,
  Get,
  Res,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('login')
  getLoginPage(@Res() res: Response) {
    return res.render('admin-login');
  }

  @Post('login')
  login(@Req() req, @Body() body: { username: string; password: string }) {
    const user = this.authService.validateUser(body.username, body.password);
    if (!user) throw new UnauthorizedException();

    req.session.user = user;
    return { message: 'Login successful', user };
  }

  @Get('logout')
  logout(@Req() req) {
    req.session.destroy(() => {});
    return { message: 'Logout successful' };
  }
}
