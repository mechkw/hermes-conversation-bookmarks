import React, { useEffect, useMemo, useState } from 'react';
import {
  host, useValue, atom, COMPOSER_AREAS, KEYBINDS_AREA, PALETTE_AREA, ROUTES_AREA, SESSION_ROW_AREAS, SIDEBAR_NAV_AREA, TITLEBAR_AREAS
} from '@hermes/plugin-sdk';
import styles from './style.css';
import { Bookmarks } from './Bookmarks.jsx';
import { BookmarkEditor } from './BookmarkEditor.jsx';
import { BookmarkSettings } from './BookmarkSettings.jsx';
import { QuickBookmarks } from './QuickBookmarks.jsx';
import { Saved } from './Saved.jsx';
import { Icon, Tip } from '@saved/presentation';
import { createSignal, plural } from './lib.js';
import { desktopHub } from './saved-coordinator.js';

const STALE = 'Connection changed. Reopen Saved.';
const SAVE_ACTION = 'conversation-bookmarks.save';

export default {
  id: 'conversation-bookmarks',
  name: 'Conversation Bookmarks',
  description: 'Keep a way back to the conversation or response that mattered.',
  register(ctx) {
    let disposed = false;
    const hub = desktopHub(host);
    const scopeNow = () => [host.state.profile.get(), host.state.connectionId.get()];
    const scopeKey = () => JSON.stringify(scopeNow());

    // Cross-surface signals: a save in the quick dialog refreshes an open page.
    const changes = createSignal(0);
    const sessionFilter = createSignal('');
    const modal = atom(null); // {kind:'quick'|'save', scope, key, session?}
    const marks = atom({ scope: '', sessions: {} });

    /** Profile- and connection-fenced transport: late answers from a previous scope are refused. */
    function transport(profile, connection) {
      const valid = () => !disposed && host.state.profile.get() === profile && host.state.connectionId.get() === connection;
      const request = async (path, opts = {}) => {
        if (!valid()) throw new Error(STALE);
        const result = await ctx.rest(path + (path.includes('?') ? '&' : '?') + 'profile=' + encodeURIComponent(profile || 'default'), opts);
        if (!valid()) throw new Error(STALE);
        return result;
      };
      request.copyText = async text => { if (!valid() || !await ctx.os.writeClipboard(text)) throw new Error('Copy unavailable'); };
      request.openSession = async id => {
        if (!valid()) throw new Error(STALE);
        await host.openSession(id, { profile: profile || 'default', expectHistory: true });
      };
      request.notify = message => { if (valid()) host.notify?.({ kind: 'success', message }); };
      if (host.composer?.insertText) {
        request.insertText = async text => { if (!valid()) return false; try { return await host.composer.insertText(null, text, { mode: 'block' }); } catch { return false; } };
      }
      return request;
    }
    function useProfileApi() {
      const profile = useValue(host.state.profile), connection = useValue(host.state.connectionId);
      const api = useMemo(() => transport(profile, connection), [profile, connection]);
      return { api, key: JSON.stringify([profile, connection]) };
    }

    // Which conversations carry bookmarks: identifiers and counts only, refreshed after each change.
    async function refreshMarks() {
      const [profile, connection] = scopeNow(), scope = scopeKey();
      try {
        const data = await transport(profile, connection)('/marks');
        if (!disposed && scope === scopeKey()) marks.set({ scope, sessions: data.sessions || {} });
      } catch {
        if (!disposed && scope === scopeKey()) marks.set({ scope, sessions: {} });
      }
    }
    const signals = { changes };
    const stopChanges = changes.subscribe(() => { void refreshMarks(); });
    const stopProfile = host.state.profile.listen?.(() => { void refreshMarks(); });
    const stopConnection = host.state.connectionId.listen?.(() => { void refreshMarks(); });
    void refreshMarks();

    const openModal = (kind, extra = {}) => modal.set({ kind, scope: scopeKey(), key: Date.now(), ...extra });
    const browse = session => { sessionFilter.set(session || ''); modal.set(null); host.navigate('/saved'); };
    const saveCurrent = () => openModal('save', { session: host.state.focusedStoredSessionId?.get?.() || '' });

    function Page() {
      const { api, key } = useProfileApi();
      const [session, setSession] = useState(sessionFilter.get());
      useEffect(() => sessionFilter.subscribe(setSession), []);
      return <Bookmarks key={key} api={api} signals={signals} session={session} onSessionCleared={() => sessionFilter.set('')} />;
    }
    function Settings() {
      const { api, key } = useProfileApi();
      return <div className="cb"><BookmarkSettings key={key} api={api} /></div>;
    }
    // Permanent mount: quick find and quick save work from any route, and the
    // one stylesheet every surface of this plugin shares lives here.
    function ModalHost() {
      const request = useValue(modal);
      const { api, key } = useProfileApi();
      const close = () => modal.set(null);
      let content = null;
      if (request && request.scope === key) {
        content = request.kind === 'save' ? (
          <BookmarkEditor
            key={request.key}
            api={api}
            entry={null}
            preset={request.session ? { session_id: request.session } : undefined}
            close={close}
            onSaved={() => {
              close();
              changes.set(changes.get() + 1);
              host.notify?.({ kind: 'success', message: 'Bookmark saved.', action: { label: 'View', onClick: () => browse() } });
            }}
          />
        ) : (
          <QuickBookmarks key={request.key} api={api} close={close} onBrowse={() => browse()} onSaveCurrent={saveCurrent} />
        );
      }
      return <><style>{styles}</style>{content}</>;
    }
    // A quiet mark on sidebar rows whose conversation has bookmarks.
    function SessionMark({ sessionId }) {
      const state = useValue(marks);
      const count = state.scope === scopeKey() ? state.sessions[sessionId] : 0;
      if (!count) return null;
      const label = `${plural(count, 'bookmark')} in this conversation`;
      return (
        <Tip label={label}>
          <button type="button" className="cb-session-mark" aria-label={label} onClick={event => { event.stopPropagation(); browse(sessionId); }}>
            <Icon name="bookmark" size="0.75rem" />
          </button>
        </Tip>
      );
    }
    function Panel() {
      const profile = useValue(host.state.profile), connection = useValue(host.state.connectionId);
      const scope = JSON.stringify([profile, connection]);
      return <Saved key={scope} hub={hub} scope={scope} manage={() => host.navigate('/capabilities?tab=plugins')} />;
    }

    ctx.registerSettingsPage?.({ id: 'conversation-bookmarks', title: 'Bookmarks', icon: 'bookmark', render: () => <Settings /> });
    ctx.registerMany([
      { id: 'attach-bookmarks', area: COMPOSER_AREAS.attachments, data: { label: 'Bookmarks', icon: 'bookmark', run: () => openModal('quick') } },
      { id: 'find-bookmark', area: PALETTE_AREA, data: { id: 'find-bookmark', label: 'Find a bookmark', keywords: ['saved', 'conversation', 'search', '/bookmarks'], run: () => openModal('quick') } },
      { id: 'browse-bookmarks', area: PALETTE_AREA, data: { id: 'browse-bookmarks', label: 'Browse bookmarks', keywords: ['saved', 'conversation', 'collection'], run: () => browse() } },
      { id: 'save-bookmark', area: PALETTE_AREA, data: { id: SAVE_ACTION, action: SAVE_ACTION, label: 'Bookmark this conversation', keywords: ['save', 'bookmark', 'keep', '/bookmark'], run: saveCurrent } },
      { id: 'bookmarks-dialog', area: TITLEBAR_AREAS.center, render: () => <ModalHost /> },
      // Newer hosts only: a missing area constant leaves these out without failing registration.
      ...(KEYBINDS_AREA ? [{ id: 'save-bookmark-key', area: KEYBINDS_AREA, data: { id: SAVE_ACTION, category: 'session', defaults: ['mod+alt+b'], label: 'Bookmark this conversation', run: saveCurrent } }] : []),
      ...(SESSION_ROW_AREAS?.trailing ? [{ id: 'session-mark', area: SESSION_ROW_AREAS.trailing, data: { render: props => <SessionMark {...props} /> } }] : [])
    ]);

    const probe = async scope => {
      const [profile, connection] = JSON.parse(scope);
      return transport(profile, connection)('/status');
    };
    const provider = {
      id: 'conversation-bookmarks', Page, probe,
      claim: () => ctx.registerMany([
        { id: 'saved-page', area: ROUTES_AREA, title: 'Saved', data: { path: '/saved' }, render: () => <Panel /> },
        { id: 'saved-nav', area: SIDEBAR_NAV_AREA, data: { path: '/saved', label: 'Saved', codicon: 'bookmark' } }
      ])
    };
    // Fence requests first, then retire the provider and hand over route ownership.
    let detach = () => {};
    ctx.onDispose(() => { disposed = true; stopChanges(); stopProfile?.(); stopConnection?.(); detach(); });
    detach = hub.add(provider);
  }
};
