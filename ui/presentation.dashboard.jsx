// Web Dashboard adapter. The Dashboard SDK exposes a smaller component set than
// Desktop, so this file uses what it provides (buttons, inputs, dialogs, tabs,
// badges) and supplies plain, token-styled stand-ins for the rest. It never
// reaches into the Desktop SDK and never bundles a second UI runtime.
import React, { useEffect, useId, useRef, useState } from 'react';
import { cx } from './lib.js';

const SDK = window.__HERMES_PLUGIN_SDK__;
const C = SDK.components;

export const supports = { contextMenu: false };
export const Input = C.Input;
export const DialogFooter = C.DialogFooter;

const GLYPHS = {
  add: '+', refresh: '↻', 'settings-gear': '⚙', close: '×', copy: '⧉', 'kebab-vertical': '⋮', ellipsis: '⋯', edit: '✎', trash: '🗑',
  'link-external': '↗', 'arrow-left': '←', 'arrow-swap': '⇅', check: '✓', 'chevron-down': '▾', 'chevron-right': '▸', warning: '⚠',
  bookmark: '❏', comment: '❝', 'comment-discussion': '❞', search: '⌕', sparkle: '✦', terminal: '›_', mention: '@'
};

export function Icon({ name, className }) {
  return <span aria-hidden="true" className={cx('cbd-icon', className)}>{GLYPHS[name] || '•'}</span>;
}

export function Tip({ label, children }) {
  return label && React.isValidElement(children) && !children.props.title ? React.cloneElement(children, { title: label }) : children;
}

