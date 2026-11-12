# Conversation Bookmarks

**Come back to the part that mattered.**

[What is verified and what is not](docs/RELEASE_STATUS.md).

Give a useful Hermes conversation or assistant response a title, a note, and a way back. Find the decision you made, the explanation that clicked, or the thread you want to continue.

[Install](docs/INSTALLATION.md) · [Usage guide](docs/USAGE.md) · [Commands](docs/COMMANDS.md) · [Security](SECURITY.md)

![Conversation Bookmarks banner in the Signal Cut art style](docs/assets/hero.webp)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/mark-on-dark.png">
  <img src="docs/assets/mark-on-light.png" alt="Conversation Bookmarks logo: a ribbon marking a speech bubble" width="104" height="104">
</picture>

## Watch it work

[Conversation Bookmarks launch film · 36 seconds](docs/assets/launch.mp4) · [Both plugins together · 42 seconds](docs/assets/saved-together.mp4)

Fictional Northstar notes. The films were recorded with the 0.1 interface; the workflow is the same, the current screens are the ones pictured below. They show saved references and the source-return control, not a transcript backup or a continuous recording.

## Save the reference, add the reason

A bookmark stores a conversation reference and your annotations. You can bookmark an entire conversation or identify an assistant response within it.

Name the bookmark for what you will look for later. “Friday launch decision” is more useful than “Interesting chat.” Add a note for the detail you do not want to reconstruct next time.

Use it for:

- The decision and reasoning behind a project change.
- An explanation you want to revisit instead of asking again.
- A conversation you intend to continue after switching tasks.
- A particular assistant response worth keeping track of.

Bookmarks does not copy the transcript, infer persistent memory, or preserve attached files. It keeps your place, not a second conversation archive.

## Install

### Native Hermes Desktop

Open **Capabilities → Plugins → Install from Git** and enter:

```text
https://github.com/mechkw/hermes-conversation-bookmarks
```

Choose the intended backend and profile, review installation permissions, and enable both the **Agent** and **Desktop** halves. Open **Saved → Bookmarks**.

### Backend or web Dashboard

Run on the backend that owns your Hermes profile:

```sh
hermes plugins install mechkw/hermes-conversation-bookmarks --enable
hermes plugins list
```

Use the installer's activation result to check whether anything still needs a reload. Installing the backend alone does not install a native Desktop UI on another computer.

[Full installation guide](docs/INSTALLATION.md), including remote backends and host compatibility.

## Save your first bookmark

In **Saved → Bookmarks**, choose **New bookmark**:

1. Pick the conversation from your recent ones. Type to narrow the list.
2. Leave **Whole conversation** selected, or choose **One response** and pick the response.
3. Enter a title, optional note, and tags.
4. Select **Save bookmark**.

No session IDs to copy, ever.

<img src="docs/assets/new-bookmark.webp" alt="New bookmark dialog in dark mode: the fictional Northstar launch plan conversation is chosen, one response is selected from a list of previews, and the title, note and tag fields are filled in" width="640">

*Fictional Northstar demonstration. The details are ready for review; the bookmark has not yet been saved.*

**Draft with AI** writes a title, note, and tags using your configured model, for a whole conversation or for one selected response. Review the draft before saving. Drafting is optional and never saves the bookmark by itself.

From a current Hermes conversation, you can also enter:

```text
/bookmark Friday launch decision #launch, planning --description "Friday stays; scope is reduced."
```

Supplying title, tags, and description saves directly. Omitted fields ask the current Hermes agent to complete them, subject to host support and explicit handoff permission. Bare `/bookmark` keeps its original meaning: **save the current conversation**, not open a browsing menu.

Browse from chat with `/bookmarks` or `/bookmark browse`. Use `/bookmarks browse launch` to search saved annotations. Both command names support explicit `add` and `help` forms. Configured Telegram connections offer a native bookmark panel with a separate confirmation before saving a conversation reference.

[Command syntax, Telegram panels, and assisted-save setup](docs/COMMANDS.md).

## Find it again

Search saved titles, notes, and tags. Narrow to conversations or single responses, select a tag from your most-used ones, and sort by newest, oldest, or title.

