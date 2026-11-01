"""Native authenticated HTTP → registered ctx.llm → native wire shaping.

No real credentials/network: only the provider transport is doubled. A separate
opt-in fictional-content smoke exercises the real provider.
"""
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from contextlib import closing
from unittest.mock import patch
from types import SimpleNamespace

from native_probe import prepare, host


def indexed_fixture(home):
    # prepare() serves legacy chooser tests; generation needs the ACTUAL native
    # schema, identities and materialization, not ALTERs on that small double.
    import sys
    from native_probe import SOURCE
    os.environ.update(HERMES_HOME=str(home), HOME=str(home.parent/'account'), HERMES_PROFILE='default',
                      HERMES_DISABLE_TELEMETRY='1')
    sys.path.insert(0, str(SOURCE))
    from hermes_state import SessionDB
    (home/'state.db').unlink()  # disposable fixture only
    with closing(SessionDB(home/'state.db')) as db:
        db.create_session('fictional-session-01', 'cli')
        db.append_message('fictional-session-01', 'user', 'Describe the fictional moon orchard. Its pears glow blue.')
        message_id = db.append_message('fictional-session-01', 'assistant', 'The fictional moon orchard has blue glowing pears. Harvest at moonrise.')
        db.get_messages('fictional-session-01', include_compacted=True)
    return message_id


def main():
    with tempfile.TemporaryDirectory(prefix='cb-native-gen-',dir=os.environ.get('TMPDIR')) as directory:
        home = Path(directory)/'home'
        prepare(home)
        message_id = indexed_fixture(home)
        with (home/'config.yaml').open('a') as config:
            config.write('model:\n  provider: custom\n  default: fictional-model\n  base_url: http://127.0.0.1:9/v1\n  api_key: fictional-not-a-secret\n')
        ws = host(home)
        # The dashboard API importer alone does not run the Agent registration
        # lifecycle. Prove this boundary, then exercise the real host loader.
        from fastapi.testclient import TestClient
        with closing(TestClient(ws.app,base_url='http://localhost')) as cold:
            response=cold.post('/api/plugins/conversation-bookmarks/generation/draft',
                json={'session_id':'fictional-session-01','message_id':message_id},
                headers={'X-Hermes-Session-Token':'fictional-test-session'})
            assert response.status_code==503
        from hermes_cli.plugins import discover_plugins
        discover_plugins()
        from openai.resources.chat.completions import AsyncCompletions
        calls=[]
        failure = None
        async def transport(self, **kwargs):
            calls.append(kwargs)
            if failure:
                raise failure
            return SimpleNamespace(model=kwargs['model'], choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(
                {'title':'Moon orchard','note':'Blue glowing pears, harvested at moonrise.','tags':['fiction']})))], usage=None)
        headers={'X-Hermes-Session-Token':'fictional-test-session'}
        prefix='/api/plugins/conversation-bookmarks'
        before=(home/'state.db').read_bytes()
        with closing(TestClient(ws.app,base_url='http://localhost')) as client, patch.object(AsyncCompletions,'create',transport):
            payload={'session_id':'fictional-session-01','message_id':message_id}
            for method,path,body in (('get','/generation/settings',None),('put','/generation/settings',{'previous_exchanges':0}),('post','/generation/draft',payload)):
                assert client.request(method,prefix+path,json=body).status_code == 401
            response=client.post(prefix+'/generation/draft',json=payload,headers=headers)
            assert response.status_code==200,(response.status_code,response.text)
            assert response.json()['draft']['title']=='Moon orchard'
            assert len(calls)==1
            wire=calls[0]
            assert wire['model']=='fictional-model',wire['model']
            assert 'tools' not in wire
            effort=wire.get('reasoning_effort') or wire.get('extra_body',{}).get('reasoning',{}).get('effort')
            assert effort=='minimal', sorted(wire)
            failure = ValueError('PRIVATE provider detail')
            refused=client.post(prefix+'/generation/draft',json=payload,headers=headers)
            assert refused.status_code==502
            assert 'PRIVATE' not in refused.text
            failure = None
            assert client.post(prefix+'/generation/draft',json=payload,headers=headers).status_code==200
            assert client.get(prefix+'/entries',headers=headers).json()['total']==0
            assert (home/'state.db').read_bytes()==before
            print(json.dumps({'native_http':'passed','ordinary_error':'redacted 502 then recovery','unauthenticated':'401 on all generation routes','model':wire['model'],
                'reasoning_effort':effort,'tool_loop':False,'source_unchanged':True,'draft':response.json()['draft']}))

if __name__=='__main__':
    main()
