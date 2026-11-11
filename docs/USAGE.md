# Use Conversation Bookmarks

A bookmark keeps an exact conversation reference, an optional message reference, and your title, note, and tags. It does not copy the transcript or preserve files.

## On this page

- [Choose what to bookmark](#choose-what-to-bookmark)
- [Save from the collection](#save-from-the-collection)
- [Generate a response bookmark draft](#generate-a-response-bookmark-draft)
- [Save from the current conversation](#save-from-the-current-conversation)
- [Search and inspect bookmarks](#search-and-inspect-bookmarks)
- [Return to a conversation](#return-to-a-conversation)
- [Edit or remove bookmarks](#edit-or-remove-bookmarks)
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

1. Open **Saved → Bookmarks**, or choose **Plus → Bookmarks** in native Desktop.
2. Select **Save bookmark**.
3. In **Choose a conversation**, choose the source by title and date.
4. In **Response (optional)**, choose an assistant response or leave **Entire conversation** selected.
5. Enter the title, optional note, and tags.
6. Select **Save bookmark**.

Conversation and response controls have separate search fields and pages. Choosing another conversation clears the response selection, so a response cannot silently carry over from a different source.

Tags in the editor use **one tag per line**. A comma remains part of that tag. Slash commands use comma-separated tags instead.

| Field | Limit |
| --- | --- |
| Title | Required, 1–160 printable characters after trimming. |
| Note | Optional, up to 4,000 characters. |
| Tags | Up to 20, each 1–40 printable characters. |
| Source | An exact existing session in the selected profile. |
| Response | Optional positive message identifier belonging to that session. |

Tag boundaries are trimmed. Case-insensitive duplicates keep their first spelling. The title, note, and tags are annotations, not instructions that the plugin executes.

## Generate a response bookmark draft

Generation is available for a new bookmark with a selected assistant response. Entire-conversation bookmarks can be written manually.

1. In **Save bookmark**, choose the conversation and response.
2. Choose **Context**: 5, 10, 20, or 50 previous exchanges. The default is 10.
3. Select **Generate details**.
4. Review the generated title, note, and tags. Edit anything you want to change.
5. Select **Save bookmark**.

The context choice is saved for this profile when you change it. It controls generation context, not how much conversation is backed up. No transcript is backed up.

The request includes the selected assistant response, its preceding real user request, and up to the selected number of earlier exchanges. It excludes content after the selected response. An exchange is a user request and its following visible assistant replies, not a fixed number of database rows.

Generation replaces the draft fields with a generated title, note, and tags. Review them before saving. If you edit while generation is in progress, the editor keeps those newer edits rather than applying a stale result.

A model timeout or invalid result leaves the draft unchanged. Correct the source if necessary, retry when ready, or enter metadata manually. Generation requires the active Agent runtime, supported model access, and an available eligible source.

**Generate details never saves a bookmark.** Closing the form without Save does not save the generated result.

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

## Search and inspect bookmarks

The collection search covers saved **titles, notes, and tags**, not full conversation text. Use **Tag** for an exact case-insensitive tag match.

Sort by:

- **Newest saved**.
- **Oldest saved**.
- **Title A–Z**.

The collection displays 30 bookmarks per page. A save's original creation date controls newest and oldest order; editing annotations does not turn an older bookmark into a new one.

Choose a bookmark title to open the adjacent inspector. Inspecting preserves collection context and is separate from checking the bookmark for removal. Use **Close preview** or Escape to close the inspector when no action is running.

The inspector shows the saved note, tags, source availability, session reference, and optional message reference. It also provides resume information and editing or removal actions.

The source chooser's search is a different operation from collection search. It searches bounded recent source choices and response previews while you create a bookmark. Those previews are not a new full-history search index.

## Return to a conversation

### Native Desktop

Select an available bookmark and choose **Open conversation**. The plugin uses Hermes's native session-opening action.

Opening a response bookmark resumes its conversation. It does not promise an exact-response scroll position, even though the saved message reference identifies the response you chose.

### Web Dashboard or terminal

Copy the session ID or use the profile-qualified command shown in the inspector. Run the command on the same Hermes host that owns the source profile.

The command includes `--profile` for a non-default profile. Do not paste a private session identifier into a public issue or send it to another host expecting the conversation to travel with it.

## Edit or remove bookmarks

### Edit annotations

1. Open the bookmark inspector.
2. Select **Edit bookmark**.
3. Change the title, note, tags, or source selection.
4. Select **Save changes**.

An unavailable source reference can remain unchanged while you edit its annotations. A newly chosen source must exist. Saved references outside the current chooser page remain selected until you deliberately replace them.

Updates use the current bookmark revision. If another client changed it, the save fails with a conflict rather than overwriting that change. Refresh the bookmark and review the latest state before retrying.

### Remove one bookmark

Open the inspector, select **Remove bookmark**, and review the confirmation. **Remove metadata** deletes the bookmark record, not its conversation or message.

### Remove selected bookmarks

1. Check the bookmarks you want to remove, or use **Select page**.
2. Continue to another page if you need more bookmarks. The selection count spans pages.
3. Select **Remove selected bookmarks**.
4. Review the count and confirm **Remove metadata**.

**Select page** affects only the current page. It is not “all filtered matches.” Changing filters clears the selection. **Clear selection** removes the checks without deleting anything.

The bulk endpoint accepts at most 100 selected bookmarks in one request. Keep each removal batch within that limit. If a selected bookmark changed or disappeared, the bulk operation rejects the batch without removing the remaining selections.

There is no Shelf-style Archive, Trash, version history, or recovery timer for bookmark metadata. Treat confirmation as a permanent removal of that annotation record.

## Set browsing preferences

Open **Bookmark settings** from the collection's settings action.

- **Show notes in list** controls note excerpts in collection rows.
- **Show source status in list** controls source-status labels in the list.

These preferences do not delete annotations or change the source. The inspector still provides the saved reference and source information. The separate **Context** control in the Add form controls generation context for new response bookmarks.

## Source availability and limits

A new bookmark validates that its session exists in the selected backend profile. A response selection must identify a message belonging to that session.

Availability checks can report:

| Status | Meaning |
| --- | --- |
| Source available | The referenced source can be found. |
| Session unavailable | The conversation is no longer present. |
| Message unavailable | The conversation exists, but the referenced message does not. |
| Session store unavailable | The native store is absent or cannot be opened. |
| Source check unavailable | The plugin could not complete the source check. |

Unavailable does not mean the bookmark was deleted. Your title, note, and tags remain. Bookmarks cannot recreate the missing transcript or recover it from the annotation.

The chooser searches up to 1,000 recent conversations and up to 500 recent assistant responses in the selected conversation. The UI reports when that source window is truncated. Paging moves within the bounded window; it is not a promise to search the entire history.

Source content is read through a plugin-owned read-only adapter. Source selection and generation enforce eligibility, size, time, and query limits. A readable native session is not automatically eligible for every generation request.

## Storage and privacy

Data lives beneath the selected Hermes home:

```text
plugin-data/conversation-bookmarks/bookmarks.sqlite3
```

The catalog stores references, annotations, timestamps, revisions, and plugin settings. It does not store another copy of the source transcript. A generated note can summarize source material, so review its contents as you would any saved note.

There is no automatic bookmarking, background transcript collector, or plugin analytics service. That does not mean the plugin never reads source text:

- Ordinary collection search reads saved metadata and checks source availability.
- Source choosers read bounded metadata and visible assistant-response previews when you ask for choices.
- **Generate details** sends the selected response and bounded preceding context to Hermes's configured provider.
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
| Generate details is disabled | Choose an assistant response in a new bookmark and wait for context settings to load. |
| Generation times out or returns invalid data | Retry, or enter details manually. The failed generation did not save a bookmark. |
| Source does not appear in search | Clear filters, page within the source window, and check that the correct profile is selected. |
| Source unavailable | Keep or edit the annotation. Restore the native source from your own backup if available; Bookmarks has no transcript copy. |
| Bookmark changed elsewhere | Refresh and review before resubmitting the edit or removal. |
| Open conversation is absent | Use the displayed resume command. Native opening belongs to the Desktop adapter. |
| Removal batch is too large | Clear selection and remove at most 100 explicitly selected bookmarks per batch. |

For component discovery, use [Installation](INSTALLATION.md). For syntax and assisted metadata, use [Commands](COMMANDS.md). Report ordinary bugs with sanitized reproduction steps through the [repository issues](https://github.com/mechkw/hermes-conversation-bookmarks/issues). Use [SECURITY.md](../SECURITY.md) for vulnerabilities; **repobugs@virtuedev.com** is the private fallback.
