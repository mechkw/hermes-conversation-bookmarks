"""Real PTB markup/Update/callback transport. No Telegram network or user data."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from telegram import Update
from telegram.ext import Application, CallbackContext
from telegram.request import BaseRequest
import test_bookmarks as fixtures

module = fixtures.load('contest_telegram_bookmarks', fixtures.ROOT/'telegram_bookmarks.py')
api = fixtures.api


class Capture(BaseRequest):
    def __init__(self):
        self.calls = []
        self.fail_edit = False
        self.next_id = 10

    @property
    def read_timeout(self):
        return 5

    async def initialize(self):
        pass

    async def shutdown(self):
        pass

    async def do_request(self, url, method, request_data=None, **kwargs):
        name = url.rsplit('/', 1)[-1]
        data = request_data.parameters if request_data else {}
        self.calls.append((name, data))
        if name == 'getMe':
            result = {'id': 900, 'is_bot': True, 'first_name': 'Fixture', 'username': 'fixture_bot'}
        elif name == 'answerCallbackQuery':
            result = True
        else:
            if name == 'editMessageText' and self.fail_edit:
                return 400, json.dumps({'ok': False, 'description': 'fictional edit failure'}).encode()
            self.next_id += 1
            result = {'message_id': data.get('message_id', self.next_id), 'date': 1700000000,
                      'chat': {'id': int(data['chat_id']), 'type': 'private'}, 'text': data.get('text', '')}
            if data.get('message_thread_id'):
                result['message_thread_id'] = data['message_thread_id']
        return 200, json.dumps({'ok': True, 'result': result}).encode()


class TelegramBookmarksTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cb-telegram-', dir=os.environ.get('TMPDIR'))
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)/'home'
        fixtures.source(self.home)
        with fixtures.database(self.home/'state.db') as conn:
            conn.execute('ALTER TABLE sessions ADD COLUMN title TEXT')
            conn.execute("UPDATE sessions SET title='Fictional conversation' WHERE id='fictional-a'")
        self.before = hashlib.sha256((self.home/'state.db').read_bytes()).hexdigest()
        self.binding = patch.object(api, 'bound_home', return_value=self.home)
        self.binding.start()
        self.addCleanup(self.binding.stop)
        self.store = api.Store(self.home)
        self.policy = self.home/'plugin-data/conversation-bookmarks/telegram-owners.json'
        self.policy.write_text('["17"]')
        self.controller = module.Controller(SimpleNamespace(), api)
        self.transport = Capture()
        self.application = Application.builder().token('900:fictional').request(self.transport).updater(None).build()
        await self.application.initialize()
        self.addAsyncCleanup(self.application.shutdown)
        self.controller.factory(self.application, None)
        self.addCleanup(self.controller.close)
        self.identity = self.controller.identity(SimpleNamespace(user_id='17', chat_id='17', thread_id=''), 'fictional-a', 'exact-route')

    def last_markup(self):
        return [data['reply_markup'] for name, data in self.transport.calls if name in ('sendMessage', 'editMessageText')][-1]

    def button(self, label):
        markup = self.last_markup()
        if isinstance(markup, str):
            markup = json.loads(markup)
        return next(button['callback_data'] for row in markup['inline_keyboard'] for button in row if button['text'] == label)

    async def click(self, label=None, data=None, user=17, chat=17, thread=None, message=None):
        panel = next(iter(self.controller.panels.values()), {})
        raw = {'update_id': 1, 'callback_query': {'id': 'callback', 'from': {'id': user, 'is_bot': False, 'first_name': 'Fiction'},
            'chat_instance': 'fictional', 'data': data or self.button(label),
            'message': {'message_id': message or int(panel.get('message') or 11), 'date': 1700000000,
                        'chat': {'id': chat, 'type': 'private'}, **({'message_thread_id': thread} if thread else {})}}}
        update = Update.de_json(raw, self.application.bot)
        handler = self.application.handlers[0][0]
        self.assertTrue(handler.check_update(update))
        await handler.handle_update(update, self.application, handler.check_update(update), CallbackContext(self.application))

    async def test_native_browse_detail_add_confirm_and_replay(self):
        entry = self.store.create(api.EntryInput(title='Fictional decision', note='Annotation only', tags=['fiction'], session_id='fictional-a', message_id=1))
        self.assertEqual(await self.controller.send(self.identity), '')
        await self.click('Fictional decision')
        self.assertIn('Annotation only', self.transport.calls[-1][1]['text'])
        self.assertIn('Response reference: 1', self.transport.calls[-1][1]['text'])
        await self.click('Back to bookmarks')
        await self.click('Add this conversation')
        self.assertEqual(self.store.search()['total'], 1)
        save = self.button('Save conversation reference')
        await self.click(data=save)
        self.assertEqual(self.store.search()['total'], 2)
        saved = next(item for item in self.store.search()['items'] if item['id'] != entry['id'])
        self.assertEqual((saved['title'], saved['session_id'], saved['note'], saved['tags']), ('Fictional conversation', 'fictional-a', '', []))
        await self.click(data=save)
        self.assertEqual(self.store.search()['total'], 2)
        self.assertEqual(hashlib.sha256((self.home/'state.db').read_bytes()).hexdigest(), self.before)

    async def test_wrong_owner_topic_message_and_revocation_do_not_save(self):
        await self.controller.send(self.identity, add=True)
        save = self.button('Save conversation reference')
        for changes in ({'user':18}, {'chat':18}, {'thread':2}, {'message':99}):
            await self.click(data=save, **changes)
            self.assertEqual(self.store.search()['total'], 0)
        self.policy.write_text('[]')
        await self.click(data=save)
        self.assertEqual(self.store.search()['total'], 0)

    async def test_profile_fence_before_catalog_query_and_reset_unload(self):
        await self.controller.send(self.identity)
        button = self.button('Add this conversation')
        with patch.object(api, 'bound_home', return_value=self.home/'foreign'), patch.object(api, 'Store', side_effect=AssertionError('foreign query')):
            self.assertIn('unavailable', await self.controller.send(self.identity))
            await self.click(data=button)
        self.controller.boundary(old_session_id='fictional-a')
        await self.click(data=button)
        self.assertEqual(self.store.search()['total'], 0)
        self.controller.close()
        self.assertIn('unavailable', await self.controller.send(self.identity))

    async def test_failed_publication_never_arms_unseen_actions(self):
        await self.controller.send(self.identity)
        old = self.button('Add this conversation')
        self.transport.fail_edit = True
        await self.click(data=old)
        self.assertEqual(self.controller.panels, {})
        await self.click(data=old)
        self.assertEqual(self.store.search()['total'], 0)

    async def test_command_epoch_expiry_and_reconnect_are_fail_closed(self):
        epoch = self.controller.epoch
        self.controller.boundary()
        self.assertIn('unavailable', await self.controller.send(self.identity, epoch=epoch))
        self.assertEqual(self.controller.panels, {})
        await self.controller.send(self.identity)
        token = next(iter(self.controller.panels))
        button = self.button('Add this conversation')
        self.controller.panels[token]['expires'] = 0
        await self.click(data=button)
        self.assertNotIn(token, self.controller.panels)
        await self.controller.send(self.identity, add=True)
        confirm = self.button('Save conversation reference')
        self.controller.factory(self.application, None)
        await asyncio.sleep(0)
        self.assertEqual(len(self.application.handlers[0]), 1)
        await self.click(data=confirm)
        self.assertEqual(self.store.search()['total'], 0)
        self.assertEqual(self.controller.panels, {})

    async def test_write_lock_wait_revocation_is_off_loop_and_fails_closed(self):
        await self.controller.send(self.identity, add=True)
        save = self.button('Save conversation reference')
        blocker = sqlite3.connect(self.store.path)
        blocker.execute('BEGIN IMMEDIATE')
        task = asyncio.create_task(self.click(data=save))
        try:
            await asyncio.sleep(.15)
            self.assertFalse(task.done())
            self.policy.write_text('[]')
            self.controller.boundary(old_session_id='fictional-a')
        finally:
            blocker.rollback()
            blocker.close()
        await task
        self.assertEqual(self.store.search()['total'], 0)


if __name__ == '__main__':
    unittest.main()
