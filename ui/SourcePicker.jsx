import React, { useEffect, useRef, useState } from 'react';
import { Button, EmptyState, ErrorNote, Icon, SearchField, Skeleton } from '@saved/presentation';
import { PAGE_SIZE, conversationTitle, cx, errorMessage, fullDate, shortAge, sourceName } from './lib.js';

/** Bounded, searchable chooser data. Results accumulate as "Show more" is used. */
function useSourceList(api, path) {
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ key: '', items: [], hasMore: false, window: null, error: '' });
  const [loading, setLoading] = useState(Boolean(path));
  const key = JSON.stringify([path, query, attempt]);
  useEffect(() => {
    if (!path) return undefined;
    let active = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api(path + '?' + new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset), q: query }));
        if (!active) return;
        setState(previous => ({
          key,
          items: offset && previous.key === key ? [...previous.items, ...data.items.filter(item => !previous.items.some(old => old.id === item.id))] : data.items,
          hasMore: Boolean(data.has_more),
          window: data.window || null,
          error: ''
        }));
      } catch (failure) {
        if (active) setState(previous => ({ ...previous, key, items: previous.key === key ? previous.items : [], hasMore: false, error: errorMessage(failure, 'Could not load choices.') }));
      } finally {
        if (active) setLoading(false);
      }
    }, offset ? 0 : 180);
    return () => { active = false; clearTimeout(timer); };
  }, [api, path, key, offset]);
  const current = state.key === key;
  return {
    query,
    search: value => { setQuery(value.slice(0, 200)); setOffset(0); },
    items: current ? state.items : [],
    hasMore: current && state.hasMore,
    window: current ? state.window : null,
    error: current ? state.error : '',
    loading,
    settled: current && !loading,
    more: () => setOffset(state.items.length),
    retry: () => { setOffset(0); setAttempt(n => n + 1); }
  };
}

// An untitled conversation is recognized by how it started, when the source can say.
const optionTitle = item => (conversationTitle(item) === 'Untitled conversation' && item.preview ? `“${item.preview}”` : conversationTitle(item));

/**
 * A searchable single-choice list of conversations, or of one conversation's
 * assistant responses. Choosing is one click; nothing here saves anything.
 */
export function SourcePicker({ api, path, kind, value, onChoose, autoFocus = false, disabled = false }) {
  const responses = kind === 'response';
  const noun = responses ? 'responses' : 'conversations';
  const list = useSourceList(api, path);
  const listbox = useRef(null);
  const search = useRef(null);
  useEffect(() => { if (autoFocus) search.current?.focus(); }, [autoFocus]);
  const options = () => [...(listbox.current?.querySelectorAll('[role="option"]') || [])];
  const focusOption = index => { const all = options(); all[Math.max(0, Math.min(all.length - 1, index))]?.focus(); };
  const onListKey = event => {
    const all = options(), index = all.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); focusOption(index + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); if (index <= 0) search.current?.focus(); else focusOption(index - 1); }
    else if (event.key === 'Home') { event.preventDefault(); focusOption(0); }
    else if (event.key === 'End') { event.preventDefault(); focusOption(all.length - 1); }
  };
  return (
    <div className="cb-picker">
      <SearchField
        aria-label={`Search ${noun}`}
        placeholder={responses ? 'Find a response…' : 'Find a conversation…'}
        containerClassName="cb-picker-search"
        inputRef={search}
        value={list.query}
        loading={list.loading && list.items.length > 0}
        onChange={list.search}
        onKeyDown={event => {
          // Enter must never submit the surrounding form from a search box.
          if (event.key === 'Enter') { event.preventDefault(); if (list.items.length === 1) onChoose(list.items[0]); }
          if (event.key === 'ArrowDown') { event.preventDefault(); focusOption(0); }
        }}
      />
      <div ref={listbox} role="listbox" aria-label={responses ? 'Assistant responses' : 'Conversations'} aria-busy={list.loading || undefined} className="cb-options" onKeyDown={onListKey}>
        {list.error ? (
          <ErrorNote action={<Button variant="text" size="inline" onClick={list.retry}>Retry {noun}</Button>}>{list.error}</ErrorNote>
        ) : !list.settled && !list.items.length ? (
          Array.from({ length: 4 }, (_, index) => <div className="cb-option cb-option-skeleton" key={index} aria-hidden="true"><Skeleton className="cb-skeleton-title" /></div>)
        ) : !list.items.length ? (
          <EmptyState compact title={list.query ? 'No matches' : responses ? 'No assistant responses yet' : 'No conversations yet'} description={list.query ? 'Try fewer or different words.' : responses ? 'You can still bookmark the whole conversation.' : 'Start a conversation, then come back to bookmark it.'} />
        ) : (
          <>
            {list.items.map(item => {
              const selected = value != null && String(item.id) === String(value);
              const time = responses ? item.created_at : item.updated_at;
              return (
                <button
                  key={item.id} type="button" role="option" aria-selected={selected} disabled={disabled}
                  className={cx('cb-option', selected && 'cb-option-on', responses && 'cb-option-response')}
                  onClick={() => onChoose(item)}
                >
                  <span className="cb-option-text">{responses ? item.preview || 'Assistant response' : optionTitle(item)}</span>
                  <span className="cb-option-meta">
                    {!responses && item.source && <span>{sourceName(item.source)}</span>}
                    {time != null && <time title={fullDate(time)}>{shortAge(time)}</time>}
                    {selected && <Icon name="check" size="0.8rem" />}
                  </span>
                </button>
              );
            })}
            {list.hasMore && <Button variant="ghost" size="sm" className="cb-options-more" loading={list.loading} onClick={list.more}>Show more {noun}</Button>}
          </>
        )}
      </div>
      {list.window?.truncated && <p className="cb-faint cb-picker-note">Showing your {list.window.limit.toLocaleString()} most recent {noun}. {responses ? 'Older ones are not listed.' : 'Search to reach older ones.'}</p>}
    </div>
  );
}
