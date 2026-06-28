# -*- coding: utf-8 -*-
"""SQLite-backed session store + transcript text builder."""
import os, sqlite3, uuid, time
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
            message TEXT, transcript TEXT, notes TEXT, error TEXT, created REAL)""")

def create_session(filename):
    sid = uuid.uuid4().hex[:12]
    with _conn() as c:
        c.execute("INSERT INTO sessions(id,filename,status,pct,message,created) VALUES(?,?,?,?,?,?)",
                  (sid, filename, "queued", 0.0, "排隊中…", time.time()))
    return sid

def get_session(sid):
    with _conn() as c:
        row = c.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
    return dict(row) if row else None

def update_session(sid, **fields):
    if not fields:
        return
    cols = ", ".join(f"{k}=?" for k in fields)
    with _conn() as c:
        c.execute(f"UPDATE sessions SET {cols} WHERE id=?", (*fields.values(), sid))

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
