"""Cold `serve` command → real socket → first Generate details request.

Run with Hermes-managed Python and HERMES_SOURCE pointing at the installed host.
Only fictional homes/content and a loopback OpenAI-compatible provider are used.
The child executes the real serve parser/command, discovery, router mount, ASGI
lifespan and uvicorn server. PM launch/repair are disabled in the child fixture
(to avoid install changes); no plugin/discovery/LLM/context code is patched.
This complements native_generation.py's deliberately API-import-only boundary.
"""
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ.get('HERMES_SOURCE', Path.home()/'.hermes/hermes-agent'))
SESSION = 'fictional-cold-generation'
TOKEN = 'fictional-lifecycle-token'
DRAFT = {'title': 'Moon orchard', 'note': 'Blue glowing pears, harvested at moonrise.', 'tags': ['fiction']}
EXPECTED_CONTEXT = [dict(role=role, content=f'{label} {i}') for i in range(13,22)
    for role, label in (('user','Orchard request'), ('assistant','Orchard answer'))] + [
    {'role':'user', 'content':'Preserve the moon orchard'}, {'role':'assistant', 'content':'Preserved orchard'},
    {'role':'user', 'content':'Use blue pears instead'}, {'role':'assistant', 'content':'Blue pears selected'}]


def child():
    """Native command entry; no direct call to discover_plugins or register."""
    from unittest.mock import patch
    sys.path.insert(0, str(SOURCE))
    # Prevent import-time install activation/repair. The explicitly selected
    # managed interpreter already supplies the host dependencies for this test.
    with patch('hermes_cli.venv_sync.prepare_launch', return_value=None), \
         patch('pm.environments.activate_dependencies'), \
         patch('hermes_cli._early_recovery.recover_if_needed'):
        from hermes_cli.main import cmd_dashboard
    from hermes_state import SessionDB
    from agent.context_compressor import SUMMARY_PREFIX
    from agent.prompt_builder import steer_user_row
    from agent.turn_context import compose_multimodal_context_part, append_notes_to_multimodal_content
    from agent.turn_stop_gates import _late_lsp_verdicts
    from agent.lsp import deferred
    from types import SimpleNamespace
    with closing(SessionDB()) as db:
        db.create_session('fictional-root', 'cli')
        for i in range(22):
            content = [{'type':'text', 'text':f'Orchard request {i}'}]
            append_notes_to_multimodal_content(content,
                compose_multimodal_context_part('PRIVATE recalled memory', 'PRIVATE plugin context'))
            db.append_messages_batch('fictional-root', [{'role':'user', 'content':content}])
            db.append_message('fictional-root', 'assistant', f'Orchard answer {i}')
        history = db.get_messages_as_conversation('fictional-root')
        db.publish_compression_child(parent_session_id='fictional-root', child_session_id=SESSION, source='cli',
            messages=[{'role':'user', 'content':SUMMARY_PREFIX+'\nPRIVATE summary', 'display_kind':'hidden',
                       '_compressed_summary':True}, *history[-4:]], require_compression_lease=False)
        db.append_message(SESSION, 'user', '[PRIOR CONTEXT — for reference only; not a new message]\n'
            'Preserve the moon orchard\n[END OF PRIOR CONTEXT — COMPACTION SUMMARY BELOW]\n'+SUMMARY_PREFIX+'\nPRIVATE handoff',
            display_kind='hidden', _compressed_summary=True)
        db.append_message(SESSION, 'assistant', 'Preserved orchard')
        db.append_messages_batch(SESSION, [steer_user_row('Use blue pears instead')])
        deferred.post(SESSION, 'fictional.py', 'PRIVATE late LSP diagnostics', None)
        lsp_note = _late_lsp_verdicts(SimpleNamespace(session_id=SESSION))
        assert lsp_note
        db.append_message(SESSION, 'user', lsp_note)
        db.append_message(SESSION, 'tool', 'PRIVATE tool result')
        message_id = db.append_message(SESSION, 'assistant', [
            {'type':'text', 'text':'Blue pears selected'}, {'type':'reasoning', 'text':'PRIVATE reasoning'},
            {'type':'message', 'role':'user', 'content':'PRIVATE wrong role'}])
        db.append_message(SESSION, 'user', 'FUTURE request')
        db.append_message(SESSION, 'assistant', 'FUTURE answer')
        for sid, config in (('fictional-sibling', {}), ('fictional-branch', {'_branched_from':'fictional-root'}),
                            ('fictional-delegate', {'_delegate_from':'fictional-root'})):
            db.create_session(sid, 'cli', parent_session_id='fictional-root', model_config=config)
            db.append_message(sid, 'user', 'PRIVATE unrelated assignment')
            db.append_message(sid, 'assistant', 'PRIVATE unrelated reply')
        db.get_messages('fictional-root', include_compacted=True)
        db.get_messages(SESSION, include_compacted=True)
    (Path(os.environ['HERMES_HOME'])/'fixture.json').write_text(json.dumps({'message_id': message_id}))
    from hermes_cli.subcommands.dashboard import build_serve_parser
    args = build_serve_parser(cmd_dashboard=cmd_dashboard).parse_args(
        ['--host', '127.0.0.1', '--port', '0', '--isolated'])
    cmd_dashboard(args)


def transcript(home):
    with closing(sqlite3.connect(f'file:{home}/state.db?mode=ro', uri=True)) as db:
        return (db.execute('SELECT * FROM sessions ORDER BY id').fetchall(),
                db.execute('SELECT * FROM messages ORDER BY id').fetchall())


