# Changelog

Notable user-facing changes are recorded here. Release tags identify published versions;
this file is not a promise of future features.

## Unreleased

- Added concise native command-menu metadata and expanded non-saving command help,
  with real-loader/menu/help/lifecycle regression probes. Documented priority/cap
  setup and the v0.22.5 global `/help` and `/commands` omission of plugin commands;
  no custom menu or core-help override. See [Command discovery](docs/COMMANDS.md).
- Propagated the selected official host through `PYTHONPATH` in verification so
  catalog child-process probes resolve host imports in clean CI environments.

- Fixed supplied tag casing loss: create/update now trim boundary whitespace and
  deduplicate case-insensitively while preserving the first spelling/case. Exact tag
  filters use Unicode casefold on both sides, so mixed-case and existing lowercase
  records remain searchable without a migration. Structured tags retain literal commas.
- Added mixed-case slash direct-save/handoff-to-fixture-save and API create/update/
  readback/filter regressions, including Unicode and literal SQL-like search input.

### Added

- `/bookmark` requests a current-session agent save, completing omitted title, tags and
  description only. Supplied details are preserved; description maps to note.
- Optional `--description "text"` extends the prior title/#comma,tags shorthand. All
  supplied metadata saves directly with readback; `/bookmark help` explicitly shows help.
- Supported native `PluginContext.inject_message` handoff, with host-owned routing and
  default-off gateway consent documented, never enabled by the plugin. No premature save
  or success message: the agent must save, search/read back, then report the details.
- Human-readable success and validation/source/context errors. Missing host session
  context fails closed, including on older one-argument command dispatchers.
- Native dispatcher-to-command-to-search tests for the exact approved example, parsing,
  limits, missing/invalid sources, legacy context, and profile isolation. Additional
  coverage verifies all omitted-field combinations, descriptions, denial/unavailable
  injection, JSON-framed hostile data, and real native injection consent/routing seams.

### Corrected

- Compatibility notes: official Hermes v0.22.5 already supplies named command session
  context through its dispatcher and gateway route; the prior documentation was wrong.
  Existing structured tags still support literal commas. No transcript reads, native
  source writes, or production installation are introduced.

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
