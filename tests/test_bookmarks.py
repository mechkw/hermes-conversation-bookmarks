"""Fictional-only storage/API/tool regressions. No production session access."""
import contextvars
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    assert spec is not None and spec.loader is not None
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
api=load('bookmarks_test_api',ROOT/'dashboard/plugin_api.py')
plugin=load('bookmarks_test_plugin',ROOT/'__init__.py')

@contextmanager
def database(path):
    db=sqlite3.connect(path)
    try:
        with db:
            yield db
    finally:
        db.close()

def source(home,profile='default'):
    home.mkdir(parents=True,exist_ok=True)
    with database(home/'state.db') as db:
        db.execute('CREATE TABLE sessions(id TEXT PRIMARY KEY,profile_name TEXT)')
        db.execute('CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT)')
        db.executemany('INSERT INTO sessions VALUES (?,?)',[('fictional-a',profile),('fictional-b',profile),('foreign','elsewhere')])
        db.executemany('INSERT INTO messages VALUES (?,?)',[(1,'fictional-a'),(2,'fictional-b')])

class BookmarksTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='cbt-',dir=os.environ.get('TMPDIR'));self.addCleanup(self.temp.cleanup)
        self.home=Path(self.temp.name)/'home';source(self.home);self.store=api.Store(self.home)
    def entry(self,**kw):return api.EntryInput(title='Useful decision',session_id='fictional-a',**kw)
    def create(self,**kw):return self.store.create(self.entry(**kw))
    def test_crud_and_revision(self):
        e=self.create(note='A deliberate note',tags=['Design','design']);self.assertEqual(e['tags'],['design'])
        u=api.EntryUpdate(**{**self.entry().model_dump(),'title':'Updated','revision':1})
        updated=self.store.update(e['id'],u);self.assertEqual(updated['revision'],2)
        with self.assertRaises(HTTPException) as cm:self.store.update(e['id'],u)
        self.assertEqual(cm.exception.status_code,409)
        with self.assertRaises(HTTPException):self.store.delete(e['id'],1)
        self.assertFalse(self.store.delete(e['id'],2)['source_deleted']);self.assertEqual(self.store.search()['total'],0)
    def test_missing_session_and_foreign_profile_rejected(self):
        for sid in ('absent','foreign'):
            with self.subTest(sid=sid),self.assertRaises(HTTPException):self.store.create(api.EntryInput(title='x',session_id=sid))
        self.assertEqual(self.store.search()['total'],0)
    def test_message_ownership_and_type(self):
        self.assertEqual(self.create(message_id=1)['source_status'],'available')
        with self.assertRaises(HTTPException):self.create(message_id=2)
        for value in (True,0,-1,'1',1.5):
            with self.subTest(value=value),self.assertRaises(ValidationError):self.entry(message_id=value)
    def test_prune_retains_metadata_and_allows_edit(self):
        e=self.create(message_id=1,note='Keep this note')
        with database(self.home/'state.db') as db:db.execute('DELETE FROM messages WHERE id=1')
        self.assertEqual(self.store.get(e['id'])['source_status'],'message_missing')
        with database(self.home/'state.db') as db:db.execute("DELETE FROM sessions WHERE id='fictional-a'")
        self.assertEqual(self.store.get(e['id'])['source_status'],'session_missing')
        updated=self.store.update(e['id'],api.EntryUpdate(**{**self.entry(message_id=1).model_dump(),'note':'Still saved','revision':1}))
        self.assertEqual(updated['note'],'Still saved')
        self.store.delete(e['id'],2)
    def test_changed_reference_requires_validation(self):
        e=self.create()
        with self.assertRaises(HTTPException):self.store.update(e['id'],api.EntryUpdate(title='x',session_id='absent',revision=1))
        self.assertEqual(self.store.get(e['id'])['revision'],1)
    def test_read_only_source_bytes_unchanged(self):
        digest=lambda:hashlib.sha256((self.home/'state.db').read_bytes()).hexdigest()
        before=digest();e=self.create(message_id=1);self.store.get(e['id']);self.store.search();self.store.delete(e['id'],1)
        self.assertEqual(digest(),before)
    def test_source_missing_store_not_created(self):
        (self.home/'state.db').unlink()
        self.assertEqual(self.store.source.availability('x'),'store_missing')
        with self.assertRaises(HTTPException):self.create()
        self.assertFalse((self.home/'state.db').exists())
    def test_schema_error_fails_closed(self):
        with database(self.home/'state.db') as db:db.execute('DROP TABLE sessions')
        self.assertEqual(self.store.source.availability('x'),'unavailable')
    def test_source_symlink_refused(self):
        p=self.home/'state.db';p.rename(self.home/'other.db');p.symlink_to('other.db')
        self.assertEqual(self.store.source.availability('fictional-a'),'unavailable')
    def test_source_hardlink_refused(self):
        os.link(self.home/'state.db',self.home/'link.db')
        self.assertEqual(self.store.source.availability('fictional-a'),'unavailable')
    def test_validation_limits(self):
        for change in ({'title':' '},{'title':'x'*161},{'title':'bad\x00'},{'note':'x'*4001},{'session_id':'../bad'},{'session_id':''},{'tags':['x'*41]},{'tags':['x']*21},{'tags':['\x01']},{'unknown':True}):
            with self.subTest(change=change),self.assertRaises(ValidationError):api.EntryInput.model_validate({**self.entry().model_dump(),**change})
    def test_search_literal_tags_and_sort(self):
        self.store.create(api.EntryInput(title='Z %_ quotation',session_id='fictional-a',note='needle',tags=['Review']))
        self.store.create(api.EntryInput(title='A decision',session_id='fictional-a',tags=['done']))
        self.assertEqual(self.store.search(q='%_')['total'],1);self.assertEqual(self.store.search(q='needle')['total'],1)
        self.assertEqual(self.store.search(q='review')['total'],1);self.assertEqual(self.store.search(tag='REVIEW')['total'],1)
        self.assertEqual(self.store.search(sort='title')['items'][0]['title'],'A decision')
        self.assertEqual(self.store.search(sort='oldest')['items'][0]['title'],'Z %_ quotation')
        self.assertEqual(len(self.store.search(limit=1,offset=1)['items']),1)
        self.assertEqual(self.store.search(q="' OR 1=1--")['total'],0)
    def test_text_retained_not_interpreted(self):
        text='<script>window.evil=true</script>'
        e=self.store.create(api.EntryInput(title=text,note=text,session_id='fictional-a'))
        self.assertEqual(e['title'],text);self.assertEqual(e['note'],text)
    def test_profile_isolation(self):
        other=Path(self.temp.name)/'profiles'/'other';source(other,'other');other_store=api.Store(other)
        a=self.create();self.assertEqual(other_store.search()['total'],0)
        with self.assertRaises(HTTPException):other_store.get(a['id'])
        with patch.object(api,'bound_home',return_value=other):
            with self.assertRaises(HTTPException):api.request_store('default')
            self.assertEqual(api.request_store('other').home,other)
    def test_concurrent_context_binding(self):
        other=Path(self.temp.name)/'profiles'/'other';source(other,'other')
        context=contextvars.ContextVar('home')
        def task(home):
            context.set(home);store=api.request_store(api.profile_name(home));e=store.create(self.entry());return store.home,e['id']
        with patch.object(api,'bound_home',side_effect=lambda:context.get()),ThreadPoolExecutor(2) as pool:
            results=list(pool.map(task,[self.home,other,self.home]))
        self.assertEqual([x[0] for x in results],[self.home,other,self.home]);self.assertEqual(self.store.search()['total'],2)
    def test_api_bounds_and_conflicts(self):
        app=FastAPI();app.include_router(api.router)
        with patch.object(api,'bound_home',return_value=self.home),TestClient(app) as client:
            payload=self.entry().model_dump();r=client.post('/entries',json=payload);self.assertEqual(r.status_code,201);e=r.json()
            self.assertEqual(client.get('/entries').headers['cache-control'],'no-store')
            for path in ('/entries?limit=101','/entries?sort=evil','/entries?offset=-1','/entries?q='+'x'*201):self.assertEqual(client.get(path).status_code,422)
            self.assertEqual(client.post('/entries',json={**payload,'note':'x'*4001}).status_code,422)
            self.assertEqual(client.post('/entries',content=b' '*32769).status_code,413)
            self.assertEqual(client.post('/entries?profile=foreign',json=payload).status_code,409)
            self.assertEqual(client.put('/entries/'+e['id'],json={**payload,'revision':2}).status_code,409)
            self.assertEqual(client.delete('/entries/'+e['id']).status_code,422)
    def test_revision_api_strict_bounds_and_unchanged_metadata(self):
        app=FastAPI();app.include_router(api.router)
        with patch.object(api,'bound_home',return_value=self.home),TestClient(app,raise_server_exceptions=False) as client:
            payload=self.entry(note='Original',tags=['design, decisions','"quoted"','日本語']).model_dump()
            e=client.post('/entries',json=payload).json();path='/entries/'+e['id']
            for revision in (9007199254740992,9223372036854775808,0,-1,1.0,1.5,True,False):
                for method in ('put','delete'):
                    with self.subTest(revision=revision,method=method):
                        r=client.put(path,json={**payload,'note':'Rejected','revision':revision}) if method=='put' else client.delete(path,params={'revision':str(revision)})
                        self.assertEqual(r.status_code,422)
                        self.assertEqual(client.get(path).json(),e)
            for revision in (2,9007199254740991):
                self.assertEqual(client.put(path,json={**payload,'revision':revision}).status_code,409)
                self.assertEqual(client.delete(path,params={'revision':revision}).status_code,409)
                self.assertEqual(client.get(path).json(),e)
            self.assertEqual(client.put(path,json={**payload,'revision':1}).status_code,200)
            self.assertEqual(client.delete(path,params={'revision':1}).status_code,409)
            self.assertEqual(client.delete(path,params={'revision':2}).status_code,200)
            fresh=client.post('/entries',json=payload).json()
            self.assertEqual(client.delete('/entries/'+fresh['id'],params={'revision':1}).status_code,200)

    def test_revision_tools_strict_bounds_and_unchanged_metadata(self):
        with patch.object(plugin,'_service',return_value=api),patch.object(api,'bound_home',return_value=self.home):
            run=lambda action,args:json.loads(plugin._run(action,args))
            payload=self.entry(note='Original').model_dump();e=run('save',payload)['data']
            for revision in (9007199254740992,9223372036854775808,0,-1,1.0,1.5,True,False,'1'):
                for action in ('update','delete'):
                    with self.subTest(revision=revision,action=action):
                        args={'id':e['id'],'revision':revision}
                        if action=='update':args.update(payload,note='Rejected')
                        result=run(action,args)
                        self.assertFalse(result['ok']);self.assertIsInstance(result['error'],str)
                        self.assertEqual(self.store.get(e['id']),e)
            for revision in (2,9007199254740991):
                for action in ('update','delete'):
                    args={'id':e['id'],'revision':revision}
                    if action=='update':args.update(payload)
                    result=run(action,args)
                    self.assertFalse(result['ok']);self.assertIn('changed elsewhere',result['error'])
                    self.assertEqual(self.store.get(e['id']),e)
            self.assertTrue(run('update',{'id':e['id'],**payload,'revision':1})['ok'])
            self.assertFalse(run('delete',{'id':e['id'],'revision':1})['ok'])
            self.assertTrue(run('delete',{'id':e['id'],'revision':2})['ok'])
            fresh=run('save',payload)['data']
            self.assertTrue(run('delete',{'id':fresh['id'],'revision':1})['ok'])

    def test_tools_explicit_context_and_crud(self):
        with patch.object(plugin,'_service',return_value=api),patch.object(api,'bound_home',return_value=self.home):
            run=lambda a,x,**kw:json.loads(plugin._run(a,x,**kw))
            self.assertFalse(run('save',{'title':'x'})['ok'])
            self.assertFalse(run('save',{'title':'x','session_id':''},session_id='fictional-a')['ok'])
            e=run('save',{'title':'x'},session_id='fictional-a')['data']
            self.assertEqual(run('search',{})['data']['total'],1)
            self.assertFalse(run('search',{'limit':True})['ok'])
            u=run('update',{'id':e['id'],**self.entry().model_dump(),'revision':1});self.assertTrue(u['ok'])
            self.assertTrue(run('delete',{'id':e['id'],'revision':2})['ok'])
    def test_registration_and_no_slash_or_hooks(self):
        class Ctx:
            def __init__(self):self.tools=[]
            def register_tool(self,**kw):self.tools.append(kw)
        ctx=Ctx();plugin.register(ctx);self.assertEqual(len(ctx.tools),4)
        self.assertEqual({x['name'] for x in ctx.tools},{'conversation_bookmark_'+x for x in ('save','search','update','delete')})
    def test_cold_import_thread_safe(self):
        cold=load('bookmarks_cold',ROOT/'__init__.py')
        with ThreadPoolExecutor(8) as pool:modules=list(pool.map(lambda _:cold._service(),range(24)))
        self.assertTrue(all(m is modules[0] and hasattr(m,'Store') for m in modules))
    def test_competing_revisions_only_one_wins(self):
        e=self.create();u=api.EntryUpdate(**self.entry().model_dump(),revision=1)
        def update(_):
            try:self.store.update(e['id'],u);return 'ok'
            except HTTPException as exc:return exc.status_code
        with ThreadPoolExecutor(2) as pool:result=list(pool.map(update,range(2)))
        self.assertCountEqual(result,['ok',409])

if __name__=='__main__':unittest.main()
