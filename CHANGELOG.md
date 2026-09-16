# Changelog

This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-09-16

### Added

- Opt-in, schema-validated `routeField` / `STRAPI_ROUTE_FIELD` support for frontends that route by a field separate from the Strapi UID.
- Explicit top-level slug, route, and title changes in clone previews and write results.

### Changed

- The package now supports local stdio only; hosted HTTP, API-key, OIDC, PostgreSQL, Docker, D1, and Durable Object infrastructure was removed.

## [0.1.2] - 2026-09-09

### Added

- Cross-process SQLite write serialization and stale lock recovery.
- Safe reconciliation for lost update responses.
- Structured `OPERATION_BUSY` and `WRITE_OUTCOME_UNKNOWN` errors.
- Public documentation and npm release automation.

### Changed

- Lost create responses now fail closed instead of retrying or adopting a page.
- Owned-draft updates recheck revisions immediately before writing and send only
  the configured dynamic-zone field.

## [0.1.1] - 2026-09-09

### Fixed

- Corrected generated nested populate parameters for Strapi 5.

## [0.1.0] - 2026-09-09

- Initial clone-first MCP implementation.

[Unreleased]: https://github.com/metehankasapp/safe-strapi-mcp/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/metehankasapp/safe-strapi-mcp/releases/tag/v0.2.0
[0.1.2]: https://github.com/metehankasapp/safe-strapi-mcp/releases/tag/v0.1.2
[0.1.1]: https://github.com/metehankasapp/safe-strapi-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/metehankasapp/safe-strapi-mcp/releases/tag/v0.1.0
