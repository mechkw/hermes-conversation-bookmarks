# Saved: native UI composition

Both plugins remain independently installable and enabled. When both native UI
halves and their current-profile backends are available, Saved offers **Bookmarks** and **Deliverables** collections.
Each collection uses its own component, authenticated transport, backend and
store. The shared coordinator carries UI providers, never saved records or
credentials. Missing collections show a short explanation and an **Install or
enable** action. This opens host plugin management; it never installs or enables
anything automatically.

## Host-specific navigation

- **Desktop:** one `/saved` route and one Saved sidebar contribution. Registration
  is coordinated across the two bundles, regardless of load order. Disposable
  `ctx.registerMany` handles transfer ownership before the new owner registers.
  Disabling/reloading either plugin retires its provider; the survivor keeps Saved.
- **Dashboard:** one Saved link in the documented `header-banner` shell slot. Each
  manifest has `tab.hidden: true` and retains its unique existing route. Either
  hidden route renders the shared Saved panel. This is deliberately **not** a
  canonical `/saved` URL or a Dashboard sidebar row.

### Why Dashboard differs

Official Hermes v0.22.5 (`bf0203a794a07aac3ff764972ab9087baa4e4f4e`)
`web/src/App.tsx:258–369` builds navigation directly from static manifests.
Equal paths are not deduplicated; two visible `/saved` manifests give two links.
Hiding just one manifest would break that plugin's standalone navigation. The
public Dashboard SDK exposes component and slot registration, not conditional
manifest navigation or contribution disposal (`plugins/registry.ts:141–147`).
`tab.hidden` still preserves a route (`App.tsx:358–366`). The documented
`header-banner` slot (`plugins/slots.ts:26`, `App.tsx:577`) is outside the sidebar
and remains visible when it collapses or the mobile drawer is closed. The old
`header-left` slot is hidden in collapsed mode (`App.tsx:612–618`);
`header-right` remains inside the narrow sidebar. The elected banner link
is the smallest supported composition without core patches, host registry
mutation, request interception, or host-DOM hiding.

Dashboard discovery follows native page-refresh/profile-change lifecycle
(`plugins/usePlugins.ts:125–160`). Enable/disable may require reloading that
Dashboard page. Its SDK has no unload callback; a MutationObserver retires only
our provider when its own profile-owned script is detached. It never rewrites
host DOM. Older frontend bundles predating this protocol retain their own
navigation: update both packages for coordinated Saved navigation.

## Scope and lifecycle

`ui/saved-coordinator.js` and `ui/Saved.jsx` are mirrored protocol-v1 sources in
both repositories and must stay byte-identical; the paired runner refuses to
start otherwise. Neither build needs the other repository. `ui/saved.css` and the
`CollectionTabs` adapter are each package's own presentation of that shell: the
Saved page is drawn by whichever plugin owns the route (Bookmarks when present). The Desktop hub
is keyed by the host SDK object; Dashboard hubs are keyed by the profile from
the native script loader. Disposed providers cannot dispatch new requests.
Desktop responses are fenced against profile, connection and disposal changes;
Dashboard responses are fenced against script lifetime. Components remount on
scope changes and clear prior records and dialogs. UI sharing does not bypass
backend profile validation or enablement policy.

The Install or enable action uses Desktop's
`host.navigate('/capabilities?tab=plugins')` (documented in `sdk/bridge.ts:14–17`)
or Dashboard's base-path-aware `/plugins` route. It does not claim a package is
absent versus disabled: the CTA covers both, and the host management screen is
the authority. Each frontend provider probes its own existing `/status` endpoint
through its host-authenticated transport, independently of UI registration. Only
HTTP 404 is treated as unavailable; 401/403 show an access-check message, and
network/timeout/other failures show a connection-check message, each with Retry.
Missing backends also offer Retry after enabling in management. Checks are
cleared on profile/connection/provider changes; late responses cannot restore
old availability or records. Checks time out after 12 seconds. No new backend
API, credential bridge or cross-plugin REST proxy is introduced.

## Build and test

```sh
npm ci --ignore-scripts
npm run build
HERMES_SOURCE=/path/to/official/hermes npm run test:browser
# Integration matrix: build the peer independently first.
HERMES_SOURCE=/path/to/official/hermes \
SAVED_PEER_REPO=/path/to/the-other-repository \
SAVED_PROOF_DIR=/path/to/fictional-proof npm run test:saved
```

