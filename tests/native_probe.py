"""Native host integration probe in a disposable home; never uses a live bank."""
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

SOURCE = Path(os.environ.get('HERMES_SOURCE', Path.home()/'.hermes/hermes-agent'))
ROOT = Path(__file__).resolve().parents[1]


def prepare(home, profile='default'):
    home.mkdir(parents=True, exist_ok=True)
    package=home/'plugins/conversation-bookmarks'
    package.mkdir(parents=True)
    for filename in ('plugin.yaml','__init__.py','telegram_bookmarks.py'):
        shutil.copy2(ROOT/filename,package/filename)
    for folder in ('dashboard','desktop'):
        shutil.copytree(ROOT/folder,package/folder,ignore=shutil.ignore_patterns('__pycache__'))
    (home/'config.yaml').write_text('plugins:\n  enabled: [conversation-bookmarks]\n  isolation: in_process\n')
    import sqlite3
    from contextlib import closing
    with closing(sqlite3.connect(home/'state.db')) as db:
        db.execute('CREATE TABLE sessions(id TEXT PRIMARY KEY,profile_name TEXT,title TEXT,source TEXT,started_at REAL,ended_at REAL,last_activity_at REAL,hidden INTEGER DEFAULT 0)')
        db.execute('CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,timestamp REAL,display_kind TEXT,observed INTEGER DEFAULT 0,_compressed_summary INTEGER DEFAULT 0)')
        db.execute('CREATE INDEX idx_messages_session ON messages(session_id,timestamp)')
        db.execute("INSERT INTO sessions(id,profile_name,title,source,started_at) VALUES ('fictional-session-01',?,'Fictional source','cli',100)", (profile,))
        db.execute("INSERT INTO messages(id,session_id,role,content,timestamp) VALUES(1,'fictional-session-01','assistant','Fictional response preview',200)")
        db.commit()
    return package


def host(home):
    os.environ['HERMES_HOME']=str(home)
    os.environ['HERMES_PROFILE']='default'
    os.environ['HOME']=str(home.parent/'account')
    os.environ['HERMES_DASHBOARD_SESSION_TOKEN']='fictional-test-session'
    os.environ['HERMES_DISABLE_TELEMETRY']='1'
    sys.path.insert(0,str(SOURCE))
    from hermes_cli import web_server
    from hermes_cli.web_server_dashboard import _mount_plugin_api_routes, mount_spa
    _mount_plugin_api_routes()
    # Native order: plugin routes BEFORE catch-all, exactly as start_dashboard.
    return web_server


