# Changelog

All notable changes to DeRadar Turbo Backup Engine will be documented in this file.


## [2.1.0](https://github.com///compare/v2.0.0...v2.1.0) (2025-10-23)

### Features

#### Arweave Wallet Authentication
- **Wander Wallet Integration** - Secure wallet-based login with challenge-response authentication
- **ArweaveSignatureService** - RSA-PSS cryptographic signature verification
- **WalletAuthService** - Nonce-based challenge system with 5-minute expiration
- **WalletLoginDto** - Strict input validation for wallet addresses and signatures
- **Dual Authentication** - Support for both traditional credentials and wallet login
- **Rate Limiting** - 10 challenge requests/min, 5 login attempts/min

#### Data Encryption & Security
- **EncryptionService** - AES-256-GCM encryption for sensitive data
- **EncryptedArchiveRecord Entity** - Encrypted storage for aircraft tracking data
- **Encrypted Data Pipeline** - End-to-end encryption for data processing
- **Encrypted Arweave Uploads** - Secure uploads to permanent storage
- **AuditExceptionFilter** - Centralized security event logging and monitoring
- **Enhanced Audit Logger** - Comprehensive logging for authentication events

#### UI/UX Improvements
- **Redesigned Admin Login** - Modern UI with Wander wallet connection interface
- **Wallet Connection Status** - Real-time wallet connection indicators
- **Modular View Partials** - Reusable components (head.ejs, styles.ejs, dashboard-core.ejs)
- **Enhanced Dashboard** - Improved layouts and styling
- **Dark Mode Pagination** - Updated pagination interface with dark theme
- **Visual Assets** - ArDrive and Nillion logos added

#### Developer Experience
- **Auto-Versioning System** - standard-version for automated releases
- **Comprehensive Documentation** - HOW-TO-RELEASE.md, VERSIONING.md, RELEASE-CHEATSHEET.md
- **config.yaml.example** - Template for secure configuration
- **Session Secret Auto-Generation** - Automatic secret generation on first run

### Security

- **Zero Private Key Storage** - All wallet signing happens client-side
- **Replay Attack Protection** - One-time cryptographic nonces with automatic cleanup
- **Cryptographically Secure Nonces** - Using crypto.randomBytes(32)
- **Challenge Expiration** - 5-minute window for nonce validity
- **Automatic Cleanup** - Expired challenges removed every minute
- **Strict Input Validation** - class-validator with whitelist mode
- **Rate Limiting** - Prevents brute force attacks on all auth endpoints
- **Full Audit Trail** - All authentication events logged with IP and user agent
- **config.yaml Removed from Git** - Sensitive configuration no longer tracked

### Technical Updates

- Added @nestjs/throttler for rate limiting
- Added standard-version for automated versioning
- Enhanced session management with explicit save callbacks
- Updated Docker Compose configurations
- Added encryption key configuration to config schema
- Extended archive entities with encryption support fields
- Improved error handling across authentication flows
- Added comprehensive audit logging filters

### Changed

- Admin login page now supports dual authentication methods
- Session management improved with better error handling
- Archive service extended with encryption capabilities
- Pagination UI updated with enhanced dark mode styling
- Configuration template separated from actual config file

## [2.0.0] - 2025-10-19

**BREAKING CHANGES:**
- Data storage migrated from JSON to Parquet columnar format for optimized performance

### Added
- **Parquet-based storage system** for high-frequency data processing with columnar compression
- **Real-time aircraft tracking** with millisecond-precision position updates
- **AircraftTrackerService** for continuous position monitoring and trajectory analysis
- **WebSocket support** for live statistics streaming via Socket.io
- **Complete UI overhaul** with new node manager dashboard
- **Public read-only dashboard** for external data visualization
- **High-throughput data pipeline** for processing large-scale tracking data
- New entities: AircraftTrack and SystemStats for enhanced data modeling
- Global rate limiting with @nestjs/throttler
- Enhanced audit logging service
- Admin dashboard optimized for real-time operations
- Dark-themed pagination interface

### Changed
- Migrated from JSON to Parquet format for 60% storage efficiency
- Optimized archive service with Parquet read/write operations
- Improved session management and authentication flows
- Enhanced flight data service with better error handling

### Performance
- Columnar storage reduces upload bandwith usage by up to 60%
- Millisecond-precision tracking for high-frequency updates
- Optimized query performance with Parquet indexing

---

## [1.0.0] - 2025-06-28 (Initial Release)

### Added
- **DeRadar Turbo Backup Engine** - Decentralized aircraft tracking data archival system
- **Arweave integration** via @ardrive/turbo-sdk for permanent data storage
- **Archive service** for collecting and backing up aircraft tracking data
- **SQLite database** with TypeORM for local metadata storage
- **Authentication system** with Passport.js and session management
- **Admin dashboard** for monitoring backup operations
- **Scheduled data collection** using @nestjs/schedule
- **RESTful API** with NestJS framework
- **Docker support** for development and production environments
- **Comprehensive test suite** with Jest
- Flight data service for processing aircraft telemetry
- Queue system for managing upload workflows
- Configuration system with YAML support
- Complete documentation and contributing guidelines

### Technical Stack
- NestJS 11.x for backend framework
- TypeORM for database management
- @ardrive/turbo-sdk for Arweave uploads
- Better-sqlite3 for high-performance local storage
- Express sessions for authentication
- Swagger/OpenAPI documentation
- Docker Compose for containerization

[Unreleased]: https://github.com/DeRadar-Turbo-Backup/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/DeRadar-Turbo-Backup/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/DeRadar-Turbo-Backup/releases/tag/v1.0.0
