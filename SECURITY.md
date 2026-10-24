# Security policy

## Report privately

Please do not put secrets, private conversation excerpts, file contents, or exploitable
proofs into a public issue. Use [GitHub private vulnerability reporting](https://github.com/mechkw/hermes-conversation-bookmarks/security/advisories/new)
as the preferred channel. If you cannot use GitHub private reporting, email
**repobugs@virtuedev.com** with the subject “Conversation Bookmarks security”.
Include the affected commit or release, Hermes version, operating system, reproduction
steps using fictional data, and expected versus observed behavior.

## Supported versions

Security fixes target the latest published release. Older versions should be upgraded
before reporting a suspected issue, unless the upgrade itself is the issue.

## Trust boundaries

This plugin runs with the permissions of its Hermes host. It is not a sandbox for
other programs running under the same operating-system account. Keep Hermes's native
authentication enabled, restrict host access, and install only plugins you trust.
Do not publish local plugin data, private screenshots, or real session exports in bug reports.

## Explicit save handoff

An explicit `/bookmark` with missing metadata may queue the current native agent via
`PluginContext.inject_message`. The plugin makes no model call of its own, but the
normal current-session agent processes context and supplied metadata under its usual
provider/privacy settings. Gateway/TUI injection requires explicit profile-local
`plugins.entries.conversation-bookmarks.allow_gateway_injection: true`; the plugin never
grants itself consent. This permission can lead to a reply on the existing external
messaging route and is not a Python sandbox.

Supplied text is JSON-framed as inert data, not prompt instructions. This is defense in
depth, not a guarantee that every model resists malicious content. The plugin never
scrapes or copies native transcripts; its source adapter reads only identifiers and
ownership labels. Generated descriptions can themselves contain sensitive context, so
protect the metadata database just as you would supplied notes.

## Release checks

Changes that affect profile binding, stored text, filesystem access, or download behavior
require regression tests. A browser check alone is not a security review. Reports are
handled without promising an unsupported response-time SLA.
