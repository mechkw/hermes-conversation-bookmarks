"""Optional host-owned Telegram panels for references, not transcript copies."""
from __future__ import annotations

import asyncio
import json
import os
import re
import secrets
import stat
import threading
import time

TTL = 600
CAPACITY = 128
PAGE = 5


class Controller:
    def __init__(self, ctx, api):
        self.ctx, self.api = ctx, api
        self.home = api.bound_home()
        self.profile = api.profile_name(self.home)
        self.lock = threading.RLock()
        self.application = None
        self.handler = None
        self.loop = None
        self.alive = True
        self.epoch = 0
        self.panels = {}
        self.retired = set()
        self.fenced = False

    def owners(self):
        path = self.home / 'plugin-data' / 'conversation-bookmarks' / 'telegram-owners.json'
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, 'rb') as stream:
                meta = os.fstat(stream.fileno())
                if not stat.S_ISREG(meta.st_mode) or meta.st_size > 4096:
                    return set()
                value = json.loads(stream.read(4097))
            if not isinstance(value, list) or len(value) > 50 or any(
                not isinstance(v, str) or not re.fullmatch(r'[1-9][0-9]{0,19}', v) for v in value
            ):
                return set()
            return set(value)
        except (OSError, ValueError):
            return set()

    def identity(self, source, session_id, session_key):
        return dict(user=str(getattr(source, 'user_id', '') or ''),
                    chat=str(getattr(source, 'chat_id', '') or ''),
                    thread=str(getattr(source, 'thread_id', '') or ''),
                    session_id=session_id or '', session_key=session_key or '')

    def permitted(self, identity):
        # Do not construct a catalog or read sources before these checks.
        return (self.api.bound_home() == self.home and identity['user'] in self.owners()
                and bool(re.fullmatch(r'-?[1-9][0-9]*', identity['chat']))
                and (not identity['thread'] or bool(re.fullmatch(r'[1-9][0-9]*', identity['thread'])))
                and not self.fenced and identity['session_id'] not in self.retired
                and bool(identity['session_id'] and identity['session_key']))

    def boundary(self, old_session_id=None, deleted_ids=None, **kwargs):
        with self.lock:
            retired = {value for value in (old_session_id, *(deleted_ids or [])) if value}
            if len(self.retired | retired) > CAPACITY:
                self.fenced = True
            else:
                self.retired.update(retired)
            self.epoch += 1
            self.panels.clear()

    @staticmethod
    def detach(application, handler, loop):
        if application is not None and handler is not None:
            if loop is not None and loop.is_running():
                loop.call_soon_threadsafe(application.remove_handler, handler)
            else:
                application.remove_handler(handler)

    def close(self):
        with self.lock:
            self.alive = False
            self.boundary()
            old = self.application, self.handler, self.loop
            self.application = self.handler = self.loop = None
        self.detach(*old)

    def factory(self, application, adapter):
        from telegram.ext import CallbackQueryHandler
        with self.lock:
            if not self.alive:
                return
            self.boundary()
            old = self.application, self.handler, self.loop
            self.application = application
            self.loop = asyncio.get_running_loop()
            self.handler = CallbackQueryHandler(self.callback, pattern=r'^cbm:')
            application.add_handler(self.handler)
        self.detach(*old)

    def require(self, token, panel):
        if not self.permitted(panel['identity']):
            raise ValueError('Bookmarks panel is no longer authorized. Open /bookmarks again.')
        with self.lock:
            if (not self.alive or self.panels.get(token) is not panel or panel['epoch'] != self.epoch
                    or panel['application'] is not self.application or panel['expires'] <= time.monotonic()):
                raise ValueError('Bookmarks panel expired. Open /bookmarks again.')

    def prepare(self, token, panel, action=('page', 0)):
        self.require(token, panel)
        kind, value = action
        buttons = []
        store = self.api.Store(self.home)
        if kind == 'detail':
            item = store.get(value)
            text = (item['title'] + '\n' + item['note'][:2200] + '\nTags: ' + ', '.join(item['tags'])[:500]
                    + '\nSource: ' + item['source_status'].replace('_', ' ')
                    + '\nSession: ' + item['session_id'])
            if item['message_id'] is not None:
                text += '\nResponse reference: ' + str(item['message_id'])
            text += '\nA reference, not a transcript backup.'
            buttons.append(('Back to bookmarks', ('page', 0)))
        elif kind == 'add':
            # Read only a bounded title from the exact invoking conversation.
            source = store.source
            source.require(panel['identity']['session_id'], None)
            with source.chooser_connection() as conn:
                row = conn.execute('SELECT substr(title,1,160) FROM sessions WHERE id=? AND (profile_name IS NULL OR profile_name IN (?,\'\'))',
                                   (panel['identity']['session_id'], self.profile)).fetchone()
            title = self.api.source_label(row[0] if row else '', 160) or 'Saved conversation'
            draft = self.api.EntryInput(title=title, note='', tags=[], session_id=panel['identity']['session_id'])
            panel['draft'] = draft
            text = ('Bookmark this conversation?\n' + title + '\nSaves a reference with this title, no note or tags. '
                    'No messages are copied. To supply annotations, use /bookmark add Title #tag --description "note".')
            buttons = [('Save conversation reference', ('save', None)), ('Cancel', ('page', 0))]
        else:
            result = store.search(q=panel['query'], limit=PAGE, offset=value)
            text = f"Bookmarks · {result['total']} matching bookmarks"
            for item in result['items']:
                text += '\n• ' + item['title'][:100]
                buttons.append((item['title'][:60], ('detail', item['id'])))
            if not result['items']:
                text += '\nNo matching bookmarks. Nothing is captured automatically.'
            if value:
                buttons.append(('Previous', ('page', max(0, value-PAGE))))
            if value+PAGE < result['total']:
                buttons.append(('More bookmarks', ('page', value+PAGE)))
            buttons.append(('Add this conversation', ('add', None)))
            text += '\nSearch: /bookmarks browse words · Help: /bookmarks help'
        self.require(token, panel)
        return text[:3900], buttons

    def save(self, token, panel):
        self.require(token, panel)
        draft = panel.get('draft')
        if draft is None:
            raise ValueError('Choose Add first.')
        def authorize():
            self.require(token, panel)
            with self.lock:
                if panel.get('claimed'):
                    raise ValueError('Already submitted. Browse bookmarks before retrying.')
                panel['claimed'] = True
        item = self.api.Store(self.home).create(draft, authorize_commit=authorize)
        if self.api.Store(self.home).get(item['id']) != item:
            raise ValueError('Save outcome unverified. Browse bookmarks before retrying.')
        self.require(token, panel)
        return 'Bookmark saved.\n' + item['title'], [('View bookmark', ('detail', item['id'])), ('Browse bookmarks', ('page', 0))]

    async def publish(self, token, panel, prepared, *, initial=False):
        from telegram import InlineKeyboardButton, InlineKeyboardMarkup
        text, buttons = prepared
        pending = {secrets.token_hex(4): action for _, action in buttons}
        keyboard = InlineKeyboardMarkup([[InlineKeyboardButton(label, callback_data=f'cbm:{token}:{key}')]
                                         for (label, _), key in zip(buttons, pending)])
        # Old actions stay disarmed during preparation and transport. Fresh keys
        # are activated only after the exact send/edit is acknowledged.
        await asyncio.to_thread(self.require, token, panel)
        with self.lock:
            panel['actions'] = {}
            if (not self.alive or self.panels.get(token) is not panel or panel['epoch'] != self.epoch
                    or panel['expires'] <= time.monotonic() or self.api.bound_home() != self.home):
                raise ValueError('Panel changed')
        kwargs = dict(chat_id=int(panel['identity']['chat']), text=text, reply_markup=keyboard)
        if initial:
            if panel['identity']['thread']:
                kwargs['message_thread_id'] = int(panel['identity']['thread'])
            sent = await panel['application'].bot.send_message(**kwargs)
            panel['message'] = str(sent.message_id)
        else:
            await panel['application'].bot.edit_message_text(message_id=int(panel['message']), **kwargs)
        await asyncio.to_thread(self.require, token, panel)
        with self.lock:
            if (not self.alive or self.panels.get(token) is not panel or panel['epoch'] != self.epoch
                    or panel['expires'] <= time.monotonic() or self.api.bound_home() != self.home):
                raise ValueError('Panel changed')
            panel['actions'] = pending

    async def send(self, identity, query='', add=False, epoch=None):
        epoch = self.epoch if epoch is None else epoch
        if not await asyncio.to_thread(self.permitted, identity):
            return 'Bookmarks unavailable: this Telegram owner must be authorized in the profile-local bookmarks owner policy. Nothing saved.'
        with self.lock:
            now = time.monotonic()
            self.panels = {key: value for key, value in self.panels.items() if value['expires'] > now}
            if not self.alive or epoch != self.epoch or self.application is None or len(self.panels) >= CAPACITY:
                return 'Bookmarks buttons are unavailable. Use /bookmark help for explicit capture syntax.'
            token = secrets.token_hex(12)
            panel = dict(identity=identity.copy(), epoch=self.epoch, expires=now+TTL, application=self.application,
                         actions={}, query=query[:200], busy=True, message='')
            self.panels[token] = panel
        try:
            prepared = await asyncio.to_thread(self.prepare, token, panel, ('add', None) if add else ('page', 0))
            await self.publish(token, panel, prepared, initial=True)
            return ''
        except (Exception, asyncio.CancelledError):
            with self.lock:
                self.panels.pop(token, None)
            return 'Bookmarks panel could not be delivered. No save was performed.'
        finally:
            panel['busy'] = False

    async def callback(self, update, context):
        from telegram import Message
        query = update.callback_query
        if not query:
            return
        match = re.fullmatch(r'cbm:([a-f0-9]{24}):([a-f0-9]{8})', query.data or '')
        if not match:
            return
        token, key = match.groups()
        with self.lock:
            panel = self.panels.get(token)
        msg = query.message
        if (not panel or not isinstance(msg, Message) or not msg.is_accessible
                or str(query.from_user.id) != panel['identity']['user']
                or str(msg.chat_id) != panel['identity']['chat']
                or str(msg.message_thread_id or '') != panel['identity']['thread']
                or str(msg.message_id) != panel['message'] or context.application is not panel['application']):
            await query.answer('This panel is not available to you.', show_alert=True)
            return
        try:
            await asyncio.to_thread(self.require, token, panel)
            with self.lock:
                if panel['busy'] or key not in panel['actions']:
                    raise ValueError('Expired button')
                action = panel['actions'].pop(key)
                panel['actions'] = {}
                panel['busy'] = True
            await query.answer()
            await asyncio.to_thread(self.require, token, panel)
            prepared = await asyncio.to_thread(self.save if action[0] == 'save' else self.prepare,
                                               token, panel, *(() if action[0] == 'save' else (action,)))
            await self.publish(token, panel, prepared)
        except (Exception, asyncio.CancelledError):
            with self.lock:
                self.panels.pop(token, None)
            # No retry button after an ambiguous write or transport outcome.
            try:
                await query.answer('Panel expired or changed. Browse /bookmarks before retrying.', show_alert=True)
            except Exception:
                pass
        finally:
            panel['busy'] = False