export function Button({ variant = 'secondary', type = 'button', size, loading, disabled, icon, className, children, ...props }) {
  const quiet = ['ghost', 'text', 'chip', 'link'].includes(variant);
  return (
    <C.Button
      {...props}
      type={type}
      size="sm"
      className={cx(variant === 'chip' && 'cbd-chip', variant === 'text' && 'cbd-text', size === 'inline' && 'cbd-inline', className)}
      destructive={variant === 'destructive'}
      ghost={quiet}
      outlined={variant === 'secondary'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {icon && <Icon name={icon} />}
      {children}
    </C.Button>
  );
}

export function IconButton({ icon, label, variant, size, tip, spinning, ...props }) {
  return <Button variant="ghost" aria-label={label} title={label} className="cbd-iconbutton" {...props}><Icon name={icon} /></Button>;
}

export function Checkbox({ checked, onCheckedChange, ...props }) {
  return <input type="checkbox" className="cbd-check" checked={Boolean(checked)} onChange={event => onCheckedChange(event.target.checked)} {...props} />;
}

export function Switch({ checked, onCheckedChange, ...props }) {
  return <input type="checkbox" role="switch" className="cbd-check" checked={Boolean(checked)} onChange={event => onCheckedChange(event.target.checked)} {...props} />;
}

export function Textarea(props) {
  return <textarea className="cbd-textarea" {...props} />;
}

export function SearchField({ value, onChange, placeholder, 'aria-label': label, onKeyDown, inputRef, containerClassName }) {
  return (
    <div className={cx('cbd-search', containerClassName)}>
      <C.Input ref={inputRef} type="search" aria-label={label || placeholder} placeholder={placeholder} value={value} onKeyDown={onKeyDown} onChange={event => onChange(event.target.value)} />
    </div>
  );
}

export function Badge({ tone = 'neutral', icon, children }) {
  return <span className={cx('cbd-badge', 'cbd-badge-' + tone)}>{icon && <Icon name={icon} />}{children}</span>;
}

export function Kbd({ children }) {
  return <kbd className="cbd-kbd">{children}</kbd>;
}

export function Skeleton({ className }) {
  return <div className={cx('cbd-skeleton', className)} />;
}

export function Loader({ label = 'Loading' }) {
  return <p role="status" className="cb-faint">{label}…</p>;
}

export function Segmented({ label, options, value, onChange, disabled }) {
  return (
    <div role="group" aria-label={label} className="cb-segmented cbd-segmented">
      {options.map(option => (
        <button key={option.id} type="button" aria-pressed={value === option.id} disabled={disabled} className={cx('cbd-segment', value === option.id && 'cbd-segment-on')} onClick={() => onChange(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Minimal menu button: Escape and outside clicks close it; arrows move between items. */
export function Menu({ trigger, items, align = 'end' }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null), id = useId();
  useEffect(() => {
    if (!open) return undefined;
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    root.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const onKeyDown = event => {
    if (!open) return;
    const all = [...root.current.querySelectorAll('[role="menuitem"]:not(:disabled)')], index = all.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); root.current.querySelector('[aria-haspopup]')?.focus(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); all[(index + 1) % all.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); all[(index + all.length - 1) % all.length]?.focus(); }
  };
  return (
    <span ref={root} className="cbd-menu-anchor" onKeyDown={onKeyDown}>
      {React.cloneElement(trigger, { 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? id : undefined, onClick: () => setOpen(value => !value) })}
      {open && (
        <div id={id} role="menu" className={cx('cb-menu cbd-menu', align === 'start' && 'cbd-menu-start')}>
          {items.filter(Boolean).map((item, index) => item.separator ? <hr key={'separator' + index} className="cbd-menu-separator" /> : (
            <button key={item.label} type="button" role="menuitem" disabled={item.disabled} className={cx('cbd-menu-item', item.destructive && 'cbd-menu-danger')} onClick={() => { setOpen(false); item.onSelect(); }}>
              <span className="cb-menu-label">{item.label}</span>
              {item.checked && <Icon name="check" className="cb-menu-check" />}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/** The Dashboard has no context-menu primitive; rows keep their visible menu button. */
export function ContextArea({ children }) {
  return children;
}

export function CopyButton({ text, label, children }) {
  const [state, setState] = useState('idle');
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setState('copied'); }
    catch { setState('failed'); }
    setTimeout(() => setState('idle'), 1500);
  };
  const shown = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label;
  return children
    ? <Button onClick={copy}>{state === 'idle' ? children : shown}</Button>
    : <Button variant="ghost" className="cbd-iconbutton" aria-label={shown} title={shown} onClick={copy}><Icon name={state === 'copied' ? 'check' : 'copy'} /></Button>;
}

const DIALOG_SIZES = { sm: 'cb-dialog cb-dialog-sm cbd-dialog', md: 'cb-dialog cbd-dialog', lg: 'cb-dialog cb-dialog-lg cbd-dialog' };

export function Dialog({ title, description, size = 'md', children, close, busy = false, restoreFocus, initialFocus, label }) {
  return (
    <C.Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
      <C.DialogContent
        className={DIALOG_SIZES[size]}
        showCloseButton={!busy}
        onCloseAutoFocus={restoreFocus}
        onOpenAutoFocus={initialFocus}
        onEscapeKeyDown={event => { if (event.target.closest?.('[role="dialog"]')?.querySelector('[role="menu"]')) event.preventDefault(); }}
      >
        <C.DialogHeader>
          <C.DialogTitle className={title ? undefined : 'cb-sr-only'}>{title || label}</C.DialogTitle>
          {description && <C.DialogDescription>{description}</C.DialogDescription>}
        </C.DialogHeader>
        <div className="cbd-dialog-body">{children}</div>
      </C.DialogContent>
    </C.Dialog>
  );
}

export function Confirm({ title, description, confirmLabel, cancelLabel, onConfirm, close }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const run = async () => {
    setBusy(true); setError('');
    try { await onConfirm(); if (alive.current) close(); }
    catch (failure) { if (alive.current) { setError(failure?.message || 'The request failed.'); setBusy(false); } }
  };
  return (
    <Dialog title={title} description={description} size="sm" busy={busy} close={close}>
      {error && <ErrorNote>{error}</ErrorNote>}
      <C.DialogFooter className="cbd-confirm-footer">
        <Button variant="ghost" disabled={busy} onClick={close}>{cancelLabel}</Button>
        <Button variant="destructive" loading={busy} onClick={run}>{busy ? 'Removing…' : confirmLabel}</Button>
      </C.DialogFooter>
    </Dialog>
  );
}

export function SettingToggle({ label, description, checked, disabled, onChange }) {
  return (
    <label className="cbd-toggle">
      <span><span className="cbd-toggle-label">{label}</span>{description && <span className="cb-faint">{description}</span>}</span>
      <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}

export function CollectionTabs({ value, onChange, items, id }) {
  return (
    <C.Tabs defaultValue={value || ''}>
      {() => (
        <C.TabsList role="tablist" aria-label="Saved collections">
          {items.map((item, index) => (
            <C.TabsTrigger
              key={item.id} value={item.id} active={value === item.id} role="tab" id={id + item.id}
              aria-controls={id + 'panel'} aria-selected={value === item.id} tabIndex={value === item.id ? 0 : -1}
              onClick={() => onChange(item.id)}
              onKeyDown={event => {
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                  : event.key === 'ArrowRight' ? (index + 1) % items.length
                  : event.key === 'ArrowLeft' ? (index + items.length - 1) % items.length : null;
                if (next !== null) { event.preventDefault(); onChange(items[next].id); document.getElementById(id + items[next].id)?.focus(); }
              }}
            >{item.label}</C.TabsTrigger>
          ))}
        </C.TabsList>
      )}
    </C.Tabs>
  );
}

export function EmptyState({ icon, title, description, children, compact }) {
  return (
    <div className={cx('cb-empty', compact && 'cb-empty-compact')}>
      {icon && <Icon name={icon} className="cb-empty-icon" />}
      <p className="cb-empty-title">{title}</p>
      {description && <p className="cb-empty-text">{description}</p>}
      {children && <div className="cb-empty-actions">{children}</div>}
    </div>
  );
}

export function ErrorState({ title, description, children }) {
  return (
    <div role="alert" className="cb-empty">
      <p className="cb-empty-title">{title}</p>
      {description && <p className="cb-empty-text">{description}</p>}
      {children && <div className="cb-empty-actions">{children}</div>}
    </div>
  );
}

export function ErrorNote({ children, action }) {
  return (
    <div role="alert" className="cb-error-note">
      <Icon name="warning" />
      <span>{children}</span>
      {action}
    </div>
  );
}
