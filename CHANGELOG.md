# Changelog

This project follows [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-10-13

### Added

- Schema-first discovery and API inspection for all collection/single types; ordinary content no longer requires a UID, dynamic zone or Draft & Publish.
- `list_content_types`, `inspect_content_type`, `find_entries`, `get_entry`, `preview_entry_write` and `apply_entry_write` with persisted inspections/previews, schema constraints, real media/relation validation, revision checks, idempotency and re-fetch verification.
- Linked localization through PUT on the same documentId, shared slugs by default, disclosed shared-field effects and unchanged published-version checks.
- `list_media`, `preview_media_upload` and `upload_media` with multipart upload, file signature/hash checks and post-upload verification.
- Explicit `allowEntryEditing` / `STRAPI_ALLOW_ENTRY_EDITING` / `--allow-entry-editing`, custom field storage contracts and immediate-write previews for types without draft state.

- Versioned preview contract with stable fields, machine-readable output schemas and field-level before/after values for clone, direct-edit and rollback previews.
- `list_page_operations`, `preview_rollback_page` and `rollback_page` for explicitly reverting completed patch-only draft edits using saved snapshots, revision checks and post-write verification. Inserted components are never removed.
- Opt-in `preview_modify_page` and `modify_page` tools for patching and inserting components in an existing page draft without cloning or publishing.
- Persisted preview hashes, revision checks, component ID preservation, destructive-operation guards and lost-response reconciliation for in-place updates.
- `allowInPlaceEditing` config, `STRAPI_ALLOW_IN_PLACE_EDITING` env and `--allow-in-place-editing` auto-discovery flag, all disabled by default.
- Isolated real Strapi acceptance script covering nested IDs, media/relations, MCP stdio insertion and unchanged published content.

### Changed

- API errors distinguish Strapi JSON errors from upstream WAF/authentication HTML failures. Clients must not silently fall back to browser or shell writes.
- Automatic discovery tolerates leftover content-type directories without schema files; legacy page aliases and protections remain available.

- SQLite write locks serialize operations across tenants sharing an audit database; audit records remain tenant-isolated.
- Rich-text blocks preserve embedded application data during normalization.

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