Select a bookmark to see it beside the list: your note and tags, the conversation it came from, and, for a response bookmark, an excerpt of the response you saved. That preview is read on request and never stored. The exact reference and a resume command are one click away under **Reference**.

![Bookmarks collection in dark mode: a search box, type filter and tag row above a list of fictional bookmarks, with the selected bookmark's note, tags and saved response shown in a details pane beside the list](docs/assets/collection.webp)

*Fictional data. Selecting a bookmark and checking it for removal are separate actions.*

Use **Open conversation** in native Desktop to resume an available source, or double-click the row. A response reference identifies what you saved, but opening resumes the conversation; it does not promise to scroll to that exact response. The web Dashboard offers the conversation ID and a profile-qualified terminal resume command.

Everything works from the keyboard: `/` to search, arrows to browse, `N` for a new bookmark, `O` to open, `E` to edit. [All shortcuts](docs/USAGE.md#keyboard-shortcuts).

## Without leaving the chat

In native Desktop:

- **+ → Bookmarks** in the composer, or **Find a bookmark** in the command palette, opens a quick finder. Type, arrow, Enter returns to that conversation. Ctrl+Enter (⌘+Enter) mentions the bookmark in the message you are writing.
- **Bookmark this conversation** in the command palette, or Ctrl+Alt+B (⌘⌥B), opens the editor on the chat you are in.
- Conversations that have bookmarks carry a small mark in the sidebar. Select it to see just those bookmarks.

<img src="docs/assets/quick-find.webp" alt="Quick finder in dark mode: a search box with the word launch and two matching fictional bookmarks, with keyboard hints for opening a conversation or mentioning the bookmark in chat" width="640">

## Your annotations survive a missing source

If a source conversation or response is pruned or removed, the bookmark remains with an unavailable-source status. You can still edit its title, note, and tags, retain the old reference, or remove the bookmark.

Bookmarks cannot restore the missing transcript. Removing one or several bookmarks deletes only their metadata, never the original conversations or messages.

Revision checks reject stale edits and removals instead of silently overwriting a newer change. [Edit, remove, and handle missing sources](docs/USAGE.md#edit-or-remove-bookmarks).

## Privacy and generation

The bookmark catalog is local to the selected Hermes **backend profile**. On a remote setup, that means the server that owns the profile.

- Saving is deliberate. There is no automatic capture or plugin analytics service.
- Collection search covers bookmark annotations, not full conversation text.
- Source choosers read bounded conversation metadata and assistant-response previews on request.
- Selecting a bookmark reads its conversation's title and, for a response bookmark, a bounded excerpt of that response to show beside the list. It is not stored.
- **Draft with AI** sends the selected response and bounded preceding context through Hermes's configured provider; later content is excluded. For a whole conversation it sends the latest response and the same bounded context.
- An assisted slash-command save uses the current agent's context. It is a different workflow from the editor's draft generation.

Do not put secrets in bookmark titles, notes, or tags. This is not an encrypted vault or transcript backup. [Storage and privacy details](docs/USAGE.md#storage-and-privacy).

## The conversation and the work

Use [Delivery Shelf](https://github.com/mechkw/hermes-delivery-shelf) for the report, images, or other files a conversation produced. Use Bookmarks for the conversation or response behind them.

Either plugin works alone. With both installed, **Saved** presents **Bookmarks** and **Deliverables** together while each plugin keeps its own backend and storage.

## Help and project links

- [Usage guide](docs/USAGE.md), [command reference](docs/COMMANDS.md), and [installation](docs/INSTALLATION.md).
- [Technical reference](docs/TECHNICAL.md), [changelog](CHANGELOG.md), and [contributing](CONTRIBUTING.md).
- [Report a bug](https://github.com/mechkw/hermes-conversation-bookmarks/issues). Remove private conversation text and identifiers from reports.
- Report vulnerabilities privately using the channel in [SECURITY.md](SECURITY.md). If GitHub private reporting is unavailable, email **repobugs@virtuedev.com**. Do not post a vulnerability publicly.

An independent community plugin for [Hermes Agent](https://hermes-agent.nousresearch.com/docs/). [MIT license](LICENSE).
