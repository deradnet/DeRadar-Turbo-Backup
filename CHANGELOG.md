# Changelog

All notable changes to DeRadar Turbo Backup Engine will be documented in this file.


## [2.1.0](https://github.com///compare/v2.0.0...v2.1.0) (2025-10-23)


### Features

* add Arweave wallet authentication with cryptographic signature verification and encrypted data pipeline ([ad27d85](https://github.com///commit/ad27d85d36fdac4e8acf81f61f88f2a43427fc7e))
* add Arweave wallet authentication with cryptographic signature verification and encrypted data pipeline ([cf40ee2](https://github.com///commit/cf40ee2c5362e578cba557d1d6920e5cc16a5a83))

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
