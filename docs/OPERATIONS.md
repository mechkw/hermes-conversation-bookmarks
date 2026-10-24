# Save a place. Find your way back.

[← README](../README.md) · [Technical guide](TECHNICAL.md)

## Install and open

```sh
hermes plugins install mechkw/hermes-conversation-bookmarks --enable
hermes plugins list
```

The repository name is `hermes-conversation-bookmarks`; the installed plugin ID is
**`conversation-bookmarks`**. This command installs directly from GitHub, not from a
claimed catalog listing. Normal Hermes dependency and capability consent still applies.

- **Dashboard:** restart an already-running server after installation, refresh the page,
  and open Conversation Bookmarks.
- **Desktop:** rescan in **Capabilities → Plugins**, verify both Agent and Desktop halves
  are enabled, then open Conversation Bookmarks.
- **Mobile:** use your authenticated web Dashboard. There is no separate mobile app.

### Remote Desktop setups

When Desktop connects to another computer, that backend owns your conversations and
bookmark database. Install the backend package there, and install the same package on
the computer running Desktop so its UI contribution is available. Rescan Desktop and
connect to the intended backend/profile. A server-side installation does not automatically
place a UI on your laptop.

Keep Hermes's normal authentication. The plugin does not need its own public server,
new account, or additional inbound port.

## Save your first bookmark

During a conversation, ask:

> “Bookmark this conversation as ‘Launch decision,’ tagged website and launch. Add the
> note ‘Friday launch, reduced scope; revisit the deferred items next week.’”

The save tool can use the session ID actually provided by its native invocation. If
that context is unavailable, it requires an explicit session ID rather than guessing.
You can also save through the plugin page using the source session ID, a title, and
optional note/tags.

A good title tells your future self **why you saved it**:

- “Launch decision” rather than “Friday chat.”
- “Why the cache kept serving old images” rather than “Debugging.”
- “Three questions for the next meeting” rather than “Useful response.”

The plugin does not copy conversation excerpts or add facts to Hermes memory. On an
explicit save request, the current agent may generate missing title, tags and description
from context it already has. Description uses the existing note field; the plugin has
no independent model client, credentials, or transcript collector.

### Save with /bookmark

```text
/bookmark
/bookmark Approved plugin art direction #branding, plugins
/bookmark #branding --description "Keep the approved direction"
/bookmark Approved plugin art direction #branding, plugins --description "Keep the approved direction"
/bookmark help
```

Bare `/bookmark` requests a save. The current native agent generates any omitted
**title, tags and description**, preserves supplied details, saves, searches/readbacks
the saved ID, then briefly reports the saved details and which were generated. No
unnecessary clarification is requested. `/bookmark help` alone shows help.

Supplying all three fields saves directly and reports the actual stored details after
readback, with no agent turn. Description maps to **note**, not a new database field.
Use `--description ""` to deliberately retain an empty note rather than generate one.
This does not rename the native conversation and uses no message ID.

Titles need no quotes. The first `#` at the start or after whitespace starts the
comma-separated tags; `C#` and `issue#42` inside a title remain literal. Starting with
`#tags` leaves title generation to the agent. `--description` requires a single- or
double-quoted value and may appear before or after title/tags; quote/backslash escaping
follows shell quoting, without shell execution or variable expansion. Duplicate or
unclosed description options are errors. Use the tool/page when your title contains a
whitespace-delimited `#`, reserved `--description` syntax, or a tag contains a literal comma.

Titles must be nonempty printable text up to 160 characters. Supply at most 20 tags,
each 1–40 printable characters; empty/trailing/doubled comma entries are rejected.
Tags retain their first spelling/case after boundary trimming and case-insensitive
deduplication. The existing UI/API/tool tag format is
unchanged: commas inside a structured tag are still literal.

The host must supply the actual current session ID. A chat without a stored session
or an older host without command context gets an actionable error, never a guessed
latest session or a session from an environment variable. Start/resume a conversation,
or upgrade such an older host; the explicit-ID tool/page remains available. Missing
or foreign-profile sources are refused. No search/update/delete subcommands are added.

### Current-agent handoff consent

The host must support `PluginContext.inject_message` and have a live route back to this
session. Gateway/TUI handoff is default-off. Only if you trust this plugin and want this
behavior, explicitly grant in the intended profile's configuration:

```yaml
plugins:
  entries:
    conversation-bookmarks:
      allow_gateway_injection: true
```

This allows the host to queue an agent turn and potentially send its reply to the
conversation's messaging platform. The plugin never changes configuration, grants
consent, creates a fresh conversation, or substitutes another model. Missing/denied
support returns an error with no command-side save. You can instead supply all three
fields, use the page, or ask your current agent to save via the tools.

An accepted handoff is **queued, not saved**. The command suppresses an extra success
message; the agent's verified save/readback is the completion. If no reply arrives,
check host routing/logs and search bookmarks before retrying (creates are not idempotent).
Current official docs note that gateway-backed classic CLI injection may be recorded
in session history without appearing in the attached CLI; use the direct path there
if a visible response is required. Agent/tool availability, normal provider processing,
usage charges, and host safety controls still apply. No live-provider or platform
transport test is implied by the plugin's fixture tests.

