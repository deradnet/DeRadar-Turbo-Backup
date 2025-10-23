import { Injectable, Logger } from '@nestjs/common';
import Arweave from 'arweave';
import * as crypto from 'crypto';

@Injectable()
export class ArweaveSignatureService {
  private readonly logger = new Logger(ArweaveSignatureService.name);
  private arweave: Arweave;

  constructor() {
    this.arweave = Arweave.init({
      host: 'arweave.net',
      port: 443,
      protocol: 'https',
    });
  }

  /**
   * Sign a message using the node's Arweave wallet (JWK)
   * @param message The message to sign
   * @param jwk The JWK (JSON Web Key) from the wallet
   * @returns Base64url encoded signature
   */
  async signMessage(message: string, jwk: any): Promise<string> {
    try {
      // Encode the message to Uint8Array
      const messageData = new TextEncoder().encode(message);

      // Hash the message with SHA-256 (this is what Wander wallet does)
      const messageHash = await this.hashMessage(messageData);

      // Sign the hash using the JWK
      const signature = await this.arweave.crypto.sign(jwk, messageHash);

      // Return as base64url encoded string
      return this.arweave.utils.bufferTob64Url(signature);
    } catch (error) {
      this.logger.error(`Failed to sign message: ${error.message}`, error.stack);
      throw new Error('Failed to sign message');
    }
  }

  /**
   * Verify a signature against a message and wallet address
   * @param message The original message that was signed
   * @param signature The signature to verify (base64url encoded)
   * @param walletAddress The Arweave wallet address
   * @returns True if signature is valid, false otherwise
   */
  async verifySignature(
    message: string,
    signature: string,
    walletAddress: string,
  ): Promise<boolean> {
    try {
      // Encode the message to Uint8Array
      const messageData = new TextEncoder().encode(message);

      // Hash the message with SHA-256
      const messageHash = await this.hashMessage(messageData);

      // Decode the signature from base64url
      const signatureBuffer = this.arweave.utils.b64UrlToBuffer(signature);

      // Get the public key (modulus) from the wallet address
      // The wallet address is the base64url encoded SHA-256 hash of the RSA public key modulus
      const publicKey = await this.getPublicKeyFromAddress(walletAddress);

      // Verify the signature
      const isValid = await this.arweave.crypto.verify(
        publicKey,
        messageHash,
        signatureBuffer,
      );

      return isValid;
    } catch (error) {
      this.logger.error(
        `Failed to verify signature: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  /**
   * Hash a message using SHA-256 (matching Wander wallet's default behavior)
   * @param data The data to hash
   * @returns The SHA-256 hash
   */
  private async hashMessage(data: Uint8Array): Promise<Uint8Array> {
    // Use Node.js crypto to hash with SHA-256
    const hash = crypto.createHash('sha256').update(data).digest();
    return new Uint8Array(hash);
  }

  /**
   * Get the public key (modulus 'n') from a wallet address
   * Note: This requires fetching from Arweave network or having it cached
   * @param walletAddress The Arweave wallet address
   * @returns The public key modulus
   */
  private async getPublicKeyFromAddress(walletAddress: string): Promise<string> {
    try {
      // Try to get the last transaction from this address to extract public key
      const txs = await this.arweave.api.get(`/wallet/${walletAddress}/last_tx`);

      if (txs.data) {
        // Get the transaction details which contain the owner (public key)
        const tx = await this.arweave.transactions.get(txs.data);
        return tx.owner;
      }

      // If no transactions exist, we can't get the public key
      throw new Error('No transactions found for this wallet address');
    } catch (error) {
      this.logger.error(
        `Failed to get public key from address: ${error.message}`,
        error.stack,
      );
      throw new Error('Could not retrieve public key from wallet address');
    }
  }

  /**
   * Alternative verification method that accepts the public key directly
   * This is more efficient as it doesn't require network calls
   * @param message The original message that was signed
   * @param signature The signature to verify (base64url encoded)
   * @param publicKey The RSA public key modulus (base64url encoded)
   * @returns True if signature is valid, false otherwise
   */
  async verifySignatureWithPublicKey(
    message: string,
    signature: string,
    publicKey: string,
  ): Promise<boolean> {
    try {
      // Encode the message to Uint8Array
      const messageData = new TextEncoder().encode(message);

      // Hash the message with SHA-256
      const messageHash = await this.hashMessage(messageData);

      // Decode the signature from base64url
      const signatureBuffer = this.arweave.utils.b64UrlToBuffer(signature);

      // Verify the signature
      const isValid = await this.arweave.crypto.verify(
        publicKey,
        messageHash,
        signatureBuffer,
      );

      return isValid;
    } catch (error) {
      this.logger.error(
        `Failed to verify signature with public key: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  /**
   * Get wallet address from JWK
   * @param jwk The JWK (JSON Web Key)
   * @returns The wallet address
   */
  async getWalletAddress(jwk: any): Promise<string> {
    try {
      return await this.arweave.wallets.jwkToAddress(jwk);
    } catch (error) {
      this.logger.error(
        `Failed to get wallet address from JWK: ${error.message}`,
        error.stack,
      );
      throw new Error('Failed to get wallet address');
    }
  }
}
