import React, { useEffect, useId, useRef, useState } from 'react';
import { Button, Dialog, DialogFooter, ErrorNote, Icon, Input, Kbd, Menu, Segmented, Textarea, Tip } from '@saved/presentation';
import { SourcePicker } from './SourcePicker.jsx';
import { TagInput } from './TagInput.jsx';
import { CONTEXT_PRESETS, DEFAULT_CONTEXT, addTag, conversationTitle, errorMessage, fullDate, modKey, sourceName } from './lib.js';

const SCOPES = [
  { id: 'conversation', label: 'Whole conversation' },
  { id: 'response', label: 'One response' }
];
const blank = preset => ({ title: preset?.title || '', note: '', tags: [], session_id: preset?.session_id || '', message_id: null });
const fields = ['title', 'note', 'tags', 'session_id', 'message_id'];

function Field({ id, label, hint, aside, children }) {
  return (
    <div className="cb-field">
      <div className="cb-field-head">
        <label htmlFor={id} className="cb-label">{label}</label>
        {hint && <span className="cb-faint">{hint}</span>}
        {aside && <span className="cb-field-aside">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * Create or edit one bookmark: choose what it points at, then say why it
 * matters. Saving is always an explicit action; drafting details with AI only
 * fills the form.
 *
 * `preset` ({session_id, title?}) starts a new bookmark on a known conversation.
 */
export function BookmarkEditor({ api, entry, preset, restoreFocus, close, onSaved }) {
  const ids = { title: useId(), note: useId(), tags: useId() };
  const editing = Boolean(entry);
  const [draft, setDraft] = useState(() => (entry ? Object.fromEntries(fields.map(key => [key, entry[key]])) : blank(preset)));
  const [conversation, setConversation] = useState(null); // {title, source, updated_at} for the chosen source, when known
  const [response, setResponse] = useState(null); // {preview, created_at} for the chosen response, when known
  const [choosing, setChoosing] = useState(!draft.session_id);
  const [scope, setScope] = useState(draft.message_id != null ? 'response' : 'conversation');
  const [suggestions, setSuggestions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [previous, setPrevious] = useState(DEFAULT_CONTEXT);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsAttempt, setSettingsAttempt] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [generationNotice, setGenerationNotice] = useState('');

  // `life` fences everything against unmount; `edits` fences a late AI draft
  // against anything the person changed while it was being written.
  const life = useRef(0), edits = useRef(0), working = useRef(false), settingVersion = useRef(0), savedPrevious = useRef(null);
  const autoTitle = useRef(preset?.title || '');
  const titleInput = useRef(null);

  useEffect(() => {
    const token = ++life.current;
    return () => { if (token === life.current) { life.current++; edits.current++; } };
  }, []);

  // Label an existing or preset source without ever asking for an ID.
  useEffect(() => {
    let active = true;
    if (entry) {
      api(`/entries/${entry.id}/context`).then(context => {
        if (!active) return;
        if (context.conversation) setConversation(context.conversation);
        if (context.response) setResponse({ preview: context.response.excerpt, created_at: context.response.created_at });
      }).catch(() => {});
    } else if (preset?.session_id) {
      api('/sources/sessions?' + new URLSearchParams({ q: preset.session_id, limit: '30', offset: '0' })).then(result => {
        const match = result.items.find(item => item.id === preset.session_id);
        if (!active || !match) return;
        setConversation(match);
        setDraft(current => {
          if (current.title.trim()) return current;
          autoTitle.current = conversationTitle(match);
          return { ...current, title: autoTitle.current };
        });
      }).catch(() => {});
    }
    api('/tags?limit=12').then(result => { if (active) setSuggestions((result.items || []).map(item => item.tag)); }).catch(() => {});
    return () => { active = false; };
  }, [api, entry, preset]);

  useEffect(() => {
    if (editing) return undefined;
    const token = life.current;
    setSettingsReady(false);
    api('/generation/settings').then(data => {
      if (token !== life.current) return;
      savedPrevious.current = data.previous_exchanges;
      setPrevious(CONTEXT_PRESETS.includes(data.previous_exchanges) ? data.previous_exchanges : DEFAULT_CONTEXT);
      setSettingsReady(true); setSettingsError('');
    }).catch(failure => { if (token === life.current) setSettingsError(errorMessage(failure, 'Could not load the context setting.')); });
    return undefined;
  }, [api, editing, settingsAttempt]);

  const touch = () => { edits.current++; setGenerationNotice(''); setGenerationError(''); };
  const change = (key, value) => { touch(); setDraft(current => ({ ...current, [key]: value })); };

  function chooseConversation(item) {
    touch();
    const title = conversationTitle(item);
    setDraft(current => {
      const replaceTitle = !current.title.trim() || current.title === autoTitle.current;
      if (replaceTitle) autoTitle.current = title;
      return { ...current, session_id: item.id, message_id: null, title: replaceTitle ? title : current.title };
    });
    setConversation(item); setResponse(null); setScope('conversation'); setChoosing(false);
    requestAnimationFrame(() => titleInput.current?.focus());
  }
  function chooseScope(next) {
    setScope(next);
    if (next === 'conversation' && draft.message_id != null) { change('message_id', null); setResponse(null); }
  }
  function chooseResponse(item) {
    change('message_id', Number(item.id));
    setResponse(item);
  }

  async function persistPrevious(value = previous) {
    if (!settingsReady) return false;
    if (value === savedPrevious.current) { setSettingsError(''); return true; }
    const token = life.current, version = ++settingVersion.current;
    const current = () => token === life.current && version === settingVersion.current;
    setSettingsBusy(true); setSettingsError('');
    try {
      const data = await api('/generation/settings', { method: 'PUT', body: { previous_exchanges: value } });
      if (current()) savedPrevious.current = data.previous_exchanges;
      return current();
    } catch (failure) {
      if (current()) setSettingsError(errorMessage(failure, 'Could not save the context setting.'));
      return false;
    } finally {
      if (current()) setSettingsBusy(false);
    }
  }

  const canGenerate = !editing && draft.message_id != null && settingsReady && !settingsBusy && !settingsError && !busy;
  async function generate() {
    if (working.current || !canGenerate) return;
    working.current = true; setGenerating(true); setGenerationError(''); setGenerationNotice('');
    const token = life.current, version = edits.current;
    const current = () => token === life.current;
    try {
      if (!await persistPrevious() || !current() || version !== edits.current) return;
      const data = await api('/generation/draft', { method: 'POST', body: { session_id: draft.session_id, message_id: draft.message_id } });
      if (!current()) return;
      if (version !== edits.current) { setGenerationNotice('You kept editing, so the draft was not applied.'); return; }
      autoTitle.current = '';
      setDraft(now => ({ ...now, title: data.draft.title, note: data.draft.note, tags: data.draft.tags.reduce(addTag, []) }));
      setGenerationNotice(`Draft ready to review.${data.context?.truncated ? ' Earlier context was shortened.' : ''}`);
    } catch (failure) {
      if (current()) setGenerationError(errorMessage(failure, 'Could not draft details. Try again when ready.'));
    } finally {
      working.current = false;
      if (current()) setGenerating(false);
    }
  }

  const valid = Boolean(draft.session_id && draft.title.trim()) && !(scope === 'response' && draft.message_id == null);
  async function submit(event) {
    event?.preventDefault();
    if (busy || !valid) return;
    touch();
    const token = life.current;
    setBusy(true); setError('');
    try {
      const body = { ...Object.fromEntries(fields.map(key => [key, draft[key]])), title: draft.title.trim() };
      if (editing) body.revision = entry.revision;
      const saved = await api(editing ? `/entries/${entry.id}` : '/entries', { method: editing ? 'PUT' : 'POST', body });
      // A save already sent may land after this editor is gone; ask for nothing more.
      if (token !== life.current) return;
      // Read back what the store holds before telling anyone it was saved.
      const stored = await api(`/entries/${saved.id}`);
      if (token === life.current) onSaved(stored);
    } catch (failure) {
      if (token === life.current) { setError(errorMessage(failure)); setBusy(false); }
    }
  }

  const sourceMissing = editing && entry.source_status !== 'available';
  const sourceTitle = conversation ? conversationTitle({ ...conversation, id: draft.session_id }) : editing ? 'Saved conversation' : 'Selected conversation';
  const draftHint = editing ? '' : draft.message_id == null ? 'Choose one response to draft its details with AI' : settingsError ? 'The context setting needs attention first' : '';

  return (
    <Dialog
      size="lg"
      title={editing ? 'Edit bookmark' : 'New bookmark'}
      description={editing ? null : 'Point at a conversation or one response, then note why it matters.'}
      busy={busy}
      close={close}
      restoreFocus={restoreFocus}
      initialFocus={choosing ? undefined : event => { event.preventDefault(); titleInput.current?.focus(); }}
    >
      <form className="cb-form" onSubmit={submit} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event); }}>
        <section className="cb-form-section" aria-label="Source">
          {choosing ? (
            <>
              <div className="cb-field-head">
                <span className="cb-label">Conversation</span>
                {draft.session_id && <span className="cb-field-aside"><Button variant="text" size="inline" onClick={() => setChoosing(false)}>Keep current</Button></span>}
              </div>
              <SourcePicker api={api} path="/sources/sessions" kind="conversation" value={draft.session_id} onChoose={chooseConversation} autoFocus disabled={busy} />
            </>
          ) : (
            <>
              <div className="cb-source-card">
                <Icon name="comment-discussion" className="cb-source-card-icon" />
                <div className="cb-source-card-text">
                  <span className="cb-source-card-title">{sourceTitle}</span>
                  <span className="cb-faint">
                    {sourceMissing ? 'No longer available · the saved reference is kept' : [conversation?.source && sourceName(conversation.source), conversation?.updated_at != null && fullDate(conversation.updated_at)].filter(Boolean).join(' · ') || 'Conversation'}
                  </span>
                </div>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setChoosing(true)}>Change conversation</Button>
              </div>
              <div className="cb-scope">
                <span className="cb-label" id={ids.title + 'scope'}>Bookmark</span>
                <Segmented label="What to bookmark" options={SCOPES} value={scope} onChange={chooseScope} disabled={busy} />
              </div>
              {scope === 'response' && (
                sourceMissing && draft.message_id != null && !response ? (
                  <p className="cb-faint">The saved response reference is kept. Choose another conversation to point this bookmark somewhere else.</p>
                ) : (
                  <SourcePicker
                    key={draft.session_id}
                    api={api}
                    path={`/sources/sessions/${encodeURIComponent(draft.session_id)}/responses`}
                    kind="response"
                    value={draft.message_id}
                    onChoose={chooseResponse}
                    disabled={busy}
                  />
                )
              )}
            </>
          )}
        </section>

        {!choosing && (
          <section className="cb-form-section" aria-label="Details">
            <Field
              id={ids.title}
              label="Title"
              aside={!editing && (
                <span className="cb-draft">
                  <Tip label={draftHint}>
                    <span className="cb-draft-anchor" tabIndex={canGenerate || generating ? undefined : 0} aria-label={canGenerate || generating ? undefined : draftHint || 'Draft with AI unavailable'}>
                      <Button variant="ghost" size="sm" icon="sparkle" loading={generating} disabled={!canGenerate} onClick={generate}>Draft with AI</Button>
                    </span>
                  </Tip>
                  <Menu
                    trigger={<Button variant="ghost" size="sm" aria-label={`Context: ${previous} previous exchanges`} disabled={!settingsReady || settingsBusy || generating}>{previous}<Icon name="chevron-down" size="0.7rem" /></Button>}
                    items={CONTEXT_PRESETS.map(value => ({ label: `${value} previous exchanges`, checked: value === previous, onSelect: () => { touch(); setPrevious(value); void persistPrevious(value); } }))}
                  />
                </span>
              )}
            >
              <Input id={ids.title} ref={titleInput} required maxLength={160} placeholder="What you will look for later" value={draft.title} disabled={busy} onChange={event => { autoTitle.current = ''; change('title', event.target.value); }} />
            </Field>
            {(generating || generationNotice || generationError || settingsError) && (
              <div className="cb-draft-status">
                {generating && <p role="status" className="cb-faint">Drafting from the selected response… You can keep editing.</p>}
                {generationNotice && <p role="status" className="cb-faint"><Icon name="sparkle" size="0.75rem" /> {generationNotice}</p>}
                {generationError && <ErrorNote action={<Button variant="text" size="inline" onClick={generate}>Try again</Button>}>{generationError}</ErrorNote>}
                {settingsError && <ErrorNote action={<Button variant="text" size="inline" onClick={() => (settingsReady ? persistPrevious() : setSettingsAttempt(n => n + 1))}>Retry context setting</Button>}>{settingsError}</ErrorNote>}
              </div>
            )}
            <Field id={ids.note} label="Note" hint="Optional">
              <Textarea id={ids.note} rows={4} maxLength={4000} placeholder="The detail you do not want to reconstruct next time" value={draft.note} disabled={busy} onChange={event => change('note', event.target.value)} />
            </Field>
            <Field id={ids.tags} label="Tags" hint="Optional">
              <TagInput id={ids.tags} tags={draft.tags} suggestions={suggestions} disabled={busy} onChange={tags => change('tags', tags)} />
            </Field>
          </section>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}
        <DialogFooter className="cb-form-footer">
          <span className="cb-faint cb-form-hint"><Kbd>{modKey()}</Kbd><Kbd>↵</Kbd> to save</span>
          <Button variant="ghost" disabled={busy} onClick={close}>Cancel</Button>
          <Button variant="default" type="submit" loading={busy} disabled={busy || !valid || choosing}>{editing ? 'Save changes' : 'Save bookmark'}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
