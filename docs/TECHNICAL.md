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

- `__init__.py`: four native tools, `/bookmark`, validated invocation context, locked lazy service import.
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

### Native slash command

`/bookmark [title] [#tag1, tag2] [--description "text"]` registers through
`ctx.register_command` with named `session_id` and `session_key` context. Bare invocation
requests a save; `/bookmark help` alone returns usage. The quoted description option is
parsed separately so unquoted title apostrophes remain literal. The first start-of-input
or whitespace-delimited `#` outside that description separates comma-separated tags.
Description maps to `note`; explicit `--description ""` preserves an empty note.

The shared `EntryInput` model validates supplied data and the exact native source ID.
Read-only source validation runs before either path, including bare handoff. No missing
or foreign source, malformed ID, invalid supplied metadata, or environment fallback is
silently repaired. Tags are boundary-trimmed and case-insensitively deduplicated, keeping the first spelling/case;
structured API/tool tags and one-tag-per-line UI retain literal commas.

When all three metadata fields are supplied, the command saves deterministically through
the existing store; `Store.create` commits then calls `get` on the exact saved ID before
returning. Its concise completion reports the actual stored title, tags and description.

When any field is omitted, the command **does not save a placeholder**. It calls only the
supported `ctx.inject_message(content, role="user", session_key=session_key)` API, capturing
its registration context rather than retaining a process-global host. The prompt carries
an ASCII-escaped JSON data object with exact parsed supplied values, explicit missing-field
names and the native source session ID. User metadata is framed as inert data, never
interpolated into instructions. The agent is asked to generate only missing fields from
its current conversation, preserve supplied data, call `conversation_bookmark_save`, then
`conversation_bookmark_search` and verify the exact returned ID and metadata before a
brief saved/generated-details completion. No source transcript is fetched by the plugin.

Host acceptance is asynchronous, not a saved result. The accepted command returns empty
text to avoid an extra completion/preamble. Missing/denied/unavailable injection yields an
explicit failure and no command-side save or retry. Normal model processing, host safety
controls, routing and delivery apply. The plugin does not own credentials, a separate
model client, or a background collector. Prompt framing is not a guarantee of arbitrary
model adherence; tests validate the handoff and tools, not a live LLM's behavior.

