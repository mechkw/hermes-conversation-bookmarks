# Use Conversation Bookmarks

A bookmark keeps an exact conversation reference, an optional message reference, and your title, note, and tags. It does not copy the transcript or preserve files.

## On this page

- [Choose what to bookmark](#choose-what-to-bookmark)
- [Save from the collection](#save-from-the-collection)
- [Draft details with AI](#draft-details-with-ai)
- [Save from the current conversation](#save-from-the-current-conversation)
- [Find a bookmark from chat](#find-a-bookmark-from-chat)
- [Search and inspect bookmarks](#search-and-inspect-bookmarks)
- [Return to a conversation](#return-to-a-conversation)
- [Edit or remove bookmarks](#edit-or-remove-bookmarks)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Set browsing preferences](#set-browsing-preferences)
- [Source availability and limits](#source-availability-and-limits)
- [Storage and privacy](#storage-and-privacy)
- [Troubleshoot a workflow](#troubleshoot-a-workflow)

## Choose what to bookmark

Use a **conversation bookmark** when you want to return to the whole thread. Use a **response bookmark** to identify a particular assistant answer within that thread.

Both store a native session reference. A response bookmark also stores a message reference. Neither creates an exported conversation, a memory entry, or a preserved file version.

Choose a title that describes why you saved the reference. Put supporting detail in the note and use tags you will recognize later. If you want to keep the report or images produced by the chat, use Delivery Shelf for those files.

## Save from the collection

In native Desktop or the web Dashboard:

1. Open **Saved → Bookmarks** and select **New bookmark** (or press `N`).
2. Pick the conversation. The list shows your recent conversations by title, where they happened, and when; type to narrow it.
3. Leave **Whole conversation** selected, or choose **One response** and pick the assistant response you mean.
4. Enter the title, an optional note, and tags.
5. Select **Save bookmark**, or press Ctrl+Enter (⌘+Enter on macOS).

The title starts as the conversation's title and follows it if you change conversations, until you type your own. **Change conversation** returns to the list; **Keep current** backs out without changing anything. Choosing another conversation clears the response selection, so a response cannot silently carry over from a different source. The editor never asks for a session or message ID.

Tags are chips. Type a tag and press Enter to add it; Backspace in the empty field removes the last one. A comma is an ordinary character, so `design, decisions` stays one tag. Tags you already use are offered as one-click suggestions. Slash commands use comma-separated tags instead.

| Field | Limit |
| --- | --- |
| Title | Required, 1–160 printable characters after trimming. |
| Note | Optional, up to 4,000 characters. |
| Tags | Up to 20, each 1–40 printable characters. |
| Source | An exact existing session in the selected profile. |
| Response | Optional positive message identifier belonging to that session. |

Tag boundaries are trimmed. Case-insensitive duplicates keep their first spelling. The title, note, and tags are annotations, not instructions that the plugin executes.

After saving, the new bookmark is selected in the list with its details open beside it.

## Draft details with AI

Drafting is available for a new bookmark with **One response** selected. Whole-conversation bookmarks are written by hand.

1. In **New bookmark**, choose the conversation and the response.
2. Optionally open the number beside **Draft with AI** to choose how much earlier conversation to include: 5, 10, 20, or 50 previous exchanges. The default is 10.
3. Select **Draft with AI**.
4. Review the drafted title, note, and tags. Edit anything you want to change.
5. Select **Save bookmark**.

The context choice is saved for this profile when you change it. It controls drafting context, not how much conversation is backed up. No transcript is backed up.

The request includes the selected assistant response, its preceding real user request, and up to the selected number of earlier exchanges. It excludes content after the selected response. An exchange is a user request and its following visible assistant replies, not a fixed number of database rows.

A draft replaces the title, note, and tags in the form. If you edit, or change what the bookmark points at, while a draft is being written, the editor keeps your changes and discards the late draft.

A model timeout or invalid result leaves the form unchanged and offers **Try again**. Drafting requires the active Agent runtime, supported model access, and an available eligible source.

**Draft with AI never saves a bookmark.** Closing the form without Save does not save the draft.

## Save from the current conversation

Use this command after starting or resuming a conversation:

```text
/bookmark Friday launch decision #launch, planning --description "Friday stays; scope is reduced."
```

This saves a reference to the current conversation. The slash command does not select an individual assistant response.

- With title, tags, and description supplied, the command saves directly without a model turn.
- With any of those fields omitted, the command asks the current Hermes agent to generate only what is missing, save, and read back the result.
- Bare `/bookmark` is an explicit request to save the current conversation with generated metadata.
- `/bookmark help` shows syntax without saving.

The slash-command description maps to the bookmark's **Note** field. Titles need no quotes. Put a whitespace-delimited `#` before the comma-separated tag list, and quote the description.

Use `/bookmarks` or `/bookmark browse` to browse without saving. Add a query with `/bookmarks browse launch`. Explicit `/bookmarks add` and `/bookmark add` forms are also available. Bare `/bookmark` remains the legacy current-conversation save request.

On configured Telegram connections, `/bookmarks` opens a native panel. **Add this conversation** opens a confirmation; **Save conversation reference** saves its title and session reference with no note or tags and no model request. For annotations, use the fully supplied command or edit the saved bookmark later. Native panel availability requires host support and a separate Bookmarks owner policy. See [Commands](COMMANDS.md#browse-from-chat-or-telegram).

Assisted saves require a supported current-session handoff and explicit per-plugin permission. A queued handoff is not a save; wait for the agent's verified completion. If permission is absent, supply all metadata or use the collection editor. See [Commands](COMMANDS.md) for setup.

In a shared group or topic, the host-routed conversation may be shared. A bookmark is not a private per-user copy of that group. Use a private conversation for private context.

In native Desktop you can also run **Bookmark this conversation** from the command palette, or press Ctrl+Alt+B (⌘⌥B on macOS; rebindable in Keyboard settings). It opens the editor on the chat you are in, with the conversation already chosen, without leaving the chat.

## Find a bookmark from chat

Native Desktop has a quick finder: choose **Bookmarks** in the composer's **+** menu, or run **Find a bookmark** from the command palette.

- Type to search titles, notes, and tags. Use the arrow keys to move.
- **Enter** returns to that bookmark's conversation.
- **Ctrl+Enter** (⌘+Enter) writes a short mention of the bookmark, with its reference and note, into the message you are composing, so the agent can look it up. Nothing is sent until you send the message.
- **Bookmark this conversation** and **All bookmarks** are at the bottom.

Conversations that have bookmarks show a small bookmark mark on their sidebar row. Select it to open **Saved** filtered to that conversation; select the **This conversation** chip to clear the filter.

## Search and inspect bookmarks

The search box covers saved **titles, notes, and tags**, not full conversation text.

- **All / Conversations / Responses** narrows by what the bookmark points at.
- The tag row lists your most-used tags with counts. Select one for an exact, case-insensitive match; select it again to clear it. Tags on a row or in the details pane do the same.
- **Sort** offers newest first, oldest first, and title A–Z. A save's original creation date controls the order; editing does not turn an older bookmark into a new one.
- **Clear filters** resets search, type, and tag together.

The list loads 30 bookmarks at a time; **Show more** adds the next 30 below.

Select a bookmark to see it in the details pane beside the list. The pane shows the note, tags, when it was saved, and where it came from: the conversation's title and, for a response bookmark, an excerpt of the saved response. That source preview is read on request each time and is never stored with the bookmark. **Reference** expands the exact conversation ID, response ID, and resume command, each with a copy button.

Each row has a menu (⋮, or right-click in native Desktop) with the same actions as the details pane. On a narrow window the details pane takes the list's place; use the back arrow to return.

A bookmark whose source is gone is flagged in the list and explained in the details pane. See [Source availability and limits](#source-availability-and-limits).

The conversation picker's search is a different operation from collection search. It searches bounded recent source choices and response previews while you create a bookmark. Those previews are not a new full-history search index.

## Return to a conversation

### Native Desktop

Select a bookmark and choose **Open conversation**, double-click its row, or press `O`. The plugin rechecks that the source still exists, then uses Hermes's native session-opening action.

Opening a response bookmark resumes its conversation. It does not promise an exact-response scroll position, even though the saved message reference identifies the response you chose.

### Web Dashboard or terminal

Expand **Reference** in the details pane and copy the conversation ID or the profile-qualified resume command, or use **Copy resume command** in the row menu. Run the command on the same Hermes host that owns the source profile.

The command includes `--profile` for a non-default profile. Do not paste a private session identifier into a public issue or send it to another host expecting the conversation to travel with it.

## Edit or remove bookmarks

### Edit annotations

1. Select the bookmark and choose **Edit bookmark** (or press `E`).
2. Change the title, note, tags, or what the bookmark points at.
3. Select **Save changes**.

An unavailable source reference can remain unchanged while you edit its annotations. A newly chosen source must exist. A saved reference stays as it is until you deliberately choose a different conversation or response.

Updates use the current bookmark revision. If another client changed it, the save fails with a conflict rather than overwriting that change, and your draft stays in the form. Refresh and review the latest state before retrying.

### Remove one bookmark

Choose **Remove bookmark** from the row menu or the details pane's **⋯** menu (or press Delete), and confirm. Removal deletes the bookmark record, not its conversation or message.

### Remove selected bookmarks

1. Hover a row and check its box, or press `X` on the selected row. Once one is checked, every row shows its checkbox.
2. Use the checkbox above the list to select everything currently loaded; **Show more** and keep selecting if you need more.
3. Select **Remove selected bookmarks**, review the count, and confirm.

The checkbox above the list selects the loaded bookmarks only. It is not “all filtered matches.” Changing filters or refreshing clears the selection. **Clear selection** removes the checks without deleting anything.

A removal batch holds at most 100 bookmarks. If a selected bookmark changed or disappeared, the whole batch is rejected and nothing is removed.

There is no Shelf-style Archive, Trash, version history, or recovery timer for bookmark metadata. Treat confirmation as a permanent removal of that annotation record.

## Keyboard shortcuts

With focus in the Bookmarks list:

| Key | Action |
| --- | --- |
| `/` | Focus search. |
| `N` | New bookmark. |
| `↑` `↓` (or `K` `J`) | Move through the list. |
| `O` | Open the selected bookmark's conversation (native Desktop). |
| `E` | Edit the selected bookmark. |
| `X` | Check or uncheck the selected bookmark. |
| Delete | Remove the selected bookmark, after confirmation. |
| Escape | Close the details pane. |

Shortcuts are ignored while you type in a field. In the editor, Ctrl+Enter (⌘+Enter) saves.

## Set browsing preferences

Open **Bookmark settings** (the gear) in the collection, or the Bookmarks page in native Desktop settings.

- **Show notes in list** previews the first lines of each note under its title.
- **Show source status in list** flags bookmarks whose source is no longer available.

Each switch saves when changed. These preferences do not delete annotations or change the source, and the details pane always reports source availability. The separate context choice beside **Draft with AI** controls drafting context for new response bookmarks.

## Source availability and limits

A new bookmark validates that its session exists in the selected backend profile. A response selection must identify a message belonging to that session.

Availability checks can report:

| Status | Meaning |
| --- | --- |
| *(no flag)* | The referenced source can be found. |
| Conversation unavailable | The conversation is no longer present. |
| Response unavailable | The conversation exists, but the referenced response does not. |
| Conversation history unavailable | The native store is absent or cannot be opened. |
| Source could not be checked | The plugin could not complete the source check. |

Unavailable does not mean the bookmark was deleted. Your title, note, and tags remain. Bookmarks cannot recreate the missing transcript or recover it from the annotation.

The picker searches up to 1,000 recent conversations and up to 500 recent assistant responses in the selected conversation, and says so when older ones are not listed. **Show more** moves within that bounded window; it is not a promise to search the entire history.

Source content is read through a plugin-owned read-only adapter. Source selection and generation enforce eligibility, size, time, and query limits. A readable native session is not automatically eligible for every generation request.

## Storage and privacy

Data lives beneath the selected Hermes home:

```text
plugin-data/conversation-bookmarks/bookmarks.sqlite3
```

The catalog stores references, annotations, timestamps, revisions, and plugin settings. It does not store another copy of the source transcript. A generated note can summarize source material, so review its contents as you would any saved note.

There is no automatic bookmarking, background transcript collector, or plugin analytics service. That does not mean the plugin never reads source text:

- Ordinary collection search reads saved metadata and checks source availability.
- The conversation picker reads bounded metadata and visible assistant-response previews when you ask for choices.
- The details pane reads one conversation title and, for a response bookmark, a bounded excerpt of that response each time you select a bookmark. It is shown, not stored.
- **Draft with AI** sends the selected response and bounded preceding context to Hermes's configured provider.
- Assisted `/bookmark` uses the context already available to the current Hermes agent.

Those last two workflows have different context boundaries. The editor's “nothing after the selected response” rule is not a promise that an active agent's existing context excludes later material.

Local means local to the backend profile, including a remote server if that is where Hermes runs. Other clients using that same profile share its bookmark catalog. Do not assume a shared backend or group session creates private per-user storage.

Ordinary package updates or uninstall do not erase saved data. Back up the bookmark database consistently if the annotations matter. Back up Hermes's native session store separately if you also need the conversations. Protect backups and reports from disclosing private annotations or identifiers.

## Troubleshoot a workflow

| Symptom | Next step |
| --- | --- |
| No current native session | Start or resume the intended conversation, or choose the source in Saved. |
| Assisted save denied or unavailable | Supply all metadata, use the editor, or review explicit handoff permission on a supported host. |
| A queued request has no completion | Inspect Saved before retrying. Queued is not proof of a saved bookmark. |
| Draft with AI is disabled | Choose **One response** and a response in a new bookmark, and wait for the context setting to load. |
| Drafting times out or returns invalid data | Try again, or enter details manually. The failed draft did not save a bookmark. |
| Source does not appear in the picker | Clear its search, use **Show more**, and check that the correct profile is selected. |
| No source preview in the details pane | The source is hidden, unsupported, or not a visible assistant response. The reference and your annotations are unaffected. |
| Source unavailable | Keep or edit the annotation. Restore the native source from your own backup if available; Bookmarks has no transcript copy. |
| Bookmark changed elsewhere | Refresh and review before resubmitting the edit or removal. |
| Open conversation is absent | Expand **Reference** and use the resume command. Native opening belongs to the Desktop adapter. |
| Removal batch is too large | Clear selection and remove at most 100 explicitly selected bookmarks per batch. |

For component discovery, use [Installation](INSTALLATION.md). For syntax and assisted metadata, use [Commands](COMMANDS.md). Report ordinary bugs with sanitized reproduction steps through the [repository issues](https://github.com/mechkw/hermes-conversation-bookmarks/issues). Use [SECURITY.md](../SECURITY.md) for vulnerabilities; **repobugs@virtuedev.com** is the private fallback.
