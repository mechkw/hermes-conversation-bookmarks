# Changelog

Notable user-facing changes are recorded here. Release tags identify published versions;
this file is not a promise of future features.

## 0.1.0 — 2026-10-23

### Added

- Explicit conversation/message bookmarks with a title, supplied note, and normalized tags.
- Native save, search, update, and delete tools with validated source references.
- Profile-local SQLite metadata and read-only source existence/ownership checks.
- Native Dashboard and Desktop pages with responsive mobile/tablet layouts and light/dark themes.
- Metadata search, tag filtering, sorting, revision conflicts, and confirmed removal.
- Visible missing-source status without discarding the saved annotation.
- Desktop conversation-opening through the host SDK; ID/resume-command copying on both hosts.
- Original featured artwork, fictional-data screenshots, everyday usage and technical guides.
- Unit/security, native API/registration, and real-loader browser tests.

### Scope

No automatic transcript copying, model calls, memory writes, or changes to source retention.
Message references identify a moment; opening the source navigates to its conversation,
not a claimed exact-message anchor. Removal deletes only bookmark metadata.

See [compatibility and verification](docs/TECHNICAL.md#compatibility-and-verification)
for the tested host surfaces and remaining platform boundaries.