The [official injection contract](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins/#injecting-messages)
and installed `hermes_cli/plugins_injection.py` establish the routing and default-off
`plugins.entries.conversation-bookmarks.allow_gateway_injection: true` permission for
gateway/TUI hosts. The plugin never writes that setting. The native routing key is passed
unchanged, never synthesized from `session_id`; no new `origin` is constructed. Classic
in-process CLI queues are host-owned. Gateway-backed classic CLI may retain the turn in
history without displaying the reply; use the all-supplied path when needed. An accepted
request can still fail later: search before retrying, and consult native gateway logs.

The host dispatcher `hermes_cli/plugin_command_dispatch.py:invoke_plugin_command`
passes only context parameters the handler declares. The gateway route is not inferred
from that helper: inspected `gateway/run_inbound_hooks.py` resolves the registered
command, looks up the existing session by the chat session key, builds session context,
and forwards its `session_id` under the native session environment scope. A missing
session remains empty; the command does not create or guess one.

Both official v0.22.5 (`bf0203a794a07aac3ff764972ab9087baa4e4f4e`) and the development
baseline contain this context-aware dispatcher and gateway route. The earlier claim
that v0.22.5 slash callbacks lacked reliable context was incorrect. No minimum-version
bump or CI pin change is required. The live official [plugin guide](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins/)
still includes one-argument examples; the installed native route is the evidence for
optional named context. Older hosts invoking just `handler(raw_args)` fail helpfully,
leaving explicit-ID tools/UI available. No environment session fallback is used.

`tests/test_bookmark_command.py` exercises the confirmed public seam: native
`invoke_plugin_command` → handler captured through `register(ctx)` → registered search
tool readback, with native ContextVar profile binding and fictional SQLite sources.
It also invokes the actual `GatewayInboundHooksMixin._hm_run_plugin_handler` with a
fictional Telegram `MessageEvent` and routing index: an existing chat resolves its
session, while a new chat with no session fails closed. Native event parsing, context
building, and dispatch execute unchanged; the fixture owns the index, context lifetime,
and executor (using native session variables and `asyncio.to_thread`).
`tests/native_probe.py` separately uses the real host plugin loader and command lookup,
then native command/tool dispatch and authenticated HTTP readback. These tests do not
claim live Telegram delivery, Bot API menu registration, or transport testing.

### Bounds

- Title: trimmed, nonempty printable text, at most 160 characters.
- Note/description: at most 4,000 characters; supplied by the caller or current agent
  on an explicit save request, never extracted by the source adapter.
- Tags: up to 20; each 1–40 printable characters; boundary-trimmed, case-insensitively deduplicated (Unicode casefold), retaining the first spelling/case.
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

Exact tag filtering compares Unicode casefolded values with bound SQL parameters,
not SQLite's ASCII-only `lower`/`NOCASE`. It matches existing lowercase and new
mixed-case records without migration; display spelling and order are unchanged by
reads. Commas, quotes, `%` and `_` remain literal tag characters, not patterns or SQL.
Casefold is not accent removal or Unicode normalization. Bookmark tag substring
search also uses casefold, avoiding a Unicode search regression when tags are no
longer stored lowercase. Title/note search semantics are unchanged.


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

### Tag-casing correction verification (unreleased)

After the supplied-tag casing correction, the installed-host run passed **41
unittest tests**, `tests/native_probe.py`, and `tests/native_contract.py` (Doctor:
4 tools, zero findings; catalog: 16 checks, zero warnings). New regressions preserve
`OpsCase` / `Keep-Tag` through direct slash saves and handoff-to-fixture completion,
and cover API create/update/readback, legacy lowercase filters, Unicode casefold,
case-insensitive deduplication, literal commas, and SQL-like tag input. The same full
unittest, native probe and contract checks also passed against an isolated archive
of official Hermes v0.22.5 after the correction.

A separate real native `AIAgent` run passed three fictional cases for this plugin:
all metadata omitted; exact title and mixed-case tags supplied; exact description
supplied. Each generated only missing metadata, saved once to actual plugin SQLite,
searched the stored entry, and returned its title, tags and description. Independent
readback confirmed supplied values and source references; source hashes stayed
unchanged across the runs.

That test used a capture callback to obtain the command handoff and a real model
for subsequent agent/tool execution. It is not live Telegram delivery or a
browser/Electron test. All fixture homes were removed; production remains unchanged.

### Slash-command verification (unreleased)

Verification passed on both the installed development host `bd3cbe91a90` and official
v0.22.5 (`bf0203a794a07aac3ff764972ab9087baa4e4f4e`): all 38 tests under
`python -m unittest discover -s tests -p 'test_*.py' -v`, `tests/native_probe.py`, and
`tests/native_contract.py`. Doctor registered four tools with zero findings; catalog
validation passed all 16 checks with zero warnings. `git diff --check` also passed.
The official host was a temporary archive removed after testing; CI pins are unchanged.

The earlier deterministic command baseline passed 32 tests. Agent-assisted metadata
completion extends that baseline to **38 unittest tests**: 22 existing tests and 16
public command regressions. The red/green sequence first demonstrated that bare saves
still showed help and omitted fields were saved prematurely, then implemented native
handoff and quoted description support. Coverage includes every omitted-field subset,
explicit empty description, supplied overrides, limits, JSON-framed hostile metadata,
help, missing sources/context, denied/unsupported injection, deterministic readback,
native gateway context propagation, and profile isolation.

`tests/native_probe.py` exercises the real loader, dispatcher, `PluginContext.inject_message`,
profile-owned default-off consent, separate profile targets, registered tool dispatch,
and authenticated HTTP readback. Its published gateway receivers and later completed
metadata are explicitly fictional fixtures, **not model output**. Acceptance alone is
checked to create no bookmark; native source bytes remain unchanged. These tests do
not prove a live model obeys the prompt, platform delivery succeeds, or arbitrary
malicious metadata cannot influence an agent.

All banks and host archives are disposable under `TMPDIR`. No production enablement,
config change, source edits, install, publishing, or frontend bundle changes are part
of this work. Browser/Electron behavior is not re-certified by command tests.

Verified release runner (0.1.0 baseline):

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

No automatic excerpts, observer hooks, independent plugin model calls, analytics, cloud sync, memory writes,
source database edits, import/export, bulk actions, source retention changes, or invented
message-anchor navigation. The narrow source adapter is the compatibility boundary to
revisit if Hermes changes its session schema or adds a suitable public read-only API.
