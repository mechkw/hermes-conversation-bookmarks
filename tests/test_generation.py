"""Generation's public HTTP seam; fictional indexed native history only."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from test_bookmarks import api, database
from test_source_choosers import native_source


class GenerationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cb-gen-', dir=os.environ.get('TMPDIR'))
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name) / 'home'
        native_source(self.home)
        with database(self.home / 'state.db') as db:
            db.executescript('''
                ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;
                ALTER TABLE sessions ADD COLUMN model_config TEXT;
                ALTER TABLE sessions ADD COLUMN end_reason TEXT;
                ALTER TABLE messages ADD COLUMN active INTEGER DEFAULT 1;
                ALTER TABLE messages ADD COLUMN compacted INTEGER DEFAULT 0;
                ALTER TABLE messages ADD COLUMN display_order INTEGER;
                ALTER TABLE messages ADD COLUMN display_identity BLOB;
                ALTER TABLE messages ADD COLUMN display_metadata TEXT;
                ALTER TABLE messages ADD COLUMN message_uid TEXT;
                ALTER TABLE messages ADD COLUMN absorbed_message_uids TEXT;
            ''')
            for n in range(1, 206):
                db.execute('INSERT INTO messages(id,session_id,role,content,timestamp,display_order,display_identity) VALUES(?,?,?,?,?,?,?)',
                           (n, 'fictional-a', 'user' if n % 2 else 'assistant', f'Fictional {n}', 1000-n, n, hashlib.sha256(f'logical-{n}'.encode()).digest()))
        self.binding = patch.object(api, 'bound_home', return_value=self.home)
        self.binding.start()
        self.addCleanup(self.binding.stop)
        app = FastAPI()
        app.include_router(api.router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.calls = []
        self.result = {'title': 'Fictional draft', 'note': 'Review this note', 'tags': ['fiction']}
        self.failure = None
        async def complete(**kwargs):
            self.calls.append(kwargs)
            if self.failure:
                raise self.failure
            return SimpleNamespace(parsed=self.result)
        self.ctx = SimpleNamespace(llm=SimpleNamespace(acomplete_structured=complete), on_unload=self.addCleanup)
        api.bind_generation(self.ctx)

    def generate(self, **changes):
        return self.client.post('/generation/draft', json={'session_id': 'fictional-a', 'message_id': 204, **changes})

    def test_logical_copies_and_rich_scrub_do_not_leak_future_or_private_rows(self):
        with database(self.home / 'state.db') as db:
            db.execute('UPDATE messages SET active=0,compacted=1 WHERE id IN (201,202)')
            for old, new in ((201, 501), (202, 502)):
                db.execute('''INSERT INTO messages(id,session_id,role,content,timestamp,display_order,display_identity)
                    SELECT ?,session_id,role,content,99999,display_order,display_identity FROM messages WHERE id=?''', (new, old))
            db.execute('UPDATE messages SET content=? WHERE id=204', ('\x00json:' + json.dumps([
                {'type':'reasoning','text':'PRIVATE reasoning'}, {'type':'text','text':'Visible <思考>PRIVATE</思考>answer <ns:tool_calls>PRIVATE</ns:tool_calls>'},
                {'type':'text','text':'PRIVATE hidden','hidden':True}, {'type':'image','text':'PRIVATE media'},
                {'type':'output_text','text':'tail <analysis malformed "PRIVATE'},
            ]),))
            db.execute('UPDATE messages SET content=? WHERE id=203', ('\x00json:' + json.dumps({'type':'message','role':'user','content':[{'type':'text','text':'Visible request'},{'type':'tool_result','text':'PRIVATE tool'}]}),))
            db.execute('UPDATE messages SET content=? WHERE id=205', ('FUTURE must never be hydrated',))
        response = self.generate()
        self.assertEqual(response.status_code, 200, response.text)
        messages = json.loads(self.calls[-1]['input'][0]['text'])['messages']
        self.assertEqual(messages[-4:], [{'role':'user','content':'Fictional 201'}, {'role':'assistant','content':'Fictional 202'},
            {'role':'user','content':'Visible request'}, {'role':'assistant','content':'Visible answer tail'}])
        self.assertEqual(len(messages), 42)
        self.assertNotIn('PRIVATE', json.dumps(self.calls))
        self.assertNotIn('FUTURE', json.dumps(self.calls))
        self.assertNotIn('Visible request', (self.home/'plugin-data/conversation-bookmarks/bookmarks.sqlite3').read_bytes().decode('latin1'))

    def test_reject_invalid_anchors_sources_profiles_schema_and_entire_conversation(self):
        for changes in ({'message_id':None}, {'message_id':203}, {'message_id':9999}, {'message_id':True}, {'session_id':'foreign'}, {'session_id':'bad/id'}, {'profile':'elsewhere'}):
            self.assertGreaterEqual(self.generate(**changes).status_code, 400)
        self.assertEqual(self.client.post('/generation/draft?profile=foreign', json={'session_id':'fictional-a','message_id':204}).status_code, 409)
        for column, value in (('source','cron'), ('hidden',1), ('profile_name','foreign'), ('parent_session_id','foreign')):
            with database(self.home/'state.db') as db:
                old = db.execute(f'SELECT {column} FROM sessions WHERE id=?', ('fictional-a',)).fetchone()[0]
                db.execute(f'UPDATE sessions SET {column}=? WHERE id=?', (value,'fictional-a'))
            self.assertEqual(self.generate().status_code, 404)
            with database(self.home/'state.db') as db:
                db.execute(f'UPDATE sessions SET {column}=? WHERE id=?', (old,'fictional-a'))
        with database(self.home/'state.db') as db:
            db.execute("UPDATE messages SET display_order='corrupt' WHERE id=203")
        self.assertEqual(self.generate().status_code, 422)
        self.assertEqual(self.calls, [])
        # Manual entire-conversation save is independent of generation eligibility.
        self.assertEqual(self.client.post('/entries', json={'title':'Manual','session_id':'fictional-a'}).status_code, 201)

    def test_hidden_synthetic_and_private_rows_excluded_and_required_text_never_truncated(self):
        for field, value in (('display_kind','hidden'), ('observed',1), ('_compressed_summary',1), ('display_metadata','{"model_only":true}'), ('display_metadata','{"thought":true}'), ('display_metadata','{"channel":"analysis"}'), ('content','<analysis>private'), ('content','[ASYNC COMPLETE] private'), ('content','x'*65537)):
            with database(self.home/'state.db') as db:
                old = db.execute(f'SELECT {field} FROM messages WHERE id=204').fetchone()[0]
                db.execute(f'UPDATE messages SET {field}=? WHERE id=204', (value,))
            self.assertEqual(self.generate().status_code, 422)
            with database(self.home/'state.db') as db:
                db.execute(f'UPDATE messages SET {field}=? WHERE id=204', (old,))
        self.assertEqual(self.calls, [])
        with database(self.home/'state.db') as db:
            db.execute('UPDATE messages SET content=? WHERE id=204', ('FULL focal '+ 'z'*10000,))
            db.execute('UPDATE messages SET content=? WHERE id=202', ('x'*65537,))
        response = self.generate()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['context']['truncated'])
        self.assertEqual(json.loads(self.calls[-1]['input'][0]['text'])['messages'][-1]['content'], 'FULL focal '+'z'*10000)

    def test_model_malformed_errors_timeout_and_retry_are_safe(self):
        for value in (None, [], {'title':'x'}, {'title':'x','note':'ok','tags':['a'*41]}, {'title':'x','note':'ok','tags':[],'session_id':'override'}, {'title':'\n','note':'ok','tags':[]}):
            self.result = value
            response = self.generate()
            self.assertEqual(response.status_code, 502, response.text)
        self.failure = RuntimeError('PRIVATE source and credentials')
        response = self.generate()
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('PRIVATE', response.text)
        self.failure = TimeoutError('PRIVATE')
        self.assertEqual(self.generate().status_code, 504)
        self.failure = None
        self.result = {'title':'Recovered','note':'Reviewed','tags':[]}
        self.assertEqual(self.generate().json()['draft']['title'], 'Recovered')
        self.assertEqual(len(self.calls), 9)  # one native invocation per explicit request

    def test_unreadable_user_metadata_never_substitutes_an_older_request(self):
        for metadata in ('{bad', '[]', '{"channel":"unknown"}'):
            with database(self.home/'state.db') as db:
                db.execute('UPDATE messages SET display_metadata=? WHERE id=203',(metadata,))
            self.assertEqual(self.generate().status_code,422)
        self.assertEqual(self.calls,[])

    def test_deadline_cancels_wait_and_releases_generation_slot(self):
        async def slow(**kwargs):
            await asyncio.sleep(2)
        self.ctx.llm.acomplete_structured=slow
        with patch.object(api,'GENERATION_TIMEOUT',0.05):
            self.assertEqual(self.generate().status_code,504)
        async def recovered(**kwargs):
            return SimpleNamespace(parsed=self.result)
        self.ctx.llm.acomplete_structured=recovered
        self.assertEqual(self.generate().status_code,200)

    def test_concurrency_and_unload_fence(self):
        import threading
        from concurrent.futures import ThreadPoolExecutor
        entered, release = threading.Event(), threading.Event()
        callbacks = []
        async def held(**kwargs):
            entered.set()
            while not release.is_set():
                await asyncio.sleep(.01)
            return SimpleNamespace(parsed=self.result)
        api.bind_generation(SimpleNamespace(llm=SimpleNamespace(acomplete_structured=held), on_unload=callbacks.append))
        with ThreadPoolExecutor() as pool:
            first = pool.submit(self.generate)
            self.assertTrue(entered.wait(3))
            self.assertEqual(self.generate().status_code, 429)
            callbacks[0]()
            release.set()
            self.assertEqual(first.result(timeout=3).status_code, 409)

    def test_generate_exact_context_zero_default_max_no_future_and_no_save(self):
        calls = []
        async def complete(**kwargs):
            calls.append(kwargs)
            return SimpleNamespace(parsed={'title': 'Fictional draft', 'note': 'Review this note', 'tags': ['fiction']})
        ctx = SimpleNamespace(llm=SimpleNamespace(acomplete_structured=complete), on_unload=lambda callback: None)
        api.bind_generation(ctx)
        before = (self.home / 'state.db').read_bytes()
        for count, first in ((0, 203), (20, 163), (100, 3)):
            self.client.put('/generation/settings', json={'previous_exchanges': count})
            result = self.client.post('/generation/draft', json={'session_id': 'fictional-a', 'message_id': 204})
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()['draft']['title'], 'Fictional draft')
            context = json.loads(calls[-1]['input'][0]['text'])
            self.assertEqual([m['content'] for m in context['messages']], [f'Fictional {n}' for n in range(first, 205)])
            self.assertEqual(result.json()['context']['previous_exchanges'], count)
            self.assertFalse(result.json()['context']['truncated'])
            self.assertEqual(calls[-1]['task'], 'conversation_bookmarks_details')
            self.assertNotIn('profile', calls[-1])
            self.assertNotIn('model', calls[-1])
        self.assertEqual((self.home / 'state.db').read_bytes(), before)
        self.assertEqual(self.client.get('/entries').json()['total'], 0)

    def test_multiple_replies_synthetic_boundaries_and_complete_exchanges(self):
        with database(self.home/'state.db') as db:
            db.execute("UPDATE messages SET role='assistant' WHERE id=201")
            db.execute("UPDATE messages SET role='user',content='[System: injected context]' WHERE id=202")
            db.execute("UPDATE messages SET role='tool',content='PRIVATE tool' WHERE id=198")
            db.execute("UPDATE messages SET display_metadata='{\"hidden\":true}',content='PRIVATE hidden' WHERE id=196")
        self.client.put('/generation/settings',json={'previous_exchanges':1})
        response=self.generate()
        self.assertEqual(response.status_code,200,response.text)
        messages=json.loads(self.calls[-1]['input'][0]['text'])['messages']
        self.assertEqual([m['content'] for m in messages],['Fictional 199','Fictional 200','Fictional 201','Fictional 203','Fictional 204'])
        self.assertNotIn('PRIVATE',json.dumps(self.calls))

    def test_ambiguous_and_excessive_timeline_fails_before_inference(self):
        with database(self.home/'state.db') as db:
            db.execute("UPDATE messages SET display_identity=(SELECT display_identity FROM messages WHERE id=202) WHERE id=201")
        self.assertEqual(self.generate().status_code,422)
        with database(self.home/'state.db') as db:
            db.execute("UPDATE messages SET display_identity=? WHERE id=201", (hashlib.sha256(b'logical-201').digest(),))
        with patch.object(api, 'GENERATION_ROW_LIMIT', 100):
            self.assertEqual(self.generate().status_code,422)
        self.assertEqual(self.calls,[])

    def test_generation_profile_context_and_settings_do_not_cross(self):
        import shutil
        other=Path(self.temp.name)/'profiles'/'other'
        other.mkdir(parents=True)
        shutil.copy2(self.home/'state.db',other/'state.db')
        with database(other/'state.db') as db:
            db.execute("UPDATE sessions SET profile_name='other'")
            db.execute("UPDATE messages SET content='OTHER profile answer' WHERE id=204")
        self.client.put('/generation/settings',json={'previous_exchanges':0})
        with patch.object(api,'bound_home',return_value=other):
            api.bind_generation(self.ctx)
            self.assertEqual(self.client.get('/generation/settings').json()['previous_exchanges'],20)
            response=self.generate()
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(json.loads(self.calls[-1]['input'][0]['text'])['messages'][-1]['content'],'OTHER profile answer')
        response=self.generate()
        self.assertEqual(response.json()['context']['previous_exchanges'],0)
        self.assertNotIn('OTHER',self.calls[-1]['input'][0]['text'])

    def test_settings_default_persist_validation_and_profile_isolation(self):
        self.assertEqual(self.client.get('/generation/settings').json(), {'previous_exchanges': 20})
        for n in (0, 100, 20):
            response = self.client.put('/generation/settings', json={'previous_exchanges': n})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.client.get('/generation/settings').json(), {'previous_exchanges': n})
        for n in (-1, 101, True, '2', 1.5):
            self.assertEqual(self.client.put('/generation/settings', json={'previous_exchanges': n}).status_code, 422)
        self.assertEqual(self.client.get('/generation/settings?profile=foreign').status_code, 409)
        other = Path(self.temp.name) / 'profiles' / 'other'
        with patch.object(api, 'bound_home', return_value=other):
            self.assertEqual(self.client.get('/generation/settings').json(), {'previous_exchanges': 20})
        self.assertEqual(self.client.get('/entries').json()['total'], 0)
