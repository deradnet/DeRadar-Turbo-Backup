import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * EncryptionService - Time-based encryption key rotation with HKDF
 *
 * Architecture:
 * - Package UUID: Unique per batch, shared between encrypted/unencrypted versions (for correlation)
 * - Encryption Key UUID: Time-based (rotated every minute), shared across all packages in that minute
 * - All packages encrypted within the same minute use the same encryption key
 * - Both UUIDs stored in Arweave tags for tracking and decryption
 *
 * Uses HKDF (HMAC-based Key Derivation Function) for deterministic key generation
 */
@Injectable()
export class EncryptionService {
  private readonly masterKey: Buffer;
  private currentMinuteEncryptionKey: { keyUuid: string; derivedKey: Buffer; timestamp: number } | null = null;
  private storedMinuteKeys: Set<string> = new Set(); // Track encryption key UUIDs already stored in nilDB

  constructor(private readonly configService: ConfigService) {
    const keyHex = this.configService.get<string>('data.encryption_key');
    if (!keyHex || keyHex.length !== 64) {
      throw new Error('Invalid encryption key: must be 64 hex characters (32 bytes)');
    }
    this.masterKey = Buffer.from(keyHex, 'hex');
  }

  /**
   * Gets or generates the encryption key for the current minute
   * Returns cached key if still within the same minute, otherwise generates new one
   * This is separate from the package UUID - it's the actual encryption key identifier
   */
  private getOrGenerateMinuteEncryptionKey(): { keyUuid: string; derivedKey: Buffer } {
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000); // Get current minute epoch

    // Check if we need a new key (new minute or no key yet)
    if (!this.currentMinuteEncryptionKey || Math.floor(this.currentMinuteEncryptionKey.timestamp / 60000) !== currentMinute) {
      const encryptionKeyUuid = `enckey-${currentMinute}-${crypto.randomUUID()}`;
      const derivedKey = this.deriveKeyFromUuid(encryptionKeyUuid);

      this.currentMinuteEncryptionKey = {
        keyUuid: encryptionKeyUuid,
        derivedKey,
        timestamp: now,
      };

      console.log(`🔑 [KEY ROTATION] New minute encryption key generated: ${encryptionKeyUuid}`);
    }

    return {
      keyUuid: this.currentMinuteEncryptionKey.keyUuid,
      derivedKey: this.currentMinuteEncryptionKey.derivedKey,
    };
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
   * Send encryption key to nildb-keystore service
   * Returns true if successful, false if service is unavailable
   * Uses deduplication cache to avoid storing the same minute key multiple times
   */
  async storeKeyInNilDB(packageUuid: string, encryptionKey: Buffer): Promise<boolean> {
    // Check if this key was already stored (deduplication for minute-based keys)
    if (this.storedMinuteKeys.has(packageUuid)) {
      console.log(`ℹ️ Key ${packageUuid} already stored in nilDB (skipping duplicate)`);
      return true;
    }

    try {
      const response = await fetch('http://nildb-keystore:3001/store-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageUuid: packageUuid,
          encryptionKey: encryptionKey.toString('hex'),
        }),
      });

      if (!response.ok) {
        console.error(`Failed to store key in nilDB: ${response.statusText}`);
        return false;
      }

      const result = await response.json();
      console.log(`✅ Key stored in nilDB for package ${packageUuid}, collection: ${result.collectionId}`);

      // Mark this key as stored
      this.storedMinuteKeys.add(packageUuid);

      // Clean up old entries (keep only last 5 minutes worth of keys)
      if (this.storedMinuteKeys.size > 5) {
        const keysArray = Array.from(this.storedMinuteKeys);
        this.storedMinuteKeys = new Set(keysArray.slice(-5));
      }

      return true;
    } catch (error) {
      console.error(`❌ Failed to communicate with nildb-keystore service:`, error.message);
      return false;
    }
  }

  /**
   * OPTIMIZED: Encrypts a Buffer with time-based key rotation (in-memory)
   * Returns encrypted buffer and metadata (no disk I/O)
   *
   * @param plaintextData - Data to encrypt
   * @param packageUuid - Package UUID for correlation between encrypted/unencrypted versions (required)
   */
  encryptBuffer(plaintextData: Buffer, packageUuid: string): {
    encryptedBuffer: Buffer;
    dataHash: string;
    fileSize: number;
    encryptionKey: Buffer;
    packageUuid: string;
    encryptionKeyUuid: string;
  } {
    // Calculate hash of plaintext (for integrity tracking)
    const dataHash = crypto.createHash('sha256').update(plaintextData).digest('hex');

    // Always use minute-based encryption key for actual encryption
    // Package UUID is for correlation, encryption key UUID is for the actual key
    const encryptionKeyInfo = this.getOrGenerateMinuteEncryptionKey();

    const encryptionKey = encryptionKeyInfo.derivedKey;
    const encryptionKeyUuid = encryptionKeyInfo.keyUuid;

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

    return {
      encryptedBuffer: encryptedPackage,
      dataHash: dataHash,
      fileSize: encryptedPackage.length,
      encryptionKey: encryptionKey,
      packageUuid: packageUuid,
      encryptionKeyUuid: encryptionKeyUuid,
    };
  }

  /**
   * Encrypts a file with UUID-derived key
   * Returns path to encrypted file and metadata
   * DEPRECATED: Use encryptBuffer() for better performance
   */
  encryptFile(inputFilePath: string, packageUuid: string): {
    encryptedFilePath: string;
    dataHash: string;
    fileSize: number;
    encryptionKey: Buffer;
    packageUuid: string;
    encryptionKeyUuid: string;
  } {
    // Read plaintext file
    const plaintextData = fs.readFileSync(inputFilePath);

    // Use in-memory encryption
    const result = this.encryptBuffer(plaintextData, packageUuid);

    // Write to temporary file (for backward compatibility)
    const tmpDir = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
    const outputFileName = `encrypted-${result.packageUuid}.bin`;
    const outputFilePath = path.join(tmpDir, outputFileName);
    fs.writeFileSync(outputFilePath, result.encryptedBuffer);

    return {
      encryptedFilePath: outputFilePath,
      dataHash: result.dataHash,
      fileSize: result.fileSize,
      encryptionKey: result.encryptionKey,
      packageUuid: result.packageUuid,
      encryptionKeyUuid: result.encryptionKeyUuid,
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
