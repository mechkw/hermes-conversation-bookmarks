# Install Conversation Bookmarks

[README](../README.md) · [Usage](USAGE.md) · [Commands](COMMANDS.md)

## Choose the host

| Host | Install |
| --- | --- |
| Native Hermes Desktop | Desktop component on the app computer and Agent component on the selected backend/profile. |
| Web Dashboard | Backend package, including its Dashboard bundle. |
| CLI, TUI, or messaging gateway | Backend package for the bookmark command and tools. |
| Browser-hosted Desktop | Do not assume it supports external native Desktop plugins. Use a compatible native client or web Dashboard for this UI. |

Native Desktop can open a source conversation through its host adapter. The web Dashboard provides source references and terminal resume information instead. A backend command being available does not establish native-client UI availability.

## Install in native Desktop

1. Open **Capabilities → Plugins → Install from Git**.
2. Enter `https://github.com/mechkw/hermes-conversation-bookmarks`.
3. Select the intended backend and profile.
4. Review source, dependency, and permission prompts.
5. Check that both **Agent** and **Desktop** are enabled in their intended scopes.
6. Open **Saved → Bookmarks**.

For a remote backend, the Desktop half is local to the app computer while the Agent half and catalog live on the server. Installing only on the server and rescanning the client is not a replacement for the native Git installation flow.

If an existing backend is healthy but the Desktop half is disabled, enable that half instead of replacing the backend. Preserve the installer's provenance and pairing; avoid ad hoc duplicate copies.

## Install on the backend

On the Hermes backend that owns the intended profile:

```sh
hermes plugins install mechkw/hermes-conversation-bookmarks --enable
hermes plugins list
```

Review normal dependency and capability consent. Read the activation result for any deferred reload or declined dependency. A package can be installed without every permission being granted.

Use Hermes's profile selection when installing or configuring a named profile. Bookmarks saved to one profile do not become bookmarks in every profile.

Open the authenticated web Dashboard and choose **Saved → Bookmarks**. If discovery or backend routes are stale, follow the host's supported reload procedure. A rescan and backend code activation are different operations. Coordinate service interruptions with active work.

## Choose whether to allow assisted slash saves

Manual editor saves and fully supplied slash-command saves do not need an agent handoff. If you want `/bookmark` to complete missing metadata through your current agent, review the per-plugin permission:

```sh
hermes config set plugins.entries.conversation-bookmarks.allow_gateway_injection true
```

Set it only for the intended profile and only when you want that workflow. The host must also support a current-session handoff. Permission alone cannot add a missing host capability.

The editor's **Draft with AI** is separate. It needs an active Agent runtime with supported structured model access and an eligible conversation or selected response. It returns an editable draft and never saves by itself.

## Configure native Telegram panels

`/bookmarks` can open a native panel when the gateway supports the plugin's Telegram handler. The operator must authorize the intended users in:

```text
plugin-data/conversation-bookmarks/telegram-owners.json
```

Resolve the path beneath the selected Hermes home. The policy is a JSON array of approved **user ID strings**. Populate it from trusted identity information. An absent or invalid policy denies native panel access.

This is Bookmarks' own policy, separate from gateway command authorization and Shelf's owner policy. A shared profile still has one bookmark catalog; owner authorization does not create a private per-user collection.

Native panels can be unavailable under isolation or an unsupported host lifecycle. Keep isolation intact and use the command's text fallback or the Saved editor. A missing native panel does not turn bare `/bookmark` into browsing; its legacy capture meaning remains unchanged.

## Check the installation

Use a fictional, non-sensitive test conversation:

1. Open **Saved → Bookmarks → New bookmark**.
2. Choose the test conversation and enter a title, note, and tag.
3. Save and find the exact annotations in the collection.
4. Select it and check the details pane: the conversation's title should appear, with no unavailable-source warning.
5. In native Desktop, test **Open conversation**. In Dashboard, expand **Reference** and check the resume command.
6. Remove only the test bookmark. Confirm that the source conversation remains.

Test assisted `/bookmark` separately if you plan to use it. A queued handoff, successful model request, or enabled toggle is not proof of a saved bookmark.

## Resolve common installation problems

| Symptom | Check |
| --- | --- |
| Installed but no Bookmarks tab | Local Desktop component, backend Agent enablement, selected profile, and scoped status. |
| “Unavailable (remote backend)” | The client may lack its Desktop component even though the backend is installed. |
| Source choices are empty | Correct profile, native source store, filters, and bounded recent-source window. |
| `/bookmark` reports no session | Start or resume the intended conversation, or choose a source in Saved. |
| Assisted save denied | Host handoff support and explicit per-plugin consent; otherwise supply all metadata. |
| Draft with AI is disabled | A new bookmark with a conversation chosen (and, for **One response**, a response selected), a loaded context setting, and an active Agent runtime. |
| Source cannot be reopened | Native source availability; the bookmark is not a transcript copy. |

Use the [issue tracker](https://github.com/mechkw/hermes-conversation-bookmarks/issues) for ordinary bugs. Include Hermes version, plugin version, client type, backend operating system, and sanitized steps. Do not post session IDs, private notes, or source text publicly.

## Update or uninstall

Use Hermes's supported plugin update and uninstall controls. Preserve profile selection and package identity.

The bookmark catalog lives under `plugin-data/conversation-bookmarks/` beneath the selected Hermes home. Ordinary updates and uninstall do not mean data erasure. Back up the database consistently before a migration or deliberate data removal.

Backing up the bookmark database preserves annotations and references, not the referenced conversations. Preserve Hermes's native session store separately if you need transcript recovery.

Official references: [Hermes plugins](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins) and [Desktop plugin SDK](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk).
