import React from 'react';
import { Bookmarks } from './Bookmarks.jsx';
import { Saved, SavedLink } from './Saved.jsx';
import { dashboardHub, attachDashboard } from './saved-coordinator.js';

const sdk = window.__HERMES_PLUGIN_SDK__;
const script = document.currentScript;
const profile = script?.getAttribute('data-hermes-profile') || '';
const hub = dashboardHub(profile);
const basePath = new URL(script.src).pathname.split('/dashboard-plugins/')[0];
const STALE = 'Profile changed. Reopen Saved.';

// The Dashboard removes this script when the profile changes: refuse to speak for a retired one.
async function api(path, opts = {}) {
  if (!script?.isConnected) throw new Error(STALE);
  const suffix = profile ? (path.includes('?') ? '&' : '?') + 'profile=' + encodeURIComponent(profile) : '';
  const result = await sdk.fetchJSON('/api/plugins/conversation-bookmarks' + path + suffix, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!script?.isConnected) throw new Error(STALE);
  return result;
}
api.copyText = text => {
  if (!script?.isConnected) throw new Error(STALE);
  return navigator.clipboard.writeText(text);
};

const provider = {
  id: 'conversation-bookmarks',
  probe: () => api('/status'),
  path: basePath + '/conversation-bookmarks',
  Page: () => <Bookmarks api={api} />
};
attachDashboard(hub, provider, script, profile);
window.__HERMES_PLUGINS__.register('conversation-bookmarks', () => (
  <Saved hub={hub} scope={profile} manage={() => { window.location.href = basePath + '/plugins'; }} />
));
window.__HERMES_PLUGINS__.registerSlot('conversation-bookmarks', 'header-banner', () => <SavedLink hub={hub} id="conversation-bookmarks" />);
