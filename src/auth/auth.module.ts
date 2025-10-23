import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LocalStrategy } from './local.strategy';
import { SessionAuthGuard } from './session.guard';
import { ArweaveSignatureService } from './services/arweave-signature.service';
import { WalletAuthService } from './services/wallet-auth.service';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [PassportModule, CommonModule],
  providers: [
    AuthService,
    LocalStrategy,
    SessionAuthGuard,
    ArweaveSignatureService,
    WalletAuthService,
  ],
  controllers: [AuthController],
  exports: [SessionAuthGuard],
})
export class AuthModule {}
