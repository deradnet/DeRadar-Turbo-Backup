/**
 * nilDB Key Storage Microservice
 *
 * API Endpoints:
 * - POST /store-key    - Store a package key
 * - GET /retrieve-key/:uuid - Retrieve a package key
 * - POST /decrypt      - Decrypt encrypted package using encryption key UUID
 * - GET /health        - Health check
 */

import express from 'express';
import { SecretVaultBuilderClient, SecretVaultUserClient } from '@nillion/secretvaults';
import { Keypair, Command, NucTokenBuilder } from '@nillion/nuc';
import { SecretKey } from '@nillion/blindfold';
import { bytesToHex } from '@noble/curves/utils';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
// @ts-ignore
import sqlite3 from 'sqlite3';

// Use require for crypto to avoid TypeScript module resolution issues
// @ts-ignore
const crypto = require('crypto');
const { randomUUID, Buffer } = crypto;

// In Docker: /app/config.yaml (mounted volume)
// In development: ../config.yaml (relative path)
const configPath = fs.existsSync('/app/config.yaml') ? '/app/config.yaml' : '../config.yaml';
const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as any;

const NILDB_CONFIG = {
  masterKey: config.data.encryption_key, // Use same master key from main app
  nodes: [
    'https://nildb-stg-n1.nillion.network',
    'https://nildb-stg-n2.nillion.network',
    'https://nildb-stg-n3.nillion.network',
  ],
  chainUrl: 'http://rpc.testnet.nilchain-rpc-proxy.nilogy.xyz',
  authUrl: 'https://nilauth.sandbox.app-cluster.sandbox.nilogy.xyz',
};

const PORT = process.env.PORT || 3001;


let builder: SecretVaultBuilderClient;
let user: SecretVaultUserClient;
let delegationToken: any;
let collectionId: string;
let userDid: string;
let initialized = false;
let keysStoredCount = 0; // Track total keys stored (loaded from DB on startup)

/**
 * Load key count from database
 */
function loadKeyCountFromDB(): Promise<number> {
  let dbPath = config.database.path;
  if (fs.existsSync('/app/database')) {
    dbPath = dbPath.replace('./database', '/app/database');
  }

  return new Promise((resolve) => {
    const database = new sqlite3.Database(dbPath, (err: any) => {
      if (err) {
        console.log('   No database found, starting count at 0');
        resolve(0);
        return;
      }

      database.get(
        'SELECT value FROM nildb_metadata WHERE key = ?',
        ['total_keys_stored'],
        (err: any, row: any) => {
          if (row && row.value) {
            const count = parseInt(row.value, 10);
            console.log(`   📊 Loaded key count from DB: ${count}`);
            resolve(count);
          } else {
            resolve(0);
          }
          database.close();
        }
      );
    });
  });
}

/**
 * Save key count to database
 */
function saveKeyCountToDB(count: number) {
  let dbPath = config.database.path;
  if (fs.existsSync('/app/database')) {
    dbPath = dbPath.replace('./database', '/app/database');
  }

  const database = new sqlite3.Database(dbPath, (err: any) => {
    if (err) return;

    database.run(
      'CREATE TABLE IF NOT EXISTS nildb_metadata (id INTEGER PRIMARY KEY, key TEXT UNIQUE, value TEXT, description TEXT, createdAt TEXT)',
      () => {
        database.run(
          'INSERT OR REPLACE INTO nildb_metadata (key, value, description, createdAt) VALUES (?, ?, ?, ?)',
          ['total_keys_stored', count.toString(), 'Total encryption keys stored in nilDB', new Date().toISOString()],
          () => {
            database.close();
          }
        );
      }
    );
  });
}

