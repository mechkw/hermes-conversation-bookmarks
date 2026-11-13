"""Fictional-only regressions for collection filters, tag summary, marks and inspector context."""
import importlib.util
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


api = load('bookmarks_browse_api', ROOT / 'dashboard/plugin_api.py')

SESSION_COLUMNS = ('id TEXT PRIMARY KEY, profile_name TEXT, title TEXT, source TEXT, started_at REAL, '
                   'ended_at REAL, last_activity_at REAL, hidden INTEGER')
MESSAGE_COLUMNS = ('id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp REAL, '
                   'display_kind TEXT, observed INTEGER, _compressed_summary INTEGER')


def native_source(home, legacy=False):
    home.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(home / 'state.db')) as db, db:
        if legacy:
            db.execute('CREATE TABLE sessions(id TEXT PRIMARY KEY, profile_name TEXT)')
            db.execute('CREATE TABLE messages(id INTEGER PRIMARY KEY, session_id TEXT)')
            db.execute("INSERT INTO sessions VALUES ('fictional-a','default')")
            db.execute("INSERT INTO messages VALUES (1,'fictional-a')")
            return
        db.execute(f'CREATE TABLE sessions({SESSION_COLUMNS})')
        db.execute(f'CREATE TABLE messages({MESSAGE_COLUMNS})')
        db.executemany('INSERT INTO sessions(id,profile_name,title,source,last_activity_at,hidden) VALUES (?,?,?,?,?,?)', [
            ('fictional-a', 'default', 'Fictional launch plan', 'desktop', 1793400000, 0),
            ('fictional-b', 'default', 'Fictional queue notes', 'cli', 1793300000, 0),
            ('fictional-hidden', 'default', 'Hidden fictional thread', 'desktop', 1793200000, 1),
            ('foreign', 'elsewhere', 'Foreign fictional thread', 'desktop', 1793100000, 0),
        ])
        db.executemany('INSERT INTO messages(id,session_id,role,content,timestamp,display_kind,observed,_compressed_summary) VALUES (?,?,?,?,?,?,?,?)', [
            (1, 'fictional-a', 'assistant', 'Friday stays. <think>private fictional reasoning</think> Scope is reduced.', 1793400100, None, 0, 0),
            (2, 'fictional-a', 'user', 'A fictional user request.', 1793400050, None, 0, 0),
            (3, 'fictional-a', 'assistant', 'word ' * 600, 1793400200, None, 0, 0),
            (4, 'fictional-b', 'assistant', 'Observed fictional relay.', 1793300100, None, 1, 0),
            (5, 'fictional-hidden', 'assistant', 'Hidden fictional response.', 1793200100, None, 0, 0),
            (6, 'foreign', 'assistant', 'Foreign fictional response.', 1793100100, None, 0, 0),
        ])


class BrowseExtensionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cbx-', dir=os.environ.get('TMPDIR'))
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name) / 'home'
        native_source(self.home)
        app = FastAPI()
        app.include_router(api.router)
        patcher = patch.object(api, 'bound_home', return_value=self.home)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def save(self, title, session_id='fictional-a', message_id=None, tags=()):
        response = self.client.post('/entries', json={'title': title, 'session_id': session_id,
                                                      'message_id': message_id, 'tags': list(tags)})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_kind_and_conversation_filters_compose_with_search(self):
        whole = self.save('Whole fictional thread')
        reply = self.save('One fictional reply', message_id=1)
        other = self.save('Other fictional thread', session_id='fictional-b')
        titles = lambda query: [item['title'] for item in self.client.get('/entries' + query).json()['items']]
        self.assertEqual(set(titles('')), {whole['title'], reply['title'], other['title']})
        self.assertEqual(set(titles('?kind=conversation')), {whole['title'], other['title']})
        self.assertEqual(titles('?kind=response'), [reply['title']])
        self.assertEqual(set(titles('?session_id=fictional-a')), {whole['title'], reply['title']})
        self.assertEqual(titles('?session_id=fictional-a&kind=response&q=reply'), [reply['title']])
        self.assertEqual(self.client.get('/entries?kind=response').json()['total'], 1)
        for query in ('?kind=everything', '?session_id=bad%20id', '?session_id=' + 'a' * 161):
            self.assertEqual(self.client.get('/entries' + query).status_code, 422, query)

    def test_tag_summary_merges_casefold_spellings_and_orders_by_use(self):
        self.save('First', tags=['Launch', 'planning'])
        self.save('Second', tags=['launch', 'Straße'])
        self.save('Third', tags=['LAUNCH', 'STRASSE', 'Design, Decisions'])
        summary = self.client.get('/tags').json()
        self.assertEqual(summary['total'], 4)
        self.assertEqual(summary['items'][:2], [{'tag': 'Launch', 'count': 3}, {'tag': 'Straße', 'count': 2}])
        self.assertEqual({item['tag'] for item in summary['items'][2:]}, {'Design, Decisions', 'planning'})
        self.assertEqual(len(self.client.get('/tags?limit=1').json()['items']), 1)
        self.assertEqual(self.client.get('/tags?limit=0').status_code, 422)
        self.assertEqual(self.client.get('/tags?profile=foreign').status_code, 409)

    def test_marks_report_identifiers_and_counts_only(self):
        self.assertEqual(self.client.get('/marks').json(), {'sessions': {}, 'truncated': False})
        self.save('First')
        self.save('Second', message_id=1)
        self.save('Third', session_id='fictional-b')
        self.assertEqual(self.client.get('/marks').json(),
                         {'sessions': {'fictional-b': 1, 'fictional-a': 2}, 'truncated': False})
        self.assertEqual(self.client.get('/marks?profile=foreign').status_code, 409)

    def test_context_projects_visible_title_and_bounded_excerpt(self):
        whole = self.save('Whole fictional thread')
        context = self.client.get(f"/entries/{whole['id']}/context").json()
        self.assertEqual(context['source_status'], 'available')
        self.assertEqual(context['conversation'], {'title': 'Fictional launch plan', 'source': 'desktop', 'updated_at': 1793400000.0})
        self.assertIsNone(context['response'])
        reply = self.save('One fictional reply', message_id=1)
        context = self.client.get(f"/entries/{reply['id']}/context").json()
        self.assertEqual(context['response'], {'excerpt': 'Friday stays. Scope is reduced.', 'created_at': 1793400100.0})
        long = self.save('Long fictional reply', message_id=3)
        excerpt = self.client.get(f"/entries/{long['id']}/context").json()['response']['excerpt']
        self.assertEqual(len(excerpt), api.SOURCE_EXCERPT_CHARS)
        self.assertTrue(excerpt.endswith('…'))
        self.assertEqual(self.client.get('/entries/' + '0' * 32 + '/context').status_code, 404)

    def test_context_withholds_ineligible_and_missing_sources(self):
        user = self.save('Legacy user reference', message_id=2)
        observed = self.save('Observed relay', session_id='fictional-b', message_id=4)
        hidden = self.save('Hidden thread', session_id='fictional-hidden', message_id=5)
        self.assertIsNone(self.client.get(f"/entries/{user['id']}/context").json()['response'])
        self.assertIsNone(self.client.get(f"/entries/{observed['id']}/context").json()['response'])
        self.assertEqual(self.client.get(f"/entries/{hidden['id']}/context").json(),
                         {'source_status': 'available', 'conversation': None, 'response': None})
        with closing(sqlite3.connect(self.home / 'state.db')) as db, db:
            db.execute("DELETE FROM messages WHERE session_id='fictional-a'")
            db.execute("DELETE FROM sessions WHERE id='fictional-a'")
        self.assertEqual(self.client.get(f"/entries/{user['id']}/context").json(),
                         {'source_status': 'session_missing', 'conversation': None, 'response': None})

    def test_context_degrades_on_an_unsupported_native_schema(self):
        with tempfile.TemporaryDirectory(prefix='cbl-', dir=os.environ.get('TMPDIR')) as directory:
            home = Path(directory) / 'home'
            native_source(home, legacy=True)
            with patch.object(api, 'bound_home', return_value=home):
                entry = self.client.post('/entries', json={'title': 'Legacy schema', 'session_id': 'fictional-a', 'message_id': 1}).json()
                self.assertEqual(self.client.get(f"/entries/{entry['id']}/context").json(),
                                 {'source_status': 'available', 'conversation': None, 'response': None})

    def test_context_never_writes_to_the_native_source(self):
        entry = self.save('One fictional reply', message_id=1)
        before = (self.home / 'state.db').read_bytes()
        for _ in range(3):
            self.client.get(f"/entries/{entry['id']}/context")
        self.assertEqual((self.home / 'state.db').read_bytes(), before)


if __name__ == '__main__':
    unittest.main()


