# Technical guide

[← README](../README.md) · [Everyday usage](OPERATIONS.md) · [Security](../SECURITY.md)

Conversation Bookmarks stores deliberate annotations and source references. It does not
store transcripts, provide another memory backend, or intercept ordinary conversation.

```text
Native save/search/update/delete tools ────────────┐
Dashboard → host fetchJSON → authenticated routes ├→ bound profile
Desktop   → host ctx.rest  → authenticated routes ┘       │
                                                        ├→ bookmarks.sqlite3 (metadata)
                                                        └→ state.db (read-only existence checks)

Desktop Open conversation → host.openSession → native session navigation
```

## Source layout

- `__init__.py`: four native tools, validated invocation context, locked lazy service import.
- `plugin.yaml`, `VERSION`: unified package identity, capabilities, runtime dependencies.
- `dashboard/plugin_api.py`: strict models, source adapter, metadata store, API routes.
- `dashboard/manifest.json`: Dashboard page contribution.
- `ui/Bookmarks.jsx`, `ui/style.css`: shared React interface and scoped styles.
- `ui/dashboard.jsx`, `ui/desktop.jsx`: separate native host adapters.
- `dashboard/dist/index.js`: ready-to-load Dashboard IIFE.
- `desktop/plugin.js`: self-contained ESM using host `react` and `@hermes/plugin-sdk`.

The package is independent of Delivery Shelf. No Node build is required by end users.
React comes from each host; relative runtime imports are not needed by Desktop's blob
loader. Only the plugin's own route/sidebar are contributed—chat/composer surfaces are
not replaced.

## Tools and input

Toolset: `conversation_bookmarks`.

| Tool | Purpose |
|---|---|
| `conversation_bookmark_save` | Save a validated reference and annotations |
| `conversation_bookmark_search` | Search bookmark metadata |
| `conversation_bookmark_update` | Replace metadata using the current revision |
| `conversation_bookmark_delete` | Remove a bookmark using its ID and revision |

All return JSON strings shaped as `{ "ok": true, "data": ... }` or
`{ "ok": false, "error": ... }`.

A fictional save payload:

```json
{
  "title": "Launch decision",
  "note": "Friday launch, reduced scope. Review deferred items next week.",
  "tags": ["website", "launch"],
  "session_id": "example-session-001",
  "message_id": 42
}
```

The supplied session must exist in the bound profile. The optional native message ID
must belong to that exact session. Omit it for a conversation-level bookmark. When
`session_id` is omitted from a tool call, the save handler may use the actual native
invocation's session ID. Missing context fails; explicitly invalid/empty IDs are not
silently repaired or replaced with a guessed source.

No `/bookmark` command is registered. The inspected raw-argument slash callback lacks
reliable session context; adding a misleading shortcut would weaken the source contract.

### Bounds

- Title: trimmed, nonempty printable text, at most 160 characters.
- Note: at most 4,000 characters; supplied by the caller, not extracted from the source.
- Tags: up to 20; each 1–40 printable characters; trimmed, lowercased, deduplicated.
- Session ID: 1–160 characters from letters, digits, `_`, `.`, `:`, and `-`.
- Message ID: positive native integer, at most 9,007,199,254,740,991. The UI conservatively
  limits its entry field to 15 decimal digits. Platform message IDs are not inferred.
- Search query: at most 200 characters; tag filter: at most 40.
- Page size: 1–100; offset: 0–1,000,000. UI pages contain up to 30 entries.
- Unknown JSON keys are rejected. POST/PUT bodies are bounded to 32 KiB while streaming,
  before model parsing. Tool arguments are validated independently of their schemas.

Search covers titles, notes, and tags, with an exact tag filter and newest/oldest/title
sorting. It never searches transcript content. Saved records add an opaque ID, timestamps,
a revision, and current source availability.

## Authenticated API

Native mount: `/api/plugins/conversation-bookmarks`. Authentication, origin protection,
trusted package admission, and effective enablement belong to the Hermes host.

| Method | Relative path | Result |
|---|---|---|
| GET | `/status` | Version and bound profile |
| GET | `/entries` | Search/filter/sort/page using `q`, `tag`, `sort`, `limit`, `offset` |
| POST | `/entries` | Validated entry; 201 |
| GET | `/entries/{id}` | Metadata and current `source_status`; 404 if absent |
| PUT | `/entries/{id}` | Full metadata and current revision; stale writes return 409 |
| DELETE | `/entries/{id}?revision=N` | Metadata deletion; `source_deleted: false`; stale deletion returns 409 |

List results contain `items`, `total`, `limit`, and `offset`. Successful responses use
`Cache-Control: no-store`. The optional `profile` argument must match the profile already
bound by the host; it cannot select a filesystem path or grant access to another home.

Create is not idempotent. After an ambiguous response, read/search before retrying; a
second POST can create a second bookmark. Revision checks prevent stale updates/deletes,
not duplicate creates. Source checks are point-in-time, not retention locks.

## Read-only source boundary

`SourceAdapter` opens exactly the bound profile's `state.db` using SQLite `mode=ro` and
`PRAGMA query_only=ON`. It does not construct a native SessionDB object that might
initialize, migrate, or repair state.

