# Security policy

## Report privately

Do not put secrets, private annotations, conversation excerpts, source identifiers, or exploitable proofs in public issues. Use [GitHub private vulnerability reporting](https://github.com/mechkw/hermes-conversation-bookmarks/security/advisories/new) if available. Otherwise email **repobugs@virtuedev.com** with the subject “Conversation Bookmarks security”.

Include the affected release or commit, Hermes version, operating system, and fictional reproduction steps. Security fixes target the latest published release. No response-time SLA is promised.

## Host and profile boundaries

The plugin runs with its Hermes host's permissions, not in a sandbox against other software under the same operating-system account. Keep native authentication enabled and restrict host access. A profile hint cannot authorize another home.

Bookmarks belong to the backend profile, including a remote backend. Clients sharing that profile share its annotations. A shared group session is not private per-user storage. Protect metadata and backups even when no transcript is copied.

## Source reads and model processing

Ordinary source validation reads identifiers and ownership. Requested source choosers read bounded session labels and visible assistant-response previews through a plugin-owned read-only native adapter. They do not create or migrate the native source store. Missing or unsupported schemas fail rather than becoming permission to search elsewhere.

The details pane reads one conversation title and, for a response bookmark, one bounded excerpt of that visible assistant response each time a bookmark is selected, through the same read-only adapter and eligibility rules as the chooser. The excerpt is returned to the requesting client and is never written to the bookmark store.

Explicit editor **Draft with AI** sends the selected response, its preceding user request, and bounded earlier eligible exchanges to Hermes's configured model service. It excludes later conversation text and recognized private/tool/reasoning carriers. The collector cannot infer provenance the host did not preserve, such as arbitrary unmarked third-party injected text. Generation returns a draft only; saving remains explicit. Provider processing, costs, and retention policies apply.

An explicit slash save with omitted metadata can queue the current agent through `PluginContext.inject_message`. That workflow uses context already available to the agent, not the editor's selected-response cutoff. Gateway-assisted handoff needs explicit profile-local `plugins.entries.conversation-bookmarks.allow_gateway_injection`. The plugin does not grant itself permission. Queue acceptance is not a successful save.

Supplied metadata is framed as data, not instructions. That is not a guarantee of arbitrary model adherence. Generated notes can summarize private source content. The plugin stores annotations and references, not a second transcript archive, a memory entry, or preserved file bytes.

## Removal and unavailable sources

New references require source validation. A missing unchanged reference can remain while its annotations are edited. Bookmarks do not retain, restore, or reconstruct pruned sources.

Single and bulk removal delete bookmark metadata only, never native conversations or messages. Bulk removal validates exact IDs/revisions and is all-or-nothing. There is no Trash or recovery timer. A stale revision is an error, not permission to overwrite another client's change. Creates are not idempotent, so inspect Saved before repeating an uncertain save.

## Native Telegram panels

Optional panels use a separate profile-local Bookmarks owner policy, distinct from Shelf and gateway admission. Missing or invalid policy denies native panel access. This policy does not replace the host's controls for every command or tool path.

Callbacks bind to owner, chat/topic, message, session, profile, and application lifecycle and expire after ten minutes. Add previews the current title; **Save conversation reference** explicitly saves only a title/reference with no note, tags, model call, or copied messages. Panel details can expose private annotations and source identifiers to other chat participants.

An uncertain confirmation may follow a committed save. Check the exact profile before retrying. Native handler support, captured-transport tests, and actual live delivery are separate evidence.

## Release checks

Changes to profile binding, source eligibility, generation input, stored text, callbacks, or deletion require regression evidence. Source inspection and browser checks alone do not prove native or live acceptance. Keep real plugin data, policies, screenshots, and native session exports out of public reports.
