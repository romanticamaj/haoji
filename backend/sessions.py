# -*- coding: utf-8 -*-
"""SQLite-backed session store + transcript text builder."""
import os, sqlite3, uuid, time, json
import config

def _conn():
    os.makedirs(os.path.dirname(config.DB_PATH), exist_ok=True)
    c = sqlite3.connect(config.DB_PATH)
    c.row_factory = sqlite3.Row
    return c

def init_db():
    with _conn() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS sessions(
            id TEXT PRIMARY KEY, filename TEXT, status TEXT, pct REAL,
            message TEXT, transcript TEXT, notes TEXT, error TEXT, created REAL,
            parts TEXT, client_id TEXT)""")
        # Migrate older DBs. client_id = idempotency key for dedup; notes_status/notes_error track
        # the BACKGROUND notes job (so a client that disappears mid-generation can collect the result
        # later); expected_parts lets the server start transcription itself once every part has
        # landed — which is what makes a background/OS-driven upload work without the app running.
        cols = [r[1] for r in c.execute("PRAGMA table_info(sessions)").fetchall()]
        for col, decl in (("client_id", "TEXT"), ("notes_status", "TEXT"),
                          ("notes_error", "TEXT"), ("expected_parts", "INTEGER")):
            if col not in cols:
                c.execute(f"ALTER TABLE sessions ADD COLUMN {col} {decl}")

def create_session(filename, client_id=None, expected_parts=None):
    """expected_parts: how many parts the client intends to upload. When set, the server starts
    transcription by itself as soon as all of them have arrived (see app.add_part) — the client does
    not have to still be alive to call /transcribe."""
    sid = uuid.uuid4().hex[:12]
    with _conn() as c:
        c.execute("INSERT INTO sessions(id,filename,status,pct,message,created,client_id,expected_parts)"
                  " VALUES(?,?,?,?,?,?,?,?)",
                  (sid, filename, "queued", 0.0, "排隊中…", time.time(), client_id, expected_parts))
    return sid

def ensure_session(sid, filename="notes", client_id=None):
    """Create a session row under a CALLER-SUPPLIED id if it isn't there, and return it.

    Notes generation is a pure function of (transcript, names, model) — the client already holds all
    of it. Requiring a pre-existing server session meant a phone whose stored id had gone (server
    redeployed, DB reset, session pruned) got "查無此工作" for a meeting it could see perfectly well.
    The row exists only to hang the async result on so the client can collect it later."""
    existing = get_session(sid)
    if existing:
        return existing
    with _conn() as c:
        c.execute("INSERT OR IGNORE INTO sessions(id,filename,status,pct,message,created,client_id)"
                  " VALUES(?,?,?,?,?,?,?)",
                  (sid, filename, "done", 1.0, "", time.time(), client_id))
    return get_session(sid)


def get_session(sid):
    with _conn() as c:
        row = c.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
    return dict(row) if row else None

def get_session_by_client(client_id):
    """Most recent session created for a given client task-id, or None. Used to make
    session creation idempotent so a client that retries the pipeline maps to ONE session."""
    if not client_id:
        return None
    with _conn() as c:
        row = c.execute("SELECT * FROM sessions WHERE client_id=? ORDER BY created DESC LIMIT 1",
                        (client_id,)).fetchone()
    return dict(row) if row else None

def update_session(sid, **fields):
    if not fields:
        return
    cols = ", ".join(f"{k}=?" for k in fields)
    with _conn() as c:
        c.execute(f"UPDATE sessions SET {cols} WHERE id=?", (*fields.values(), sid))

def get_parts(sid):
    s = get_session(sid)
    return json.loads(s["parts"]) if s and s.get("parts") else []

def add_part(sid, path):
    parts = get_parts(sid)
    parts.append(path)
    update_session(sid, parts=json.dumps(parts))
    return len(parts)

def set_part(sid, index, path):
    """Store a part at a specific index (idempotent). Re-uploading the same index overwrites it
    instead of appending a duplicate — this is what stops a retried upload from concatenating the
    same audio N times. Returns the count of non-empty parts."""
    parts = get_parts(sid)
    while len(parts) <= index:
        parts.append(None)
    parts[index] = path
    update_session(sid, parts=json.dumps(parts))
    return sum(1 for p in parts if p)

def _mmss(t):
    t = max(0, int(t)); return f"{t // 60:02d}:{t % 60:02d}"

def build_transcript_text(segments, names=None):
    names = names or {}
    out, cur = [], None
    for s in segments:
        sp = s["speaker"]
        if cur and cur["sp"] == sp:
            cur["text"] += s["text"]; cur["end"] = s["end"]
        else:
            if cur: out.append(cur)
            cur = {"sp": sp, "start": s["start"], "end": s["end"], "text": s["text"]}
    if cur: out.append(cur)
    return "\n\n".join(f"[{_mmss(p['start'])}] {names.get(p['sp'], p['sp'])}: {p['text'].strip()}"
                       for p in out)


def parts_complete(sid):
    """True when every expected part slot is filled. Used to auto-start transcription so an upload
    finished by the OS (background URLSession) still gets processed with the app closed."""
    s = get_session(sid)
    if not s:
        return False
    expected = s.get("expected_parts")
    if not expected:
        return False
    parts = get_parts(sid)
    filled = sum(1 for p in parts[:expected] if p)
    return filled >= expected
