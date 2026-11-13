// Host-neutral helpers shared by every surface. No host imports here.

export const PAGE_SIZE = 30;
export const SELECTION_LIMIT = 100;
export const CONTEXT_PRESETS = [5, 10, 20, 50];
export const DEFAULT_CONTEXT = 10;

export const cx = (...parts) => parts.filter(Boolean).join(' ');

export const errorMessage = (error, fallback = 'The request failed. Refresh and try again.') =>
  error?.message || fallback;

export const isResponse = entry => entry?.message_id != null;

export const kindLabel = entry => (isResponse(entry) ? 'Response' : 'Conversation');

const SOURCE_PROBLEMS = {
  session_missing: 'Conversation unavailable',
  message_missing: 'Response unavailable',
  store_missing: 'Conversation history unavailable',
  unavailable: 'Source could not be checked'
};

/** Null while the source is fine: only a problem earns a place on screen. */
export const sourceProblem = status => (status === 'available' ? null : SOURCE_PROBLEMS[status] || 'Source unavailable');

/** The native chooser titles untitled sessions "<source> · <id>"; never show that raw. */
export const conversationTitle = item =>
  !item?.title || item.title === `${item.source || 'Conversation'} · ${item.id}` ? 'Untitled conversation' : item.title;

const SOURCE_NAMES = { cli: 'CLI', tui: 'TUI', web: 'Web', webapp: 'Web', desktop: 'Desktop' };

export const sourceName = source =>
  !source ? '' : SOURCE_NAMES[source] || source.charAt(0).toUpperCase() + source.slice(1);

const toDate = seconds => (typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(seconds * 1000) : null);

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'narrow' });
const sameYear = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const otherYear = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const full = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Compact age for list rows: "now", "5m ago", "3h ago", "2d ago", then a date. */
export function shortAge(seconds, now = Date.now()) {
  const date = toDate(seconds);
  if (!date) return '';
  const elapsed = Math.max(0, now - date.getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return relative.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relative.format(-hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 7) return relative.format(-days, 'day');
  return (date.getFullYear() === new Date(now).getFullYear() ? sameYear : otherYear).format(date);
}

export const fullDate = seconds => {
  const date = toDate(seconds);
  return date ? full.format(date) : 'Date unavailable';
};

export const isoDate = seconds => toDate(seconds)?.toISOString();

/** Shell-quoted resume command for the profile that owns the bookmark. */
export function resumeCommand(sessionId, profile) {
  const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
  const scope = profile && profile !== 'default' ? ` --profile ${quote(profile)}` : '';
  return `hermes${scope} --resume ${quote(sessionId)}`;
}

/** Plain-text reference a person can drop into a chat so the agent can find the moment. */
export function chatReference(entry) {
  const where = isResponse(entry)
    ? `response ${entry.message_id} in conversation ${entry.session_id}`
    : `conversation ${entry.session_id}`;
  const note = entry.note?.trim() ? `\nNote: ${entry.note.trim()}` : '';
  return `Bookmark “${entry.title}” (${where})${note}`;
}

export const plural = (count, one, many = one + 's') => `${count} ${count === 1 ? one : many}`;

/** Tags compare the way the backend does: boundary-trimmed and case-folded. */
export const tagKey = tag => tag.trim().toLocaleLowerCase();

export function addTag(tags, raw) {
  const value = raw.trim().slice(0, 40);
  if (!value || tags.length >= 20 || tags.some(tag => tagKey(tag) === tagKey(value))) return tags;
  return [...tags, value];
}

/** Minimal observable for cross-surface signals (saved elsewhere, open requests). */
export function createSignal(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set(next) {
      value = next;
      for (const listener of [...listeners]) listener(value);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

/** The platform's primary modifier, as people see it on their keyboard. */
export const modKey = () => (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl');
