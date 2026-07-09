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
        # Migrate DBs created before client_id existed (idempotency key for dedup).
        cols = [r[1] for r in c.execute("PRAGMA table_info(sessions)").fetchall()]
        if "client_id" not in cols:
            c.execute("ALTER TABLE sessions ADD COLUMN client_id TEXT")

def create_session(filename, client_id=None):
    sid = uuid.uuid4().hex[:12]
    with _conn() as c:
        c.execute("INSERT INTO sessions(id,filename,status,pct,message,created,client_id) VALUES(?,?,?,?,?,?,?)",
                  (sid, filename, "queued", 0.0, "排隊中…", time.time(), client_id))
    return sid

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
