// Static contract for the UI sources: which host each adapter may speak to, and
// what the plugin's stylesheet and bundles are allowed to contain.
import {readFile, readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = path => readFile(resolve(root, path), 'utf8');

// Adapters: Desktop speaks only the Desktop SDK; the Dashboard never imports it.
const desktop = await read('ui/presentation.desktop.jsx');
assert.match(desktop, /from '@hermes\/plugin-sdk'/);
for (const part of ['Button', 'SearchField', 'SegmentedControl', 'DropdownMenu', 'ContextMenu', 'ConfirmDialog', 'DialogContent', 'TabsTrigger', 'ToggleRow', 'Badge', 'Tip', 'Skeleton', 'CopyButton', 'Kbd']) {
  assert.ok(desktop.includes(part), 'Desktop adapter should use the host ' + part);
}
const dashboard = await read('ui/presentation.dashboard.jsx');
assert.ok(dashboard.includes('SDK.components'));
assert.ok(!dashboard.includes('@hermes/plugin-sdk'));

// Every shared component goes through the adapter, never straight to a host.
for (const file of (await readdir(resolve(root, 'ui'))).filter(name => /\.(jsx|js)$/.test(name))) {
  if (/^(presentation\.|desktop\.jsx$|dashboard\.jsx$)/.test(file)) continue;
  const source = await read('ui/' + file);
  assert.ok(!/@hermes\/plugin-sdk|__HERMES_PLUGIN_SDK__/.test(source), file + ' must stay host-neutral');
}

// Stylesheets: host tokens only, no restyling of host controls, no reach into app markup.
for (const file of ['ui/style.css', 'ui/saved.css']) {
  const css = await read(file);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, file + ': use host color tokens, not literal colors');
  assert.doesNotMatch(css, /\brgba?\(|\bhsla?\(/i, file + ': use host color tokens, not literal colors');
  assert.doesNotMatch(css, /\[data-(slot|tour|sidebar|testid|tree-|pane-host|titlebar-cluster)/, file + ': never select the app\'s own markup');
  assert.doesNotMatch(css, /\.(cb|hs-saved)[\w-]*\s+(button|input|select|textarea)\b/, file + ': never restyle host controls by element');
  assert.doesNotMatch(css, /!important/, file + ': no forced overrides');
  for (const family of css.matchAll(/font-family:([^;}]+)/g)) assert.match(family[1], /^var\(--/, file + ': fonts come from host tokens');
}

// Bundles: Desktop keeps React and the SDK external; neither ships a second runtime or remote code.
const bundle = await read('desktop/plugin.js');
assert.match(bundle, /from"@hermes\/plugin-sdk"/);
assert.match(bundle, /from"react"/);
for (const built of [bundle, await read('dashboard/dist/index.js')]) {
  assert.doesNotMatch(built, /(?<![\w$.])eval\(|\bnew\s+Function\(/);
  assert.doesNotMatch(built, /createElement\(\s*['"]script['"]\s*\)|<script\b/);
  assert.doesNotMatch(built, /\bimport\(\s*(?!['"](?:@hermes\/plugin-sdk|react)(?:\/[\w/-]*)?['"]\s*\))/);
  assert.doesNotMatch(built, /https?:\/\//, 'bundles must not reference remote resources');
}

// The editor never asks a person for a raw identifier.
assert.doesNotMatch(await read('ui/BookmarkEditor.jsx') + await read('ui/SourcePicker.jsx'), /Session ID|Message ID|Conversation ID/);
console.log('PASS UI contract: adapter boundaries, host-neutral components, token-only styles, clean bundles, no raw IDs in the editor');
