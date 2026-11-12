import React from 'react';
import { Badge, Button, Checkbox, ContextArea, Icon, IconButton, Menu, Tip } from '@saved/presentation';
import { cx, fullDate, isResponse, isoDate, kindLabel, shortAge, sourceProblem, tagKey } from './lib.js';

/**
 * One bookmark in the list. The title is the real control (keyboard and
 * assistive tech); clicking anywhere else on the row is a pointer shortcut for
 * it. The leading cell shows what kind of bookmark this is and turns into its
 * checkbox on hover, focus, or while a selection is in progress.
 */
export function BookmarkRow({
  entry, active, checked, selecting, selectionFull, showNote, showStatus, activeTag, actions,
  onInspect, onOpen, onCheck, onTag
}) {
  const problem = sourceProblem(entry.source_status);
  const interactive = target => target.closest('button,a,input,[role="checkbox"],[role="menuitem"]');
  const row = (
    <article
      role="listitem"
      className={cx('cb-row', active && 'cb-row-active', checked && 'cb-row-checked', selecting && 'cb-row-selecting')}
      data-entry={entry.id}
      onClick={event => { if (!interactive(event.target)) onInspect(); }}
      onDoubleClick={event => { if (onOpen && !interactive(event.target)) onOpen(); }}
    >
      <div className="cb-row-lead">
        <Tip label={kindLabel(entry) + ' bookmark'}>
          <span className="cb-row-kind"><Icon name={isResponse(entry) ? 'comment' : 'comment-discussion'} /></span>
        </Tip>
        <span className="cb-row-check">
          <Checkbox
            aria-label={`Select bookmark ${entry.title}`}
            checked={checked}
            disabled={selectionFull && !checked}
            onCheckedChange={value => onCheck(value === true)}
          />
        </span>
      </div>
      <div className="cb-row-main">
        <h3 className="cb-row-heading">
          <button type="button" className="cb-row-title" aria-current={active ? 'true' : undefined} onClick={onInspect}>
            {entry.title}
          </button>
        </h3>
        {showNote && entry.note && <p className="cb-row-note">{entry.note}</p>}
        {(entry.tags.length > 0 || (showStatus && problem)) && (
          <div className="cb-row-meta">
            {showStatus && problem && <Badge tone="warn" icon="warning">{problem}</Badge>}
            {entry.tags.map(tag => (
              <Button
                key={tag} variant="chip" size="xs"
                className={cx('cb-tag', tagKey(activeTag) === tagKey(tag) && 'cb-tag-on')}
                aria-label={`Filter tag ${tag}`}
                onClick={() => onTag(tag)}
              >#{tag}</Button>
            ))}
          </div>
        )}
      </div>
      <div className="cb-row-end">
        <Tip label={'Saved ' + fullDate(entry.created)}>
          <time className="cb-row-time" dateTime={isoDate(entry.created)}>{shortAge(entry.created)}</time>
        </Tip>
        <span className="cb-row-menu">
          <Menu trigger={<IconButton icon="kebab-vertical" label={`Actions for ${entry.title}`} size="icon-xs" tip={false} />} items={actions} />
        </span>
      </div>
    </article>
  );
  return <ContextArea items={actions}>{row}</ContextArea>;
}
