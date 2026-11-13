# Release status

Version 0.2.0 is an interface redesign on the `ux-polish-pass` branch. It keeps Bookmarks a separate package with reference-only storage: not a transcript backup or a file shelf. Storage, tools, commands, and existing API routes are unchanged; four read-only routes and two list filters were added.

## Verified for 0.2.0

Run locally against Hermes Desktop/Dashboard source v0.23.0 with the companion Delivery Shelf checkout:

- Unit tests for storage, API, tools, commands, source choosers, generation, Telegram capture, and the new filters, tag summary, marks, and source context.
- Native API probe and the 16-check catalog validation.
- Static UI contract and the host's desktop-surface lint (no forbidden constructs, no review cues).
- Browser regressions through the real host loaders and real Hermes UI components, on both the Desktop and Dashboard adapters and both plugin load orders. See [Saved UI](SAVED_UI.md#build-and-test) for what each group covers.

This is native-loader and browser QA with host state and IPC doubled at the SDK boundary. **It is not a full Electron launch.** The redesigned interface has not yet been exercised in an installed Hermes Desktop; the 0.1 installed-client acceptance does not carry over. Captured-transport Telegram checks are not live Telegram acceptance.

## Known gaps

- **Installed-client pass pending.** Composer mention, the sidebar mark, the shortcut, and toast feedback depend on host doors that are doubled in tests. Sidebar marks match on the conversation ID a bookmark stores; a conversation whose stored ID differs from its sidebar ID shows no mark.
- **Launch films show the 0.1 interface.** Screenshots in the README are current.
- **Three native fixture checks do not run on host v0.23.0** (`tests/native_telegram.py`, `tests/native_command_discovery.py`, `tests/test_native_generation_context.py`): importing the host from a fictional home makes the newer host re-launch the process in an isolated runtime. They fail the same way on `main` and are unrelated to this change; they need the host version declared for CI, or a fixture update.
- [Live Telegram plural command](https://github.com/mechkw/hermes-conversation-bookmarks/issues/1). `/bookmarks browse` returned an unknown-command response in the tested live connection. Live Telegram bookmark saving remains untested.
- [Settings label spacing](https://github.com/mechkw/hermes-conversation-bookmarks/issues/2) is addressed in source by the host's own toggle rows; it needs confirming in the installed client before the issue is closed.

Publication does not establish remote CI success. See the repository's Actions results for the published commit.

[README](../README.md) · [Commands](COMMANDS.md)
