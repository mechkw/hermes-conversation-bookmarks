"""Bounded release seams against fictional stores and public commands."""
import hashlib
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
import test_bookmarks as fixtures
api, plugin = fixtures.api, fixtures.plugin


class ContestReleaseTests(unittest.TestCase):
    setUp = fixtures.BookmarksTests.setUp
    entry = fixtures.BookmarksTests.entry
    create = fixtures.BookmarksTests.create
    def client(self):
        app = FastAPI()
        app.include_router(api.router)
        binding = patch.object(api, 'bound_home', return_value=self.home)
        binding.start()
        self.addCleanup(binding.stop)
        client = TestClient(app)
        self.addCleanup(client.close)
        return client

    def test_bulk_remove_all_or_nothing_cas_and_original_integrity(self):
        client = self.client()
        before = hashlib.sha256((self.home/'state.db').read_bytes()).hexdigest()
        entries = [self.create(note='Keep provenance') for _ in range(3)]
        refs = [{'id': e['id'], 'revision': e['revision']} for e in entries]
        conflict = client.post('/entries/remove', json={'entries': [refs[0], {**refs[1], 'revision': 2}]})
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(self.store.search()['total'], 3)
        result = client.post('/entries/remove', json={'entries': refs[:2]})
        self.assertEqual(result.json(), {'deleted': [r['id'] for r in refs[:2]], 'source_deleted': False})
        for entry in entries[:2]:
            self.assertEqual(client.get('/entries/'+entry['id']).status_code, 404)
        self.assertEqual(client.get('/entries/'+entries[2]['id']).json(), entries[2])
        self.assertEqual(hashlib.sha256((self.home/'state.db').read_bytes()).hexdigest(), before)
        self.assertEqual(client.post('/entries/remove', json={'entries': refs[:2]}).status_code, 409)

    def test_bulk_validation_and_profile_fence(self):
        client = self.client()
        entry = self.create()
        ref = {'id': entry['id'], 'revision': 1}
        for entries in ([], [ref, ref], [dict(ref, revision=True)], [dict(ref, id='bad')], [ref]*101):
            self.assertEqual(client.post('/entries/remove', json={'entries': entries}).status_code, 422)
        self.assertEqual(client.post('/entries/remove?profile=foreign', json={'entries': [ref]}).status_code, 409)
        self.assertEqual(self.store.get(entry['id']), entry)

    def test_display_preferences_are_strict_profile_local_and_persisted(self):
        client = self.client()
        self.assertEqual(client.get('/settings').json(), {'show_notes': True, 'show_source_status': True})
        value = {'show_notes': False, 'show_source_status': True}
        self.assertEqual(client.put('/settings', json=value).json(), value)
        self.assertEqual(client.get('/settings').json(), value)
        self.assertEqual(api.browse_settings(api.Store(self.home)), value)
        self.assertEqual(client.put('/settings', json={'show_notes': 'false'}).status_code, 422)
        self.assertEqual(client.get('/settings?profile=foreign').status_code, 409)

    def test_commands_browse_without_model_and_capture_aliases(self):
        commands, injections = {}, []
        ctx = SimpleNamespace(register_tool=lambda **kw: None,
            register_command=lambda name, handler, **kw: commands.update({name: handler}),
            inject_message=lambda *args, **kw: injections.append(args) or True)
        with patch.object(plugin, '_service', return_value=api), patch.object(api, 'bound_home', return_value=self.home):
            plugin.register(ctx)
            self.assertIn('0 matching bookmarks', commands['bookmarks'](''))
            self.assertIn('0 matching bookmarks', commands['bookmark']('browse'))
            self.assertEqual(injections, [])
            self.assertEqual(commands['bookmark']('', session_id='fictional-a', session_key='route'), '')
            self.assertEqual(len(injections), 1)
            self.assertEqual(self.store.search()['total'], 0)
            for name in ('bookmark', 'bookmarks'):
                result = commands[name]('add Supplied #Exact --description "Kept"', session_id='fictional-a')
                self.assertIn('Saved bookmark: Supplied', result)
            self.assertEqual(self.store.search()['total'], 2)
            self.assertIn('2 matching bookmarks', commands['bookmarks']('browse Supplied'))
            self.assertEqual(len(injections), 1)

    def test_optional_native_panel_refusal_preserves_commands_without_catalog_leak(self):
        commands, unloads = {}, []
        def refused(*args):
            raise RuntimeError('native isolation refusal')
        ctx = SimpleNamespace(register_tool=lambda **kw: None,
            register_command=lambda name, handler, **kw: commands.update({name: handler}),
            register_platform_handler=refused, register_hook=lambda *args: None,
            on_unload=unloads.append)
        with patch.object(plugin, '_service', return_value=api), patch.object(api, 'bound_home', return_value=self.home):
            plugin.register(ctx)
            source = SimpleNamespace(user_id='17', chat_id='17', thread_id='')
            arguments = dict(platform='telegram', source=source, session_id='fictional-a', session_key='route')
            with patch.object(api, 'Store', side_effect=AssertionError('unauthorized catalog read')):
                self.assertIn('unavailable', commands['bookmarks']('', **arguments))
            policy = self.home/'plugin-data/conversation-bookmarks/telegram-owners.json'
            policy.write_text('["17"]')
            self.assertIn('0 matching bookmarks', commands['bookmarks']('', **arguments))
            self.assertIn('0 matching bookmarks', commands['bookmarks'](''))
            self.assertEqual(self.store.search()['total'], 0)
            for close in unloads:
                close()

    def test_guarded_create_authorizes_after_sql_reservation(self):
        called = []
        def denied():
            called.append(True)
            raise ValueError('retired')
        with self.assertRaisesRegex(ValueError, 'retired'):
            self.store.create(self.entry(), authorize_commit=denied)
        self.assertEqual(called, [True])
        self.assertEqual(self.store.search()['total'], 0)


if __name__ == '__main__':
    unittest.main()
