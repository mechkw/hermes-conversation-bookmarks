# Native command discovery and syntax

## Commands

- `/bookmark`: explicitly request a bookmark of the current conversation, not a list or menu. The current agent generates title, tags and description before saving and verifying.
- `/bookmark [title] [#tag1, tag2] [--description "text"]`: supply any or all metadata. Only missing fields are generated; supplied fields are preserved. Description maps to the stored note. Supply all three to save directly without a model turn.
- `/bookmark help`: show syntax without saving, even when there is no current session or handoff permission.

Titles need no quotes. A whitespace-delimited `#` introduces comma-separated tags;
use a quoted `--description`, including `""` for an intentionally empty description.
An existing current native session is required; none is guessed. This command has
no `add` subcommand, no search subcommand and no `--file` syntax: other text is a
title. Use the tools/page for explicit session/message IDs, search or reserved
syntax in titles. Delivery Shelf is a separate, optional plugin for file references.

Gateway-assisted saves require explicit
`plugins.entries.conversation-bookmarks.allow_gateway_injection: true` consent;
the plugin never grants it itself. Queued is not saved: confirmation follows save
and exact readback. In a group, the host-routed session may be shared; this is not
a private per-participant store or an owner-pinned Shelf Add workflow. Use a private
conversation for private context. See [Operations](OPERATIONS.md#current-agent-handoff-consent).

## Conversation and response selection

The page can request recent conversation choices and, after selecting a conversation,
bounded assistant-response previews through the authenticated host API. These are
not new slash commands and do not change `/bookmark`'s current-conversation behavior.

- `GET /api/plugins/conversation-bookmarks/sources/sessions?limit=30&offset=0&q=`
  lists local conversation IDs, native titles (or source/ID fallback labels), source,
  and epoch-second activity timestamps.
- `GET /api/plugins/conversation-bookmarks/sources/sessions/{session_id}/responses?limit=30&offset=0&q=`
  lists native message IDs and visible assistant previews, at most 350 characters each.

Both return `items`, `has_more`, and `window: {limit, truncated}`. Search covers only
the recent 1,000 session choices or 500 eligible assistant rows in the selected session;
response search matches previews, not a full transcript. Page size is 1–100 (default 30),
query length is at most 200, and offsets stop at the corresponding window size.
The page must label that bounded scope; an empty search is not proof that older sources
do not exist. Missing or unsafe native stores fail explicitly rather than appearing empty.

Previews are read only on explicit chooser requests, are not stored in bookmarks, and
never include prompt/system/tool rows or dedicated reasoning payloads. Unsupported or
oversized rich content may be omitted. Choosing a source does not itself save a bookmark.
Manual exact references and editing metadata for old/pruned sources remain supported;
legacy message references are not restricted retroactively to chooser-visible responses.
See [Technical guide](TECHNICAL.md#read-only-source-boundary) for exact privacy and bounds.

## Manual AI draft (not a slash command)

In Save bookmark, select an assistant response and click **Generate details**. This
explicit click uses bounded prior context through the host’s stateless model API and
fills Title, Note and Tags for review, without saving or injecting a live chat turn.
**Context** offers 5, 10, 20 or 50 previous exchanges, defaults to 10, and persists
per profile on selection. The API still accepts integers 0–100; nothing after the
response is sent. The separate `/bookmark` current-agent save behavior is unchanged.

- `GET` / `PUT /api/plugins/conversation-bookmarks/generation/settings`: read/write
  `{ "previous_exchanges": 10 }` in the already-bound profile.
- `POST /api/plugins/conversation-bookmarks/generation/draft`: supply exact
  `{ "session_id": "example-session-001", "message_id": 42 }`; returns `draft` and
  `context` count/truncation metadata, not a saved record.

All routes use native authentication. Context is read-only/transient; the AI draft
becomes bookmark metadata only after explicit Save. See the [technical contract](TECHNICAL.md#manual-ai-draft).

## Menu and `/help`: verified host behavior, not a custom menu

The plugin declares `provides_commands: [bookmark]` and uses public
`ctx.register_command` with description, optional-leading `args_hint`, and explicit
`argument_mode="text"`. It does not publish Bot API menus, replace `/help`, register
duplicate commands, patch core code or enable itself.

The canonical Telegram menu reads this native registry. Plugin menu descriptions
are capped at **40 characters**, so this entry stays concise and untruncated:
**Save this chat; /bookmark help**. Selecting it sends bare `/bookmark`, which
requests a save; type `/bookmark help` for non-saving syntax help. The menu does
not append the argument hint. Optional-leading `[` keeps the command eligible;
the host excludes plugin hints beginning with required `<`.

**Official Hermes v0.22.5 limitation:** native gateway `/help` and `/commands`
render built-ins and skills, but omit plugin commands entirely—not just their
argument hints. Registry metadata cannot make `/bookmark` appear there on that
host. `/bookmark help` is the supported syntax path. The global `/help` requirement
remains an upstream host gap; no plugin-owned replacement is provided.

## Operator setup (never applied automatically)

1. Install and enable the backend plugin in the profile used by the intended
   Telegram gateway. A Desktop-only installation is insufficient. Verify
   `hermes plugins list` there and ensure the resident gateway actually loads the
   registration; changing files or running a local menu probe does not do this.
2. Merge priorities into that profile's configuration through supported Hermes
   configuration editing, preserving existing values. Example for Bookmarks alone:

   ```yaml
   platforms:
     telegram:
       extra:
         command_menu:
           max_commands: 60
           priority_mode: prepend
           priority: [help, new, stop, bookmark]
   ```

   If Delivery Shelf is independently installed, add `shelf` too. Priorities order
   candidates before the cap; they are not an allowlist. Preserve safety controls
   and existing priorities. `append` does not outrank the host's default built-in
   priorities. Default cap: 60; supported configured bounds: 1–100. The pinned
   v0.22.5 fixture's built-ins displace Bookmarks at the default cap. Native
   registration alone therefore does **not** guarantee menu visibility.
3. Allow the authorized gateway to load/reload and normally register the menu;
   restart only when separately authorized and necessary for resident code.
   `/reload-skills` does not reload plugins. Native force rediscovery disposes and
   replaces command registrations; targeted unload removes them. Config disabling
   alone leaves resident commands until host reconciliation/reload. Local registry
   changes do not prove remote Telegram menu publication.
4. The host publishes default, all-private-chat and all-group-chat scopes after
   connection and lazily registers forum **parent-chat** scopes. A narrower chat or
   language scope can override broader menus. Host fingerprints include language
   and payload; changed fingerprints clear cached forum registrations for later
   refresh. Telegram client caching is separate. An authorized operator must verify
   bot identity and read back the applicable scope/language, then check actual
   inbound dispatch. A generated menu is not live proof. This plugin neither reads
   tokens nor refreshes scopes itself.

## Reproduce offline

`tests/native_command_discovery.py` runs inside `scripts/verify.sh`; no companion
checkout is required. It uses disposable fictional homes and a read-only host,
without bot/model calls, gateway startup or production configuration.

```sh
HERMES_SOURCE=/path/to/hermes-agent python tests/native_command_discovery.py
# Optional combined check; Shelf remains an independent plugin:
HERMES_SOURCE=/path/to/hermes-agent python tests/native_command_discovery.py \
  --companion /path/to/hermes-delivery-shelf
```

Coverage: actual PluginManager loading, registry metadata, canonical menu defaults,
cap/priority displacement, prepend versus append, configured bounds, native gateway
`/help` and `/commands`, plugin syntax dispatch without source context, force reload,
targeted unload, companion retention and config-disable reconciliation. The probe
records host revision/source hashes and checks no catalog DB was written. The known
v0.22.5 global-help omission is asserted explicitly; a future upstream fix requires
updating the assertion and documentation, not hiding the change.

This is not live Telegram acceptance: menu publication, exact scope readback and
real inbound commands still need separately authorized verification.
