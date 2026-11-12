# Conversation Bookmarks command reference

[Usage guide](USAGE.md) · [Installation](INSTALLATION.md)

- [Browse from chat or Telegram](#browse-from-chat-or-telegram)
- [Save the current conversation](#save-the-current-conversation)
- [Supply metadata](#supply-metadata)
- [Complete missing details with the current agent](#complete-missing-details-with-the-current-agent)
- [Tools](#tools)

## Browse from chat or Telegram

| Command | Meaning |
| --- | --- |
| `/bookmarks` | Browse saved bookmark metadata without saving. |
| `/bookmarks browse launch` | Search saved annotations for `launch`. |
| `/bookmark browse launch` | Singular alias for browsing with the same query. |
| `/bookmarks help` | Show help without saving. |
| `/bookmarks add [metadata]` | Explicit Add form. |
| `/bookmark add [metadata]` | Singular Add alias. |

Bare `/bookmark` still saves the current conversation. Bare `/bookmarks` browses. Unrecognized plural forms return syntax guidance rather than becoming a bookmark title.

Outside native Telegram, `add` forwards to the current-conversation save workflow described below. On configured Telegram connections, bare `add` opens a confirmation panel instead. Supplying metadata after `add` uses the normal direct or agent-assisted save workflow.

The native Telegram panel includes recent bookmark choices, source details, paging, and **Add this conversation**. Add previews the current conversation title; **Save conversation reference** explicitly saves that title and session reference with empty note and tags. It does not generate annotations or copy messages. Use a metadata command or the editor when you want notes and tags.

Native panels require the host's Telegram handler support and the operator-owned Bookmarks policy. They expire after ten minutes and are bound to the requesting user, chat or topic, session, and profile. Open `/bookmarks` again after expiry or a session change. An unconfirmed save or transport result needs inspection before retry, not an automatic duplicate request.

[Configure Telegram ownership](INSTALLATION.md#configure-native-telegram-panels).

## Save the current conversation

```text
/bookmark
/bookmark Friday launch decision #launch, planning
/bookmark Friday launch decision #launch, planning --description "Friday stays; scope is reduced."
/bookmark help
```

| Form | Meaning |
| --- | --- |
| `/bookmark` | Request a bookmark of the current native conversation, with missing metadata completed by the current agent. |
| `/bookmark [title] [#tags] [--description "text"]` | Supply some or all save metadata. |
| `/bookmark help` | Show syntax without saving. |

Bare `/bookmark` preserves its legacy save meaning. It is not a browsing command. Use **Saved → Bookmarks** to browse, select a response, or manage saved annotations.

The host must supply the actual current native session. The plugin does not guess from the newest conversation or another focused chat. Start or resume the intended conversation before saving.

The slash command saves the entire-conversation reference. To identify one assistant response, use the collection editor or a tool with the exact message reference.

## Supply metadata

- The title needs no quotes.
- A whitespace-delimited `#` starts the tag list. Separate tags with commas.
- `C#` remains part of a title when no whitespace-delimited tag marker occurs.
- Supply `--description` once, with a quoted value.
- Description is stored as the bookmark's **Note**.

For example:

```text
/bookmark Retry policy explanation #engineering, reference --description "Why retries stop after the deadline."
```

All three metadata fields are supplied, so this saves directly without a model turn. A deliberately empty description uses `--description ""`.

Titles must contain 1–160 printable characters. Notes accept up to 4,000 characters. At most 20 tags are allowed, each 1–40 printable characters. Tag boundaries are trimmed, and case-insensitive duplicates keep their first spelling.

Use the editor or tools for tags with literal commas, an explicit empty tag list, or titles containing reserved command syntax. In the editor, tags use one line per tag rather than commas.

## Complete missing details with the current agent

If title, tags, or description is omitted, the command requests one current-session agent handoff. The agent is instructed to fill only the missing fields, preserve supplied values, save, and verify the returned bookmark through search.

This is different from **Draft with AI** in the editor:

| Workflow | Context | Persistence |
| --- | --- | --- |
| Assisted `/bookmark` | Context already available to the current agent. | Explicit request to complete and save. |
| Editor **Draft with AI** | Selected response and bounded earlier exchanges. | Editable draft only. Save remains separate. |

Gateway-assisted saves require explicit per-plugin permission on a host that supports the handoff:

```sh
hermes config set plugins.entries.conversation-bookmarks.allow_gateway_injection true
```

Run the command for the intended profile. The plugin never grants this permission itself. If the handoff is unsupported, denied, or unavailable, the command reports that it did not perform a save. Supply all metadata or use the collection editor instead.

Queue acceptance is not completion. Wait for the agent's verified saved confirmation; inspect the collection before repeating a request with an uncertain outcome. The save endpoint does not promise duplicate suppression for repeated bookmark requests.

## Shared conversations

A bookmark belongs to the backend profile, not a private per-user collection inside a shared group. In a group or topic, the reference is the host-routed session, which may be shared. Use a private chat for private context.

There is no `--file` attachment syntax. Bookmarks stores source references and annotations. Use Delivery Shelf for delivered files.

## Tools

| Tool | Purpose |
| --- | --- |
| `conversation_bookmark_save` | Save an explicitly requested conversation reference and annotations. |
| `conversation_bookmark_search` | Search saved titles, notes, and tags. |
| `conversation_bookmark_update` | Replace complete metadata using the current revision. |
| `conversation_bookmark_delete` | Remove explicitly selected bookmark metadata using the current revision. |

Omitting `session_id` is valid only when reliable native invocation context supplies it. An explicit malformed or empty source must not be repaired into another reference.

Tools do not back up transcripts, infer memory, or attach files. The assistant must search and read back the returned bookmark before confirming a save. For schemas and routes, see [Technical reference](TECHNICAL.md).

## Discover commands

Use `/bookmark help` for plugin-owned syntax. Global `/help`, `/commands`, and Telegram command-menu visibility depend on the Hermes host and its menu limits. Absence from a global menu does not prove the plugin command is unregistered.

See the current [Hermes plugin documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins) for host command and permission behavior.
