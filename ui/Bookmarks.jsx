import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './style.css';
import {
  Button, Checkbox, Confirm, Dialog, EmptyState, ErrorState, Icon, IconButton, Menu, SearchField, Segmented, Skeleton
} from '@saved/presentation';
import { BookmarkRow } from './BookmarkRow.jsx';
import { BookmarkInspector } from './BookmarkInspector.jsx';
import { BookmarkEditor } from './BookmarkEditor.jsx';
import { BookmarkSettings } from './BookmarkSettings.jsx';
import { PAGE_SIZE, SELECTION_LIMIT, chatReference, cx, errorMessage, plural, resumeCommand, tagKey } from './lib.js';

const KINDS = [
  { id: 'all', label: 'All' },
  { id: 'conversation', label: 'Conversations' },
  { id: 'response', label: 'Responses' }
];
const SORTS = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'title', label: 'Title A–Z' }
];
const DEFAULT_SETTINGS = { show_notes: true, show_source_status: true };
const initialFilters = session => ({ q: '', tag: '', kind: 'all', sort: 'newest', session: session || '' });
const isTyping = target => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * The Bookmarks collection: a searchable list with an adjacent inspector.
 *
 * `api(path, opts)` is the host-authenticated transport. Optional doors on it
 * (`openSession`, `notify`, `insertText`) light up host-specific actions.
 * `signals.changes` announces saves made elsewhere (quick save, chat command).
 */
