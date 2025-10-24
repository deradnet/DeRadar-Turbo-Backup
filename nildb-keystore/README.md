# nilDB Key Storage Microservice

Standalone HTTP service for storing package encryption keys in Nillion's nilDB.

## What It Does

- Listens for HTTP requests with UUID + encryption key pairs
- Stores keys in nilDB using secret sharing (splits into 3 encrypted shares)
- Distributes shares across 3 nilDB nodes
- Provides retrieval API for decryption

## API

### POST /store-key
Store a package encryption key.

**Request:**
```json
{
  "packageUuid": "pkg-12345-uuid",
  "encryptionKey": "abc123def456..." // 64-char hex string
}
```

**Response:**
```json
{
  "success": true,
  "packageUuid": "pkg-12345-uuid",
  "collectionId": "387f3bbd-..."
}
```

### GET /retrieve-key/:uuid
Retrieve a stored key.

**Response:**
```json
{
  "success": true,
  "packageUuid": "pkg-12345-uuid",
  "encryptionKey": "abc123def456..."
}
```

### GET /health
Health check.

**Response:**
```json
{
  "status": "ready",
  "collection": "387f3bbd-...",
  "userDid": "did:nil:..."
}
```

## How It Works

1. Reads `config.yaml` from parent directory (same as main app)
2. Uses `data.encryption_key` as nilDB master key
3. Auto-creates collection on first run
4. Stores collection ID in shared SQLite database
5. Accepts HTTP requests to store/retrieve keys
6. Keys are secret-shared across 3 nilDB nodes

## Usage with Main App

The main DeRadar app will call this service when encrypting packages:

```typescript
// In your archive service
const response = await fetch('http://nildb-keystore:3001/store-key', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    packageUuid: pkg.uuid,
    encryptionKey: derivedKey
  })
});
```

## Docker Compose

```yaml
services:
  nildb-keystore:
    build: ./nildb-keystore
    ports:
      - "3001:3001"
    volumes:
      - ./config.yaml:/app/config.yaml:ro
      - ./data:/app/data
    environment:
      - PORT=3001
```

## Configuration

Uses the same `config.yaml` as the main app:
- `data.encryption_key` - Master key for nilDB
- `database.path` - Shared SQLite database for collection metadata

No additional configuration needed!
