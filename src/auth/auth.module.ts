import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LocalStrategy } from './local.strategy';
import { SessionAuthGuard } from './session.guard';

@Module({
  imports: [PassportModule],
  providers: [AuthService, LocalStrategy, SessionAuthGuard],
  controllers: [AuthController],
  exports: [SessionAuthGuard],
})
export class AuthModule {}
