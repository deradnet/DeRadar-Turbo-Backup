import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArweaveSignatureService } from './arweave-signature.service';
import { AuditLoggerService } from '../../common/services/audit-logger.service';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

interface Challenge {
  nonce: string;
  timestamp: number;
  expiresAt: number;
}

@Injectable()
export class WalletAuthService implements OnModuleInit {
  private readonly logger = new Logger(WalletAuthService.name);
  private nodeWalletJWK: any;
  private nodeWalletAddress: string;
  private readonly LOGIN_MESSAGE = 'I want to login my DeRadar node admin dashboard';
  private challenges: Map<string, Challenge> = new Map();
  private readonly CHALLENGE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly configService: ConfigService,
    private readonly arweaveSignatureService: ArweaveSignatureService,
    private readonly auditLogger: AuditLoggerService,
  ) {}

  async onModuleInit() {
    await this.initializeWallet();
    // Start cleanup interval for expired challenges
    setInterval(() => this.cleanupExpiredChallenges(), 60000); // Run every minute
  }

  /**
   * Initialize the node wallet and pre-sign the login message
   */
  private async initializeWallet() {
    try {
      // Get the wallet keyfile path from config
      const privateKeyName = this.configService.get<string>('wallet.private_key_name');

      if (!privateKeyName) {
        throw new Error('wallet.private_key_name not configured');
      }

      const keysDirectory = path.join(process.cwd(), 'keys');
      const keyfilePath = path.join(keysDirectory, privateKeyName);

      // Check if keyfile exists
      if (!fs.existsSync(keyfilePath)) {
        throw new Error(`Wallet keyfile not found at: ${keyfilePath}`);
      }

      // Load the JWK from file
      const keyfileContent = fs.readFileSync(keyfilePath, 'utf-8');
      this.nodeWalletJWK = JSON.parse(keyfileContent);

      // Get the wallet address
      this.nodeWalletAddress = await this.arweaveSignatureService.getWalletAddress(
        this.nodeWalletJWK,
      );

      this.logger.log(`Node wallet initialized: ${this.nodeWalletAddress}`);
      this.logger.log(`Login message: "${this.LOGIN_MESSAGE}"`);
    } catch (error) {
      this.logger.error(
        `Failed to initialize wallet: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }


  /**
   * Generate a challenge (nonce) for wallet authentication
   * @returns Challenge object with nonce
   */
  generateChallenge(): { nonce: string; message: string } {
    const nonce = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();

    this.challenges.set(nonce, {
      nonce,
      timestamp: now,
      expiresAt: now + this.CHALLENGE_EXPIRY_MS,
    });

    return {
      nonce,
      message: this.LOGIN_MESSAGE,
    };
  }

  /**
   * Validate a wallet login attempt with nonce-based challenge
   * @param walletAddress The wallet address attempting to login
   * @param signature The signature provided by the user
   * @param nonce The nonce from the challenge
   * @returns User object if valid, null otherwise
   */
  async validateWalletLogin(
    walletAddress: string,
    signature: string,
    nonce: string,
  ): Promise<{ user: { walletAddress: string } } | null> {
    try {
      // 1. Check if wallet address matches the node wallet
      if (walletAddress !== this.nodeWalletAddress) {
        this.logger.warn(
          `Login attempt from unauthorized wallet: ${walletAddress}`,
        );
        return null;
      }

      // 2. Validate nonce exists and hasn't expired
      const challenge = this.challenges.get(nonce);
      if (!challenge) {
        this.logger.warn('Invalid or expired nonce');
        return null;
      }

      if (Date.now() > challenge.expiresAt) {
        this.challenges.delete(nonce);
        this.logger.warn('Nonce has expired');
        return null;
      }

      // 3. Delete nonce to prevent replay attacks (use once only)
      this.challenges.delete(nonce);

      // 4. Construct the message that should have been signed (includes nonce)
      const messageWithNonce = `${this.LOGIN_MESSAGE}\n\nNonce: ${nonce}`;

      // 5. VERIFY the signature (don't compare - RSA-PSS has random padding!)
      const isValid = await this.arweaveSignatureService.verifySignatureWithPublicKey(
        messageWithNonce,
        signature,
        this.nodeWalletJWK.n, // public key modulus
      );

      // Log to audit
      this.auditLogger.logWalletSignatureDebug(
        walletAddress,
        messageWithNonce,
        signature,
        `Verification result: ${isValid}`,
        isValid,
      );

      if (!isValid) {
        this.logger.warn('Wallet signature verification failed - check audit.log for details');
        return null;
      }

      this.logger.log(`✅ Successful wallet login: ${walletAddress}`);

      // Return user object
      return {
        user: {
          walletAddress,
        },
      };
    } catch (error) {
      this.logger.error(
        `Wallet login validation error: ${error.message}`,
        error.stack,
      );
      return null;
    }
  }

  /**
   * Clean up expired challenges from memory
   */
  private cleanupExpiredChallenges() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [nonce, challenge] of this.challenges.entries()) {
      if (challenge.expiresAt < now) {
        this.challenges.delete(nonce);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`Cleaned up ${cleanedCount} expired challenges`);
    }
  }

  /**
   * Get the login message that should be signed
   * @returns The login message
   */
  getLoginMessage(): string {
    return this.LOGIN_MESSAGE;
  }

  /**
   * Get the node wallet address
   * @returns The node wallet address
   */
  getNodeWalletAddress(): string {
    return this.nodeWalletAddress;
  }
}
