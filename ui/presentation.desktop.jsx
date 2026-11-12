// Desktop adapter: every control here IS a Hermes design-system component.
// This file only translates the plugin's small vocabulary into host props, so
// the host keeps ownership of appearance, portals, focus and keyboard behavior.
import React from 'react';
import {
  Badge as HostBadge,
  Button as HostButton,
  Checkbox,
  Codicon,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  CopyButton as HostCopyButton,
  Dialog as HostDialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ErrorState as HostErrorState,
  Input,
  Kbd,
  Loader,
  SearchField,
  SegmentedControl,
  Skeleton,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  Tip as HostTip,
  ToggleRow
} from '@hermes/plugin-sdk';
import { cx } from './lib.js';

export { Checkbox, DialogFooter, Input, Kbd, Loader, SearchField, Skeleton, Switch, Textarea };

export const supports = { contextMenu: true };

export function Icon({ name, size = '0.875rem', className, spinning }) {
  return <Codicon name={name} size={size} className={className} spinning={spinning} />;
}

export function Tip({ label, side, children }) {
  return <HostTip label={label} side={side}>{children}</HostTip>;
}

export function Button({ variant = 'secondary', type = 'button', icon, children, ...props }) {
  return (
    <HostButton type={type} variant={variant} {...props}>
      {icon && <Icon name={icon} />}
      {children}
    </HostButton>
  );
}

export function IconButton({ icon, label, variant = 'ghost', size = 'icon-sm', tip = true, spinning, ...props }) {
  const button = (
    <HostButton type="button" aria-label={label} variant={variant} size={size} {...props}>
      <Icon name={icon} spinning={spinning} />
    </HostButton>
  );
  return tip && !props.disabled ? <Tip label={label}>{button}</Tip> : button;
}

const BADGE_TONES = { neutral: 'muted', accent: 'default', warn: 'warn', danger: 'destructive', success: 'success', outline: 'outline' };

export function Badge({ tone = 'neutral', icon, children, ...props }) {
  return (
    <HostBadge variant={BADGE_TONES[tone] || 'muted'} {...props}>
      {icon && <Icon name={icon} size="0.7rem" />}
      {children}
    </HostBadge>
  );
}

export function Segmented({ label, options, value, onChange, disabled }) {
  return (
    <div role="group" aria-label={label} className="cb-segmented">
      <SegmentedControl options={options} value={value} onChange={onChange} disabled={disabled} sizing="content" />
    </div>
  );
}

function menuRows(items, Item, Separator) {
  return items.filter(Boolean).map((item, index) =>
    item.separator ? (
      <Separator key={'separator' + index} />
    ) : (
      <Item
        key={item.label}
        disabled={item.disabled}
        variant={item.destructive ? 'destructive' : 'default'}
        onSelect={item.onSelect}
      >
        {item.icon && <Icon name={item.icon} />}
        <span className="cb-menu-label">{item.label}</span>
        {item.checked && <Icon name="check" className="cb-menu-check" />}
        {item.hint && <span className="cb-menu-hint">{item.hint}</span>}
      </Item>
    )
  );
}

/** Button-triggered actions menu. `items`: {label, icon, onSelect, destructive, disabled, checked, hint} | {separator}. */
export function Menu({ trigger, items, align = 'end' }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="cb-menu">
        {menuRows(items, DropdownMenuItem, DropdownMenuSeparator)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Right-click parity for a row: the same items its kebab shows. */
export function ContextArea({ items, children }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="cb-menu">{menuRows(items, ContextMenuItem, ContextMenuSeparator)}</ContextMenuContent>
    </ContextMenu>
  );
}

export function CopyButton({ text, label, children }) {
  return children ? (
    <HostCopyButton text={text} label={label} appearance="button" buttonVariant="secondary" buttonSize="sm">
      {children}
    </HostCopyButton>
  ) : (
    <HostCopyButton text={text} label={label} appearance="icon" buttonSize="icon-xs" />
  );
}

const DIALOG_SIZES = { sm: 'cb-dialog cb-dialog-sm', md: 'cb-dialog', lg: 'cb-dialog cb-dialog-lg' };

export function Dialog({ title, description, size = 'md', children, close, busy = false, restoreFocus, initialFocus, label }) {
  return (
    <HostDialog open onOpenChange={open => { if (!open && !busy) close(); }}>
      <DialogContent
        className={DIALOG_SIZES[size]}
        {...(description ? {} : { 'aria-describedby': undefined })}
        showCloseButton={Boolean(title) && !busy}
        onCloseAutoFocus={restoreFocus}
        onOpenAutoFocus={initialFocus}
      >
        {title ? (
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
        ) : (
          <DialogTitle className="cb-sr-only">{label}</DialogTitle>
        )}
        {children}
      </DialogContent>
    </HostDialog>
  );
}

/** Destructive confirmation with the host's pending → done beat and inline error. */
export function Confirm({ title, description, confirmLabel, cancelLabel, onConfirm, close }) {
  return (
    <ConfirmDialog
      open
      destructive
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      busyLabel="Removing…"
      doneLabel="Removed"
      cancelLabel={cancelLabel}
      onConfirm={onConfirm}
      onClose={close}
    />
  );
}

export function SettingToggle({ label, description, checked, disabled, onChange }) {
  return <ToggleRow label={label} description={description} checked={checked} disabled={disabled} onChange={onChange} />;
}

export function CollectionTabs({ value, onChange, items, id }) {
  return (
    <Tabs value={value || ''} onValueChange={onChange}>
      <TabsList aria-label="Saved collections">
        {items.map(item => (
          <TabsTrigger key={item.id} value={item.id} id={id + item.id} aria-controls={id + 'panel'}>
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** Quiet, centered empty state with an optional glyph and action. */
export function EmptyState({ icon, title, description, children, compact }) {
  return (
    <div className={cx('cb-empty', compact && 'cb-empty-compact')}>
      {icon && <Icon name={icon} size="1.25rem" className="cb-empty-icon" />}
      <p className="cb-empty-title">{title}</p>
      {description && <p className="cb-empty-text">{description}</p>}
      {children && <div className="cb-empty-actions">{children}</div>}
    </div>
  );
}

/** Full-surface failure (the list could not load). */
export function ErrorState({ title, description, children }) {
  return (
    <div role="alert" className="cb-error-state">
      <HostErrorState title={title} description={description}>{children}</HostErrorState>
    </div>
  );
}

/** Inline failure inside a form or pane: one line, never a second layout. */
export function ErrorNote({ children, action }) {
  return (
    <div role="alert" className="cb-error-note">
      <Icon name="warning" />
      <span>{children}</span>
      {action}
    </div>
  );
}
