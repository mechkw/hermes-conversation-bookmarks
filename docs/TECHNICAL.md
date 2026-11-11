# Conversation Bookmarks technical reference

[README](../README.md) · [Operations](OPERATIONS.md) · [Usage](USAGE.md) · [Security](../SECURITY.md)

Conversation Bookmarks persists deliberate annotations and exact source references, not transcripts or delivered files. Source existence checks, requested chooser previews, and explicit generation have different read boundaries.

## Runtime layout

| Source | Responsibility |
| --- | --- |
| `__init__.py` | Four tools, singular/plural commands, current-session handoff, and generation registration. |
| `telegram_bookmarks.py` | Optional native panels, owner policy, explicit reference-only Add confirmation, and callback lifetime. |
| `dashboard/plugin_api.py` | Models, annotation store, read-only source adapter, generation collector, and authenticated routes. |
| `ui/Bookmarks.jsx` | Collection, adjacent inspector, checkboxes, and confirmed removal. |
| `ui/BookmarkEditor.jsx` | Conversation/response chooser, annotations, and generated draft. |
| `ui/BookmarkSettings.jsx` | Profile-local display switches. |
| `ui/desktop.jsx`, `ui/dashboard.jsx` | Host-specific transport and navigation. |
| `desktop/plugin.js`, `dashboard/dist/index.js` | Built client bundles. |

The package works without Delivery Shelf. When both are enabled, their providers share Saved navigation. Bookmarks remains references and annotations; Shelf remains delivered files and preserved versions. Native Desktop contributes **Plus → Bookmarks** and **Browse bookmarks**, which open browsing rather than silently capturing a source.

## Persistence and input

Data lives beneath the backend profile's Hermes home:

```text
plugin-data/conversation-bookmarks/bookmarks.sqlite3
```

The store contains annotation entries and settings. Saved records include `id`, `created`, `updated`, and `revision`. `source_status` is computed from the native source store rather than a retained transcript copy. Updates/removal of the package do not erase this database.

| Input | Contract |
| --- | --- |
| `title` | Trimmed, nonempty printable text, at most 160 characters. |
| `note` | Optional text, at most 4,000 characters. Slash `--description` maps here. |
| `tags` | Up to 20 printable strings, each 1–40 characters. Boundary-trimmed, Unicode-casefold deduplicated, first spelling retained. |
| `session_id` | Exact bound-profile source, 1–160 letters, digits, `_`, `.`, `:`, or `-`. |
| `message_id` | Optional positive JavaScript-safe native integer belonging to that session. Not a Telegram message ID. |

Unknown keys and invalid types are rejected. HTTP POST/PUT bodies are bounded to 32 KiB. Tool validation is independent of advertised schemas. An omitted tool `session_id` can use reliable native invocation context. An explicit empty or malformed reference is not repaired into a guessed source.

Create validates the source and reads back the exact stored ID. Creates are not idempotent. Updates require the current revision; a changed reference must validate again. An unchanged missing-source reference may remain while its annotations are edited. Delete removes metadata only and returns `source_deleted: false`.

## Commands and tools

### Native slash command

| Command | Meaning |
| --- | --- |
| `/bookmarks` | Browse without saving. |
| `/bookmarks browse [words]`, `/bookmark browse [words]` | Search saved annotations. |
| `/bookmarks add [metadata]`, `/bookmark add [metadata]` | Explicit current-conversation capture. Native Telegram bare Add instead opens a confirmation panel. |
| `/bookmark` | Preserve legacy current-conversation capture, not browsing. |
| `/bookmark [title] [#tags] [--description "text"]` | Supply any or all metadata for current-conversation capture. |
| `/bookmarks help`, `/bookmark help` | Help without saving. |

Unrecognized plural forms return guidance without saving. Reserved singular forms such as `browse`, `add`, and `help` dispatch as commands; use the editor/tools for a title that conflicts with command syntax. Slash tags are comma-separated. Editor tags use one per line and retain literal commas.

Fully supplied title, tags, and description save directly without inference. Omitted metadata requests a supported current-agent handoff through `ctx.inject_message`, using the actual source session and routing key. Gateway-assisted handoff needs explicit profile-local `plugins.entries.conversation-bookmarks.allow_gateway_injection`. Accepted work is queued, not saved. The agent is instructed to preserve supplied fields, save, and search/read back before confirming. Prompt instructions do not guarantee every model's adherence.

Toolset `conversation_bookmarks` contains `conversation_bookmark_save`, `conversation_bookmark_search`, `conversation_bookmark_update`, and `conversation_bookmark_delete`. Tools return JSON strings with `ok` and either `data` or `error`. There is no file attachment tool or automatic linking to Shelf.

## Search, inspection, and removal

Saved search covers titles, notes, and tags, not transcript content. Title/note matching uses SQLite `lower()` and literal substring matching. Tag substrings and exact tag filters use Unicode casefold. This is not a universal Unicode full-text search engine.

Sorts are `newest`, `oldest`, and `title`. Newest/oldest use original creation time, not last edit. API pages default to 50 and allow 1–100; the UI displays 30. Offset is bounded to 1,000,000.

Selecting a title opens an adjacent inspector. Checkboxes separately select explicit bookmarks for removal. Page selection affects that page, and selected records can span pages up to the 100-item UI cap. Changing filters or refreshing clears the selection. There is no all-filtered selection. Bulk removal accepts 1–100 unique ID/revision pairs, reserves one SQLite transaction, validates every pair, and removes all or none.

