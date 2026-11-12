# Operate Conversation Bookmarks

[README](../README.md) · [Installation](INSTALLATION.md) · [Usage](USAGE.md) · [Technical reference](TECHNICAL.md)

## Install and open

Follow [Installation](INSTALLATION.md) for native Desktop, web Dashboard, and remote pairing. Check the backend and profile, then open **Saved → Bookmarks**. Native **+ → Bookmarks** opens a quick finder, not an automatic save. Browser-hosted Desktop is not the web Dashboard.

The package works alone. Delivery Shelf is optional and stores different data. Installing a remote Agent half does not prove the local Desktop half is present or enabled.

## Save a reference

For a model-free current-conversation save, supply all metadata:

```text
/bookmark Friday launch decision #launch, planning --description "Friday stays; scope is reduced."
```

Bare `/bookmark` requests capture with missing metadata completed by the current agent. Bare `/bookmarks` browses without saving. Use `/bookmarks browse launch` to search saved annotations. Explicit `add` forms are available on both singular and plural commands.

For a response reference, open **New bookmark**, pick the conversation, choose **One response** and the response, enter annotations, and select **Save bookmark**. Optional **Draft with AI** produces a draft only. Review it before Save; a draft replaces the title, note, and tags in the form.

Check the saved bookmark before repeating a request with an uncertain outcome. Creates are not idempotent. An accepted agent handoff is queued work, not a successful save. Assisted gateway saves require explicit permission described in [Commands](COMMANDS.md#complete-missing-details-with-the-current-agent); the plugin does not enable it itself.

## Configure native Telegram panels

1. Resolve the intended profile's Hermes home.
2. Create `plugin-data/conversation-bookmarks/telegram-owners.json` beneath that home.
3. Store a JSON array of authorized Telegram user IDs as decimal strings. For example, using a fictional ID:

```json
["123456789"]
```

4. Open `/bookmarks` from an authorized account in the intended chat/topic.
5. Choose **Add this conversation**, review the title, and select **Save conversation reference** only if you want that bookmark.

The policy accepts at most 50 IDs and denies native access when absent or invalid. It is separate from Shelf's owner policy and the gateway's allowed-user list. Revocation prevents future authorized panel interactions; it does not erase saved annotations. This policy controls native panels, not every legacy command/tool save.

Reference-only Add saves the title and session with no note, tags, model call, or copied messages. Use a metadata command or edit the bookmark for annotations. Buttons expire after ten minutes and bind to the owner, chat/topic, message, session, profile, and host lifecycle. Open a fresh panel after expiry or reset.

Panel details can expose annotation text and source identifiers to other chat participants. A shared group source and a shared profile are not private per-user storage. Use a private conversation for private context.

## Inspect or remove bookmarks

Select a bookmark to see it in the details pane beside the list. Use **Open conversation** in native Desktop, or expand **Reference** for the resume command and run it on the same backend. The pane's source preview (conversation title and a bounded response excerpt) is read on request and never stored. Opening a response bookmark resumes its conversation, not an exact-message scroll position.

Use checkboxes for removal. The checkbox above the list selects the loaded bookmarks only; **Show more** loads further ones. A selection holds up to 100 bookmarks. Changing filters or refreshing clears it. Review **Remove selected bookmarks**, then confirm.

Bulk removal is all-or-nothing if any selected ID/revision changed. It deletes only annotation records. There is no Trash, Archive, or recovery timer. Never delete the native conversation as a workaround for a stale bookmark.

## Change display preferences

Open **Bookmark settings** from the collection or the native Bookmarks settings page. **Show notes in list** and **Show source status in list** save immediately when changed. They do not remove notes, references, or anything shown in the details pane.

The editor's separate context choice beside **Draft with AI** controls drafting, not transcript retention. Default is 10 previous exchanges, with 5, 10, 20, and 50 available in the UI.

## Back up or erase annotations

The backend profile stores `plugin-data/conversation-bookmarks/bookmarks.sqlite3`. Use SQLite's backup API or stop writers for a consistent copy. Protect titles, notes, tags, references, and policies as private data.

The bookmark database is not a transcript backup. Back up Hermes's native session store separately if you need the conversations. Ordinary plugin updates and removal leave annotation data in place.

For deliberate erasure, stop or disable clients and remove only this plugin's own data directory. Do not remove native `state.db` or the broader `plugin-data/` tree.

## Update or disable

```sh
hermes plugins update conversation-bookmarks
hermes plugins disable conversation-bookmarks
hermes plugins remove conversation-bookmarks
hermes plugins list
```

Use the intended profile. Verify relevant Agent and Desktop state after changes. Activate updated backend and UI code through their normal host lifecycle. Obtain a restart decision before interrupting active work. Removing package code is not data erasure.

## Diagnose failures

| Symptom | Action |
| --- | --- |
| UI missing or API 404 | Check backend, selected profile, both relevant halves, and effective enablement. |
| No native current session | Start/resume the intended conversation or choose an explicit source in the editor. |
| Handoff unavailable | Supply title, tags, and description, or use the editor. Queued work is not saved. |
| Generate unavailable | Choose an eligible assistant response and check supported Agent/model registration. Manual saving remains available. |
| Source absent from chooser | Check the profile and bounded recent search window. Do not substitute a guessed session. |
| Source unavailable | Keep or edit annotations. Bookmarks cannot recover a pruned transcript. |
| Revision conflict | Refresh and review before resubmitting the edit or removal. |
| Panel/send outcome uncertain | Browse the exact profile before repeating a save. |
| Old operation disappears on profile switch | Return to the original profile and read back before repeating a mutation. |

Report bugs with fictional reproductions. Use [SECURITY.md](../SECURITY.md) for private vulnerabilities, with **repobugs@virtuedev.com** as the fallback.