### Bookmark a particular message

Provide the exact **native Hermes integer message ID** along with its session ID. The
plugin verifies that the message belongs to that session in the bound profile. A
Telegram or Discord message ID is not interchangeable with a Hermes message ID.

Message references identify a source moment, but **Open conversation opens the session**;
it does not promise an exact-message jump or scroll position. Omit the message ID if you
only need a conversation-level bookmark.

## Find, edit, and remove

Search titles, notes, and tags; filter by an exact tag; sort by newest saved, oldest saved,
or title. Search does not inspect conversation text. Tag filters are case-insensitive,
including older lowercase entries; stored tags are not rewritten. In the
editor, enter one tag per line; commas inside a tag remain part of that tag.

Editing uses the revision you loaded. If another client saves first, refresh and review
the newer entry before retrying; a stale edit does not silently overwrite it. The UI
retains the unsaved draft on a revision conflict.

Removal deletes only the bookmark's metadata. It never deletes a conversation, message,
file, or memory. The UI asks for confirmation.

## Return to the source

**Desktop:** use **Open conversation**. The plugin rechecks source availability and calls
Hermes's supported session-opening interface with the bound profile. Actual navigation
and history loading remain the host's responsibility.

**Dashboard:** copy the session ID or the supplied profile-qualified resume command.
The plugin does not invent a Dashboard route. Run the command on the **same backend
machine** that owns the session, not an unrelated local Hermes installation.

For a known session, the CLI form is:

```sh
hermes --profile default --resume example-session-001
```

Replace the fictional ID and profile with the actual source. `/bookmark` uses only the
current session supplied by Hermes; use the tool/page for a different explicit source.

## When the source disappears

Bookmarks are **references, not transcript backups**. Normal Hermes retention, manual
deletion, or removal of an individual message can make a source unavailable. The card
remains, along with your title, note, and tags; you can still edit or remove it.

Source status distinguishes an available reference, missing session, missing message,
missing source store, or an unavailable source. Retargeting an entry to a different
session/message requires fresh validation. A source can disappear after a successful
check if another process prunes it; saving a bookmark does not change retention rules.

## Profiles, storage, and backup

Each backend profile has its own metadata database:

```text
$HERMES_HOME/plugin-data/conversation-bookmarks/bookmarks.sqlite3
```

The plugin checks existence against that profile's `state.db`, opened read-only. It reads
only source identifiers/profile labels needed for validation—not message content,
reasoning, prompts, or transcript excerpts. It never initializes or repairs the native
source database.

The default profile commonly uses `~/.hermes`; named profiles have their own homes.
A profile hint in a request is not permission to access another profile. If the host
cannot bind the intended profile, the plugin refuses the mismatch.

There is no automatic bookmark expiration. Ordinary package updates/removal leave data
in place. Back up with SQLite's backup API or stop writers first; copying a live main
SQLite file alone may not capture all activity. Protect backups as private data: titles,
notes, tags, and source references can themselves be sensitive.

To erase bookmark data, disable/stop clients and deliberately remove only this plugin's
own data directory. Never delete the native `state.db` or the broader `plugin-data/`
directory as a shortcut. Other software running as the same OS user is not sandboxed
by this plugin.

## Update, disable, or remove

```sh
hermes plugins update conversation-bookmarks
hermes plugins disable conversation-bookmarks
hermes plugins remove conversation-bookmarks
```

Verify the resulting state in `hermes plugins list` and Desktop's controls. Restart a
running backend after Python changes and rescan Desktop after package updates. Removing
a package is not data erasure.

## Troubleshooting

### The page is missing, or requests return 404

Check the package ID, connected machine, selected profile, and both relevant enablement
switches. Restart the Dashboard backend after installation and rescan Desktop. A frontend
can be installed while its connected backend is absent or disabled.

### Saving says the source is missing or belongs elsewhere

Check the exact session ID, profile, and backend. For a message bookmark, confirm its
native integer ID belongs to the same session. Do not substitute a platform message ID
or choose the latest conversation as a workaround.

### The source store is unavailable

A missing store, incompatible schema, unreadable file, or linked path is refused rather
than silently treated as trustworthy. Check Hermes's own health and permissions. Do not
point the plugin at another profile's database or remove its read-only safeguards.

### I switched profiles and an operation disappeared

Requests and callbacks are tied to their original profile/connection. Switching away
prevents old results from appearing in the new view. A write already dispatched may have
completed in the original profile; return there and read back before repeating it.

### My entries returned after reinstalling

Package code and persistent metadata are separate. See storage and backup above for
intentional erasure.

For unresolved issues, [open a bug report](https://github.com/mechkw/hermes-conversation-bookmarks/issues/new/choose)
with versions and a fictional reproduction. Keep real conversation IDs, private paths,
notes, and transcript content out of public reports.
