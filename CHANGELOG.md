# Changelog

Release tags identify published versions. Unreleased notes describe source changes, not a publication or deployment receipt.

## Unreleased

- `/bookmarks` browses without saving. Plural and singular `browse` and `add` forms are available. Bare `/bookmark` retains current-conversation capture, and help forms do not save. Unrecognized plural forms return guidance without becoming a saved title.
- Native Plus Bookmarks and Browse bookmarks open browsing. The collection separates title-based adjacent inspection from checkbox selection for removal.
- Page selection can span pages, up to 100 explicit bookmarks. Bulk removal checks every ID/revision in one transaction and removes all or none. Annotation removal never deletes conversations or messages and has no recovery timer.
- Display switches control notes and source status in the list. They persist immediately without deleting annotations or changing references.
- Source choosers read bounded recent conversation labels and eligible assistant-response previews on request. These are not full-history searches or copied transcripts.
- Explicit Generate details uses the selected response and bounded earlier eligible exchanges to return an editable annotation draft. It excludes later text, can replace draft fields, and does not save. Current-agent slash completion retains its separate existing-context handoff.
- Optional native Telegram panels use a separate Bookmarks owner policy. Add this conversation previews a title; Save conversation reference explicitly saves that title/reference with empty note and tags and no model call. Panels expire and bind to owner, chat/topic, session, profile, message, and application lifecycle.
- Technical, operations, command, installation, and security guides describe the current source-read, model-processing, deletion, and shared-profile boundaries. No live Telegram, native installation, or current test-pass count is asserted here.

## 0.1.0 - 2026-10-23

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