`npm run test:contract` checks the static UI contract: only the two `presentation.*` adapters touch a host UI kit, stylesheets use host tokens and never select app markup, and bundles ship no second runtime or remote code. `scripts/verify.sh` also runs the host's own desktop-surface lint over `desktop/plugin.js`.

`tests/harness.mjs` is the shared browser harness: real React and Chromium, the official Dashboard loader/slot registry, the Desktop runtime loader/contribution registry, the real Hermes UI components compiled from the host checkout, and the native authenticated backend over a fictional profile. `test:browser` runs the both-plugins scenario; `test:saved` runs the whole matrix. Bookmarks cases live in `tests/bookmarks-browser.mjs`:

- **Collection:** independent inspect/select, selection across loaded pages, cancel and confirmed bulk removal with API readback and an untouched native source, display settings, type/tag/search/sort filters, escaped text, keyboard, row and context menus, outage and retry.
- **Inspector:** on-request source context, quoted named-profile resume command, copy, open with recheck, pruned-source flag with editable annotations.
- **Editor:** picker flow, search races, errors/retry/empty, response scope reset, tag chips, modifier-save, readback, conflict with retained draft, removal error/cancel/readback, focus return, and 360 px bounds.
- **AI draft:** explicit click only, persisted presets, review-only result, edit and scope fences, failure and retry.
- **Fences:** a save, source search, or draft in flight when the profile, connection, or plugin goes away issues no follow-up request and paints nothing late.
- **Desktop integrations:** palette rows and the shared-action shortcut, quick finder open/mention, save from the focused chat, live refresh, sidebar marks, profile isolation.

`npm run preview [dir]` uses the same harness to save screenshots of the main states in a light and a dark built-in skin, with fictional data. Screenshots and proofs default to disposable directories; set `SAVED_PROOF_DIR` to keep them.

`test:saved` has 34 cases: 24 matched frontend/backend states (both enabled, either alone/disabled, both disabled across both hosts/load orders), plus 10 independently activated Desktop cases. These assert quiet CTAs and actual native backend re-enable → Retry recovery. Both-host cases also inject 401/403/503/network status faults and retry; Desktop checks discard delayed old-connection probes. It verifies independent UI edits with API readback, 401/404 admission, one/no Saved link, Desktop live disable/re-enable/reload/unload, Dashboard link navigation, scope clearing/recovery, keyboard tabs and 360/768/1440 layouts. Results include host commit, browser version and frontend file hashes. Temporary servers, bundles and fictional homes are cleaned in finally blocks.

**Evidence boundary:** host state/IPC, SDK transport wiring and the surrounding
shell are test boundaries. This is native-loader/browser QA, not a full Electron
launch or the full production Dashboard app. The management CTA test proves the
supported navigation target, not installation. Foreign-profile switch tests
prove stale-view clearing and fail-closed requests, not a successful remote
secondary-profile subprocess transport. No production settings, installation,
restart, publish, or artwork changes are part of this work.

## CI versus paired local coverage

`.github/workflows/verify.yml` invokes `scripts/verify.sh`: single-repository
source/native/backend and single-plugin browser regressions. It does **not** run
the paired Saved matrix. No published companion revision is assumed to contain
these unpublished changes; a green CI job is not shared-matrix evidence.

For paired verification, prepare both matching local checkouts with their npm
dependencies, then run (replace the three absolute paths):

```sh
export HERMES_SOURCE=/absolute/path/to/official-hermes-v0.22.5
export SAVED_PEER_REPO=/absolute/path/to/companion-repository
export SAVED_PROOF_DIR=/absolute/path/to/fictional-proof
# From this repository; the companion is built independently.
npm --prefix "$SAVED_PEER_REPO" run build
npm run build
npm run test:browser
(cd "$SAVED_PEER_REPO" && npm run test:browser)
npm run test:saved
```

Set `PYTHON` to an existing runtime containing `tests/requirements-ci.txt` when
needed. The paired runner fails before launching fixtures if the companion or
built assets are missing, or mirrored shared source/tests differ. It pins UI,
bundles, UI docs and harnesses across execution, not concurrently edited Python
command/backend files. Save the resulting `results.json` with review evidence.

References:
- https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk
- https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard
