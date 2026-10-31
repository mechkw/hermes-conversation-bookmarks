"""Profile-local bookmarks. Native state.db is opened read-only, never migrated.

SourceAdapter is the only installed-schema coupling. Existence checks read IDs;
explicit chooser requests read bounded metadata and visible assistant previews.
Mount this router through the authenticated Hermes host, never standalone.
"""
from __future__ import annotations
from contextlib import contextmanager
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import stat
import time
from typing import Literal
import uuid

from fastapi import APIRouter, Depends, HTTPException, Path as PathParam, Query, Request, Response
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field, field_validator

PLUGIN_ID = "conversation-bookmarks"
VERSION = "0.1.0"
MAX_REVISION = 9007199254740991
SOURCE_SESSION_WINDOW = 1000
SOURCE_RESPONSE_WINDOW = 500
SOURCE_CONTENT_BYTES = 16384
SOURCE_PREVIEW_CHARS = 350
SESSION_ID_PATTERN = r"^[A-Za-z0-9_.:-]+$"

# Mirror THINK_TAG_NAMES in agent/think_scrubber.py and the tool/function/arg
# carriers in agent/agent_runtime_helpers.py, plus analysis/tool_use. Keep this
# adapter independent of the host's heavyweight runtime-helper imports.
SOURCE_PRIVATE_TAG_NAMES = (
    "think", "thinking", "reasoning", "thought", "REASONING_SCRATCHPAD",
    "思考", "反思", "推理", "推敲", "analysis", "tool_use",
    "tool_call", "tool_calls", "tool_result", "function_call", "function_calls",
    "function", "arg_key", "arg_value",
)
SOURCE_PRIVATE_TAG_RE = re.compile(
    r"<(?P<close>/?)(?P<name>(?:[\w.-]+:)?(?:" + "|".join(SOURCE_PRIVATE_TAG_NAMES)
    + r"))(?=[\s/>]|$)"
    # Quotes may contain '>'; a missing terminator is still a private carrier.
    + r'''(?P<attrs>(?:[^<>"']|"[^"]*(?:"|$)|'[^']*(?:'|$))*)(?P<end>>|(?=<)|$)''',
    re.I,
)


def source_timestamp(value):
    # SQLite can contain corrupt/non-numeric cells. Never emit NaN/Infinity or
    # mistake a millisecond timestamp for seconds (year 9999 is the upper bound).
    if isinstance(value, (int, float)) and math.isfinite(value) and 0 <= value <= 253402300799:
        return float(value)
    return None


def source_label(value, limit):
    if not isinstance(value, str):
        return ""
    return " ".join("".join(c for c in value if c.isprintable() or c.isspace()).split())[:limit]


def source_preview(content):
    """Decode the native NUL-json marker, projecting only known visible text blocks.

    Never recursively stringify unknown blocks: their text/content may be reasoning,
    tool arguments or media. Malformed/oversized payloads are not previewable.
    """
    if not isinstance(content, str):
        return ""
    if content.startswith("\x00json:"):
        try:
            content = json.loads(content[6:])
        except (ValueError, RecursionError):
            return ""
    def visible(value, depth=0):
        if depth > 8:
            return []
        if isinstance(value, str):
            return [value]
        if isinstance(value, list):
            return [text for block in value if isinstance(block, dict) for text in visible(block, depth + 1)]
        if not isinstance(value, dict) or value.get("thought") or value.get("role", "assistant") != "assistant":
            return []
        if value.get("channel") not in (None, "final", "commentary"):
            return []
        if value.get("type") in ("text", "output_text") and isinstance(value.get("text"), str):
            return [value["text"]]
        if value.get("type") == "message" and value.get("role") == "assistant":
            return visible(value.get("content"), depth + 1)
        return []
    text = " ".join(visible(content))
    # Some providers save tagged reasoning inside content rather than in its
    # dedicated column. Only a matching closer may release a private block;
    # orphan closers invalidate the preceding prefix, unfinished tags the tail.
    parts, stack, start = [], [], 0
    for tag in SOURCE_PRIVATE_TAG_RE.finditer(text):
        if not stack:
            parts.append(text[start:tag.start()])
            if tag.group("close"):
                parts.clear()
        if not tag.group("end"):
            start = len(text)
            break
        name = tag.group("name").casefold()
        if tag.group("close"):
            if stack and stack[-1] == name:
                stack.pop()
        elif not tag.group("attrs").rstrip().endswith("/"):
            stack.append(name)
        start = tag.end()
    if not stack:
        parts.append(text[start:])
    text = re.sub(r"data:[^\s<>\"']+", "[media omitted]", " ".join(parts), flags=re.I)
    text = source_label(text, SOURCE_CONTENT_BYTES)
    return text[:SOURCE_PREVIEW_CHARS - 1] + "…" if len(text) > SOURCE_PREVIEW_CHARS else text


def source_page(items, q, limit, offset, window, truncated, fields):
    needle = q.casefold().strip()
    matches = [item for item in items if not needle or any(needle in str(item[key]).casefold() for key in fields)]
    return {"items": matches[offset:offset + limit], "has_more": len(matches) > offset + limit,
            "window": {"limit": window, "truncated": truncated}}


class EntryInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    title: str = Field(min_length=1, max_length=160)
    note: str = Field(default="", max_length=4000)
    tags: list[str] = Field(default_factory=list, max_length=20)
    session_id: str = Field(min_length=1, max_length=160, pattern=r"^[A-Za-z0-9_.:-]+$")
    message_id: int | None = Field(default=None, ge=1, le=9007199254740991)

    @field_validator("title")
    @classmethod
    def title_valid(cls, value):
        value = value.strip()
        if not value or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError("Use a nonempty printable title")
        return value

    @field_validator("tags")
    @classmethod
    def tags_valid(cls, values):
        result, seen = [], set()
        for value in values:
            value = value.strip()
            if not value or len(value) > 40 or not value.isprintable():
                raise ValueError("Tags must contain 1–40 printable characters")
            key = value.casefold()
            if key not in seen:
                seen.add(key)
                result.append(value)
        return result


class EntryUpdate(EntryInput):
    revision: int = Field(ge=1, le=MAX_REVISION)


class SearchInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    q: str = Field(default="", max_length=200)
    tag: str = Field(default="", max_length=40)
    sort: Literal["newest", "oldest", "title"] = "newest"
    limit: int = Field(default=50, ge=1, le=100)
    offset: int = Field(default=0, ge=0, le=1000000)


class DeleteInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-f0-9]{32}$")
    revision: int = Field(ge=1, le=MAX_REVISION)


def bound_home():
    from hermes_constants import get_hermes_home
    return Path(get_hermes_home()).absolute()


def profile_name(home):
    return home.name if home.parent.name == "profiles" else "default"


