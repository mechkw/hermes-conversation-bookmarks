"""HTTP generation regressions built by the installed native SessionDB.

Only fictional temporary homes. Run with managed Python and HERMES_SOURCE (or
its default checkout); native writes/materialization belong ONLY to fixtures.
The public seams are /generation/draft, settings, and the captured LLM input.
"""
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from test_bookmarks import api, database


class NativeGenerationContextTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cb-native-context-', dir=os.environ.get('TMPDIR'))
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name) / 'home'
        self.home.mkdir()
        env = patch.dict(os.environ, HERMES_HOME=str(self.home), HOME=str(Path(self.temp.name)/'account'),
                         HERMES_PROFILE='default', HERMES_DISABLE_TELEMETRY='1')
        env.start()
        self.addCleanup(env.stop)
        source = os.environ.get('HERMES_SOURCE', '/home/ken/.hermes/hermes-agent')
        paths = patch.object(sys, 'path', [source, *sys.path])
        paths.start()
        self.addCleanup(paths.stop)
        from hermes_state import SessionDB
        self.db = SessionDB(self.home / 'state.db')
        self.addCleanup(self.db.close)
        self.db.create_session('root', 'cli')
        self.calls = []
        async def complete(**kwargs):
            self.calls.append(kwargs)
            return SimpleNamespace(parsed={'title':'Draft', 'note':'Review before saving', 'tags':['fiction']})
        binding = patch.object(api, 'bound_home', return_value=self.home)
        binding.start()
        self.addCleanup(binding.stop)
        api.bind_generation(SimpleNamespace(llm=SimpleNamespace(acomplete_structured=complete), on_unload=self.addCleanup))
        app = FastAPI()
        app.include_router(api.router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def append(self, role, content, sid='root', **kw):
        return self.db.append_message(sid, role, content, **kw)

    def materialize(self, *sids):
        for sid in sids or ('root',):
            self.db.get_messages(sid, include_compacted=True)

    def generate(self, anchor, sid='root'):
        self.materialize(sid)
        # Compare all native tables, not just bodies, and leave no bookmark saves.
        with database(self.home/'state.db') as conn:
            before = list(conn.iterdump())
        response = self.client.post('/generation/draft', json={'session_id':sid, 'message_id':anchor})
        with database(self.home/'state.db') as conn:
            self.assertEqual(list(conn.iterdump()), before)
        self.assertEqual(self.client.get('/entries').json()['total'], 0)
        return response

    def messages(self):
        return json.loads(self.calls[-1]['input'][0]['text'])['messages']

    def test_long_reset_history_does_not_require_unrelated_ancestry(self):
        # Live Telegram shape: 36 raw ancestors, but only four compression
        # segments in this conversation. Prior resets are not resume context.
        parent = 'root'
        for i in range(35):
            sid = f'continued-{i}'
            self.db.end_session(parent, 'compression' if i >= 32 else 'session_reset')
            self.db.create_session(sid, 'telegram', parent_session_id=parent,
                model_config={'_reset_from': parent} if i == 31 else {})
            parent = sid
        self.append('user', 'Current human request', parent)
        anchor = self.append('assistant', 'Current human answer', parent)
        response = self.generate(anchor, parent)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.messages(), [{'role':'user','content':'Current human request'},
                                          {'role':'assistant','content':'Current human answer'}])

    def test_mixed_legacy_parent_index_is_read_only_and_keeps_latest_request(self):
        # Live Desktop shape: indexed tip, one unindexed ordinary user in its
        # compression parent. Opening the tip does not backfill that parent.
        self.append('user', 'Original request', timestamp=10)
        self.append('assistant', 'Original answer', timestamp=11)
        unindexed = self.append('user', 'Latest human request', timestamp=12)
        self.append('assistant', 'Earlier progress', timestamp=13)
        first = self.db.get_messages_as_conversation('root')[0]
        self.db.publish_compression_child(parent_session_id='root', child_session_id='tip', source='desktop',
            messages=[first], require_compression_lease=False)
        anchor = self.append('assistant', 'Selected answer', 'tip', timestamp=14)
        self.materialize('root', 'tip')
        with database(self.home/'state.db') as conn:
            conn.execute('UPDATE messages SET display_identity=NULL,display_order=NULL WHERE id=?', (unindexed,))
        with patch.object(self, 'materialize'):
            response = self.generate(anchor, 'tip')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.messages(), [
            {'role':'user','content':'Original request'}, {'role':'assistant','content':'Original answer'},
            {'role':'user','content':'Latest human request'}, {'role':'assistant','content':'Selected answer'}])
        self.assertFalse(response.json()['context']['truncated'])

    def test_pruned_parent_uses_only_proven_local_history_and_reports_shortfall(self):
        with database(self.home/'state.db') as conn:
            conn.execute("UPDATE sessions SET parent_session_id='pruned-parent' WHERE id='root'")
        self.append('user', 'Retained human request')
        anchor = self.append('assistant', 'Retained answer')
        response = self.generate(anchor)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['context'],
                         {'previous_exchanges':0, 'requested_exchanges':10, 'truncated':True})
        self.assertEqual(self.messages(), [{'role':'user','content':'Retained human request'},
                                          {'role':'assistant','content':'Retained answer'}])
        self.client.put('/generation/settings', json={'previous_exchanges':0})
        self.assertFalse(self.generate(anchor).json()['context']['truncated'])
        # A missing parent cannot justify inventing a missing focal request.
        self.db.create_session('orphan-answer', 'desktop')
        with database(self.home/'state.db') as conn:
            conn.execute("UPDATE sessions SET parent_session_id='pruned-parent' WHERE id='orphan-answer'")
        orphan = self.append('assistant', 'No retained human request', 'orphan-answer')
        self.assertEqual(self.generate(orphan, 'orphan-answer').status_code, 422)

    def test_unindexed_legacy_order_dedupes_without_hydrating_future_bodies(self):
        from contextlib import contextmanager
        self.append('user', 'First request', timestamp=100)
        self.append('assistant', 'First answer', timestamp=99)
        self.append('user', 'Selected request', timestamp=98)
        anchor = self.append('assistant', 'Selected answer', timestamp=97)
        future_user = self.append('user', 'FUTURE request', timestamp=1)
        future_answer = self.append('assistant', 'FUTURE answer', timestamp=2)
        with database(self.home/'state.db') as conn:
            # A carried earlier answer can have a later physical id. The native
            # legacy first-identity rule, not timestamps, defines its cutoff.
            conn.execute('''INSERT INTO messages(session_id,role,content,timestamp,active)
                SELECT session_id,role,content,timestamp,active FROM messages WHERE id=?''', (anchor,))
            carried = conn.execute('SELECT max(id) FROM messages').fetchone()[0]
            conn.execute('UPDATE messages SET display_identity=NULL,display_order=NULL')
        queries = []
        original = api.SourceAdapter.chooser_connection
        @contextmanager
        def trace(source):
            with original(source) as conn:
                conn.set_trace_callback(queries.append)
                yield conn
        with patch.object(self, 'materialize'), patch.object(api.SourceAdapter, 'chooser_connection', trace):
            response = self.generate(carried)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([m['content'] for m in self.messages()],
                         ['First request', 'First answer', 'Selected request', 'Selected answer'])
        # Query trace contains fictional SQL only. Verify no SELECT returning a
        # body touched either future row, even in the legacy identity pass.
        body_reads = [q for q in queries if ' AS content FROM messages' in q or 'THEN content ELSE NULL END FROM messages' in q]
        self.assertTrue(body_reads)
        for mid in (future_user, future_answer):
            self.assertFalse(any(f'id={mid}' in q or f'id = {mid}' in q for q in body_reads), body_reads)

    def test_unsupported_legacy_carrier_is_a_barrier_not_an_older_request(self):
        self.append('user', [{'type':'text','text':'Older rich request'}])
        self.append('assistant', 'Older answer')
        self.append('user', 'Focal request')
        anchor = self.append('assistant', 'Focal answer')
        self.materialize()
        with database(self.home/'state.db') as conn:
            conn.execute("UPDATE messages SET display_identity=NULL,display_order=NULL WHERE role='user' AND id=(SELECT min(id) FROM messages)")
        with patch.object(self, 'materialize'):
            response = self.generate(anchor)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['context']['truncated'])
        self.assertEqual(self.messages(), [{'role':'user','content':'Focal request'},
                                          {'role':'assistant','content':'Focal answer'}])
        # The exact same unsupported legacy row is fatal when it is focal.
        with patch.object(self, 'materialize'):
            response = self.generate(anchor-2)
        self.assertEqual(response.status_code, 422)

    def test_missing_slot_uses_native_identity_but_malformed_identity_still_rejects(self):
        user = self.append('user', 'Human request')
        anchor = self.append('assistant', 'Human answer')
        self.materialize()
        with database(self.home/'state.db') as conn:
            conn.execute('UPDATE messages SET display_order=NULL WHERE id=?', (user,))
        with patch.object(self, 'materialize'):
            response = self.generate(anchor)
        self.assertEqual(response.status_code, 200, response.text)
        for value in ('not-a-native-digest', b'bad'):
            with database(self.home/'state.db') as conn:
                conn.execute('UPDATE messages SET display_identity=? WHERE id=?', (value, user))
            with patch.object(self, 'materialize'):
                self.assertEqual(self.generate(anchor).status_code, 422)

    def test_unindexed_future_tombstone_cannot_resurrect_selected_answer(self):
        self.append('user', 'Human request')
        anchor = self.append('assistant', 'Human answer')
        self.materialize()
        with database(self.home/'state.db') as conn:
            conn.execute('''INSERT INTO messages(session_id,role,content,timestamp,active,compacted)
                SELECT session_id,role,content,timestamp,0,0 FROM messages WHERE id=?''', (anchor,))
        with patch.object(self, 'materialize'):
            response = self.generate(anchor)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.calls, [])

    def test_explicit_boundary_still_checks_known_parent_provenance(self):
        for i, (column, value) in enumerate((('profile_name','foreign'), ('hidden',1),
                                            ('model_config','{"_delegate_from":"worker"}'))):
            parent = f'boundary-parent-{i}'
            child = f'boundary-child-{i}'
            self.db.create_session(parent, 'desktop')
            self.db.create_session(child, 'desktop', parent_session_id=parent,
                                   model_config={'_branched_from':parent})
            with database(self.home/'state.db') as conn:
                conn.execute(f'UPDATE sessions SET {column}=? WHERE id=?', (value,parent))
            self.append('user', 'Copied request', child)
            anchor = self.append('assistant', 'Copied answer', child)
            self.assertIn(self.generate(anchor, child).status_code, (404,422))
        self.assertEqual(self.calls, [])

    def test_native_memory_parts_are_not_human_context(self):
        from agent.turn_context import compose_multimodal_context_part, append_notes_to_multimodal_content
        anchor = None
        for i in range(2):
            content = [{'type':'text', 'text':f'Human request {i}'},
                       {'type':'image_url', 'image_url':{'url':'data:image/png;base64,PRIVATE'}}]
            self.assertTrue(append_notes_to_multimodal_content(content,
                compose_multimodal_context_part('PRIVATE_RECALLED_MEMORY', 'PRIVATE_PLUGIN_CONTEXT')))
            self.append('user', content)
            anchor = self.append('assistant', f'Human answer {i}')
        for previous in (0, 1):
            self.client.put('/generation/settings', json={'previous_exchanges':previous})
            response = self.generate(anchor)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.messages(), [dict(role=role, content=f'Human {label} {i}')
                for i in range(1-previous, 2) for role, label in (('user','request'), ('assistant','answer'))])
            self.assertFalse(response.json()['context']['truncated'])
        self.assertNotIn('PRIVATE', json.dumps(self.calls))

    def test_native_late_lsp_rows_do_not_replace_human_requests(self):
        from agent.lsp import deferred
        from agent.turn_stop_gates import apply_stop_gates
        from tools.file_operations_lint import _format_lsp_block
        anchor = None
        for i in range(2):
            self.append('user', f'Human request {i}')
            agent = SimpleNamespace(session_id=f'fixture-{self.temp.name}-{i}',
                _emit_interim_assistant_message=lambda row: None,
                _flush_messages_to_session_db=lambda *args: None,
                _interim_content_was_streamed=lambda text: False)
            path = str(self.home/'PRIVATE.py')
            note = _format_lsp_block(path, [{'severity':1, 'message':'PRIVATE_DIAGNOSTIC'}],
                f'LSP diagnostics introduced by your earlier edit of {path} '
                '(the language server answered after that tool result returned):\n')
            deferred.post(agent.session_id, path, note, None)
            self.addCleanup(deferred.pop_notes, agent.session_id)
            rows = []
            verdict = apply_stop_gates(agent, {'role':'assistant', 'content':f'Interim answer {i}'},
                final_response=f'Interim answer {i}', messages=rows, conversation_history=[],
                pending_verification_response=None, pending_verification_response_previewed=False)
            self.assertTrue(verdict.continue_turn)
            self.assertEqual(rows[-1]['role'], 'user')
            self.assertNotIn('display_kind', rows[-1])
            self.db.append_messages_batch('root', rows)
            anchor = self.append('assistant', f'Final answer {i}')
        for previous in (0, 1):
            self.client.put('/generation/settings', json={'previous_exchanges':previous})
            response = self.generate(anchor)
            self.assertEqual(response.status_code, 200, response.text)
            expected = ([{'role':'user','content':'Human request 0'},
                         {'role':'assistant','content':'Interim answer 0'},
                         {'role':'assistant','content':'Final answer 0'}] if previous else [])
            self.assertEqual(self.messages(), expected + [{'role':'user','content':'Human request 1'},
                                                         {'role':'assistant','content':'Final answer 1'}])
            self.assertEqual(response.json()['context']['previous_exchanges'], previous)
        self.assertNotIn('PRIVATE', json.dumps(self.calls))

    def test_native_gateway_note_siblings_preserve_rich_and_durable_human_text(self):
        from agent.turn_context import _merge_gateway_notes
        from agent.session_persistence import _durable_content
        from agent.plugin_live_notes import queue_plugin_notice
        from agent.skills_index_delta import _render
        from agent.surface_switch import stage_surface_switch_note
        from agent.prompt_builder import hud_surface_note, bot_screen_note
        from agent.onboarding import PLAIN_INTRO_NOTE, profile_build_directive
        from agent.onboarding_text import turn_note
        from agent.lsp import deferred
        from tools.file_operations_lint import _format_lsp_block
        from tools.voice_live import voice_live_turn_note
        from tools.tts_streaming import SPEECH_INTERRUPTED_NOTE
        from hermes_cli.plugins_activation_live import live_notice
        from gateway.session import build_channel_continuity_note, Platform, SessionSource, SessionEntry
        from gateway.run import _AUTO_RESET_CONTEXT_NOTES
        from gateway.run_agent_cache import GatewayAgentCacheMixin
        from tools.hook_output_spill import spill_if_oversized
        from datetime import datetime
        from unittest.mock import MagicMock
        voice_state = SimpleNamespace(conversation=SimpleNamespace(vc_last=None))
        gateway = MagicMock(spec=GatewayAgentCacheMixin)
        gateway._delivery_adapter_for = MagicMock(return_value=SimpleNamespace(get_voice_channel_context=lambda guild: 'PRIVATE VC'))
        gateway._get_guild_id = MagicMock(return_value='fictional')
        gateway._session_state = MagicMock(return_value=voice_state)
        voice_source = SessionSource(platform=Platform.DISCORD, chat_id='fictional', thread_id='fictional')
        voice_note = GatewayAgentCacheMixin._voice_channel_sidecar_note(gateway, None, voice_source, 'fixture')
        continuity = build_channel_continuity_note(SessionEntry(
            session_key='fictional', session_id='fictional', created_at=datetime(2000, 1, 1), updated_at=datetime(2000, 1, 1),
            prev_session_id='PRIVATE-prior', reset_had_activity=True), voice_source)
        spill_config = {'enabled':True, 'max_chars':20, 'preview_head':30, 'preview_tail':30,
                        'directory':str(self.home/'spills')}
        spilled = spill_if_oversized('PRIVATE hook context '*10, session_id='root', source='plugin hook', config=spill_config)
        with patch('tools.spill_safety.write_text_exclusive', side_effect=OSError('fictional failure')):
            failed_spill = spill_if_oversized('PRIVATE hook context '*10, session_id='root', source='plugin hook', config=spill_config)
        surface = SimpleNamespace(platform='desktop', session_id='fictional')
        with patch('agent.system_prompt.platform_hint', return_value='PRIVATE interface guidance'):
            self.assertTrue(stage_surface_switch_note(surface, 'Platform: cli', []))
        notes = [
            live_notice({'name':'PRIVATE', 'live_now':{'skills':[{'name':'PRIVATE-skill'}]}}),
            surface._surface_switch_note,
            _render({'PRIVATE':'    - PRIVATE: private description'}, {'PRIVATE-removed'}),
            _render({}, set()),
            hud_surface_note({'read_window_below', 'computer_use'}),
            voice_live_turn_note('PRIVATE spoken context'), SPEECH_INTERRUPTED_NOTE,
            bot_screen_note(True, ':PRIVATE', 'human'), bot_screen_note(False, ':PRIVATE', ''),
            PLAIN_INTRO_NOTE, profile_build_directive(),
            turn_note({'beats':{'name':'pending'}}),
            voice_note, continuity, *_AUTO_RESET_CONTEXT_NOTES.values(), spilled, failed_spill,
        ]
        path = str(self.home/'PRIVATE.py')
        diagnostic = _format_lsp_block(path, [{'severity':1,'message':'PRIVATE_DIAGNOSTIC'}],
            f'LSP diagnostics introduced by your earlier edit of {path} '
            '(the language server answered after that tool result returned):\n')
        notes.append(diagnostic)
        for n, note in enumerate(notes):
            self.assertTrue(note, n)
            for durable in (False, True):
                sid = f'note-{n}-{durable}'
                self.db.create_session(sid, 'cli')
                anchor = None
                for i in range(2):
                    rows = [{'role':'user','content':[{'type':'text','text':f'Human request {i}'}]}]
                    agent = SimpleNamespace(session_id=sid)
                    if note == diagnostic:
                        deferred.post(sid, path, note, None)
                        self.addCleanup(deferred.pop_notes, sid)
                    else:
                        queue_plugin_notice(agent, 'fixture', note)
                    self.assertEqual(_merge_gateway_notes(agent, rows, 0, ''), '')
                    if durable:
                        rows[0]['content'] = _durable_content(rows[0]['content'])
                    self.db.append_messages_batch(sid, rows)
                    anchor = self.append('assistant', f'Human answer {i}', sid)
                for previous in (0, 1):
                    with self.subTest(note=n, durable=durable, previous=previous):
                        self.client.put('/generation/settings', json={'previous_exchanges':previous})
                        response = self.generate(anchor, sid)
                        self.assertEqual(response.status_code, 200, response.text)
                        self.assertEqual(self.messages(), [dict(role=role, content=f'Human {label} {i}')
                            for i in range(1-previous, 2)
                            for role, label in (('user','request'), ('assistant','answer'))])
                        self.assertFalse(response.json()['context']['truncated'])
        self.assertNotIn('PRIVATE', json.dumps(self.calls))

    def test_nested_and_damaged_memory_carriers_fail_closed_when_unseparable(self):
        from agent.turn_context import compose_multimodal_context_part, append_notes_to_multimodal_content
        from agent.session_persistence import _durable_content
        from agent.prompt_builder import steer_user_row
        memory = compose_multimodal_context_part('PRIVATE_MEMORY', 'PRIVATE_PLUGIN')
        assert isinstance(memory, str)
        self.append('user', 'Old request must not replace a damaged human turn')
        self.append('assistant', 'Old reply')
        self.client.put('/generation/settings', json={'previous_exchanges':0})
        nested = memory.replace('PRIVATE_MEMORY', '<memory-context>\nPRIVATE_NESTED\n</memory-context>')
        for content in (
            [{'type':'message','role':'user','content':[{'type':'text','text':'Genuine question'},
                {'type':'text','text':nested}]}],
            _durable_content([{'type':'text','text':'Genuine question'}, {'type':'text','text':nested}]),
            [ {'type':'text','text':'Genuine question'}, {'type':'text','text':memory},
              {'type':'text','text':'Genuine final clause'} ],
        ):
            self.append('user', content)
            anchor = self.append('assistant', 'Visible answer')
            response = self.generate(anchor)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.messages()[0]['content'], 'Genuine question' +
                (' Genuine final clause' if isinstance(content, list) and len(content) == 3 else ''))
        bad = (
            memory.replace('</memory-context>', ''),
            memory.replace('<memory-context>', '<memory-context'),
            memory.replace('<memory-context>', ''),
            memory.replace('PRIVATE_MEMORY', '<memory-context>\nPRIVATE_NESTED'),
            memory.replace('</memory-context>', '</memory-context>\n</memory-context>'),
        )
        for i, damaged in enumerate(bad):
            with self.subTest(damage=i):
                parts = [{'type':'text','text':'Genuine question'}]
                append_notes_to_multimodal_content(parts, damaged)
                parts.append({'type':'text','text':'PRIVATE possible continuation of broken frame'})
                self.append('user', parts)
                anchor = self.append('assistant', 'Reply to unreadable context')
                before = len(self.calls)
                self.assertEqual(self.generate(anchor).status_code, 422)
                self.assertEqual(len(self.calls), before)
        self.db.append_messages_batch('root', [steer_user_row('Genuine question\n'+memory)])
        anchor = self.append('assistant', 'Reply to wrapped steer')
        response = self.generate(anchor)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.messages()[0]['content'], 'Genuine question')
        self.assertNotIn('PRIVATE', json.dumps(self.calls))

    def test_note_only_media_request_never_substitutes_an_older_human(self):
        from agent.turn_context import append_notes_to_multimodal_content
        from agent.onboarding import PLAIN_INTRO_NOTE
        from agent.skills_index_delta import _render
        self.client.put('/generation/settings', json={'previous_exchanges':0})
        for i, note in enumerate((PLAIN_INTRO_NOTE, _render({}, set()))):
            sid = f'image-note-{i}'
            self.db.create_session(sid, 'cli')
            self.append('user', 'Old request', sid)
            self.append('assistant', 'Old answer', sid)
            parts = [{'type':'image_url','image_url':{'url':'data:image/png;base64,PRIVATE'}}]
            append_notes_to_multimodal_content(parts, note)
            self.append('user', parts, sid)
            anchor = self.append('assistant', 'Answer about the image', sid)
            self.assertEqual(self.generate(anchor, sid).status_code, 422)
        self.assertEqual(self.calls, [])

    def test_ordinary_prose_mentions_and_multiple_human_blocks_are_not_stripped(self):
        prose = [
            'Explain <memory-context> tags and </memory-context> closing tags.',
            'What does [System note: plugin Example was installed and is live in this chat now '
            '(a Hermes note, not tool output).] mean?',
            '[System note: my own label for a database migration question]',
            '[Note: please preserve this ordinary note.]',
            'LSP diagnostics introduced by your earlier edit of this example are worth discussing.',
            'Bot Screen: how does this work?',
            'The terms PRIVATE_RECALLED_MEMORY and PRIVATE_PLUGIN_CONTEXT are ordinary identifiers.',
        ]
        self.client.put('/generation/settings', json={'previous_exchanges':0})
        for text in prose:
            self.append('user', [{'type':'text','text':text}, {'type':'text','text':'Keep this second paragraph.'}])
            anchor = self.append('assistant', 'Visible answer')
            response = self.generate(anchor)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.messages()[0]['content'], text+' Keep this second paragraph.')

    def test_native_multimodal_backfill_and_string_sidecar_do_not_disclose_injections(self):
        from agent.turn_context import _append_multimodal_context, compose_user_api_content
        for compacted in (False, True):
            content = [{'type':'text','text':'Backfilled human request'}]
            uid = self.append('user', content)
            row = {'role':'user','content':content, '_row_id':uid}
            agent = SimpleNamespace(session_id='root', _session_db=self.db)
            _append_multimodal_context(agent, row, 'PRIVATE_MEMORY', 'PRIVATE_PLUGIN',
                                      preflight_compressed=compacted)
            anchor = self.append('assistant', 'Backfilled answer')
            self.client.put('/generation/settings', json={'previous_exchanges':0})
            response = self.generate(anchor)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.messages(), [{'role':'user','content':'Backfilled human request'},
                                              {'role':'assistant','content':'Backfilled answer'}])
        self.append('user', 'Clean human request',
            api_content=compose_user_api_content('Clean human request', 'PRIVATE_MEMORY', 'PRIVATE_PLUGIN'))
        anchor = self.append('assistant', 'Clean answer')
        self.assertEqual(self.generate(anchor).status_code, 200)
        self.assertEqual(self.messages()[0]['content'], 'Clean human request')
        self.assertNotIn('PRIVATE', json.dumps(self.calls))

    def test_other_native_stop_gates_are_ephemeral_before_sessiondb_projection(self):
        from agent.turn_stop_gates import apply_stop_gates
        from agent.session_persistence import _db_flush_collect
        from agent.verification_stop import build_verify_on_stop_nudge
        from agent.kanban_stop import build_kanban_stop_nudge
        from hermes_cli.plugins import get_pre_verify_continue_message
        with patch('agent.verification_stop._verification_snapshot', return_value=(
                {'status':'unverified'}, {'verifyCommands':['PRIVATE_check']})), \
             patch('agent.verification_stop.last_unattributed_run', return_value=None), \
             patch('agent.verification_stop._workspace_has_runnable_recipe', return_value=False), \
             patch('agent.verify_hooks.coding_verify_guidance', return_value=None):
            verify = build_verify_on_stop_nudge(session_id='root', changed_paths=[str(self.home/'PRIVATE.py')])
        with patch('hermes_cli.plugins.invoke_hook', return_value=[{'action':'continue','message':'PRIVATE hook guidance'}]):
            pre_verify = get_pre_verify_continue_message(changed_paths=['PRIVATE.py'])
        with patch('agent.kanban_stop.kanban_stop_nudge_enabled', return_value=True):
            kanban = build_kanban_stop_nudge(task_id='PRIVATE_task')
        cases = ((verify, None, None), (None, pre_verify, None), (None, None, kanban))
        for i, nudges in enumerate(cases):
            self.assertTrue(any(nudges))
            agent = SimpleNamespace(session_id='root',
                _emit_interim_assistant_message=lambda row: None,
                _flush_messages_to_session_db=lambda *args: None,
                _interim_content_was_streamed=lambda text: False,
                _emit_diagnostic_status=lambda text: None)
            rows = [{'role':'user','content':f'Human request {i}'}]
            with patch('agent.turn_stop_gates._late_lsp_verdicts', return_value=None), \
                 patch('agent.turn_stop_gates._verify_on_stop_nudge', return_value=nudges[0]), \
                 patch('agent.turn_stop_gates._pre_verify_nudge', return_value=nudges[1]), \
                 patch('agent.turn_stop_gates._kanban_stop_nudge', return_value=nudges[2]):
                self.assertTrue(apply_stop_gates(agent, {'role':'assistant','content':'Interim answer'},
                    final_response='Interim answer', messages=rows, conversation_history=[],
                    pending_verification_response=None, pending_verification_response_previewed=False).continue_turn)
            durable, _ = _db_flush_collect(agent, rows, [])
            self.assertFalse(any('PRIVATE' in str(row['content']) for row in durable))
            self.db.append_messages_batch('root', durable)
            anchor = self.append('assistant', f'Final answer {i}')
            self.client.put('/generation/settings', json={'previous_exchanges':0})
            response = self.generate(anchor)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.messages(), [{'role':'user','content':f'Human request {i}'},
                                              {'role':'assistant','content':f'Final answer {i}'}])
        self.assertNotIn('PRIVATE', json.dumps(self.calls))

    def test_summary_projection_precedes_memory_removal_without_losing_live_question(self):
        from agent.turn_context import compose_multimodal_context_part
        from agent.context_compressor import SUMMARY_PREFIX
        memory = compose_multimodal_context_part('PRIVATE recalled', 'PRIVATE plugin')
        assert isinstance(memory, str)
        self.append('user', 'Old request')
        self.append('assistant', 'Old answer')
        self.client.put('/generation/settings', json={'previous_exchanges':0})
        end = '\n--- END OF CONTEXT SUMMARY — respond to the message below, not the summary above ---\n'
        for content in (
            SUMMARY_PREFIX+'\n'+memory+end+'Genuine question',
            [{'type':'text','text':SUMMARY_PREFIX+'\n'+memory+end},
             {'type':'text','text':'Genuine question'}, {'type':'text','text':memory}],
            '[PRIOR CONTEXT — for reference only; not a new message]\nGenuine question\n'
            '[END OF PRIOR CONTEXT — COMPACTION SUMMARY BELOW]\n'+SUMMARY_PREFIX+'\n'+memory,
        ):
            self.append('user', content, display_kind='hidden', _compressed_summary=True)
            anchor = self.append('assistant', 'Visible answer')
            response = self.generate(anchor)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.messages()[0]['content'], 'Genuine question')
        self.assertNotIn('PRIVATE', json.dumps(self.calls))

    def test_human_steer_and_summary_carrier_are_the_immediate_request(self):
        from agent.prompt_builder import steer_user_row
        from agent.context_compressor import SUMMARY_PREFIX
        self.append('user', 'Older request must not replace the current input')
        self.append('assistant', 'Older reply')
        self.client.put('/generation/settings', json={'previous_exchanges':0})
        carriers = [
            steer_user_row('Use the blue orchard instead.'),
            {'role':'user', 'display_kind':'hidden', '_compressed_summary':True,
             'content':'[PRIOR CONTEXT — for reference only; not a new message]\nCurrent carried request\n'
                       '[END OF PRIOR CONTEXT — COMPACTION SUMMARY BELOW]\n' + SUMMARY_PREFIX + '\nPRIVATE summary'},
            {'role':'user', 'display_kind':'hidden', '_compressed_summary':True,
             'content':[{'type':'text', 'text':SUMMARY_PREFIX + '\nPRIVATE summary\n'
                 '--- END OF CONTEXT SUMMARY — respond to the message below, not the summary above ---\n'},
                 {'type':'text', 'text':'Current rich request'},
                 {'type':'message', 'role':'assistant', 'content':'PRIVATE wrong role'},
                 {'type':'reasoning', 'text':'PRIVATE reasoning'}]},
        ]
        for carrier, expected in zip(carriers, ('Use the blue orchard instead.', 'Current carried request', 'Current rich request')):
            self.db.append_messages_batch('root', [carrier])
            self.append('user', 'PRIVATE notification', display_kind='notification')
            self.append('tool', 'PRIVATE tool')
            anchor = self.append('assistant', 'Visible reply')
            response = self.generate(anchor)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.messages(), [{'role':'user', 'content':expected}, {'role':'assistant', 'content':'Visible reply'}])
            self.assertNotIn('PRIVATE', json.dumps(self.calls))

    def test_delegate_and_malformed_provenance_rejected_before_inference(self):
        self.append('user', 'Real human request')
        self.append('assistant', 'Real response')
        for i, config in enumerate(({'_delegate_from':'root'}, {'_delegate_from':''}, {'_delegate_from':None}, [], '{broken')):
            sid = 'child-' + str(i)
            self.db.create_session(sid, 'cli', parent_session_id='root', model_config=config)
            if not isinstance(config, dict):
                # Native creation normalizes falsey config; corruption injection
                # tests the read boundary, never fabricates the native schema.
                with database(self.home/'state.db') as conn:
                    conn.execute('UPDATE sessions SET model_config=? WHERE id=?',
                                 (json.dumps(config) if isinstance(config, list) else config, sid))
            self.append('user', 'PRIVATE internal delegated assignment', sid)
            anchor = self.append('assistant', 'PRIVATE worker response', sid)
            response = self.generate(anchor, sid)
            self.assertIn(response.status_code, (404, 422), response.text)
        self.db.create_session('delegate', 'telegram', parent_session_id='root', model_config={'_delegate_from':'root'})
        self.db.end_session('delegate', 'compression')
        self.db.create_session('delegate-continuation', 'telegram', parent_session_id='delegate')
        self.append('user', 'PRIVATE inherited assignment', 'delegate-continuation')
        anchor = self.append('assistant', 'PRIVATE inherited result', 'delegate-continuation')
        self.assertIn(self.generate(anchor, 'delegate-continuation').status_code, (404, 422))
        self.assertEqual(self.calls, [])

    def test_compression_ancestry_deduplicates_and_cuts_off_at_selected_response(self):
        self.client.put('/generation/settings', json={'previous_exchanges': 20})
        from agent.context_compressor import SUMMARY_PREFIX
        for i in range(24):
            self.append('user', f'Request {i}', timestamp=200-i)
            self.append('assistant', f'Answer {i}', timestamp=200-i)
        self.materialize()
        tail = self.db.get_messages_as_conversation('root')[-4:]
        self.db.publish_compression_child(parent_session_id='root', child_session_id='tip', source='cli',
            messages=[{'role':'user', 'content':SUMMARY_PREFIX+'\nPRIVATE summary', '_compressed_summary':True,
                       'display_kind':'hidden'}, *tail], require_compression_lease=False)
        self.append('user', 'Current request', 'tip')
        anchor = self.append('assistant', 'Current answer', 'tip')
        self.append('user', 'FUTURE tip request', 'tip')
        self.append('assistant', 'FUTURE tip answer', 'tip')
        for sid, config in (('sibling', {}), ('branch', {'_branched_from':'root'}), ('worker', {'_delegate_from':'root'})):
            self.db.create_session(sid, 'cli', parent_session_id='root', model_config=config)
            self.append('user', 'PRIVATE unrelated request', sid)
            self.append('assistant', 'PRIVATE unrelated answer', sid)
        self.materialize('root', 'tip')
        response = self.generate(anchor, 'tip')
        self.assertEqual(response.status_code, 200, response.text)
        expected = [dict(role=role, content=f'{label} {i}') for i in range(4,24)
                    for role, label in (('user','Request'), ('assistant','Answer'))]
        expected += [{'role':'user','content':'Current request'}, {'role':'assistant','content':'Current answer'}]
        self.assertEqual(self.messages(), expected)
        self.assertEqual(response.json()['context'], {'previous_exchanges':20, 'requested_exchanges':20, 'truncated':False})
        # Selecting a carried old answer must not collect newer ancestor turns.
        carried = next(m['id'] for m in self.db.get_messages('tip', include_compacted=True) if m['content']=='Answer 22')
        response = self.generate(carried, 'tip')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([m['content'] for m in self.messages()],
                         [f'{label} {i}' for i in range(2,23) for label in ('Request','Answer')])
        self.assertNotIn('FUTURE', json.dumps(self.calls))
        self.assertNotIn('PRIVATE', json.dumps(self.calls))

    def test_unreadable_immediate_native_human_input_never_uses_older_request(self):
        from agent.prompt_builder import steer_user_row
        from agent.context_compressor import SUMMARY_PREFIX
        self.append('user', 'Old request')
        self.append('assistant', 'Old answer')
        invalid = [
            {'role':'user', 'content':[{'type':'message', 'role':'assistant', 'content':'PRIVATE'}]},
            steer_user_row('x'*65537),
            {'role':'user', 'display_kind':'steer', 'content':'[OUT-OF-BAND corrupt wrapper'},
            {'role':'user', 'display_kind':'hidden', '_compressed_summary':True, 'content':'broken carrier'},
            {'role':'user', 'display_kind':'hidden', '_compressed_summary':True,
             'content':SUMMARY_PREFIX+'\n--- END OF CONTEXT SUMMARY — respond to the message below, not the summary above ---\n<analysis>PRIVATE'},
        ]
        for i, row in enumerate(invalid):
            self.db.append_messages_batch('root', [row])
            anchor = self.append('assistant', f'Answer to invalid {i}')
            self.assertEqual(self.generate(anchor).status_code, 422, i)
        self.assertEqual(self.calls, [])

    def test_legacy_summary_human_projection_and_input_text_blocks(self):
        from agent.context_compressor import SUMMARY_PREFIX
        self.append('user', 'Old request')
        self.append('assistant', 'Old answer')
        self.append('user', SUMMARY_PREFIX + '\nPRIVATE summary\n'
                    '--- END OF CONTEXT SUMMARY — respond to the message below, not the summary above ---\nLive request',
                    display_kind='hidden')
        anchor = self.append('assistant', 'Live answer')
        self.client.put('/generation/settings', json={'previous_exchanges':0})
        self.assertEqual(self.generate(anchor).status_code, 200)
        self.assertEqual(self.messages()[0]['content'], 'Live request')
        self.append('user', [{'type':'input_text','text':'Native input text'}, {'type':'reasoning','text':'PRIVATE'}])
        anchor = self.append('assistant', 'Input answer')
        self.assertEqual(self.generate(anchor).status_code, 200)
        self.assertEqual(self.messages()[0]['content'], 'Native input text')
        self.assertNotIn('PRIVATE', json.dumps(self.calls))

    def test_in_place_compaction_retains_earlier_human_copy_without_future_text(self):
        from agent.context_compressor import SUMMARY_PREFIX
        self.append('user', 'Protected original request')
        anchor = self.append('assistant', 'Archived selected answer')
        self.append('user', 'FUTURE request')
        self.append('assistant', 'FUTURE answer')
        history = self.db.get_messages_as_conversation('root', include_row_ids=True)
        carried = [history[0], *history[-2:]]
        self.db.archive_and_compact('root', [history[0],
            {'role':'user', 'content':SUMMARY_PREFIX+'\nPRIVATE summary', '_compressed_summary':True, 'display_kind':'hidden'},
            *history[-2:]], carried_messages=carried)
        response = self.generate(anchor)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.messages(), [{'role':'user','content':'Protected original request'},
                                          {'role':'assistant','content':'Archived selected answer'}])
        self.assertFalse(response.json()['context']['truncated'])

    def test_branch_reset_and_inherited_branch_continuation_stay_in_scope(self):
        from agent.context_compressor import SUMMARY_PREFIX
        self.append('user', 'PRIVATE parent request')
        self.append('assistant', 'PRIVATE parent answer')
        self.db.end_session('root', 'compression')
        for marker in ('_branched_from', '_reset_from'):
            sid = marker[1:]
            self.db.create_session(sid, 'cli', parent_session_id='root', model_config={marker:'root'})
            self.append('user', 'Branch request', sid)
            anchor = self.append('assistant', 'Branch answer', sid)
            response = self.generate(anchor, sid)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.messages(), [{'role':'user','content':'Branch request'}, {'role':'assistant','content':'Branch answer'}])
            child = sid+'-continued'
            self.db.publish_compression_child(parent_session_id=sid, child_session_id=child, source='cli',
                model_config={marker:'root'}, require_compression_lease=False,
                messages=[{'role':'user', 'content':SUMMARY_PREFIX+'\nPRIVATE summary', '_compressed_summary':True}])
            self.append('user', 'Continued request', child)
            anchor = self.append('assistant', 'Continued answer', child)
            self.materialize(sid, child)
            response = self.generate(anchor, child)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['context']['previous_exchanges'], 1)
            self.assertEqual([m['content'] for m in self.messages()], ['Branch request','Branch answer','Continued request','Continued answer'])
        self.assertNotIn('PRIVATE', json.dumps(self.calls))

    def test_native_bounds_and_corruption_fail_closed_without_legacy_text_identity(self):
        user = self.append('user', 'Current request')
        anchor = self.append('assistant', 'Current answer')
        self.materialize()
        with database(self.home/'state.db') as conn:
            identity = conn.execute('SELECT display_identity FROM messages WHERE id=?', (anchor,)).fetchone()[0]
        for value in (b'x'*31, b'x'*33, identity.hex(), 'legacy-key', 123):
            with database(self.home/'state.db') as conn:
                conn.execute('UPDATE messages SET display_identity=? WHERE id=?', (value, anchor))
            self.assertEqual(self.generate(anchor).status_code, 422)
        with database(self.home/'state.db') as conn:
            conn.execute('UPDATE messages SET display_identity=? WHERE id=?', (identity, anchor))
        with patch.object(api, 'GENERATION_ROW_LIMIT', 1):
            self.assertEqual(self.generate(anchor).status_code, 422)
        with database(self.home/'state.db') as conn:
            conn.execute('UPDATE messages SET content=? WHERE id=?', ('\x00json:{broken', user))
        self.assertEqual(self.generate(anchor).status_code, 422)
        self.assertEqual(self.calls, [])

    def test_ancestor_payload_bound_is_reported_without_dropping_focal_text(self):
        from agent.context_compressor import SUMMARY_PREFIX
        self.append('user', 'Old large request')
        self.append('assistant', 'x'*65537)
        self.append('user', 'Recent request')
        self.append('assistant', 'Recent answer')
        self.db.publish_compression_child(parent_session_id='root', child_session_id='tip', source='cli',
            require_compression_lease=False, messages=[{'role':'user', 'content':SUMMARY_PREFIX+'\nPRIVATE summary', '_compressed_summary':True}])
        self.append('user', 'Current request', 'tip')
        anchor = self.append('assistant', 'Current full answer '+ 'y'*10000, 'tip')
        self.materialize('root', 'tip')
        response = self.generate(anchor, 'tip')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['context'], {'previous_exchanges':1,'requested_exchanges':10,'truncated':True})
        self.assertEqual([m['content'] for m in self.messages()], ['Recent request','Recent answer','Current request','Current full answer '+'y'*10000])
        self.client.put('/generation/settings', json={'previous_exchanges':0})
        response = self.generate(anchor, 'tip')
        self.assertEqual(response.json()['context'], {'previous_exchanges':0,'requested_exchanges':0,'truncated':False})
        self.assertEqual(len(self.messages()), 2)

    def test_summary_only_carrier_recovers_its_exact_original_user_not_an_older_one(self):
        from agent.context_compressor import SUMMARY_PREFIX
        self.append('user', 'Older unrelated request')
        self.append('assistant', 'Older answer')
        self.append('user', 'Actual carried request')
        original = self.db.get_messages_as_conversation('root')[-1]
        self.db.publish_compression_child(parent_session_id='root', child_session_id='tip', source='cli',
            require_compression_lease=False, messages=[dict(original, content=SUMMARY_PREFIX+'\nPRIVATE summary',
                                                           _compressed_summary=True, display_kind='hidden')])
        anchor = self.append('assistant', 'Selected answer', 'tip')
        self.materialize('root', 'tip')
        self.client.put('/generation/settings', json={'previous_exchanges':0})
        response = self.generate(anchor, 'tip')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.messages(), [{'role':'user','content':'Actual carried request'}, {'role':'assistant','content':'Selected answer'}])

    def test_native_blob_identity_default_ten_explicit_twenty_and_zero(self):
        for i in range(23):
            self.append('user', f'Request {i}')
            anchor = self.append('assistant', f'Answer {i}')
        self.append('user', 'FUTURE request')
        self.materialize()
        with database(self.home/'state.db') as conn:
            identity = conn.execute('SELECT display_identity FROM messages WHERE id=?', (anchor,)).fetchone()[0]
        self.assertIsInstance(identity, bytes)
        self.assertEqual(len(identity), 32)
        for previous in (10, 20, 0):
            if previous != 10:
                self.client.put('/generation/settings', json={'previous_exchanges':previous})
            response = self.generate(anchor)
            self.assertEqual(response.status_code, 200, response.text)
            expected = [dict(role=role, content=f'{label} {i}') for i in range(22-previous, 23)
                        for role, label in (('user', 'Request'), ('assistant', 'Answer'))]
            self.assertEqual(self.messages(), expected)
            self.assertEqual(response.json()['context'], {'previous_exchanges':previous,
                'requested_exchanges':previous, 'truncated':False})
        self.assertEqual(len(self.calls), 3)


if __name__ == '__main__':
    unittest.main()