def probe():
    from fastapi.testclient import TestClient
    with tempfile.TemporaryDirectory(prefix='cbn-',dir=os.environ.get('TMPDIR')) as directory:
        home=Path(directory)/'home'
        prepare(home)
        ws=host(home)
        from hermes_cli.web_server_dashboard import mount_spa
        mount_spa(ws.app)
        headers={'X-Hermes-Session-Token':'fictional-test-session'}
        # No lifespan: exercise native HTTP/mount/auth without starting schedulers,
        # reconciling session banks, or invoking the host's environment bootstrap.
        from contextlib import closing
        with closing(TestClient(ws.app,base_url='http://localhost')) as client:
            prefix='/api/plugins/conversation-bookmarks'
            r=client.get(prefix+'/status')
            assert r.status_code==401,(r.status_code,r.text)
            r=client.get(prefix+'/status',headers=headers)
            assert r.status_code==200,(r.status_code,r.text)
            assert r.json()['profile']=='default'
            chooser_paths = ('/sources/sessions', '/sources/sessions/fictional-session-01/responses')
            before_chooser_source = (home/'state.db').read_bytes()
            for path in chooser_paths:
                assert client.get(prefix+path).status_code == 401
                response = client.get(prefix+path, headers=headers)
                assert response.status_code == 200, (response.status_code, response.text)
                assert response.headers['cache-control'] == 'no-store'
                assert response.json()['has_more'] is False
                assert len(response.json()['items']) == 1
            assert client.get(prefix+chooser_paths[0],headers=headers).json()['items'] == [
                {'id':'fictional-session-01','title':'Fictional source','updated_at':200.0,'source':'cli'}]
            assert client.get(prefix+chooser_paths[1],headers=headers).json()['items'] == [
                {'id':1,'preview':'Fictional response preview','created_at':200.0}]
            assert (home/'state.db').read_bytes() == before_chooser_source
            print('NATIVE CHOOSERS: both routes deny unauthenticated requests; profile-bound bounded previews, no-store and source-byte integrity passed.')
            r=client.post(prefix+'/entries',headers=headers,json={'title':'Native mount proof','session_id':'fictional-session-01'})
            assert r.status_code==201,(r.status_code,r.text)
            entry=r.json()
            assert client.get(prefix+'/entries/'+entry['id'],headers=headers).json()['title']=='Native mount proof'
            assert client.get('/dashboard-plugins/conversation-bookmarks/plugin_api.py',headers=headers).status_code in (403,404)
            assert client.get('/dashboard-plugins/conversation-bookmarks/dist/index.js',headers=headers).status_code==200
            # Exercise the installed ContextVar API, not a mocked home resolver.
            from hermes_constants import set_hermes_home_override, reset_hermes_home_override
            other=Path(directory)/'profiles'/'other'
            prepare(other, 'other')
            # Test native ContextVar home binding without asking the outer
            # host to launch an out-of-process secondary-profile service.
            import importlib.util
            spec=importlib.util.spec_from_file_location('bookmark_binding_probe',ROOT/'dashboard/plugin_api.py')
            assert spec is not None and spec.loader is not None
            module=importlib.util.module_from_spec(spec)
            sys.modules[spec.name]=module
            spec.loader.exec_module(module)
            token=set_hermes_home_override(other)
            try:
                assert module.request_store('other').search()['total']==0
                assert module.request_source('other').sessions()['items'][0]['id'] == 'fictional-session-01'
                assert module.request_source('other').responses('fictional-session-01')['items'][0]['id'] == 1
                try:
                    module.request_store('default')
                    raise AssertionError('mismatching hint accepted')
                except __import__('fastapi').HTTPException as exc:
                    assert exc.status_code==409
                assert module.bound_home()==other
            finally:
                reset_hermes_home_override(token)
            assert module.bound_home()==home
            assert client.get(prefix+'/entries',headers=headers).json()['total']==1
            # Real loader registration, native command dispatcher, native tool
            # dispatch and HTTP readback all share the fictional bound profile.
            from hermes_cli.plugins import get_plugin_command_handler
            from hermes_cli.plugin_command_dispatch import invoke_plugin_command
            from tools.registry import registry
            handler=get_plugin_command_handler('bookmark')
            assert handler is not None
            reply=invoke_plugin_command(handler, 'Approved plugin art direction #branding, plugins --description "Chosen direction"',
                                        session_id='fictional-session-01', platform='telegram')
            assert 'Saved bookmark' in reply,reply
            search_result=registry.dispatch('conversation_bookmark_search', {'tag':'plugins'},scope=str(home))
            assert isinstance(search_result,str)
            found=json.loads(search_result)
            assert found['ok'] and found['data']['total']==1,found
            saved=found['data']['items'][0]
            assert saved['title']=='Approved plugin art direction'
            assert saved['tags']==['branding','plugins']
            assert saved['session_id']=='fictional-session-01'
            assert saved['note']=='Chosen direction'
            assert client.get(prefix+'/entries/'+saved['id'],headers=headers).json()==saved
            print('NATIVE COMMAND: real loader /bookmark → native dispatcher → search tool → HTTP readback passed.')
            # Real PluginContext.inject_message and native permission/router boundary.
            # The published gateway receiver is a fixture: no model or platform transport.
            from hermes_cli.plugins import get_plugin_manager
            manager = get_plugin_manager()
            owner, queued = object(), []
            def receive(**request):
                queued.append(request)
                return True
            manager.set_gateway_message_injector(owner, receive)
            before_source = (home/'state.db').read_bytes()
            try:
                reply = invoke_plugin_command(handler, '', session_id='fictional-session-01',
                                              session_key='telegram:fictional-chat', platform='telegram')
                assert 'Bookmark not saved' in reply and 'allow_gateway_injection' in reply, reply
                assert queued == []
                (home/'config.yaml').write_text('plugins:\n  enabled: [conversation-bookmarks]\n  isolation: in_process\n  entries:\n    conversation-bookmarks:\n      allow_gateway_injection: true\n')
                reply = invoke_plugin_command(handler, 'Approved plugin art direction #branding, plugins',
                                              session_id='fictional-session-01',
                                              session_key='telegram:fictional-chat', platform='telegram')
                assert reply == '' and len(queued) == 1, (reply, queued)
                request = queued[0]
                assert request['session_key'] == 'telegram:fictional-chat'
                assert request['plugin_home'] == home
                assert request['plugin_id'] == 'conversation-bookmarks'
                payload = json.loads(request['content'].split('\nREQUEST_DATA_JSON\n', 1)[1])
                assert payload == {'session_id': 'fictional-session-01',
                                   'supplied': {'title': 'Approved plugin art direction',
                                                'tags': ['branding', 'plugins']},
                                   'missing': ['description']}, payload
                assert client.get(prefix+'/entries',headers=headers).json()['total']==2
                assert (home/'state.db').read_bytes() == before_source
                # Merely acknowledging a queued request did not perform a save.
                # Simulate the later agent's public tool calls with explicit fictional
                # metadata, NOT fabricated model output; verify through native HTTP.
                completion = registry.dispatch('conversation_bookmark_save', {
                    'title': 'Fictional generated title', 'tags': ['fictional'],
                    'note': 'Fictional agent completion fixture',
                    'session_id': 'fictional-session-01'}, scope=str(home))
                assert isinstance(completion, str)
                completed = json.loads(completion)
                assert completed['ok'], completed
                search_result = registry.dispatch('conversation_bookmark_search',
                                                  {'tag': 'fictional'}, scope=str(home))
                assert isinstance(search_result, str)
                found = json.loads(search_result)
                assert found['ok'] and found['data']['items'] == [completed['data']], found
                assert client.get(prefix+'/entries/'+completed['data']['id'],headers=headers).json()==completed['data']
                assert (home/'state.db').read_bytes() == before_source
                # Consent and target home are profile-owned, not borrowed from default.
                token = set_hermes_home_override(other)
                other_manager = get_plugin_manager()
                other_queued = []
                def receive_other(**request):
                    other_queued.append(request)
                    return True
                other_manager.set_gateway_message_injector(owner, receive_other)
                try:
                    other_handler = get_plugin_command_handler('bookmark')
                    assert other_handler is not None
                    reply = invoke_plugin_command(other_handler, '', session_id='fictional-session-01',
                                                  session_key='telegram:fictional-other', platform='telegram')
                    assert 'Bookmark not saved' in reply and 'allow_gateway_injection' in reply, reply
                    assert other_queued == [] and len(queued) == 1
                    (other/'config.yaml').write_text('plugins:\n  enabled: [conversation-bookmarks]\n  isolation: in_process\n  entries:\n    conversation-bookmarks:\n      allow_gateway_injection: true\n')
                    reply = invoke_plugin_command(other_handler, '', session_id='fictional-session-01',
                                                  session_key='telegram:fictional-other', platform='telegram')
                    assert reply == '' and len(other_queued) == 1
                    assert other_queued[0]['plugin_home'] == other
                    assert other_queued[0]['session_key'] == 'telegram:fictional-other'
                    assert module.request_store('other').search()['total'] == 0
                finally:
                    other_manager.clear_gateway_message_injector(owner)
                    reset_hermes_home_override(token)
            finally:
                manager.clear_gateway_message_injector(owner)
            print('NATIVE HANDOFF: consent denied/allowed; exact route and JSON data; no premature save; tool/HTTP completion fixture readback passed (no LLM/transport).')
            # Live effective policy gate must close an already-mounted router.
            (home/'config.yaml').write_text('plugins:\n  enabled: []\n  disabled: [conversation-bookmarks]\n  isolation: in_process\n')
            r=client.get(prefix+'/status',headers=headers)
            assert r.status_code==404,(r.status_code,r.text)
            for path in chooser_paths:
                assert client.get(prefix+path, headers=headers).status_code == 404
        print('NATIVE API: 401 unauthenticated; authenticated discovery/CRUD/readback 200/201; Python source denied; bundle served; disabled router 404.')


if __name__=='__main__':probe()