class SourceAdapter:
    """On-demand source reads; no collection, native constructor, or migrations.

    Chooser previews are ephemeral, not bookmark metadata. Legacy availability
    checks remain identifier-only and accept existing non-assistant references.
    Reject linked stores; no SQLite immutable flag (live WAL must stay visible).
    A concurrent host prune can race a successful check; status is rechecked on
    every read. A bookmark is a reference, never a retention guarantee.
    """
    def __init__(self, home):
        self.home = home

    def availability(self, session_id, message_id=None):
        path = self.home / "state.db"
        try:
            if path.is_symlink() or any(p.is_symlink() for p in self.home.parents) or self.home.is_symlink():
                return "unavailable"
            if not path.exists():
                return "store_missing"
            if not path.is_file() or path.stat().st_nlink != 1:
                return "unavailable"
            conn = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=2)
            try:
                conn.execute("PRAGMA query_only=ON")
                # Current native schema has profile_name. Older schemas without
                # it fail closed rather than treating a foreign row as local.
                row = conn.execute("SELECT profile_name FROM sessions WHERE id=?", (session_id,)).fetchone()
                if row is None or row[0] not in (None, "", profile_name(self.home)):
                    return "session_missing"
                if message_id is not None and conn.execute("SELECT 1 FROM messages WHERE id=? AND session_id=?", (message_id, session_id)).fetchone() is None:
                    return "message_missing"
                return "available"
            finally:
                conn.close()
        except (OSError, sqlite3.Error):
            return "unavailable"

    @contextmanager
    def chooser_connection(self):
        """Short-lived, bounded read transaction; never initialize/migrate native state."""
        conn = None
        try:
            path = self.home / "state.db"
            if any(p.is_symlink() for p in (self.home, *self.home.parents)):
                raise OSError("Linked home")
            # Also fence SQLite's sidecars: a safe main file is not sufficient.
            for candidate in (path, Path(str(path) + "-wal"), Path(str(path) + "-shm"), Path(str(path) + "-journal")):
                try:
                    info = candidate.lstat()
                except FileNotFoundError:
                    if candidate == path:
                        raise
                    continue
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise OSError("Unsafe native store")
            conn = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=1)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA query_only=ON")
            conn.execute("PRAGMA trusted_schema=OFF")
            deadline, ticks = time.monotonic() + 1, 0
            def budget():
                nonlocal ticks
                ticks += 1
                return ticks > 2000 or time.monotonic() > deadline
            conn.set_progress_handler(budget, 1000)
            conn.create_function("source_epoch", 1, source_timestamp, deterministic=True)
            conn.execute("BEGIN")
            yield conn
        except (OSError, sqlite3.Error, ValueError):
            raise HTTPException(503, "Conversation source is unavailable in this profile") from None
        finally:
            if conn is not None:
                conn.close()

    @staticmethod
    def chooser_schema(conn, required):
        for table, columns in required.items():
            row = conn.execute("SELECT type FROM sqlite_master WHERE name=?", (table,)).fetchone()
            if row is None or row[0] != "table":
                raise sqlite3.DatabaseError("Unsupported native schema")
            # Names are adapter-owned constants, never request data.
            actual = {row[1] for row in conn.execute(f'PRAGMA table_info("{table}")')}
            if not set(columns) <= actual:
                raise sqlite3.DatabaseError("Unsupported native schema")

    def sessions(self, q="", limit=30, offset=0):
        with self.chooser_connection() as conn:
            self.chooser_schema(conn, {
                "sessions": ("id", "profile_name", "title", "source", "started_at", "ended_at", "last_activity_at", "hidden"),
                "messages": ("session_id", "timestamp"),
            })
            rows = conn.execute("""
                SELECT id, substr(title,1,160) AS title, substr(source,1,64) AS source,
                    (SELECT MAX(value) FROM (
                        SELECT source_epoch(s.started_at) AS value UNION ALL
                        SELECT source_epoch(s.ended_at) UNION ALL
                        SELECT source_epoch(s.last_activity_at) UNION ALL
                        SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id=s.id
                            AND typeof(m.timestamp) IN ('integer','real')
                            AND m.timestamp BETWEEN 0 AND 253402300799
                    )) AS updated_at
                FROM sessions s WHERE (profile_name IS NULL OR profile_name='' OR profile_name=?)
                    AND COALESCE(hidden,0)=0
                ORDER BY updated_at DESC, id DESC LIMIT ?
            """, (profile_name(self.home), SOURCE_SESSION_WINDOW + 1)).fetchall()
        items = []
        for row in rows[:SOURCE_SESSION_WINDOW]:
            sid = row["id"]
            if not isinstance(sid, str) or not 1 <= len(sid) <= 160 or not re.fullmatch(SESSION_ID_PATTERN, sid):
                continue
            source = source_label(row["source"], 64)
            items.append({"id": sid, "title": source_label(row["title"], 160) or f"{source or 'Conversation'} · {sid}",
                          "updated_at": row["updated_at"], "source": source})
        return source_page(items, q, limit, offset, SOURCE_SESSION_WINDOW,
                           len(rows) > SOURCE_SESSION_WINDOW, ("id", "title", "source"))

    def responses(self, session_id, q="", limit=30, offset=0):
        with self.chooser_connection() as conn:
            self.chooser_schema(conn, {
                "sessions": ("id", "profile_name", "hidden"),
                "messages": ("id", "session_id", "role", "content", "timestamp", "display_kind", "observed", "_compressed_summary"),
            })
            owned = conn.execute("""SELECT 1 FROM sessions WHERE id=? AND
                (profile_name IS NULL OR profile_name='' OR profile_name=?) AND COALESCE(hidden,0)=0""",
                (session_id, profile_name(self.home))).fetchone()
            if owned is None:
                raise HTTPException(404, "Conversation is not available in this profile")
            rows = conn.execute("""
                SELECT id, source_epoch(timestamp) AS created_at,
                    CASE WHEN typeof(content)='text' AND length(CAST(content AS BLOB))<=?
                         THEN content ELSE NULL END AS content
                FROM messages WHERE session_id=? AND role='assistant'
                    AND COALESCE(display_kind,'')='' AND COALESCE(observed,0)=0
                    AND COALESCE(_compressed_summary,0)=0 AND id BETWEEN 1 AND ?
                ORDER BY created_at DESC, id DESC LIMIT ?
            """, (SOURCE_CONTENT_BYTES, session_id, MAX_REVISION, SOURCE_RESPONSE_WINDOW + 1)).fetchall()
        items = []
        for row in rows[:SOURCE_RESPONSE_WINDOW]:
            preview = source_preview(row["content"])
            if preview:
                items.append({"id": row["id"], "preview": preview, "created_at": row["created_at"]})
        return source_page(items, q, limit, offset, SOURCE_RESPONSE_WINDOW,
                           len(rows) > SOURCE_RESPONSE_WINDOW, ("preview",))

    def require(self, session_id, message_id):
        state = self.availability(session_id, message_id)
        if state != "available":
            raise HTTPException(422 if state in ("session_missing", "message_missing") else 503,
                                "Source is not available in this profile. Check the exact session and message IDs.")


