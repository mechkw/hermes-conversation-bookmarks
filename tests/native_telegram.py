"""Official loader/command admission + real PTB transport in an owned home."""
import asyncio
import hashlib
import inspect
import os
from pathlib import Path
import sys
import tempfile

from native_probe import prepare, host


async def exercise(home):
    from telegram import Update
    from telegram.ext import Application, CallbackContext
    from test_telegram_bookmarks import Capture
    from hermes_cli.plugins import get_plugin_manager, get_plugin_command_handler
    from hermes_cli.plugin_command_dispatch import invoke_plugin_command
    from gateway.session import SessionSource
    from gateway.config import Platform, PlatformConfig
    from plugins.platforms.telegram.adapter import TelegramAdapter
    from fastapi.testclient import TestClient

    ws = host(home)
    manager = get_plugin_manager()
    manager.discover_and_load()
    factories = [(factory, name) for factory, name in manager.get_platform_handler_factories('telegram') if name == 'conversation-bookmarks']
    assert len(factories) == 1, manager.list_plugins()
    policy = home/'plugin-data/conversation-bookmarks/telegram-owners.json'
    policy.parent.mkdir(parents=True, exist_ok=True)
    policy.write_text('["17"]')
    transport = Capture()
    app = Application.builder().token('900:fictional').request(transport).updater(None).build()
    await app.initialize()
    adapter = TelegramAdapter(PlatformConfig(enabled=True))
    adapter._wire_plugin_handlers(app)
    assert len(app.handlers[0]) == 1
    source = SessionSource(platform=Platform.TELEGRAM, user_id='17', chat_id='17', chat_type='dm')
    before = hashlib.sha256((home/'state.db').read_bytes()).hexdigest()
    handler = get_plugin_command_handler('bookmarks')
    assert handler is not None
    result = invoke_plugin_command(handler, '', session_id='fictional-session-01', session_key='telegram:fixture', platform='telegram', source=source)
    assert inspect.isawaitable(result)
    assert await result == ''
    headers = {'X-Hermes-Session-Token': 'fictional-test-session'}
    prefix = '/api/plugins/conversation-bookmarks'

    async def click(label):
        rows = [data for name, data in transport.calls if name in ('sendMessage', 'editMessageText')]
        row = rows[-1]
        data = next(button['callback_data'] for buttons in row['reply_markup']['inline_keyboard'] for button in buttons if button['text'] == label)
        sent_id = next(value['message_id'] if 'message_id' in value else 11 for name, value in transport.calls if name in ('sendMessage', 'editMessageText'))
        update = Update.de_json({'update_id': 1, 'callback_query': {'id': 'fixture', 'chat_instance': 'fictional',
            'from': {'id':17, 'first_name':'Fiction', 'is_bot':False}, 'data': data,
            'message': {'message_id':sent_id, 'date':1700000000, 'chat':{'id':17, 'type':'private'}}}}, app.bot)
        callback = app.handlers[0][0]
        await callback.handle_update(update, app, callback.check_update(update), CallbackContext(app))

    try:
        with TestClient(ws.app) as client:
            assert client.get(prefix+'/entries', headers=headers).json()['total'] == 0
            await click('Add this conversation')
            assert client.get(prefix+'/entries', headers=headers).json()['total'] == 0
            await click('Save conversation reference')
            data = client.get(prefix+'/entries', headers=headers).json()
            assert data['total'] == 1, transport.calls
            saved = data['items'][0]
            assert (saved['title'], saved['session_id'], saved['note'], saved['tags']) == ('Fictional source', 'fictional-session-01', '', [])
            assert client.get(prefix+'/entries/'+saved['id'], headers=headers).json() == saved
            assert hashlib.sha256((home/'state.db').read_bytes()).hexdigest() == before
        manager.discover_and_load(force=True)
        adapter.rewire_plugin_handlers()
        await asyncio.sleep(0)  # old controller detaches its owned PTB handler
        assert not app.handlers.get(0), app.handlers
        replacement = get_plugin_command_handler('bookmarks')
        assert replacement is not None
        fallback = invoke_plugin_command(replacement, '', session_id='fictional-session-01', session_key='telegram:fixture', platform='telegram', source=source)
        assert not inspect.isawaitable(fallback) and '1 matching bookmarks' in fallback, fallback
        rebuilt_transport = Capture()
        rebuilt = Application.builder().token('900:fictional').request(rebuilt_transport).updater(None).build()
        await rebuilt.initialize()
        try:
            adapter._wire_plugin_handlers(rebuilt)
            recovered = invoke_plugin_command(replacement, '', session_id='fictional-session-01', session_key='telegram:fixture', platform='telegram', source=source)
            assert inspect.isawaitable(recovered) and await recovered == ''
            assert any(name == 'sendMessage' for name, data in rebuilt_transport.calls)
        finally:
            manager.unload('conversation-bookmarks')
            await asyncio.sleep(0)
            assert not rebuilt.handlers.get(0), rebuilt.handlers
            await rebuilt.shutdown()
        print('HOST LIMITATION: same-client force reload skips the same-qualified platform factory; new commands fall back to authorized text. Native-client rebuild wires replacement and restores buttons. No host workaround or restart applied.')
        print('NATIVE TELEGRAM PASS: official PluginManager + command dispatcher + registered platform factory + real PTB Application/Update/CallbackQueryHandler/markup; Add confirmation and exact HTTP readback; original source bytes unchanged. Captured transport, not live Telegram.')
    finally:
        manager.unload('conversation-bookmarks')
        await app.shutdown()


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='cb-native-telegram-', dir=os.environ.get('TMPDIR')) as directory:
        home = Path(directory)/'home'
        prepare(home)
        asyncio.run(exercise(home))
