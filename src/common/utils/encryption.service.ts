import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * EncryptionService - UUID-based key derivation with HKDF
 *
 * Each package gets unique encryption key derived from:
 * - Master Key (from config)
 * - Package UUID (unique per package)
 *
 * Uses HKDF (HMAC-based Key Derivation Function) for deterministic key generation
 */
@Injectable()
export class EncryptionService {
  private readonly masterKey: Buffer;

  constructor(private readonly configService: ConfigService) {
    const keyHex = this.configService.get<string>('data.encryption_key');
    if (!keyHex || keyHex.length !== 64) {
      throw new Error('Invalid encryption key: must be 64 hex characters (32 bytes)');
    }
    this.masterKey = Buffer.from(keyHex, 'hex');
  }

  /**
   * Derives a 32-byte encryption key from UUID using HKDF
   * Same UUID + same master key = same derived key (deterministic)
   */
  private deriveKeyFromUuid(packageUuid: string): Buffer {
    const salt = Buffer.from(packageUuid, 'utf-8');
    const info = Buffer.from('arweave-package-encryption', 'utf-8');

    // HKDF-SHA256: Extract then Expand
    // Extract: PRK = HMAC-SHA256(salt, master_key)
    const prk = crypto.createHmac('sha256', salt).update(this.masterKey).digest();

    // Expand: OKM = HMAC-SHA256(PRK, info || 0x01)
    const okm = crypto.createHmac('sha256', prk)
      .update(Buffer.concat([info, Buffer.from([0x01])]))
      .digest();

    return okm; // 32 bytes for AES-256
  }

  /**
   * Encrypts a file with UUID-derived key
   * Returns path to encrypted file and metadata
   */
  encryptFile(inputFilePath: string, packageUuid: string): {
    encryptedFilePath: string;
    dataHash: string;
    fileSize: number;
  } {
    // Read plaintext file
    const plaintextData = fs.readFileSync(inputFilePath);

    // Calculate hash of plaintext (for integrity tracking)
    const dataHash = crypto.createHash('sha256').update(plaintextData).digest('hex');

    // Derive encryption key from UUID
    const encryptionKey = this.deriveKeyFromUuid(packageUuid);

    // Generate random IV (12 bytes for GCM)
    const iv = crypto.randomBytes(12);

    // Encrypt with AES-256-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    const encryptedData = Buffer.concat([
      cipher.update(plaintextData),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Create encrypted package: [IV][AuthTag][EncryptedData]
    const encryptedPackage = Buffer.concat([iv, authTag, encryptedData]);

    // Write to temporary file
    const tmpDir = os.tmpdir();
    const outputFileName = `encrypted-${packageUuid}.bin`;
    const outputFilePath = path.join(tmpDir, outputFileName);
    fs.writeFileSync(outputFilePath, encryptedPackage);

    return {
      encryptedFilePath: outputFilePath,
      dataHash: dataHash,
      fileSize: encryptedPackage.length,
    };
  }

  /**
   * Decrypts a file using UUID-derived key
   * (For future decryption service - NOT used in main app)
   */
  decryptFile(encryptedFilePath: string, packageUuid: string): Buffer {
    // Read encrypted package
    const encryptedPackage = fs.readFileSync(encryptedFilePath);

    // Parse package structure: [12 bytes IV][16 bytes AuthTag][remaining: encrypted data]
    const iv = encryptedPackage.slice(0, 12);
    const authTag = encryptedPackage.slice(12, 28);
    const encryptedData = encryptedPackage.slice(28);

    // Derive same encryption key from UUID
    const encryptionKey = this.deriveKeyFromUuid(packageUuid);

    // Decrypt with AES-256-GCM
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
    decipher.setAuthTag(authTag);

    const decryptedData = Buffer.concat([
      decipher.update(encryptedData),
      decipher.final(),
    ]);

    return decryptedData;
  }

  /**
   * Calculate SHA-256 hash of a file
   */
  hashFile(filePath: string): string {
    const data = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}
