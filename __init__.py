"""Explicit bookmark tools. No observers, model calls or transcript capture."""
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import threading

_lock = threading.Lock()
_api = None


def _service():
    global _api
    with _lock:
        if _api is None:
            name = __name__ + ".bookmarks_api"
            spec = importlib.util.spec_from_file_location(name, Path(__file__).parent / "dashboard" / "plugin_api.py")
            if spec is None or spec.loader is None:
                raise RuntimeError("Bookmark service is unavailable")
            module = importlib.util.module_from_spec(spec)
            sys.modules[name] = module
            try:
                spec.loader.exec_module(module)
            except BaseException:
                sys.modules.pop(name, None)
                raise
            _api = module
        return _api


def _run(action, args, session_id=None):
    from fastapi import HTTPException
    from pydantic import ValidationError
    api = _service()
    try:
        if not isinstance(args, dict):
            raise ValueError("Expected an object")
        args = dict(args)
        store = api.Store(api.bound_home())
        if action == "save":
            # Only native invocation context may supply an omitted reference.
            # Explicit empty/invalid values must fail; never repair them.
            if "session_id" not in args and session_id:
                args["session_id"] = session_id
            result = store.create(api.EntryInput.model_validate(args))
        elif action == "search":
            result = store.search(**api.SearchInput.model_validate(args).model_dump())
        elif action == "update":
            entry_id = args.pop("id", None)
            api.DeleteInput.model_validate({"id":entry_id,"revision":args.get("revision")})
            result = store.update(entry_id, api.EntryUpdate.model_validate(args))
        elif action == "delete":
            parsed = api.DeleteInput.model_validate(args)
            result = store.delete(parsed.id, parsed.revision)
        else:
            raise ValueError("Unknown bookmark action")
        return json.dumps({"ok":True,"data":result})
    except ValidationError:
        return json.dumps({"ok":False,"error":"Invalid bookmark metadata or reference. Use an exact session ID and optional positive integer message ID."})
    except HTTPException as exc:
        return json.dumps({"ok":False,"error":exc.detail})
    except ValueError as exc:
        return json.dumps({"ok":False,"error":str(exc)})
    except (OSError, sqlite3.Error):
        return json.dumps({"ok":False,"error":"Bookmark storage is unavailable"})


def register(ctx):
    api = _service()
    save_schema = api.EntryInput.model_json_schema()
    save_schema["required"] = [key for key in save_schema["required"] if key != "session_id"]
    save_schema["properties"]["session_id"]["description"] = "Exact current-profile stored session ID. Omit only to use reliable host invocation context; missing context fails closed."
    update_schema = api.EntryUpdate.model_json_schema()
    update_schema["properties"]["id"] = {"type":"string","pattern":"^[a-f0-9]{32}$"}
    update_schema["required"].append("id")
    for action, schema, description in (
        ("save",save_schema,"Save ONLY a conversation reference the user explicitly asks to bookmark, with their title, optional note and tags. No transcript capture or automatic memory. Source must exist in this profile."),
        ("search",api.SearchInput.model_json_schema(),"Search this profile's explicitly saved bookmark titles, notes and tags. No conversation content is searched."),
        ("update",update_schema,"Update a bookmark's complete metadata using its current revision. Unchanged missing-source references may be retained."),
        ("delete",api.DeleteInput.model_json_schema(),"Remove ONLY explicitly selected bookmark metadata using its current revision. Never deletes a session or message."),
    ):
        name = "conversation_bookmark_" + action
        def handler(args, _action=action, **kwargs):
            return _run(_action,args,session_id=kwargs.get("session_id"))
        ctx.register_tool(name=name,toolset="conversation_bookmarks",description=description,
                          schema={"name":name,"description":description,"parameters":schema},
                          handler=handler,check_fn=lambda:True)
    # No /bookmark command: native raw-args callbacks lack reliable session
    # context. Agent tools and the explicit-ID UI cover the full workflow.