Only these source fields are consulted:

```sql
SELECT profile_name FROM sessions WHERE id = ?;
SELECT 1 FROM messages WHERE id = ? AND session_id = ?;
```

No content, reasoning, prompts, session titles, tool payloads, or transcript excerpts
are selected. Missing stores are not created. Symlinked stores/ancestors and hard-linked
stores are refused. Read/schema failures fail closed. No immutable SQLite mode is used,
so the adapter does not intentionally ignore a live write-ahead log.

The required native schema includes `sessions.id`, `sessions.profile_name`, `messages.id`,
and `messages.session_id`. A null/empty legacy profile label is accepted only inside the
already-bound profile's database. An explicitly foreign label is refused. Missing
`profile_name` is not treated as permission to ignore ownership.

Source statuses are `available`, `session_missing`, `message_missing`, `store_missing`,
and `unavailable`. Deleted sources leave bookmark metadata intact. Editing annotations
for a missing source is allowed; changing its reference requires validation again.
Native pruning can occur immediately after validation, so a bookmark never promises
source resurrection or transcript retention.

## Persistence and context lifetime

Metadata lives at:

```text
<bound HERMES_HOME>/plugin-data/conversation-bookmarks/bookmarks.sqlite3
```

The service resolves `get_hermes_home()` for each request, not once at import. It uses
short-lived SQLite connections, transactional writes, a 10-second busy timeout, and
optimistic revision checks. Linked metadata directories/files are refused. Package
removal does not erase this catalog. Filesystem tampering by software running as the
same account is outside the remote-client boundary.

Desktop uses `ctx.rest` and fences requests/completions against profile, connection,
and disposal. Dashboard captures the native loader's profile and refuses work after
its script retires. Shared UI action generations reject stale read/detail completions.
A write already dispatched may finish in its original context; unmounting does not undo
it, but must not issue verification through a newly selected host.

Desktop's open action rechecks availability, then calls
`host.openSession(id, { profile, expectHistory: true })`. This opens a conversation—not
a claimed exact-message anchor. Dashboard offers copy/resume rather than guessing a
route. Clipboard access uses the host OS bridge on Desktop and browser clipboard support
on Dashboard, with a manual-copy fallback.

## Development and tests

Use a separate Python development environment with FastAPI, Pydantic 2, and the test/host
dependencies. Do not ad-hoc install packages into a managed Hermes environment.

```sh
npm ci --ignore-scripts
npx playwright install chromium
export PYTHON=/path/to/development/python
export HERMES_SOURCE=/path/to/hermes-agent
bash scripts/verify.sh
```

The runner executes unit tests, native HTTP/auth checks, Doctor and catalog validation,
builds, and both native-loader browser suites. Fictional source banks and HTTP fixtures
are outside the repository and removed on exit; public-safe screenshots are retained.
Native server lifespan workers/bootstrap are disabled in HTTP fixtures.

## Compatibility and verification

The initial complete runner and native installation lifecycle passed against **Hermes
v0.22.5**, official commit `bf0203a794a07aac3ff764972ab9087baa4e4f4e`, as well as the
development baseline `bd3cbe91a9`. The CI workflow pins the official release. This does
not establish an older minimum version.

The separate `tests/install_lifecycle.py` requires a disposable host checkout beneath
`TMPDIR`; native package preparation can modify that checkout, so never aim it at a
live installation. It exercises actual install, enable, disable, update while disabled,
and removal. The real Desktop reconciliation implementation copies, updates, and prunes
the UI package. Bookmark SQLite and the fictional native source database are checked
byte-identical across the lifecycle. The workflow contains the isolated setup.

Verified release runner:

- 22 unit tests covering ownership, strict inputs, source pruning, read-only source
  bytes, concurrent profile contexts, revision conflicts, and native tools.
- Native unauthenticated 401, authenticated create/readback, source-file denial,
  generated bundle serving, and already-mounted disabled-plugin 404.
- Doctor: four tools, zero findings. Catalog validation: 16 checks, zero warnings.
- Real Dashboard and Desktop native loaders at 360/768/1440 pixels, including CRUD,
  search/filter/sort, escaped text, keyboard dialogs, error/retry, conflict draft
  retention, source pruning, and stale profile/connection/disposal callbacks.
- No horizontal overflow; visible controls at least 44 pixels; measured muted-card
  contrast 4.78:1 light and 7.36:1 dark in the tested palettes.

The Desktop browser harness uses the actual runtime loader, React, HTTP, and SQLite,
but doubles SDK state/IPC/UI boundaries. It verifies the session-open invocation, not
actual Electron history hydration. Full Electron, OS clipboard behavior, Windows/macOS,
remote OAuth, and end-to-end out-of-process secondary-profile transport are not proved
by these tests. Context binding tests are separate from that transport boundary.

## Deliberate exclusions

No automatic excerpts, observer hooks, model calls, analytics, cloud sync, memory writes,
source database edits, import/export, bulk actions, source retention changes, or invented
message-anchor navigation. The narrow source adapter is the compatibility boundary to
revisit if Hermes changes its session schema or adds a suitable public read-only API.
