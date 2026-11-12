"""Public chooser HTTP contracts against fictional native SQLite, never live state."""
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from test_bookmarks import api, database


def native_source(home, profile='default'):
    home.mkdir(parents=True, exist_ok=True)
    with database(home / 'state.db') as db:
        db.executescript('''
            CREATE TABLE sessions(id TEXT PRIMARY KEY, profile_name TEXT, title TEXT,
                source TEXT, started_at REAL, ended_at REAL, last_activity_at REAL,
                hidden INTEGER DEFAULT 0);
            CREATE TABLE messages(id INTEGER PRIMARY KEY, session_id TEXT, role TEXT,
                content TEXT, timestamp REAL, display_kind TEXT, observed INTEGER DEFAULT 0,
                _compressed_summary INTEGER DEFAULT 0, reasoning TEXT, tool_calls TEXT);
            CREATE INDEX idx_messages_session ON messages(session_id,timestamp);
        ''')
        db.executemany('INSERT INTO sessions(id,profile_name,title,source,started_at,last_activity_at) VALUES(?,?,?,?,?,?)', [
            ('fictional-a', profile, 'Alpha decision', 'cli', 100, 200),
            ('fictional-b', profile, None, 'telegram', 100, 200),
            ('foreign', 'elsewhere', 'Private foreign title', 'cli', 900, 900),
        ])


class SourceChooserTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cb-chooser-', dir=os.environ.get('TMPDIR'))
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name) / 'home'
        native_source(self.home)
        self.binding = patch.object(api, 'bound_home', return_value=self.home)
        self.binding.start()
        self.addCleanup(self.binding.stop)
        app = FastAPI()
        app.include_router(api.router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def add_message(self, mid, content, role='assistant', timestamp: int | float | str | None = 400, **extra):
        values = {'id': mid, 'session_id': 'fictional-a', 'role': role, 'content': content, 'timestamp': timestamp, **extra}
        with database(self.home / 'state.db') as db:
            db.execute('INSERT INTO messages(' + ','.join(values) + ') VALUES(' + ','.join('?' for _ in values) + ')', tuple(values.values()))

    def test_responses_only_visible_assistant_text_and_native_rich_blocks(self):
        rich = '\x00json:' + json.dumps([
            {'type': 'thinking', 'thinking': 'HIDDEN THINKING'},
            {'type': 'text', 'text': 'Visible answer'},
            {'type': 'tool_use', 'input': {'text': 'HIDDEN TOOL ARGS'}},
            {'type': 'image', 'source': {'data': 'HIDDEN MEDIA'}},
            {'type': 'output_text', 'text': 'Second part'},
            {'type': 'text', 'text': 'HIDDEN THOUGHT', 'thought': True},
        ])
        self.add_message(1, rich)
        self.add_message(2, 'Ordinary answer', reasoning='HIDDEN REASONING', tool_calls='HIDDEN CALLS')
        for mid, role in enumerate(('user', 'system', 'tool', 'developer'), 3):
            self.add_message(mid, 'PRIVATE ROLE', role=role)
        self.add_message(7, None, tool_calls='HIDDEN CALLS')
        self.add_message(8, '\x00json:' + json.dumps([{'type': 'reasoning', 'text': 'PRIVATE REASONING'}]))
        self.add_message(9, 'PRIVATE HIDDEN', display_kind='hidden')
        self.add_message(10, 'PRIVATE SUMMARY', _compressed_summary=1)
        self.add_message(11, 'PRIVATE OBSERVED', observed=1)
        self.add_message(12, '   ')
        response = self.client.get('/sources/sessions/fictional-a/responses')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['items'], [
            {'id': 2, 'preview': 'Ordinary answer', 'created_at': 400.0},
            {'id': 1, 'preview': 'Visible answer Second part', 'created_at': 400.0},
        ])
        self.assertIs(response.json()['has_more'], False)
        self.assertNotIn('HIDDEN', response.text)
        self.assertNotIn('PRIVATE', response.text)
        self.assertEqual(response.headers['cache-control'], 'no-store')

    def test_rich_content_fails_closed_and_inline_private_carriers_are_removed(self):
        cases = [
            ('\x00json:' + json.dumps({'type': 'text', 'text': 'PRIVATE', 'channel': 'analysis'}), None),
            ('\x00json:' + json.dumps({'type': 'message', 'role': 'assistant', 'channel': 'analysis', 'content': 'PRIVATE'}), None),
            ('\x00json:{broken', None),
            ('\x00json:' + json.dumps({'type': 'tool_use', 'text': 'PRIVATE'}), None),
            ('\x00json:' + json.dumps({'text': 'PRIVATE unknown shape'}), None),
            ('\x00json:' + json.dumps({'type': 'message', 'role': 'user', 'content': 'PRIVATE'}), None),
            ('\x00json:' + json.dumps({'type': 'message', 'role': 'assistant', 'content': [{'type': 'output_text', 'text': 'Nested visible'}]}), 'Nested visible'),
            ('\x00json:' + json.dumps({'type': 'text', 'text': 'Standalone visible'}), 'Standalone visible'),
            ('\x00json:' + json.dumps('Escaped visible string'), 'Escaped visible string'),
            ('<think>PRIVATE <think>PRIVATE nested</think> PRIVATE tail</think>Public answer', 'Public answer'),
            ('<analysis>PRIVATE unfinished', None),
            ('PRIVATE orphan</think>Public after orphan', 'Public after orphan'),
            ('<tool_call>{"arguments":"PRIVATE"}</tool_call>Public tool result explanation', 'Public tool result explanation'),
            ('Image data:image/png;base64,PRIVATEBYTES End', 'Image [media omitted] End'),
            ('\x00json:' + '[' * 1100, None),
            (b'PRIVATE binary', None),
            ('\x00json:' + json.dumps([{'type': 'text', 'text': 'Oversized'}, {'type': 'image', 'data': 'PRIVATE' * 4000}]), None),
            ('x' * 360, 'x' * 349 + '…'),
        ]
        for mid, (content, _) in enumerate(cases, 1):
            self.add_message(mid, content, timestamp=mid)
        response = self.client.get('/sources/sessions/fictional-a/responses')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['items'], [
            {'id': mid, 'preview': preview, 'created_at': float(mid)}
            for mid, (_, preview) in reversed(list(enumerate(cases, 1))) if preview is not None
        ])
        self.assertNotIn('PRIVATE', response.text)

    def test_host_private_carriers_never_reach_previews_or_search(self):
        # Installed host vocabulary: agent/think_scrubber.py and
        # agent/agent_runtime_helpers.py. Keep literal examples independent of
        # the implementation, including the host's named-function/arg fragments.
        carriers = [
            ('think', ''), ('thinking', ''), ('reasoning', ''), ('thought', ''),
            ('REASONING_SCRATCHPAD', ''), ('思考', ''), ('反思', ''),
            ('推理', ''), ('推敲', ''), ('analysis', ''), ('tool_use', ''),
            ('tool_call', ''), ('tool_calls', ''), ('tool_result', ''),
            ('function_call', ''), ('function_calls', ''),
            ('function', ' name="terminal"'), ('arg_key', ''), ('arg_value', ''),
        ]
        carriers += [(f'ns-v1.tools:{name}', attrs) for name, attrs in carriers
                     if name.startswith(('tool_', 'function'))]
        path = '/sources/sessions/fictional-a/responses'
        for name, attrs in carriers:
            opening, closing = f'<{name}{attrs}>', f'</{name}>'
            cases = [
                (f'Visible before {opening}PRIVATE payload{closing} Visible after', 'Visible before Visible after'),
                (f'{opening}PRIVATE outer {opening}PRIVATE inner{closing} PRIVATE tail{closing}Visible after', 'Visible after'),
                (f'{opening}PRIVATE <think>PRIVATE nested</think> PRIVATE tail{closing}Visible after', 'Visible after'),
                (f'Visible before {opening}PRIVATE unfinished', 'Visible before'),
                (f'PRIVATE orphan{closing}Visible after', 'Visible after'),
                (f'{opening}PRIVATE only{closing}', None),
                (f'{opening.upper()}PRIVATE mixed case{closing.lower()}Visible after', 'Visible after'),
            ]
            for rich in (False, True):
                with self.subTest(carrier=name, rich=rich):
                    with database(self.home / 'state.db') as db:
                        db.execute('DELETE FROM messages')
                    expected = []
                    for mid, (content, preview) in enumerate(cases, 1):
                        if rich:
                            content = '\x00json:' + json.dumps([{'type': 'output_text', 'text': content}])
                        self.add_message(mid, content, timestamp=mid)
                        if preview:
                            expected.insert(0, {'id': mid, 'preview': preview, 'created_at': float(mid)})
                    before = {p.name: p.read_bytes() for p in self.home.iterdir()}
                    response = self.client.get(path)
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual(response.json()['items'], expected)
                    hidden = self.client.get(path, params={'q': 'PRIVATE'})
                    self.assertEqual(hidden.status_code, 200, hidden.text)
                    self.assertEqual(hidden.json()['items'], [])
                    self.assertIs(hidden.json()['has_more'], False)
                    visible = self.client.get(path, params={'q': 'VISIBLE'})
                    self.assertEqual(visible.status_code, 200, visible.text)
                    self.assertEqual(visible.json()['items'], expected)
                    self.assertEqual({p.name: p.read_bytes() for p in self.home.iterdir()}, before)
                    self.assertFalse((self.home / 'plugin-data').exists())

    def test_malformed_carriers_cannot_close_another_private_block(self):
        cases = [
            ('Visible before <thought>PRIVATE</tool_calls> PRIVATE tail', 'Visible before'),
            ('Visible before <thought>PRIVATE</tool_calls> PRIVATE tail</thought>Visible after', 'Visible before Visible after'),
            ('Visible before <thought><tool_calls>PRIVATE</thought></tool_calls> PRIVATE tail', 'Visible before'),
            ('Visible before <ns:tool_calls>PRIVATE</other:tool_calls> PRIVATE tail', 'Visible before'),
            ('Visible before <thought PRIVATE unfinished opening', 'Visible before'),
            ('Visible before <thought', 'Visible before'),
            ('PRIVATE orphan</thought', None),
            ('Visible before <thought>PRIVATE</thought PRIVATE unfinished closing', 'Visible before'),
            ('Visible before <tool_calls payload="PRIVATE > still private"/> Visible after', 'Visible before Visible after'),
            ('Visible before <thought/><ns:function_calls /> Visible after', 'Visible before Visible after'),
            ('Visible before <thought payload="PRIVATE unfinished quote', 'Visible before'),
            ('Visible before <thought PRIVATE <tool_calls>PRIVATE</tool_calls> PRIVATE tail', 'Visible before'),
            ('<thought>PRIVATE</thought>Visible middle<tool_calls>PRIVATE</tool_calls>Visible after', 'Visible middle Visible after'),
            ('Visible <thinking-cap>example</thinking-cap> and <function-call>notation</function-call>', 'Visible <thinking-cap>example</thinking-cap> and <function-call>notation</function-call>'),
            ('Visible thought and function_calls are words; 2 < 3; <b>ordinary markup</b>', 'Visible thought and function_calls are words; 2 < 3; <b>ordinary markup</b>'),
        ]
        path = '/sources/sessions/fictional-a/responses'
        for content, preview in cases:
            with self.subTest(content=content):
                with database(self.home / 'state.db') as db:
                    db.execute('DELETE FROM messages')
                self.add_message(1, content)
                expected = [] if preview is None else [{'id': 1, 'preview': preview, 'created_at': 400.0}]
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()['items'], expected)
                hidden = self.client.get(path, params={'q': 'PRIVATE'})
                self.assertEqual(hidden.status_code, 200, hidden.text)
                self.assertEqual(hidden.json()['items'], [])
                self.assertIs(hidden.json()['has_more'], False)
                self.assertEqual(self.client.get(path, params={'q': 'Visible'}).json()['items'], expected)

    def test_session_recency_uses_index_without_scanning_large_transcripts(self):
        with database(self.home / 'state.db') as db:
            db.executemany('INSERT INTO messages(id,session_id,role,content,timestamp) VALUES(?,?,?,?,?)',
                           ((i, 'fictional-a', 'user', 'PRIVATE prompt', i) for i in range(1, 300001)))
        response = self.client.get('/sources/sessions')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['items'][0]['updated_at'], 300000.0)
        self.assertNotIn('PRIVATE', response.text)

    def test_search_is_literal_casefolded_and_only_matches_visible_preview(self):
        self.add_message(1, 'Straße decision 100%_', reasoning='Private needle')
        self.add_message(2, 'x' * 400 + ' hidden-tail')
        for query, expected in [('STRASSE', [1]), ('%_', [1]), ("' OR 1=1 --", []),
                                ('Private needle', []), ('hidden-tail', [])]:
            with self.subTest(query=query):
                result = self.client.get('/sources/sessions/fictional-a/responses', params={'q': query}).json()
                self.assertEqual([item['id'] for item in result['items']], expected)
        for query, expected in [('ALPHA', ['fictional-a']), ('telegram', ['fictional-b']),
                                ('fictional-a', ['fictional-a']), ('%', []), ('Private', [])]:
            result = self.client.get('/sources/sessions', params={'q': query}).json()
            self.assertEqual([item['id'] for item in result['items']], expected)

    def test_query_bounds_and_invalid_ids_fail_without_writes(self):
        for path, max_offset in [('/sources/sessions', 1000), ('/sources/sessions/fictional-a/responses', 500)]:
            for params in ({'limit': 0}, {'limit': 101}, {'limit': 'true'}, {'limit': '1.5'},
                           {'offset': -1}, {'offset': max_offset + 1}, {'q': 'x' * 201}):
                with self.subTest(path=path, params=params):
                    self.assertEqual(self.client.get(path, params=params).status_code, 422)
            self.assertEqual(self.client.get(path, params={'limit': 100, 'offset': max_offset, 'q': 'x' * 200}).status_code, 200)
            self.assertEqual(self.client.get(path, params={'profile': 'elsewhere'}).status_code, 409)
        from urllib.parse import quote
        for sid in ('bad id', 'x' * 161, "' OR 1=1 --", 'x\x00', 'é', 'x\\y'):
            self.assertEqual(self.client.get('/sources/sessions/' + quote(sid, safe='') + '/responses').status_code, 422)
        self.assertFalse((self.home / 'plugin-data').exists())

    def test_profile_ownership_missing_and_hidden_sessions_are_indistinguishable(self):
        self.add_message(1, 'PRIVATE FOREIGN', session_id='foreign')
        with database(self.home / 'state.db') as db:
            db.execute("INSERT INTO sessions(id,profile_name,title,hidden) VALUES('hidden','default','PRIVATE HIDDEN',1)")
            db.execute("INSERT INTO sessions(id,profile_name) VALUES('legacy-null',NULL)")
            db.execute("INSERT INTO sessions(id,profile_name) VALUES('legacy-empty','')")
        for sid in ('foreign', 'missing', 'hidden'):
            response = self.client.get(f'/sources/sessions/{sid}/responses')
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.json(), {'detail': 'Conversation is not available in this profile'})
        for sid in ('legacy-null', 'legacy-empty'):
            response = self.client.get(f'/sources/sessions/{sid}/responses')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['items'], [])
        result = self.client.get('/sources/sessions').json()
        self.assertNotIn('PRIVATE', json.dumps(result))
        null_item = next(item for item in result['items'] if item['id'] == 'legacy-null')
        self.assertEqual(null_item, {'id': 'legacy-null', 'title': 'Conversation · legacy-null', 'source': '', 'updated_at': None})

    def test_concurrent_profile_bound_requests_do_not_share_results(self):
        import contextvars
        from concurrent.futures import ThreadPoolExecutor
        other = Path(self.temp.name) / 'profiles' / 'other'
        native_source(other, 'other')
        self.add_message(1, 'Default answer')
        with database(other / 'state.db') as db:
            db.execute("INSERT INTO messages(id,session_id,role,content,timestamp) VALUES(1,'fictional-a','assistant','Other answer',400)")
        context = contextvars.ContextVar('chooser_home')
        api.bound_home.side_effect = lambda: context.get()
        def request(home):
            context.set(home)
            return self.client.get('/sources/sessions/fictional-a/responses', params={'profile': api.profile_name(home)}).json()['items'][0]['preview']
        with ThreadPoolExecutor(3) as pool:
            self.assertEqual(list(pool.map(request, [self.home, other, self.home])), ['Default answer', 'Other answer', 'Default answer'])

    def test_timestamp_normalization_and_stable_ties(self):
        with database(self.home / 'state.db') as db:
            db.execute("INSERT INTO sessions(id,title,started_at,last_activity_at) VALUES('invalid-time','Invalid clock','garbage',1e300)")
        self.add_message(1, 'First', timestamp=500)
        self.add_message(2, 'Second', timestamp=500)
        self.add_message(3, 'Unknown date', timestamp='bad')
        self.add_message(4, 'Infinite date', timestamp=float('inf'))
        items = self.client.get('/sources/sessions/fictional-a/responses').json()['items']
        self.assertEqual([item['id'] for item in items], [2, 1, 4, 3])
        self.assertEqual([item['created_at'] for item in items], [500.0, 500.0, None, None])
        result = self.client.get('/sources/sessions', params={'q': 'invalid-time'}).json()
        self.assertIsNone(result['items'][0]['updated_at'])
        # No messages, equal session activity: lexical ID descending is stable.
        with database(self.home / 'state.db') as db:
            db.execute('DELETE FROM messages')
        self.assertEqual([i['id'] for i in self.client.get('/sources/sessions').json()['items']], ['fictional-b', 'fictional-a', 'invalid-time'])

    def test_bounded_windows_paging_and_default_page_size(self):
        with database(self.home / 'state.db') as db:
            db.executemany('INSERT INTO messages(id,session_id,role,content,timestamp) VALUES(?,?,?,?,?)',
                           [(i, 'fictional-a', 'assistant', 'Window answer', i) for i in range(1, 503)])
            db.executemany('INSERT INTO sessions(id,profile_name,title,source,started_at) VALUES(?,?,?,?,?)',
                           [(f'recent-{i:04}', 'default', f'Recent {i}', 'cli', i) for i in range(1000, 2002)])
        path = '/sources/sessions/fictional-a/responses'
        result = self.client.get(path).json()
        self.assertEqual(len(result['items']), 30)
        self.assertEqual(result['items'][0]['id'], 502)
        self.assertIs(result['has_more'], True)
        self.assertEqual(result['window'], {'limit': 500, 'truncated': True})
        page = self.client.get(path, params={'offset': 499}).json()
        self.assertEqual([i['id'] for i in page['items']], [3])
        self.assertIs(page['has_more'], False)
        self.assertEqual(self.client.get(path, params={'offset': 500}).json()['items'], [])
        result = self.client.get('/sources/sessions').json()
        self.assertEqual(len(result['items']), 30)
        self.assertEqual(result['items'][0]['id'], 'recent-2001')
        self.assertEqual(result['window'], {'limit': 1000, 'truncated': True})
        result = self.client.get('/sources/sessions', params={'offset': 999}).json()
        self.assertEqual([item['id'] for item in result['items']], ['recent-1002'])
        self.assertIs(result['has_more'], False)
        # Search runs before the window is cut, so an older conversation stays reachable.
        found = self.client.get('/sources/sessions', params={'q': 'Alpha'}).json()
        self.assertEqual([item['id'] for item in found['items']], ['fictional-a'])
        self.assertEqual(found['window'], {'limit': 1000, 'truncated': False})

    def test_missing_corrupt_and_incomplete_schema_fail_closed(self):
        path = self.home / 'state.db'
        before = path.read_bytes()
        paths = ('/sources/sessions', '/sources/sessions/fictional-a/responses')
        for scenario in ('missing', 'corrupt', 'missing-profile', 'missing-messages', 'view'):
            with self.subTest(scenario=scenario):
                path.unlink()
                if scenario != 'missing':
                    path.write_bytes(b'not a sqlite database' if scenario == 'corrupt' else before)
                if scenario in ('missing-profile', 'missing-messages', 'view'):
                    with database(path) as db:
                        if scenario == 'missing-profile':
                            db.execute('ALTER TABLE sessions DROP COLUMN profile_name')
                        else:
                            db.execute('DROP TABLE messages')
                            if scenario == 'view':
                                db.execute('CREATE VIEW messages AS SELECT 1 AS id, id AS session_id, started_at AS timestamp FROM sessions')
                for route in paths:
                    response = self.client.get(route)
                    self.assertEqual(response.status_code, 503, response.text)
                    self.assertNotIn(str(self.home), response.text)
                if scenario == 'missing':
                    self.assertFalse(path.exists())
                    path.write_bytes(before)
        self.assertFalse((self.home / 'plugin-data').exists())

    def test_linked_database_sidecars_and_home_are_rejected(self):
        original = self.home / 'state.db'
        for suffix in ('', '-wal', '-shm', '-journal'):
            candidate = Path(str(original) + suffix)
            target = self.home / 'link-target'
            if suffix == '':
                candidate.rename(target)
            else:
                target.write_bytes(b'fictional sidecar')
            for kind in ('symlink', 'hardlink'):
                with self.subTest(suffix=suffix, kind=kind):
                    if kind == 'symlink':
                        candidate.symlink_to(target)
                    else:
                        os.link(target, candidate)
                    for route in ('/sources/sessions', '/sources/sessions/fictional-a/responses'):
                        self.assertEqual(self.client.get(route).status_code, 503)
                    candidate.unlink()
            if suffix == '':
                target.rename(original)
            else:
                target.unlink()
        linked = self.home.parent / 'linked'
        linked.symlink_to(self.home, target_is_directory=True)
        api.bound_home.return_value = linked
        self.assertEqual(self.client.get('/sources/sessions').status_code, 503)
        parent = self.home.parent / 'linked-parent'
        parent.symlink_to(self.home.parent, target_is_directory=True)
        api.bound_home.return_value = parent / 'home'
        self.assertEqual(self.client.get('/sources/sessions').status_code, 503)

    def test_reads_leave_source_bytes_and_bookmark_storage_untouched(self):
        self.add_message(1, 'Fictional preview')
        path = self.home / 'state.db'
        before = {p.name: p.read_bytes() for p in self.home.iterdir()}
        for route in ('/sources/sessions', '/sources/sessions/fictional-a/responses'):
            self.assertEqual(self.client.get(route).status_code, 200)
        self.assertEqual({p.name: p.read_bytes() for p in self.home.iterdir()}, before)
        # A live WAL must be visible; no immutable=1 shortcut ignoring committed rows.
        writer = sqlite3.connect(path)
        try:
            writer.execute('PRAGMA journal_mode=WAL')
            writer.execute("INSERT INTO messages(id,session_id,role,content,timestamp) VALUES(2,'fictional-a','assistant','WAL answer',500)")
            writer.commit()
            before = {p.name: p.read_bytes() for p in (path, Path(str(path) + '-wal'))}
            response = self.client.get('/sources/sessions/fictional-a/responses')
            self.assertEqual(response.json()['items'][0]['preview'], 'WAL answer')
            self.assertEqual({p.name: p.read_bytes() for p in (path, Path(str(path) + '-wal'))}, before)
        finally:
            writer.close()
        self.assertFalse((self.home / 'plugin-data').exists())

    def test_legacy_nonassistant_reference_and_pruned_source_editing_still_work(self):
        self.add_message(1, 'User prompt', role='user')
        item = self.client.post('/entries', json={'session_id': 'fictional-a', 'message_id': 1, 'title': 'Legacy reference'}).json()
        self.assertEqual(item['message_id'], 1)
        self.assertEqual(self.client.get('/sources/sessions/fictional-a/responses').json()['items'], [])
        with database(self.home / 'state.db') as db:
            db.execute('DELETE FROM messages')
            db.execute('DELETE FROM sessions')
        updated = self.client.put('/entries/' + item['id'], json={'session_id': 'fictional-a', 'message_id': 1, 'title': 'Edited after pruning', 'revision': 1})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()['source_status'], 'session_missing')
        self.assertEqual(self.client.get('/entries/' + item['id']).json(), updated.json())

    def test_recent_sessions_stable_paging_and_null_title_without_prompt_reads(self):
        with database(self.home / 'state.db') as db:
            db.execute("INSERT INTO messages(id,session_id,role,content,timestamp) VALUES(1,'fictional-a','user','PRIVATE PROMPT',300)")
        response = self.client.get('/sources/sessions', params={'limit': 1})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        result = response.json()
        self.assertEqual(result['items'], [{'id': 'fictional-a', 'title': 'Alpha decision', 'updated_at': 300.0, 'source': 'cli'}])
        self.assertIs(result['has_more'], True)
        last = self.client.get('/sources/sessions', params={'limit': 1, 'offset': 1}).json()
        self.assertEqual(last['items'], [{'id': 'fictional-b', 'title': 'telegram · fictional-b', 'updated_at': 200.0, 'source': 'telegram'}])
        self.assertIs(last['has_more'], False)
        self.assertNotIn('PRIVATE', response.text)


if __name__ == '__main__':
    unittest.main()