Bookmarks has no Archive, Trash, version history, or recovery timer. Confirmed removal is permanent annotation deletion, not source deletion.

Native Desktop rechecks availability and calls `host.openSession` for the session/profile. An optional response reference does not promise exact-message scrolling. Dashboard supplies session/resume information rather than inventing a route.

## Read-only source boundary

`SourceAdapter` opens exactly the bound profile's `state.db` using SQLite `mode=ro` and query-only mode. It does not create a native SessionDB object or migrate source state. Missing, unsafe, or unsupported stores are refused rather than repaired.

Ordinary saves and availability checks consult source identifiers and ownership. Explicit chooser requests can read session labels and bounded visible assistant previews. The chooser searches up to 1,000 recent local non-hidden sessions or 500 eligible assistant rows in a selected session. These are recent windows, not full-history search.

Stored preview cells are bounded to 16 KiB before decoding. Returned previews are at most 350 characters. Supported visible text is projected from native content. Reasoning, tool, media, hidden, observed, and unsupported carriers are not previews. `has_more` describes matches inside the current window; `window.truncated` describes older candidates outside it. Pages can shift as native history changes.

Source states are `available`, `session_missing`, `message_missing`, `store_missing`, and `unavailable`. None promises source retention. A source may disappear immediately after validation, and annotations cannot reconstruct it.

## Manual AI draft

Editor **Generate details** uses `POST /generation/draft` for a new response bookmark. It sends the selected response, its preceding real user request, and bounded earlier eligible exchanges through `ctx.llm.acomplete_structured` with task `conversation_bookmarks_details`. It excludes later text. It returns a draft, never a saved entry.

UI **Context** offers 5, 10, 20, or 50 previous exchanges, default 10. The compatibility API accepts strict integers 0–100. Generation reports actual/requested context and truncation. Required focal text is not silently shortened. The collector follows eligible compression continuity within its bounded native-history contract; it does not invent missing ancestry or initialize display indices.

Limits include 4,000 candidate timeline rows, 64 KiB per generation message cell, and 256 KiB serialized input. Native model access has a 45-second deadline and concurrency limits. Unsupported source formats, invalid output, timeout, or plugin/profile changes reject the draft. Recognized private carriers are excluded, but the adapter cannot infer provenance absent from native history, such as arbitrary unmarked third-party injections.

Generation replaces the form's title, note, and tags. Newer edits and changed selections fence a late completion. Selection or settings changes do not themselves trigger inference. The current-agent slash handoff uses the agent's existing context instead; its context boundary is not the editor's selected-response cutoff.

## Authenticated HTTP API

Mount prefix: `/api/plugins/conversation-bookmarks`. The host owns authentication and enablement. A `profile` query parameter must match the already-bound profile and cannot authorize another filesystem home.

| Method | Relative route | Contract |
| --- | --- | --- |
| GET | `/status` | Version and bound profile. |
| GET | `/entries` | Metadata search with `q`, `tag`, `sort`, `limit`, and `offset`. |
| POST | `/entries` | Validate source and create annotations. |
| GET / PUT | `/entries/{id}` | Read, or replace complete metadata using current revision. |
| DELETE | `/entries/{id}?revision=N` | Remove one annotation record only. |
| POST | `/entries/remove` | All-or-nothing removal of explicit ID/revision pairs, maximum 100. |
| GET / PUT | `/settings` | Strict booleans `show_notes` and `show_source_status`, default true. |
| GET | `/sources/sessions` | Bounded recent conversation choices. |
| GET | `/sources/sessions/{session_id}/responses` | Bounded eligible assistant previews. |
| GET / PUT | `/generation/settings` | Strict `previous_exchanges` value, 0–100. |
| POST | `/generation/draft` | Validated metadata draft and context counts; no save. |

Strict revisions are positive JavaScript-safe integers. A stale update/delete returns 409. UI clients fence late reads and completions against profile, connection, and disposal. A mutation already dispatched may finish in its original context; leaving the view does not roll it back.

## Optional Telegram panel

Native `/bookmarks` panels require host handler support and the separate profile-local `plugin-data/conversation-bookmarks/telegram-owners.json`. It is an array of decimal user-ID strings, maximum 50. Missing or invalid policy denies native panel access before catalog/source reads. The policy is not a grant for all command/tool paths.

Panels expire after ten minutes and bind to owner, chat/topic, message, session, profile, and application lifecycle. **Add this conversation** previews the exact invoking source's title. **Save conversation reference** explicitly saves that title with empty note/tags and no model call. An untitled source uses **Saved conversation**. Cancel does not save. Reset, deletion, unload, stale buttons, and changed ownership can invalidate a panel. Handler replacement and unload detach the prior application callback; delivery rechecks expiry, profile binding, and lifecycle before publishing actions. Telegram browse without native application support still checks owner/session before returning text. A failed confirmation is not proof of rollback.

## Compatibility and verification

Run checks in a disposable development checkout with separate dependencies:

```sh
npm ci --ignore-scripts
npx playwright install chromium
export PYTHON=/path/to/development/python
export HERMES_SOURCE=/path/to/hermes-agent
bash scripts/verify.sh
```

The source runner includes unit, native fixture, command, Telegram capture, build, and browser checks. Fixture tests do not establish live messaging, Electron history hydration, remote transport, or clean installation. Source inspection is not a test receipt. A new bundle, installed package, and native workflow each need separate evidence against the exact release. No current pass count or universal backend/client support is asserted here.
