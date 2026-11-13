import React, { useEffect, useRef, useState } from 'react';
import { Badge, Button, Dialog, EmptyState, ErrorNote, Icon, Kbd, SearchField, Skeleton, Tip } from '@saved/presentation';
import { chatReference, cx, errorMessage, isResponse, modKey, shortAge, sourceProblem } from './lib.js';

/**
 * Find a bookmark without leaving the chat: type, arrow, Enter. Enter (or a
 * click on the row) mentions the bookmark in the message being written; the
 * modifier goes to its conversation. Each row also carries both as buttons.
 * Saving the current conversation is one more row at the bottom.
 */
export function QuickBookmarks({ api, close, onBrowse, onSaveCurrent }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [working, setWorking] = useState(false);
  const serial = useRef(0), alive = useRef(true), list = useRef(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const ticket = ++serial.current;
    const timer = setTimeout(async () => {
      try {
        const data = await api('/entries?' + new URLSearchParams({ q: query, sort: 'newest', limit: '8', offset: '0' }));
        if (alive.current && ticket === serial.current) { setResult(data); setIndex(0); setError(''); }
      } catch (failure) {
        if (alive.current && ticket === serial.current) setError(errorMessage(failure));
      }
    }, query ? 160 : 0);
    return () => clearTimeout(timer);
  }, [api, query]);
  const items = result?.items || [];
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [index]);

  async function open(entry) {
    if (working) return;
    setWorking(true); setError('');
    try {
      const fresh = await api(`/entries/${entry.id}`);
      if (fresh.source_status !== 'available') throw new Error('This conversation is no longer available. Your bookmark is still saved.');
      await api.openSession(fresh.session_id);
      if (alive.current) close();
    } catch (failure) {
      if (alive.current) { setError(errorMessage(failure)); setWorking(false); }
    }
  }
  async function mention(entry) {
    if (!api.insertText) return;
    if (await api.insertText(chatReference(entry))) { api.notify?.('Added to your message.'); close(); }
    else if (alive.current) setError('Open a chat to mention this bookmark.');
  }
  // Mentioning is the default wherever there is a message to write into.
  const primary = entry => (api.insertText ? mention(entry) : api.openSession ? open(entry) : undefined);
  const onKeyDown = event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(n => Math.min(items.length - 1, n + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(n => Math.max(0, n - 1)); }
    else if (event.key === 'Enter' && items[index]) {
      event.preventDefault();
      if ((event.metaKey || event.ctrlKey) && api.openSession) open(items[index]); else primary(items[index]);
    }
  };
  return (
    <Dialog label="Find a bookmark" size="md" close={close}>
      <div className="cb cb-quick" onKeyDown={onKeyDown}>
        <SearchField aria-label="Find a bookmark" placeholder="Find a bookmark…" variant="box" value={query} loading={working} onChange={value => setQuery(value.slice(0, 200))} />
        <div ref={list} role="listbox" aria-label="Bookmarks" className="cb-quick-list">
          {error && <ErrorNote>{error}</ErrorNote>}
          {!result && !error ? (
            Array.from({ length: 4 }, (_, n) => <div className="cb-option cb-option-skeleton" key={n} aria-hidden="true"><Skeleton className="cb-skeleton-title" /></div>)
          ) : !items.length && !error ? (
            <EmptyState compact title={query ? 'No matching bookmarks' : 'No bookmarks yet'} description={query ? 'Search covers titles, notes and tags.' : 'Bookmark this conversation to find it here later.'} />
          ) : items.map((entry, n) => {
            const problem = sourceProblem(entry.source_status);
            return (
              <div
                key={entry.id} role="option" aria-selected={n === index}
                className={cx('cb-option cb-quick-option', n === index && 'cb-option-on')}
                onMouseMove={() => setIndex(n)}
                onClick={() => primary(entry)}
              >
                <Icon name={isResponse(entry) ? 'comment' : 'comment-discussion'} className="cb-quick-icon" />
                <span className="cb-option-text">
                  <span className="cb-quick-title">{entry.title}</span>
                  {entry.note && <span className="cb-quick-note">{entry.note}</span>}
                </span>
                <span className="cb-option-meta">
                  {problem && <Badge tone="warn">Unavailable</Badge>}
                  <time>{shortAge(entry.created)}</time>
                </span>
                <span className="cb-quick-actions" onClick={event => event.stopPropagation()}>
                  {api.openSession && (
                    <Tip label={problem ? 'This conversation is no longer available' : 'Go to this conversation'}>
                      <Button variant="ghost" size="xs" icon="arrow-right" aria-label="Go to" disabled={working || Boolean(problem)} onClick={() => open(entry)}>
                        <span className="cb-quick-action-text">Go to</span>
                      </Button>
                    </Tip>
                  )}
                  {api.insertText && (
                    <Tip label="Mention this bookmark in your message">
                      <Button variant="ghost" size="xs" icon="mention" aria-label="Mention" disabled={working} onClick={() => mention(entry)}>
                        <span className="cb-quick-action-text">Mention</span>
                      </Button>
                    </Tip>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <footer className="cb-quick-foot">
          {onSaveCurrent && <Button variant="ghost" size="sm" icon="add" onClick={onSaveCurrent}>Bookmark this conversation</Button>}
          <Button variant="ghost" size="sm" icon="bookmark" onClick={onBrowse}>All bookmarks</Button>
          {items.length > 0 && (
            <span className="cb-faint cb-quick-keys">
              {api.insertText && <span className="cb-quick-key"><Kbd>↵</Kbd> Mention</span>}
              {api.openSession && <span className="cb-quick-key">{api.insertText && <Kbd>{modKey()}</Kbd>}<Kbd>↵</Kbd> Go to</span>}
            </span>
          )}
        </footer>
      </div>
    </Dialog>
  );
}