async function initializeNilDB() {
  console.log('🔐 Initializing nilDB service...');

  try {
    // Load existing key count from database
    keysStoredCount = await loadKeyCountFromDB();
    // Create keypair from master key
    const builderKeypair = Keypair.from(NILDB_CONFIG.masterKey);
    const userKeypair = Keypair.from(NILDB_CONFIG.masterKey);
    userDid = userKeypair.toDid().toString();

    console.log(`   DID: ${userDid}`);

    // Initialize builder client
    builder = await SecretVaultBuilderClient.from({
      keypair: builderKeypair,
      urls: {
        chain: NILDB_CONFIG.chainUrl,
        auth: NILDB_CONFIG.authUrl,
        dbs: NILDB_CONFIG.nodes,
      },
      blindfold: {
        operation: 'store',
      },
    });

    // Register builder if needed
    try {
      await builder.refreshRootToken();
      await builder.readProfile();
      console.log('   ✅ Builder already registered');
    } catch (error: any) {
      console.log('   Registering builder...');
      try {
        await builder.register({
          did: builderKeypair.toDid().toString(),
          name: 'DeRadar nilDB Keystore',
        });
        await builder.refreshRootToken();
        console.log('   ✅ Builder registered');
      } catch (regError: any) {
        // If it's a duplicate error, try to refresh token anyway
        if (regError.toString().includes('DuplicateEntryError') ||
            (Array.isArray(regError) && regError.some((e: any) => e?.error?.body?.errors?.includes('DuplicateEntryError')))) {
          console.log('   ⚠️  Builder already exists (duplicate), attempting to use existing registration');
          await builder.refreshRootToken();
          console.log('   ✅ Using existing builder registration');
        } else {
          throw regError;
        }
      }
    }

    // Get or create collection
    collectionId = await getOrCreateCollection();
    console.log(`   ✅ Using collection: ${collectionId}`);

    // Initialize user client
    user = await SecretVaultUserClient.from({
      baseUrls: NILDB_CONFIG.nodes,
      keypair: userKeypair,
      blindfold: {
        operation: 'store',
      },
    });

    // Generate delegation token
    delegationToken = NucTokenBuilder.extending(builder.rootToken)
      .command(new Command(['nil', 'db', 'data', 'create']))
      .audience(userKeypair.toDid())
      .expiresAt(Math.floor(Date.now() / 1000) + 3600)
      .build(builderKeypair.privateKey());

    initialized = true;
    console.log('✅ nilDB service ready!\n');

  } catch (error: any) {
    console.error('❌ Failed to initialize nilDB:', error.message);
    console.error('   Full error:', JSON.stringify(error, null, 2));
    throw error;
  }
}

async function getOrCreateCollection(): Promise<string> {
  // Check if collection exists in database (shared with main app)
  // In Docker: /app/database/... (mounted volume)
  // In development: use config path as-is
  let dbPath = config.database.path;
  if (fs.existsSync('/app/database')) {
    // Running in Docker, adjust path
    dbPath = dbPath.replace('./database', '/app/database');
  }

  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(dbPath, (err: any) => {
      if (err) {
        // If no DB, create new collection
        createNewCollection().then(resolve).catch(reject);
        return;
      }

      database.get(
        'SELECT value FROM nildb_metadata WHERE key = ?',
        ['collection_id'],
        async (err: any, row: any) => {
          if (row) {
            resolve(row.value);
          } else {
            const id = await createNewCollection();
            // Store in DB
            database.run(
              'CREATE TABLE IF NOT EXISTS nildb_metadata (id INTEGER PRIMARY KEY, key TEXT UNIQUE, value TEXT, description TEXT, createdAt TEXT)',
              () => {
                database.run(
                  'INSERT INTO nildb_metadata (key, value, description, createdAt) VALUES (?, ?, ?, ?)',
                  ['collection_id', id, 'nilDB collection for package keys', new Date().toISOString()]
                );
              }
            );
            resolve(id);
          }
          database.close();
        }
      );
    });
  });
}

async function createNewCollection(): Promise<string> {
  const collectionId = randomUUID();

  const schema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        _id: { type: 'string', format: 'uuid' },
        private_key: {
          type: 'object',
          properties: { '%share': { type: 'string' } },
          required: ['%share'],
        },
      },
      required: ['_id', 'private_key'],
    },
  };

  await builder.createCollection({
    _id: collectionId,
    type: 'owned' as const,
    name: 'DeRadar Package Encryption Keys',
    schema,
  });

  return collectionId;
}


async function storeKeyInNilDB(packageUuid: string, encryptionKey: string): Promise<boolean> {
  if (!initialized) {
    throw new Error('nilDB not initialized');
  }

  try {
    const keyBuffer = Buffer.from(encryptionKey, 'hex');

    // Store in nilDB with secret sharing (%allot directive)
    await user.createData(delegationToken, {
      owner: userDid,
      acl: {
        grantee: builder.did.toString(),
        read: false,
        write: false,
        execute: true,
      },
      collection: collectionId,
      data: [{
        _id: packageUuid,
        private_key: {
          '%allot': keyBuffer, // Magic: Secret sharing!
        },
      }],
    });

    // Increment counter on successful storage and save to DB
    keysStoredCount++;
    saveKeyCountToDB(keysStoredCount);

    return true;
  } catch (error: any) {
    if (error.message?.includes('duplicate')) {
      // Already stored, that's fine (don't increment counter again)
      return true;
    }
    throw error;
  }
}

async function retrieveKeyFromNilDB(packageUuid: string): Promise<string | null> {
  if (!initialized) {
    throw new Error('nilDB not initialized');
  }

  try {
    const retrieved = await user.readData({
      collection: collectionId,
      document: packageUuid,
    });

    const keyBuffer = Buffer.from(Object.values(retrieved.data.private_key));
    return keyBuffer.toString('hex');
  } catch (error) {
    return null;
  }
}

