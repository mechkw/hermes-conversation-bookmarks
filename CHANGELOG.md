# Changelog

Release tags identify published versions. Unreleased notes describe source changes, not a publication or deployment receipt.

## Unreleased

## 0.2.1 - 2026-11-12

### Fixed

- **Draft with AI works for either scope.** A whole-conversation bookmark can be drafted without choosing a response: the draft covers the conversation's latest usable response and as many earlier exchanges as the context choice allows. Choosing **One response** still drafts for exactly that response. Every source fence (profile, hidden, non-human sources, private and synthetic rows) applies unchanged.
- **The conversation picker lists your conversations first.** Automated runs (cron, subagents, one-shots) now sort after conversations you took part in, instead of crowding them out of the 1,000-item window. Search runs across the whole history before the window is cut, and an untitled conversation shows its first visible request so it can be recognized. That line is chooser text only and is never stored.
- **Routes no longer wait on the host's shared worker pool.** Bookmark routes now run on a small pool owned by the plugin. On a busy Hermes backend, the host's own slow reads could fill the shared pool, leaving Saved at "Checking availability…" and the conversation list timing out after 30 seconds even though the plugin was healthy.

## 0.2.0 - 2026-11-12

A ground-up interface pass. Storage, tools, slash commands, Telegram panels, and every existing API route behave as before; saved bookmarks need no migration.

### Changed

- **Collection.** One toolbar (search, type filter, sort, refresh, settings, New bookmark) above a dense list with an adjacent details pane. Rows show the title, a two-line note, tags, and a compact age; a problem with the source is the only status that earns a flag. The profile header, filter form, and footer copy are gone.
- **Selection.** A row's leading cell shows what kind of bookmark it is and becomes its checkbox on hover, focus, or while a selection is in progress. A selection bar replaces the count line. The list loads 30 at a time and appends on **Show more**, replacing Previous/Next pages.
- **Details pane.** Open conversation is the primary action, with Edit beside it and the rest under **⋯**. Raw identifiers and the resume command moved into a collapsed **Reference** section with copy buttons. On narrow windows the pane takes the list's place, with a back control.
- **Editor.** Choosing a source is a searchable list of recent conversations (title, origin, age), then **Whole conversation** or **One response** with response previews, replacing the select-plus-pager controls. Tags are chips with suggestions from tags already in use. Ctrl/⌘+Enter saves. **Generate details** is now **Draft with AI**; its context choice sits beside it.
- **Feedback.** Saves, removals, and copies report through host toasts on Desktop. Removal uses the host confirmation dialog with its pending state and inline error.
- **Dashboard.** The same components run on the web Dashboard through its own adapter, using its SDK components where they exist.
- Opening the primary button reads **New bookmark**; removal confirmation buttons read **Remove bookmark(s)** / **Keep bookmark(s)**. Source states are worded for people: *Conversation unavailable*, *Response unavailable*.

### Added

- Type filter (all, conversations, responses) and a tag row listing most-used tags with counts.
- Source context in the details pane: the conversation's title and, for a response bookmark, a bounded excerpt of the saved response. Read on request through the existing read-only adapter; never stored.
- Keyboard: `/` search, arrows or `J`/`K` browse, `N` new, `O` open, `E` edit, `X` check, Delete remove, Escape close.
- Row menu and, on Desktop, a matching right-click menu: open, edit, mention in chat, copy resume command, copy conversation ID, remove. Double-click opens the conversation.
- Desktop quick finder from the composer's **+** menu and the **Find a bookmark** palette command: Enter returns to the conversation, Ctrl/⌘+Enter writes a mention of the bookmark into the current draft without sending it.
- Desktop **Bookmark this conversation** palette command and rebindable shortcut (default Ctrl/⌘+Alt+B): opens the editor on the focused chat from any screen.
- Desktop sidebar mark on conversations that have bookmarks; selecting it filters Saved to that conversation.
- API: `kind` and `session_id` filters on `GET /entries`; `GET /tags`; `GET /marks`; `GET /entries/{id}/context`. All additive, authenticated, profile-bound, and read-only toward native history.
- `npm run preview` renders the main states with the real host components and fictional data. `npm run test:contract` and the host's desktop-surface lint join `scripts/verify.sh`.

### Removed

- The exact-tag text field (use the tag row, or select a tag anywhere it appears) and the in-collection footer copy.
- The full collection inside a dialog from the composer's **+** menu, replaced by the quick finder.

### Earlier unreleased notes

- `/bookmarks` browses without saving. Plural and singular `browse` and `add` forms are available. Bare `/bookmark` retains current-conversation capture, and help forms do not save. Unrecognized plural forms return guidance without becoming a saved title.
- The collection separates title-based adjacent inspection from checkbox selection for removal.
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