class Store:
    def __init__(self, home):
        self.home = Path(home).absolute()
        directory = self.home / "plugin-data" / PLUGIN_ID
        for part in (self.home, self.home / "plugin-data", directory):
            if part.is_symlink():
                raise HTTPException(503, "Bookmark storage is unsafe")
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = directory / "bookmarks.sqlite3"
        if self.path.is_symlink() or (self.path.exists() and self.path.stat().st_nlink != 1):
            raise HTTPException(503, "Bookmark storage is unsafe")
        self.source = SourceAdapter(self.home)
        with self.connect() as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY,payload TEXT NOT NULL,created REAL NOT NULL,updated REAL NOT NULL,revision INTEGER NOT NULL)")
            conn.execute("CREATE INDEX IF NOT EXISTS entries_created ON entries(created)")
        os.chmod(self.path, 0o600)

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        # SQLite lower/NOCASE only fold ASCII; match the Unicode validator instead.
        conn.create_function("tag_casefold", 1, str.casefold, deterministic=True)
        try:
            with conn:
                yield conn
        except sqlite3.Error:
            raise HTTPException(503, "Bookmark storage is unavailable; check profile storage permissions") from None
        finally:
            conn.close()

    def decode(self, row):
        result = {**json.loads(row["payload"]), **{key: row[key] for key in ("id", "created", "updated", "revision")}}
        result["source_status"] = self.source.availability(result["session_id"], result["message_id"])
        return result

    def get(self, entry_id):
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Bookmark not found")
        return self.decode(row)

    def search(self, q="", tag="", sort="newest", limit=50, offset=0):
        params, clauses = [], []
        if q:
            clauses.append("(instr(lower(json_extract(payload,'$.title') || ' ' || json_extract(payload,'$.note')),lower(?))>0 OR EXISTS (SELECT 1 FROM json_each(payload,'$.tags') WHERE instr(tag_casefold(value),tag_casefold(?))>0))")
            params.extend([q,q])
        if tag:
            clauses.append("EXISTS (SELECT 1 FROM json_each(payload,'$.tags') WHERE tag_casefold(value)=?)")
            params.append(tag.casefold())
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        order = {"newest":"created DESC,id", "oldest":"created ASC,id", "title":"lower(json_extract(payload,'$.title')),id"}[sort]
        with self.connect() as conn:
            total = conn.execute("SELECT count(*) FROM entries" + where, params).fetchone()[0]
            rows = conn.execute("SELECT * FROM entries" + where + " ORDER BY " + order + " LIMIT ? OFFSET ?", [*params,limit,offset]).fetchall()
        return {"items":[self.decode(row) for row in rows],"total":total,"limit":limit,"offset":offset}

    def create(self, entry):
        self.source.require(entry.session_id, entry.message_id)
        entry_id, now = uuid.uuid4().hex, time.time()
        with self.connect() as conn:
            conn.execute("INSERT INTO entries VALUES (?,?,?,?,1)", (entry_id,entry.model_dump_json(),now,now))
        return self.get(entry_id)

    def update(self, entry_id, entry):
        current = self.get(entry_id)
        # Metadata of a pruned source remains editable; new references must pass.
        if (current["session_id"], current["message_id"]) != (entry.session_id, entry.message_id):
            self.source.require(entry.session_id, entry.message_id)
        with self.connect() as conn:
            changed = conn.execute("UPDATE entries SET payload=?,updated=?,revision=revision+1 WHERE id=? AND revision=?", (entry.model_dump_json(exclude={"revision"}),time.time(),entry_id,entry.revision)).rowcount
        if not changed:
            raise HTTPException(409,"Bookmark changed elsewhere. Refresh before saving; your draft has not been applied.")
        return self.get(entry_id)

    def delete(self, entry_id, revision):
        self.get(entry_id)
        with self.connect() as conn:
            changed = conn.execute("DELETE FROM entries WHERE id=? AND revision=?", (entry_id,revision)).rowcount
        if not changed:
            raise HTTPException(409,"Bookmark changed elsewhere. Refresh before removing.")
        return {"deleted":entry_id,"source_deleted":False}


class BoundedRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()
        async def handler(request: Request):
            if request.method in ("POST", "PUT"):
                size, chunks = 0, []
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > 32768:
                        raise HTTPException(413, "Bookmark body exceeds 32 KiB")
                    chunks.append(chunk)
                request._body = b"".join(chunks)
            response = await original(request)
            response.headers["Cache-Control"] = "no-store"
            return response
        return handler


def request_store(profile: str | None = Query(None, max_length=160)):
    home = bound_home()
    if profile is not None and profile != profile_name(home):
        raise HTTPException(409,"Profile does not match the host-bound profile; reconnect to the intended profile")
    return Store(home)


def request_source(profile: str | None = Query(None, max_length=160)):
    home = bound_home()
    if profile is not None and profile != profile_name(home):
        raise HTTPException(409, "Profile does not match the host-bound profile; reconnect to the intended profile")
    # Choosers must not even initialize the plugin's metadata database.
    return SourceAdapter(home)


router = APIRouter(route_class=BoundedRoute)


@router.get("/sources/sessions")
def source_sessions(q: str = Query("", max_length=200), limit: int = Query(30, ge=1, le=100),
                    offset: int = Query(0, ge=0, le=1000), source: SourceAdapter = Depends(request_source)):
    return source.sessions(q, limit, offset)


@router.get("/sources/sessions/{session_id}/responses")
def source_responses(session_id: str = PathParam(..., min_length=1, max_length=160, pattern=SESSION_ID_PATTERN),
                     q: str = Query("", max_length=200), limit: int = Query(30, ge=1, le=100),
                     offset: int = Query(0, ge=0, le=500), source: SourceAdapter = Depends(request_source)):
    return source.responses(session_id, q, limit, offset)


@router.get("/status")
def status(store: Store = Depends(request_store)):
    return {"version":VERSION,"profile":profile_name(store.home)}


@router.get("/entries")
def entries(q: str = Query("",max_length=200), tag: str = Query("",max_length=40), sort: Literal["newest","oldest","title"] = "newest", limit: int = Query(50,ge=1,le=100), offset: int = Query(0,ge=0,le=1000000), store: Store = Depends(request_store)):
    return store.search(q,tag,sort,limit,offset)


@router.post("/entries",status_code=201)
def create(entry: EntryInput, store: Store = Depends(request_store)):
    return store.create(entry)


@router.get("/entries/{entry_id}")
def get_entry(entry_id: str, store: Store = Depends(request_store)):
    return store.get(entry_id)


@router.put("/entries/{entry_id}")
def update(entry_id: str, entry: EntryUpdate, store: Store = Depends(request_store)):
    return store.update(entry_id,entry)


def revision_query(revision: str = Query(..., pattern=r"^[1-9][0-9]*$", max_length=16)):
    # Query strings have no JSON type; reject float/bool spellings before parsing.
    value = int(revision)
    if value > MAX_REVISION:
        raise HTTPException(422, "Revision must be a positive JavaScript-safe integer")
    return value


@router.delete("/entries/{entry_id}")
def delete(entry_id: str, revision: int = Depends(revision_query), store: Store = Depends(request_store)):
    return store.delete(entry_id,revision)