export function Bookmarks({ api, signals, session = '', onSessionCleared }) {
  const [status, setStatus] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(() => initialFilters(session));
  const [pages, setPages] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [tags, setTags] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [checked, setChecked] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [context, setContext] = useState(null);
  const [actionError, setActionError] = useState('');
  const [opening, setOpening] = useState(false);
  const [editor, setEditor] = useState(undefined); // undefined = closed, null = new, entry = edit
  const [removing, setRemoving] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [notice, setNotice] = useState('');

  const alive = useRef(true);
  const serial = useRef(0);
  const detailSerial = useRef(0);
  const root = useRef(null);
  const search = useRef(null);
  const lastTrigger = useRef(null);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const say = useCallback(message => {
    if (api.notify) api.notify(message);
    else setNotice(message);
  }, [api]);

  // ── Loading ────────────────────────────────────────────────────────────────
  const query = useMemo(() => JSON.stringify(filters), [filters]);
  const typed = useRef(filters.q);
  useEffect(() => {
    const ticket = ++serial.current;
    const current = JSON.parse(query);
    // Only keystrokes are debounced; every other change answers immediately.
    const wait = typed.current !== current.q ? 180 : 0;
    typed.current = current.q;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const request = offset => api('/entries?' + new URLSearchParams({
          q: current.q, tag: current.tag, sort: current.sort, kind: current.kind,
          ...(current.session ? { session_id: current.session } : {}),
          limit: String(PAGE_SIZE), offset: String(offset)
        }));
        const [profile, ...chunks] = await Promise.all([
          api('/status'),
          ...Array.from({ length: pages }, (_, index) => request(index * PAGE_SIZE))
        ]);
        if (!alive.current || ticket !== serial.current) return;
        const seen = new Set();
        const items = chunks.flatMap(chunk => chunk.items).filter(item => !seen.has(item.id) && seen.add(item.id));
        setStatus(profile);
        setData({ items, total: chunks[chunks.length - 1].total });
        setError('');
      } catch (failure) {
        if (alive.current && ticket === serial.current) setError(errorMessage(failure));
      } finally {
        if (alive.current && ticket === serial.current) setLoading(false);
      }
    }, wait);
    return () => clearTimeout(timer);
  }, [api, query, pages, refresh]);

  useEffect(() => {
    let active = true;
    // Tag summary and display preferences are conveniences: never block the list on them.
    api('/tags?limit=12').then(result => { if (active) setTags(result.items || []); }).catch(() => {});
    api('/settings').then(value => { if (active) setSettings(value); }).catch(() => {});
    return () => { active = false; };
  }, [api, refresh, showSettings]);

  useEffect(() => signals?.changes.subscribe(() => setRefresh(n => n + 1)), [signals]);
  useEffect(() => { setFilters(f => (f.session === session ? f : { ...initialFilters(session) })); setPages(1); }, [session]);

  const items = data?.items || [];
  const total = data?.total || 0;
  const active = useMemo(() => {
    if (!activeId) return null;
    return detail?.id === activeId ? detail : items.find(item => item.id === activeId) || null;
  }, [activeId, detail, items]);

  // ── Inspector ──────────────────────────────────────────────────────────────
  const inspect = useCallback(async item => {
    const ticket = ++detailSerial.current;
    setActiveId(item.id);
    setDetail(item);
    setContext(null);
    setActionError('');
    try {
      const fresh = await api(`/entries/${item.id}`);
      if (!alive.current || ticket !== detailSerial.current) return;
      setDetail(fresh);
    } catch (failure) {
      if (alive.current && ticket === detailSerial.current) setActionError(errorMessage(failure));
      return;
    }
    try {
      const value = await api(`/entries/${item.id}/context`);
      if (alive.current && ticket === detailSerial.current) setContext(value);
    } catch {
      // Older backends have no context route; the inspector simply shows less.
      if (alive.current && ticket === detailSerial.current) setContext({ conversation: null, response: null });
    }
  }, [api]);

  const closeInspector = useCallback(() => {
    detailSerial.current++;
    const id = activeId;
    setActiveId(null);
    setDetail(null);
    setContext(null);
    setActionError('');
    requestAnimationFrame(() => root.current?.querySelector(`[data-entry="${id}"] .cb-row-title`)?.focus());
  }, [activeId]);

  // A bookmark that left the list (removed, filtered away) leaves the inspector too.
  useEffect(() => {
    if (activeId && data && !loading && !items.some(item => item.id === activeId)) {
      detailSerial.current++;
      setActiveId(null); setDetail(null); setContext(null);
    }
  }, [activeId, data, items, loading]);

  // ── Filters and selection ──────────────────────────────────────────────────
  const filter = useCallback((key, value) => {
    setFilters(current => (current[key] === value ? current : { ...current, [key]: value }));
    setPages(1);
    setChecked({});
    if (key === 'session' && !value) onSessionCleared?.();
  }, [onSessionCleared]);
  const clearFilters = () => {
    setFilters(current => ({ ...initialFilters(''), sort: current.sort }));
    setPages(1); setChecked({});
    onSessionCleared?.();
  };
  const reload = () => { setChecked({}); setRefresh(n => n + 1); };

  const chosen = Object.values(checked);
  const filtered = Boolean(filters.q || filters.tag || filters.session || filters.kind !== 'all');
  const allChecked = items.length > 0 && items.every(item => checked[item.id]);
  const toggle = (item, value) => setChecked(current => {
    const next = { ...current };
    if (value) next[item.id] = item; else delete next[item.id];
    return next;
  });
  const toggleAll = value => setChecked(current => {
    const next = { ...current };
    for (const item of items) {
      if (!value) delete next[item.id];
      else if (next[item.id] || Object.keys(next).length < SELECTION_LIMIT) next[item.id] = item;
    }
    return next;
  });

  // ── Actions ────────────────────────────────────────────────────────────────
  const remember = () => { lastTrigger.current = document.activeElement; };
  const openEditor = entry => { remember(); setActionError(''); setEditor(entry); };
  const askRemove = entries => { remember(); setActionError(''); setRemoving(entries); };

  async function remove() {
    const entries = removing;
    if (entries.length === 1) await api(`/entries/${entries[0].id}?revision=${entries[0].revision}`, { method: 'DELETE' });
    else await api('/entries/remove', { method: 'POST', body: { entries: entries.map(({ id, revision }) => ({ id, revision })) } });
    if (!alive.current) return;
    setChecked({});
    signals?.changes.set((signals.changes.get() || 0) + 1);
    if (!signals) setRefresh(n => n + 1);
    say(`${entries.length === 1 ? 'Bookmark' : plural(entries.length, 'bookmark')} removed. The ${entries.length === 1 ? 'conversation was' : 'conversations were'} not changed.`);
  }

  async function openConversation(entry) {
    if (opening || !api.openSession) return;
    const ticket = detailSerial.current;
    setOpening(true); setActionError('');
    try {
      // Recheck first: a source can be pruned between listing and opening.
      const fresh = await api(`/entries/${entry.id}`);
      if (!alive.current) return;
      if (ticket === detailSerial.current && activeId === entry.id) setDetail(fresh);
      if (fresh.source_status !== 'available') throw new Error('This conversation is no longer available. Your bookmark is still saved.');
      await api.openSession(fresh.session_id);
    } catch (failure) {
      if (!alive.current) return;
      if (activeId === entry.id) setActionError(errorMessage(failure));
      else say(errorMessage(failure));
    } finally {
      if (alive.current) setOpening(false);
    }
  }

  async function copy(text, done) {
    try { await api.copyText(text); say(done); }
    catch { say('Copy is unavailable here. Select the text in the inspector and copy it manually.'); }
  }

  const actionsFor = entry => [
    api.openSession && { label: 'Open conversation', icon: 'link-external', disabled: entry.source_status !== 'available', onSelect: () => openConversation(entry) },
    { label: 'Edit bookmark', icon: 'edit', onSelect: () => openEditor(entry) },
    api.insertText && { label: 'Mention in chat', icon: 'mention', onSelect: async () => say(await api.insertText(chatReference(entry)) ? 'Added to your message.' : 'Open a chat to mention this bookmark.') },
    { separator: true },
    { label: 'Copy resume command', icon: 'terminal', onSelect: () => copy(resumeCommand(entry.session_id, status?.profile), 'Resume command copied.') },
    { label: 'Copy conversation ID', icon: 'copy', onSelect: () => copy(entry.session_id, 'Conversation ID copied.') },
    { separator: true },
    { label: 'Remove bookmark', icon: 'trash', destructive: true, onSelect: () => askRemove([entry]) }
  ].filter(Boolean);

  // After a dialog closes on a control that no longer exists, keep focus in the collection.
  const restoreFocus = event => {
    const target = lastTrigger.current;
    if (target?.isConnected && !target.disabled) { event?.preventDefault(); target.focus(); return; }
    const fallback = root.current?.querySelector('[data-cb-fallback]');
    if (fallback) { event?.preventDefault(); fallback.focus(); }
  };
  const dialogOpen = editor !== undefined || Boolean(removing) || showSettings;
  useEffect(() => {
    if (dialogOpen) return;
    const timer = setTimeout(() => { if (alive.current && document.activeElement === document.body && lastTrigger.current) restoreFocus(); }, 80);
    return () => clearTimeout(timer);
  }, [dialogOpen]);

  // ── Keyboard ───────────────────────────────────────────────────────────────
  const move = step => {
    if (!items.length) return;
    const index = items.findIndex(item => item.id === activeId);
    const next = items[Math.min(items.length - 1, Math.max(0, index < 0 ? (step > 0 ? 0 : items.length - 1) : index + step))];
    inspect(next);
    root.current?.querySelector(`[data-entry="${next.id}"] .cb-row-title`)?.focus();
  };
  const onKeyDown = event => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || dialogOpen) return;
    const typing = isTyping(event.target);
    if (event.key === 'Escape' && !typing && activeId) { event.preventDefault(); closeInspector(); return; }
    if (typing) {
      if (event.key === 'ArrowDown' && event.target === search.current) { event.preventDefault(); move(1); }
      return;
    }
    const run = action => { event.preventDefault(); action(); };
    switch (event.key) {
      case '/': return run(() => search.current?.focus());
      case 'n': return run(() => openEditor(null));
      case 'ArrowDown': case 'j': return run(() => move(1));
      case 'ArrowUp': case 'k': return run(() => move(-1));
      case 'e': return active && run(() => openEditor(active));
      case 'o': return active && api.openSession && run(() => openConversation(active));
      case 'x': return active && run(() => toggle(active, !checked[active.id]));
      case 'Delete': case 'Backspace': return active && run(() => askRemove([active]));
      default:
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const sort = SORTS.find(option => option.id === filters.sort);
  const tagActive = tag => tagKey(filters.tag) === tagKey(tag);
  const firstLoad = !data && loading;
  const more = total - items.length;

  return (
    <section ref={root} className="cb" data-detail={active ? '' : undefined} onKeyDown={onKeyDown}>
      <style>{styles}</style>

      <div className="cb-bar">
        <SearchField
          aria-label="Search bookmarks"
          placeholder="Search titles, notes and tags"
          containerClassName="cb-search"
          inputRef={search}
          value={filters.q}
          loading={loading && Boolean(filters.q)}
          onChange={value => filter('q', value.slice(0, 200))}
        />
        <Segmented label="Bookmark type" options={KINDS} value={filters.kind} onChange={value => filter('kind', value)} />
        <div className="cb-bar-end">
          <Menu
            trigger={<Button variant="ghost" aria-label={`Sort: ${sort.label}`}><Icon name="arrow-swap" className="cb-rotate" />{sort.label}</Button>}
            items={SORTS.map(option => ({ label: option.label, checked: option.id === filters.sort, onSelect: () => filter('sort', option.id) }))}
          />
          <IconButton icon="refresh" label="Refresh" spinning={loading && Boolean(data)} onClick={reload} />
          <IconButton icon="settings-gear" label="Bookmark settings" onClick={() => { remember(); setShowSettings(true); }} />
          <Button variant="default" icon="add" data-cb-fallback disabled={!status} onClick={() => openEditor(null)}>New bookmark</Button>
        </div>
      </div>

      {(tags.length > 0 || filters.tag || filters.session) && (
        <div className="cb-tagrail" role="group" aria-label="Filter by tag">
          {filters.session && (
            <Button variant="chip" size="xs" aria-pressed="true" onClick={() => filter('session', '')}>
              <Icon name="comment-discussion" size="0.75rem" />This conversation<Icon name="close" size="0.7rem" />
            </Button>
          )}
          {filters.tag && !tags.some(item => tagActive(item.tag)) && (
            <Button variant="chip" size="xs" aria-pressed="true" aria-label={`Filter tag ${filters.tag}`} onClick={() => filter('tag', '')}>#{filters.tag}</Button>
          )}
          {tags.map(item => (
            <Button
              key={item.tag} variant="chip" size="xs"
              className={cx('cb-tag', tagActive(item.tag) && 'cb-tag-on')}
              aria-pressed={tagActive(item.tag)}
              aria-label={`Filter tag ${item.tag}`}
              onClick={() => filter('tag', tagActive(item.tag) ? '' : item.tag)}
            >#{item.tag}<span className="cb-tag-count">{item.count}</span></Button>
          ))}
        </div>
      )}

      <div className="cb-status">
        {items.length > 0 && (
          <Checkbox
            aria-label="Select all bookmarks on this page"
            checked={allChecked}
            disabled={!allChecked && chosen.length >= SELECTION_LIMIT}
            onCheckedChange={value => toggleAll(value === true)}
          />
        )}
        {chosen.length > 0 ? (
          <>
            <span role="status" className="cb-status-count">{plural(chosen.length, 'bookmark')} selected</span>
            <Button variant="text" size="inline" onClick={() => setChecked({})}>Clear selection</Button>
            <span className="cb-spacer" />
            {chosen.length >= SELECTION_LIMIT && <span className="cb-faint">Limit of {SELECTION_LIMIT} at a time</span>}
            <Button variant="destructive" size="sm" icon="trash" onClick={() => askRemove(chosen)}>Remove selected bookmarks</Button>
          </>
        ) : (
          <>
            <span aria-live="polite" className="cb-status-count">
              {firstLoad ? 'Loading bookmarks…' : filtered ? plural(total, 'result') : plural(total, 'bookmark')}
            </span>
            {filtered && <Button variant="text" size="inline" onClick={clearFilters}>Clear filters</Button>}
            {notice && <span role="status" className="cb-notice">{notice}</span>}
          </>
        )}
      </div>

      <div className="cb-split">
        <div className="cb-list" role="list" aria-label="Bookmarks" aria-busy={loading || undefined}>
          {error && !data ? (
            <ErrorState title="Could not load bookmarks" description={error}><Button onClick={reload}>Try again</Button></ErrorState>
          ) : firstLoad ? (
            Array.from({ length: 6 }, (_, index) => (
              <div className="cb-row cb-row-skeleton" key={index} aria-hidden="true">
                <Skeleton className="cb-skeleton-dot" /><div><Skeleton className="cb-skeleton-title" /><Skeleton className="cb-skeleton-note" /></div>
              </div>
            ))
          ) : !items.length ? (
            filtered ? (
              <EmptyState icon="search" title="No matching bookmarks" description="Try a different search, or clear the filters.">
                <Button onClick={clearFilters}>Clear filters</Button>
              </EmptyState>
            ) : (
              <EmptyState icon="bookmark" title="Keep your place" description="Save a conversation, or the one response that mattered, with a note for later. Nothing is captured automatically.">
                <Button variant="default" icon="add" onClick={() => openEditor(null)}>Save your first bookmark</Button>
              </EmptyState>
            )
          ) : (
            <>
              {error && <p role="alert" className="cb-list-error">{error} <Button variant="text" size="inline" onClick={reload}>Try again</Button></p>}
              {items.map(item => (
                <BookmarkRow
                  key={item.id}
                  entry={item}
                  active={item.id === activeId}
                  checked={Boolean(checked[item.id])}
                  selecting={chosen.length > 0}
                  selectionFull={chosen.length >= SELECTION_LIMIT}
                  showNote={settings.show_notes}
                  showStatus={settings.show_source_status}
                  activeTag={filters.tag}
                  actions={actionsFor(item)}
                  onInspect={() => inspect(item)}
                  onOpen={api.openSession ? () => openConversation(item) : undefined}
                  onCheck={value => toggle(item, value)}
                  onTag={tag => filter('tag', tagActive(tag) ? '' : tag)}
                />
              ))}
              {more > 0 && (
                <div className="cb-more">
                  <Button variant="ghost" loading={loading} onClick={() => setPages(n => n + 1)}>
                    Show {Math.min(PAGE_SIZE, more)} more
                  </Button>
                  <span className="cb-faint">{items.length} of {total}</span>
                </div>
              )}
            </>
          )}
        </div>

        <BookmarkInspector
          entry={active}
          context={context}
          profile={status?.profile}
          error={actionError}
          opening={opening}
          canOpen={Boolean(api.openSession)}
          hasBookmarks={items.length > 0}
          actions={active ? actionsFor(active) : []}
          onOpen={() => openConversation(active)}
          onEdit={() => openEditor(active)}
          onRemove={() => askRemove([active])}
          onTag={tag => filter('tag', tag)}
          onClose={closeInspector}
        />
      </div>

      {editor !== undefined && (
        <BookmarkEditor
          api={api}
          entry={editor}
          restoreFocus={restoreFocus}
          close={() => setEditor(undefined)}
          onSaved={saved => {
            setEditor(undefined);
            if (signals) signals.changes.set((signals.changes.get() || 0) + 1); else setRefresh(n => n + 1);
            say(editor ? 'Bookmark updated.' : 'Bookmark saved.');
            inspect(saved);
          }}
        />
      )}
      {showSettings && (
        <Dialog title="Bookmark settings" size="sm" close={() => setShowSettings(false)} restoreFocus={restoreFocus}>
          <BookmarkSettings api={api} />
        </Dialog>
      )}
      {removing && (
        <Confirm
          title={removing.length === 1 ? 'Remove this bookmark?' : `Remove ${removing.length} bookmarks?`}
          description={`${removing.length === 1 ? `“${removing[0].title}” will be removed` : `${removing.length} selected bookmarks will be removed`} from your bookmarks. The original ${removing.length === 1 ? 'conversation is' : 'conversations are'} not changed.`}
          confirmLabel={removing.length === 1 ? 'Remove bookmark' : 'Remove bookmarks'}
          cancelLabel={removing.length === 1 ? 'Keep bookmark' : 'Keep bookmarks'}
          onConfirm={remove}
          close={() => setRemoving(null)}
        />
      )}
    </section>
  );
}
