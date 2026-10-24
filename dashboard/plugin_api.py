"""Profile-local bookmarks. Native state.db is opened read-only, never migrated.

SourceAdapter is the only installed-schema coupling; it reads identifiers only.
Mount this router through the authenticated Hermes host, never standalone.
"""
from __future__ import annotations
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3
import time
from typing import Literal
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field, field_validator

PLUGIN_ID = "conversation-bookmarks"
VERSION = "0.1.0"
MAX_REVISION = 9007199254740991


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
    """No transcript reads, native DB constructor, writes, or profile discovery.

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


router = APIRouter(route_class=BoundedRoute)


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