def main():
    calls = []
    class Provider(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass
        def do_POST(self):
            request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            calls.append({'path': self.path, 'body': request})
            body = json.dumps({'id': 'fictional-completion', 'object': 'chat.completion',
                'created': 1, 'model': request['model'], 'choices': [{'index': 0,
                'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': json.dumps(DRAFT)}}],
                'usage': {'prompt_tokens': 12, 'completion_tokens': 10, 'total_tokens': 22}}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    provider = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    thread = threading.Thread(target=provider.serve_forever, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix='cb-cold-serve-', dir=os.environ.get('TMPDIR')) as directory:
            root = Path(directory)
            home = root/'home'
            package = home/'plugins/conversation-bookmarks'
            package.mkdir(parents=True)
            for name in ('plugin.yaml', '__init__.py', 'telegram_bookmarks.py'):
                shutil.copy2(ROOT/name, package/name)
            for name in ('dashboard', 'desktop'):
                shutil.copytree(ROOT/name, package/name, ignore=shutil.ignore_patterns('__pycache__'))
            (home/'config.yaml').write_text(
                'plugins:\n  enabled: [conversation-bookmarks]\n  isolation: in_process\n'
                'model:\n  provider: custom\n  default: fictional-cold-model\n'
                f'  base_url: http://127.0.0.1:{provider.server_port}/v1\n'
                '  api_key: fictional-not-a-secret\n'
                'local_runtime:\n  enabled: false\n'
                'memory:\n  memory_enabled: false\n  user_profile_enabled: false\n'
                'mcp_servers: {}\n')
            account = root/'account'
            account.mkdir()
            env = {key: os.environ[key] for key in ('PATH', 'LANG', 'LC_ALL', 'TMPDIR') if key in os.environ}
            env.update(HOME=str(account), HERMES_HOME=str(home), HERMES_PROFILE='default',
                HERMES_SOURCE=str(SOURCE), HERMES_DASHBOARD_SESSION_TOKEN=TOKEN,
                HERMES_DISABLE_TELEMETRY='1', PYTHONDONTWRITEBYTECODE='1', PYTHONUNBUFFERED='1')
            log_path = root/'serve.log'
            with log_path.open('w') as log:
                process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--child'],
                    cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 90
                port = None
                while time.monotonic() < deadline:
                    text = log_path.read_text()
                    match = re.search(r'HERMES_BACKEND_READY port=(\d+)', text)
                    if match:
                        port = int(match.group(1))
                        break
                    if process.poll() is not None:
                        raise AssertionError(f'Native serve exited {process.returncode}:\n{text}')
                    time.sleep(.1)
                assert port, 'Native serve readiness timeout:\n' + log_path.read_text()
                assert calls == [], 'No inference is allowed before explicit generation'
                base = f'http://127.0.0.1:{port}/api/plugins/conversation-bookmarks'
                message_id = json.loads((home/'fixture.json').read_text())['message_id']
                payload = {'session_id': SESSION, 'message_id': message_id}
                before = transcript(home)
                def request(path, body=None, authenticated=True):
                    headers = {'Content-Type': 'application/json'}
                    if authenticated:
                        headers['X-Hermes-Session-Token'] = TOKEN
                    req = Request(base+path, data=json.dumps(body).encode() if body is not None else None,
                                  headers=headers)
                    try:
                        with urlopen(req, timeout=60) as response:
                            return response.status, json.load(response)
                    except HTTPError as error:
                        return error.code, json.load(error)
                assert request('/generation/draft', payload, False)[0] == 401
                assert calls == []
                status, result = request('/generation/draft', payload)
                if status != 200:
                    with closing(sqlite3.connect(home/'state.db')) as db:
                        indices = db.execute('SELECT id, display_order, display_identity FROM messages ORDER BY id').fetchall()
                    raise AssertionError((status, result, indices, log_path.read_text()))
                assert result['draft'] == DRAFT, result
                assert len(calls) == 1, calls
                wire = calls[0]['body']
                assert calls[0]['path'] == '/v1/chat/completions', calls
                assert wire['model'] == 'fictional-cold-model', wire
                content = wire['messages'][-1]['content']
                assert isinstance(content, list) and len(content) == 2, content
                assert content[-1]['type'] == 'text'
                context = json.loads(content[-1]['text'])['messages']
                assert context == EXPECTED_CONTEXT, context
                assert result['context'] == {'previous_exchanges':10, 'requested_exchanges':10, 'truncated':False}, result
                assert 'PRIVATE' not in json.dumps(wire) and 'FUTURE' not in json.dumps(wire)
                assert 'tools' not in wire
                assert wire.get('reasoning_effort') == 'minimal' or wire.get('reasoning', {}).get('effort') == 'minimal', wire
                assert request('/entries')[1]['total'] == 0
                assert transcript(home) == before
                print(json.dumps({'cold_native_serve': 'passed', 'first_generation_status': status,
                    'before_any_chat_or_discovery_request': True, 'unauthenticated': 401,
                    'provider_calls': len(calls), 'model': wire['model'], 'draft': result['draft'],
                    'source_unchanged': True, 'no_bookmark_saved': True,
                    'exact_context_messages':len(context), 'context':result['context']}))
            finally:
                process.terminate()
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)
    finally:
        provider.shutdown()
        provider.server_close()
        thread.join(timeout=5)


if __name__ == '__main__':
    child() if '--child' in sys.argv else main()
