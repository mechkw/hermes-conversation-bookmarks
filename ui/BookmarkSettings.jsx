import React, { useEffect, useRef, useState } from 'react';
import { Button, ErrorNote, SettingToggle, Skeleton } from '@saved/presentation';
import { errorMessage } from './lib.js';

const OPTIONS = [
  ['show_notes', 'Show notes in list', 'Preview the first lines of each note under its title.'],
  ['show_source_status', 'Show source status in list', 'Flag bookmarks whose conversation or response is no longer available.']
];

/** Profile-local display preferences. Each switch saves on change. */
export function BookmarkSettings({ api }) {
  const [value, setValue] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const life = useRef(0), working = useRef(false);
  useEffect(() => {
    const token = ++life.current;
    api('/settings')
      .then(data => { if (token === life.current) { setValue(data); setError(''); } })
      .catch(failure => { if (token === life.current) setError(errorMessage(failure, 'Could not load settings.')); });
    return () => { life.current++; };
  }, [api, attempt]);
  async function change(key, checked) {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    const token = life.current;
    try {
      const saved = await api('/settings', { method: 'PUT', body: { ...value, [key]: checked } });
      if (token === life.current) setValue(saved);
    } catch (failure) {
      if (token === life.current) setError(errorMessage(failure, 'Could not save settings.'));
    } finally {
      working.current = false;
      if (token === life.current) setBusy(false);
    }
  }
  return (
    <section className="cb-settings" aria-label="Bookmark display preferences">
      {!value && !error && <div className="cb-settings-loading"><Skeleton className="cb-skeleton-title" /><Skeleton className="cb-skeleton-title" /></div>}
      {value && OPTIONS.map(([key, label, description]) => (
        <SettingToggle key={key} label={label} description={description} checked={Boolean(value[key])} disabled={busy} onChange={checked => change(key, checked)} />
      ))}
      {error && <ErrorNote action={<Button variant="text" size="inline" onClick={() => setAttempt(n => n + 1)}>Retry settings</Button>}>{error}</ErrorNote>}
      <p className="cb-faint cb-settings-note">Bookmarks are saved for this profile only. They keep a reference and your notes, never a copy of the conversation.</p>
    </section>
  );
}
