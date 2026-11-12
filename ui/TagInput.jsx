import React, { useState } from 'react';
import { Button, Icon } from '@saved/presentation';
import { addTag, tagKey } from './lib.js';

/**
 * Tags as removable chips. Enter adds the typed tag; Backspace on an empty
 * field removes the last one. A comma is an ordinary character, so a tag such
 * as "design, decisions" stays one tag.
 */
export function TagInput({ id, tags, onChange, suggestions = [], disabled }) {
  const [text, setText] = useState('');
  const commit = raw => {
    const next = addTag(tags, raw);
    if (next !== tags) onChange(next);
    setText('');
  };
  const offered = suggestions.filter(tag => !tags.some(existing => tagKey(existing) === tagKey(tag))).slice(0, 6);
  const full = tags.length >= 20;
  return (
    <div className="cb-taginput-wrap">
      <div className="cb-taginput" data-disabled={disabled || undefined} onClick={event => { if (event.target === event.currentTarget) event.currentTarget.querySelector('input')?.focus(); }}>
        {tags.map(tag => (
          <span className="cb-chip" key={tag}>
            #{tag}
            <button type="button" className="cb-chip-remove" aria-label={`Remove tag ${tag}`} disabled={disabled} onClick={() => onChange(tags.filter(item => item !== tag))}>
              <Icon name="close" size="0.7rem" />
            </button>
          </span>
        ))}
        <input
          id={id}
          className="cb-taginput-field"
          aria-label="Tags"
          maxLength={40}
          disabled={disabled || full}
          placeholder={full ? 'Tag limit reached' : tags.length ? 'Add another…' : 'Add a tag and press Enter'}
          value={text}
          onChange={event => setText(event.target.value)}
          onBlur={() => { if (text.trim()) commit(text); }}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
              // Enter belongs to the tag while one is being typed, never to the form.
              if (text.trim()) { event.preventDefault(); commit(text); }
            } else if (event.key === 'Backspace' && !text && tags.length) {
              onChange(tags.slice(0, -1));
            }
          }}
        />
      </div>
      {offered.length > 0 && !full && (
        <div className="cb-suggestions" role="group" aria-label="Suggestions">
          {offered.map(tag => (
            <Button key={tag} variant="text" size="inline" disabled={disabled} aria-label={`Add tag ${tag}`} onClick={() => commit(tag)}>#{tag}</Button>
          ))}
        </div>
      )}
    </div>
  );
}
