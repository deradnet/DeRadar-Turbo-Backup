# Deradar Turbo Backup Engine

A decentralized flight tracking system that collects ADS-B aircraft data from multiple antennas and permanently archives it on the Arweave blockchain network using Ardrive Turbo SDK.

```
                                               ┌─────────────────┐
                                               │    AR.IO ARNS   │  
                                               └─────────────────┘
                                                        │
                                               ┌─────────────────┐
                                               │   DeRadar App   │   
                                               │   ar://deradar  │
                                               └─────────────────┘     
              ┌─────────────────────┐                   |
              │ Historical data API │─────<─>── GraphQL + Data Access
              └─────────────────────┘                   |
                                                        │
                                                        │
 ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐    ┌─────────────────┐
 │   ADS-B Antenna │    │  DeRadar Backup  │    │  AR.IO Network  │    │     Arweave     │
 │    (dump1090)   │───>│     Engine       │───>│   (Gateways)    │───>│     Network     │
 │                 │    │                  │    │                 │    │       L1        │
 └─────────────────┘    │  ┌─────────────┐ │    └─────────────────┘    └─────────────────┘
                        │  │Backup Worker│ │            
 ┌─────────────────┐    │  │  (Turbo)    │ │                          ┌─────────────────┐
 │   ADS-B Antenna │───>│  └─────────────┘ │──────────>logs───────────>   SQLite DB     │
 │   (readsb)      │    │                  │                          │   (metadata)    │
 └─────────────────┘    │  ┌─────────────┐ │                          └─────────────────┘
                        │  │ Web UI      │ │                           | For debugging |
 ┌─────────────────┐    │  │ (EJS views) │ │                          ┌─────────────────┐
 │   Custom Feed   │───>│  └─────────────┘ │──────────>logs───────────>   User Browser  │
 └─────────────────┘    └──────────────────┘                          └─────────────────┘
```

## Overview

- **Collects real-time flight data** from ADS-B receivers and antennas
- **Archives data permanently** on Arweave blockchain for immutable storage
- **Provides a web dashboard** to debug and search local/archived flight records
- **Supports multiple data sources** with configurable antenna endpoints

The system runs continuously, fetching aircraft data every 60 seconds from configured antennas and uploading non-empty datasets to Arweave for permanent preservation.

## Features

### **Automated Data Collection**
- Scheduled data fetching from multiple ADS-B antennas
- Configurable antenna endpoints with enable/disable controls
- Automatic filtering of empty datasets to save storage costs
- Mutex-protected operations to prevent concurrent uploads

### **Blockchain Archiving**
- Permanent data storage on Arweave network
- ARIO Turbo SDK integration for efficient and turbo fast uploads
- Metadata tagging with timestamps and source identification
- Transaction ID tracking for debugging

### **Web Interface**
- Authentication-protected dashboard
- Paginated browsing of archived records
- Direct access to archived data via transaction IDs
- System health monitoring and statistics

### Data Flow
1. **Collection**: Scheduler fetches JSON data from configured antenna end-points
2. **Validation**: Checks for aircraft presence and data validity
3. **Network Upload**: Archives data to Arweave using Ardrive Turbo SDK
4. **Perma Storage**: Data permanently stored on Arweave
5. **Metadata Storage**: Transaction metadata saved to local SQLite database (also it's possible to Graphql the data directly from Arweave using the gateways)
6. **Network Sync**: Connects with other Derad Network nodes for distributed tracking (in the next release)
7. **Access**: Web interface provides browsing and retrieval capabilities

## Quick Start

### Prerequisites
- **Node.js** 18+ and npm
- **Docker** and Docker Compose
- **Arweave Wallet** with Turbo Credits for uploads
- https://www.wander.app/
- https://turbo-topup.com/
- **ADS-B Data Source** (dump1090, readsb, etc.)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/deradar/DeRadar-Turbo-Backup
   cd DeRadar-Turbo-Backup
   ```

2. **Set up Arweave wallet**
   ```bash
   mkdir keys
   # Place your Arweave keyfile in the keys/ directory
   # Example: keys/arweave-keyfile-abc123.json
   ```

3. **Configure the application**
   ```bash
   nano config.yaml
   # Edit config.yaml with your settings
   ```
### config.yaml Structure

```yaml
# UI
api:
  enabled: false  # Set to true to enable debug UI access

# Authentication Settings
auth:
  username: your_username     # Change from default!
  password: your_password     # Change from default!
  secret: ""                  # Auto-generated session secret

# Database Configuration
database:
  path: /data/db.sqlite      # SQLite database for debugging logs

# Antenna Data Sources
antennas:
  - id: antenna-1
    url: http://localhost:8080/data/aircraft.json
    enabled: true
  - id: antenna-2
    url: http://remotehost:30003/data.json
    enabled: false

# Arweave Wallet Configuration
wallet:
  private_key_name: arweave-keyfile-abc123.json  # Filename in keys/ directory
```

4. **Start with Docker**
   ```bash
   # Development
   docker-compose -f dev.docker-compose.yaml up

   # Production
   docker-compose -f prod.docker-compose.yaml up -d
   ```

5. **Access the application**
   - Web Interface: http://localhost:9995
   - Health Check: http://localhost:9995/health

## ⚙️ Configuration

### Antenna Configuration

Backup engine supports any ADS-B data source that provides JSON in this format:
```json
{
  "now": 1751069515,
  "messages": 8690014,
  "aircraft": [
    {
      "hex": "48436b",
      "type": "adsb_icao",
      "flight": "KLM855  ",
      "alt_baro": 37000,
      "alt_geom": 38900,
      "gs": 575.3,
      "ias": 270,
      "tas": 492,
      "mach": 0.828,
      "wd": 273,
      "ws": 87,
      "oat": -41,
      "tat": -9,
      "track": 77.65,
      "roll": -7.91,
      "mag_heading": 68.2,
      "true_heading": 74.9,
      "baro_rate": 0,
      "geom_rate": 0,
      "squawk": "6025",
      "emergency": "none",
      "category": "A5",
      "nav_qnh": 1012.8,
      "nav_altitude_mcp": 36992,
      "nav_heading": 82.27,
      "lat": 40.925795,
      "lon": 47.061497,
      "nic": 7,
      "rc": 371,
      "seen_pos": 0.966,
      "version": 2,
      "nic_baro": 1,
      "nac_p": 8,
      "nac_v": 2,
      "sil": 3,
      "sil_type": "perhour",
      "gva": 2,
      "sda": 2,
      "alert": 0,
      "spi": 0,
      "mlat": [],
      "tisb": [],
      "messages": 987,
      "seen": 0.6,
      "rssi": -49.5
    }
```

**Compatible Software:**
- dump1090 (--write-json)
- readsb (--write-json)
- tar1090 JSON output
- Custom ADS-B APIs

#### We tested this software mainly with Readsb (wiedehopf fork) and tar1090. But any other decoder writes a standart json outputs can work.

### Project Structure

```
src/
├── archive/          # Arweave archiving module
├── auth/             # Authentication system
├── flight-data/      # Data collection service
├── common/           # Shared utilities and guards
├── config/           # Configuration validation
└── views/            # EJS templates for web UI

dockerfiles/          # Docker build configurations
keys/                 # Arweave wallet storage
database/             # SQLite database files
```
