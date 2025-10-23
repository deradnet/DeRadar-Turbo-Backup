# Changelog

All notable changes to DeRadar Turbo Backup Engine will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Arweave wallet authentication with Wander wallet integration
- ArweaveSignatureService for RSA-PSS cryptographic signature verification
- WalletAuthService with challenge-response (nonce) authentication system
- Encrypted data pipeline with AES-256-GCM encryption service
- EncryptedArchiveRecord entity for secure data storage
- Encrypted archive uploads to Arweave network
- Comprehensive audit logging with AuditExceptionFilter
- Rate limiting on authentication endpoints (5-10 requests/min)
- Wallet login UI integration with connection status indicators
- Modular view partials (head, styles, dashboard-core)
- Session secret auto-generation utility
- Visual assets (ArDrive and Nillion logos)
- config.yaml.example template for secure configuration

### Changed
- Enhanced admin login page with dual authentication (credentials + wallet)
- Updated pagination UI with improved dark mode styling
- Extended archive entities with encryption support fields
- Improved session management with explicit save callbacks
- Enhanced error handling across authentication flows

### Security
- **Zero private key storage** - All signing happens client-side in wallet
- **Replay attack protection** - One-time cryptographic nonces with 5-minute expiration
- **Cryptographically secure nonces** using crypto.randomBytes(32)
- **Automatic nonce cleanup** to prevent memory leaks
- **Strict input validation** with class-validator for all DTOs
- **Rate limiting** prevents brute force attacks
- **Comprehensive audit trail** for all security events
- **End-to-end encryption** for sensitive aircraft tracking data
- **Removed config.yaml from git tracking** to protect secrets

### Fixed
- Session cookie security (preparing for production hardening)

---

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
