# Contest candidate status

This candidate aligns Bookmarks with Delivery Shelf while retaining a separate package and reference-only storage. It is not a transcript backup or a file shelf.

## Verified workflows

The full local staged verification entrypoint passed 109 unit tests, native integration probes, 16 catalog checks, builds, and four paired browser cases covering both loading orders in Dashboard and Desktop adapters. Captured-transport Telegram checks are not live Telegram acceptance.

Installed native Desktop acceptance covered deliberate bookmarking, selection, the adjacent inspector, source return, metadata-only removal, and settings persistence after closing and reopening. Both original effective settings values were restored.

The launch films use genuine dark native captures with fictional content. Video decoding and audio levels were checked. Audio was measured, not auditioned.

## Open issues

- [Live Telegram plural command](https://github.com/mechkw/hermes-conversation-bookmarks/issues/1). `/bookmarks browse` returned an unknown-command response in the tested live connection, although fresh Desktop dispatch worked and live `/bookmark help` succeeded. Live Telegram bookmark saving remains untested.
- [Settings label spacing](https://github.com/mechkw/hermes-conversation-bookmarks/issues/2). At the captured Desktop size, the switches overlapped the ends of their labels. Persistence worked; the spacing remains a refinement item.

Local qualification used a different Hermes host commit and Python patch version from declared CI. Publication does not establish remote CI success or resolve these installed-client issues. See the repository's Actions results for the published commit.

[README](../README.md) · [Commands](COMMANDS.md)
