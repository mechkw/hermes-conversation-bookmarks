import React, { useState } from 'react';
import { Badge, Button, CopyButton, EmptyState, ErrorNote, Icon, IconButton, Kbd, Menu, Skeleton } from '@saved/presentation';
import { conversationTitle, fullDate, isResponse, isoDate, resumeCommand, sourceName, sourceProblem } from './lib.js';

function Reference({ label, value }) {
  return (
    <div className="cb-ref">
      <dt>{label}</dt>
      <dd><code>{value}</code><CopyButton text={String(value)} label={`Copy ${label.toLowerCase()}`} /></dd>
    </div>
  );
}

/** Adjacent detail pane. Reads only; every change goes through an explicit action. */
export function BookmarkInspector({
  entry, context, profile, error, opening, canOpen, hasBookmarks, actions,
  onOpen, onEdit, onRemove, onTag, onClose
}) {
  const [showReference, setShowReference] = useState(false);
  if (!entry) {
    return (
      <aside className="cb-inspector cb-inspector-empty" aria-label="Bookmark details">
        <EmptyState compact icon="bookmark" title="Select a bookmark" description={hasBookmarks ? 'Its note, tags and the way back to the conversation appear here.' : 'Your saved moments will appear here.'} />
        {hasBookmarks && (
          <dl className="cb-keys" aria-label="Keyboard shortcuts">
            <div><dt><Kbd>↑</Kbd><Kbd>↓</Kbd></dt><dd>Browse</dd></div>
            <div><dt><Kbd>/</Kbd></dt><dd>Search</dd></div>
            <div><dt><Kbd>N</Kbd></dt><dd>New bookmark</dd></div>
            {canOpen && <div><dt><Kbd>O</Kbd></dt><dd>Open conversation</dd></div>}
            <div><dt><Kbd>E</Kbd></dt><dd>Edit</dd></div>
          </dl>
        )}
      </aside>
    );
  }
  const problem = sourceProblem(entry.source_status);
  const response = isResponse(entry);
  const conversation = context?.conversation;
  const edited = entry.updated - entry.created > 1;
  const secondary = actions.filter(item => item.separator || !['Open conversation', 'Edit bookmark'].includes(item.label));
  const menu = secondary.filter((item, index, list) => !(item.separator && (index === 0 || list[index - 1]?.separator)));
  return (
    <aside className="cb-inspector" aria-label="Bookmark details">
      <header className="cb-inspector-head">
        <IconButton icon="arrow-left" label="Back to bookmarks" className="cb-inspector-back" onClick={onClose} />
        <span className="cb-eyebrow">
          <Icon name={response ? 'comment' : 'comment-discussion'} size="0.75rem" />
          {response ? 'Response bookmark' : 'Conversation bookmark'}
        </span>
        <span className="cb-spacer" />
        <Menu trigger={<IconButton icon="ellipsis" label="More actions" size="icon-xs" />} items={menu} />
        <IconButton icon="close" label="Close details" size="icon-xs" className="cb-inspector-close" onClick={onClose} />
      </header>

      <div className="cb-inspector-body">
        <h2 className="cb-inspector-title">{entry.title}</h2>
        <p className="cb-inspector-dates">
          Saved <time dateTime={isoDate(entry.created)}>{fullDate(entry.created)}</time>
          {edited && <> · edited <time dateTime={isoDate(entry.updated)}>{fullDate(entry.updated)}</time></>}
        </p>

        <div className="cb-inspector-actions">
          {canOpen && (
            <Button variant="default" icon="link-external" loading={opening} disabled={Boolean(problem)} onClick={onOpen}>Open conversation</Button>
          )}
          <Button icon="edit" onClick={onEdit}>Edit bookmark</Button>
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}
        {problem && (
          <div className="cb-callout" role="status">
            <Icon name="warning" />
            <div>
              <strong>{problem}</strong>
              <p>It may have been pruned or removed. Your title, note and tags are kept, and the reference below still records where this came from.</p>
            </div>
          </div>
        )}

        <section className="cb-section" aria-label="Note">
          <h3 className="cb-label">Note</h3>
          {entry.note ? <p className="cb-note">{entry.note}</p> : (
            <p className="cb-faint">No note yet. <Button variant="text" size="inline" onClick={onEdit}>Add one</Button></p>
          )}
        </section>

        {entry.tags.length > 0 && (
          <section className="cb-section" aria-label="Tags">
            <h3 className="cb-label">Tags</h3>
            <div className="cb-tags">
              {entry.tags.map(tag => (
                <Button key={tag} variant="chip" size="xs" className="cb-tag" aria-label={`Show bookmarks tagged ${tag}`} onClick={() => onTag(tag)}>#{tag}</Button>
              ))}
            </div>
          </section>
        )}

        {!problem && (
          <section className="cb-section" aria-label="Source">
            <h3 className="cb-label">{response ? 'Saved response' : 'Conversation'}</h3>
            {!context ? (
              <div className="cb-source-loading"><Skeleton className="cb-skeleton-title" /><Skeleton className="cb-skeleton-note" /></div>
            ) : (
              <>
                {response && context.response?.excerpt && <blockquote className="cb-excerpt">{context.response.excerpt}</blockquote>}
                {conversation ? (
                  <p className="cb-source-line">
                    <Icon name="comment-discussion" size="0.8rem" />
                    <span className="cb-source-title">{conversationTitle({ ...conversation, id: entry.session_id })}</span>
                    {conversation.source && <Badge tone="outline">{sourceName(conversation.source)}</Badge>}
                  </p>
                ) : (
                  <p className="cb-faint">{response && context.response?.excerpt ? '' : 'A preview is not available for this source.'}</p>
                )}
                {response && <p className="cb-faint">Opening returns to the conversation, not to this exact response.</p>}
              </>
            )}
          </section>
        )}

        <section className="cb-section cb-reference" aria-label="Reference">
          <button type="button" className="cb-disclosure" aria-expanded={showReference} onClick={() => setShowReference(open => !open)}>
            <Icon name={showReference ? 'chevron-down' : 'chevron-right'} size="0.75rem" />Reference
          </button>
          {showReference && (
            <>
              <dl className="cb-refs">
                <Reference label="Conversation ID" value={entry.session_id} />
                {response && <Reference label="Response ID" value={entry.message_id} />}
                <Reference label="Resume command" value={resumeCommand(entry.session_id, profile)} />
              </dl>
              <p className="cb-faint">Run the command on the Hermes host that owns this profile.</p>
            </>
          )}
        </section>
      </div>
    </aside>
  );
}