class ConversationChooserTests(BrowseExtensionTests):
    def test_people_first_then_automated_runs_and_search_reaches_both(self):
        with closing(sqlite3.connect(self.home / 'state.db')) as db, db:
            db.executemany('INSERT INTO sessions(id,profile_name,title,source,last_activity_at,hidden) VALUES (?,?,?,?,?,?)',
                           [(f'fictional-cron-{n}', 'default', None, 'cron', 1793500000 + n, 0) for n in range(40)]
                           + [('fictional-sub', 'default', 'Fictional delegated audit', 'subagent', 1793600000, 0)])
        items = self.client.get('/sources/sessions').json()['items']
        self.assertEqual([item['id'] for item in items[:2]], ['fictional-a', 'fictional-b'])
        self.assertEqual(items[2]['id'], 'fictional-sub')
        self.assertTrue(all(item['source'] == 'cron' for item in items[3:]))
        found = self.client.get('/sources/sessions', params={'q': 'DELEGATED'}).json()['items']
        self.assertEqual([item['id'] for item in found], ['fictional-sub'])
        self.assertEqual(len(self.client.get('/sources/sessions', params={'q': 'cron', 'limit': 100}).json()['items']), 40)

    def test_untitled_conversation_is_labelled_by_its_first_visible_request(self):
        with closing(sqlite3.connect(self.home / 'state.db')) as db, db:
            db.executemany('INSERT INTO sessions(id,profile_name,title,source,last_activity_at,hidden) VALUES (?,?,?,?,?,?)', [
                ('fictional-untitled', 'default', None, 'telegram', 1793700000, 0),
                ('fictional-silent', 'default', '', 'desktop', 1793690000, 0)])
            db.executemany('INSERT INTO messages(id,session_id,role,content,timestamp,display_kind,observed,_compressed_summary) VALUES (?,?,?,?,?,?,?,?)', [
                (20, 'fictional-untitled', 'user', '[System: fictional synthetic carrier]', 1, None, 0, 0),
                (21, 'fictional-untitled', 'user', 'Hidden fictional steer', 2, 'hidden', 0, 0),
                (22, 'fictional-untitled', 'user', 'Plan the fictional harbor festival ' + 'detail ' * 60, 3, None, 0, 0),
                (23, 'fictional-untitled', 'assistant', 'A fictional answer.', 4, None, 0, 0)])
        items = {item['id']: item for item in self.client.get('/sources/sessions').json()['items']}
        preview = items['fictional-untitled']['preview']
        self.assertTrue(preview.startswith('Plan the fictional harbor festival'))
        self.assertLessEqual(len(preview), api.SOURCE_OPENING_CHARS)
        self.assertNotIn('preview', items['fictional-silent'])
        self.assertNotIn('preview', items['fictional-a'])
        # The line is chooser text only; saving the conversation stores no transcript.
        self.save('Fictional festival', session_id='fictional-untitled')
        stored = (self.home / 'plugin-data/conversation-bookmarks/bookmarks.sqlite3').read_bytes()
        self.assertNotIn(b'harbor', stored)

    def test_opening_line_is_optional_on_older_schemas(self):
        with closing(sqlite3.connect(self.home / 'state.db')) as db, db:
            db.execute("INSERT INTO sessions(id,profile_name,title,source,last_activity_at,hidden) VALUES ('fictional-old','default',NULL,'cli',1793800000,0)")
            db.execute('ALTER TABLE messages DROP COLUMN display_kind')
        response = self.client.get('/sources/sessions')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('preview', response.json()['items'][0])


class HostPoolIsolationTests(unittest.TestCase):
    """A host whose shared worker pool is full must not stall bookmark routes."""

    def test_routes_answer_while_the_host_pool_is_exhausted(self):
        import asyncio
        import threading
        import anyio.to_thread
        import httpx

        with tempfile.TemporaryDirectory(prefix='cbx-pool-', dir=os.environ.get('TMPDIR')) as temp:
            home = Path(temp) / 'home'
            native_source(home)
            app = FastAPI()
            app.include_router(api.router)

            @app.get('/host-route')
            def host_route():
                return {'thread': threading.current_thread().name}

            async def scenario():
                release = threading.Event()
                limiter = anyio.to_thread.current_default_thread_limiter()
                limiter.total_tokens = 1
                blocker = asyncio.ensure_future(anyio.to_thread.run_sync(release.wait))
                await asyncio.sleep(0.05)
                try:
                    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://plugin') as client:
                        with self.assertRaises(TimeoutError):
                            async with asyncio.timeout(0.5):
                                await client.get('/host-route')
                        async with asyncio.timeout(5):
                            results = [await client.get(path) for path in (
                                '/status', '/entries', '/tags', '/marks', '/settings', '/generation/settings',
                                '/sources/sessions', '/sources/sessions/fictional-a/responses')]
                            saved = await client.post('/entries', json={'title': 'Saved under pressure', 'session_id': 'fictional-a'})
                        return [r.status_code for r in results], saved.status_code
                finally:
                    release.set()
                    await blocker

            with patch.object(api, 'bound_home', return_value=home):
                statuses, saved = asyncio.run(scenario())
            self.assertEqual(statuses, [200] * 8)
            self.assertEqual(saved, 201)

    def test_blocking_work_runs_on_the_plugin_pool(self):
        import threading
        seen = []
        with tempfile.TemporaryDirectory(prefix='cbx-pool-', dir=os.environ.get('TMPDIR')) as temp:
            home = Path(temp) / 'home'
            native_source(home)
            app = FastAPI()
            app.include_router(api.router)
            real = api.Store.marks
            def marks(store):
                seen.append(threading.current_thread().name)
                return real(store)
            with patch.object(api, 'bound_home', return_value=home), patch.object(api.Store, 'marks', marks), TestClient(app) as client:
                self.assertEqual(client.get('/marks').status_code, 200)
        self.assertTrue(seen and seen[0].startswith(api.PLUGIN_ID), seen)