/**
 * Decrypt encrypted package data using encryption key UUID
 * Matches the encryption format from EncryptionService:
 * [IV (12 bytes)][AuthTag (16 bytes)][EncryptedData]
 */
async function decryptPackage(encryptedData: any, encryptionKeyUuid: string): Promise<any> {
  if (!initialized) {
    throw new Error('nilDB not initialized');
  }

  // Retrieve encryption key from nilDB
  const encryptionKeyHex = await retrieveKeyFromNilDB(encryptionKeyUuid);
  if (!encryptionKeyHex) {
    throw new Error(`Encryption key not found: ${encryptionKeyUuid}`);
  }

  const encryptionKey = Buffer.from(encryptionKeyHex, 'hex');

  // Parse encrypted package structure: [12 bytes IV][16 bytes AuthTag][remaining: encrypted data]
  if (encryptedData.length < 28) {
    throw new Error('Invalid encrypted package: too short');
  }

  const iv = encryptedData.slice(0, 12);
  const authTag = encryptedData.slice(12, 28);
  const ciphertext = encryptedData.slice(28);

  // Decrypt with AES-256-GCM
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAuthTag(authTag);

  const decryptedData = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decryptedData;
}

// ============================================================================
// HTTP API Server
// ============================================================================

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: initialized ? 'ready' : 'initializing',
    collection: collectionId,
    userDid,
  });
});

// Stats endpoint - get count of keys stored
app.get('/stats', async (req, res) => {
  try {
    if (!initialized) {
      return res.status(503).json({
        success: false,
        error: 'Service not initialized',
      });
    }

    // Return the count of keys successfully stored
    res.json({
      success: true,
      totalKeys: keysStoredCount,
      collectionId,
      userDid,
      status: 'ready',
    });
  } catch (error: any) {
    console.error('Error getting stats:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Store key endpoint
app.post('/store-key', async (req, res) => {
  try {
    const { packageUuid, encryptionKey } = req.body;

    if (!packageUuid || !encryptionKey) {
      return res.status(400).json({
        success: false,
        error: 'packageUuid and encryptionKey required',
      });
    }

    await storeKeyInNilDB(packageUuid, encryptionKey);

    console.log(`✅ Stored key: ${packageUuid}`);

    res.json({
      success: true,
      packageUuid,
      collectionId,
    });
  } catch (error: any) {
    console.error('Error storing key:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Retrieve key endpoint
app.get('/retrieve-key/:uuid', async (req, res) => {
  try {
    const packageUuid = req.params.uuid;
    const key = await retrieveKeyFromNilDB(packageUuid);

    if (!key) {
      return res.status(404).json({
        success: false,
        error: 'Key not found',
      });
    }

    console.log(`✅ Retrieved key: ${packageUuid}`);

    res.json({
      success: true,
      packageUuid,
      encryptionKey: key,
    });
  } catch (error: any) {
    console.error('Error retrieving key:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Decrypt package endpoint
app.post('/decrypt', async (req, res) => {
  try {
    const { encryptedData, encryptionKeyUuid } = req.body;

    if (!encryptedData || !encryptionKeyUuid) {
      return res.status(400).json({
        success: false,
        error: 'encryptedData (base64) and encryptionKeyUuid required',
      });
    }

    // Convert base64 encoded encrypted data to Buffer
    const encryptedBuffer = Buffer.from(encryptedData, 'base64');

    // Decrypt the package
    const decryptedData = await decryptPackage(encryptedBuffer, encryptionKeyUuid);

    console.log(`✅ Decrypted package using key: ${encryptionKeyUuid}`);

    // Return decrypted data as base64
    res.json({
      success: true,
      encryptionKeyUuid,
      decryptedData: decryptedData.toString('base64'),
      size: decryptedData.length,
    });
  } catch (error: any) {
    console.error('Error decrypting package:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================================================
// Startup
// ============================================================================

async function main() {
  console.log('\n════════════════════════════════════════════════');
  console.log('  nilDB Key Storage Microservice');
  console.log('════════════════════════════════════════════════\n');

  // Initialize nilDB
  await initializeNilDB();

  // Start HTTP server
  app.listen(PORT, () => {
    console.log(`🚀 HTTP Server listening on port ${PORT}`);
    console.log(`   POST http://localhost:${PORT}/store-key`);
    console.log(`   GET  http://localhost:${PORT}/retrieve-key/:uuid`);
    console.log(`   POST http://localhost:${PORT}/decrypt`);
    console.log(`   GET  http://localhost:${PORT}/health\n`);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
