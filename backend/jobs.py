# -*- coding: utf-8 -*-
"""What the server is working on, for the console's 工作 page.

In-memory and deliberately content-free: an entry carries a 6-char id prefix, the kind, status,
progress and timings — never the filename, title or any transcript text. The full session id is a
capability (it reads a transcript), so it never leaves this module."""
import threading, time
from fastapi import APIRouter, Depends
import auth

RECENT_MAX = 50
_lock = threading.Lock()
_active = {}      # (sid, kind) -> entry (with private "_sid")
_recent = []      # newest first


def reset():
    with _lock:
        _active.clear()
        _recent.clear()


def _entry(sid, kind, status):
    return {"id": sid[:6], "kind": kind, "status": status, "pct": 0.0, "message": "",
            "started_at": None, "finished_at": None, "duration_s": None, "error": None,
            "_sid": sid, "_queued_at": time.time()}


def queued(sid, kind):
    with _lock:
        _active[(sid, kind)] = _entry(sid, kind, "queued")


def start(sid, kind):
    with _lock:
        e = _active.get((sid, kind)) or _entry(sid, kind, "queued")
        e.update(status="running", started_at=time.time())
        _active[(sid, kind)] = e


def progress(sid, kind, pct, message=""):
    with _lock:
        e = _active.get((sid, kind))
        if e:
            e.update(pct=round(float(pct), 3), message=message or e["message"])


def finish(sid, kind, ok, error=None):
    with _lock:
        e = _active.pop((sid, kind), None) or _entry(sid, kind, "running")
        now = time.time()
        started = e["started_at"] or e["_queued_at"]
        e.update(status="done" if ok else "error", finished_at=now,
                 duration_s=round(now - started, 1), error=None if ok else (str(error) if error else "失敗"),
                 message="完成" if ok else "失敗")
        if ok:
            e["pct"] = 1.0
        _recent.insert(0, e)
        del _recent[RECENT_MAX:]


def _public(e):
    return {k: v for k, v in e.items() if not k.startswith("_")}


def snapshot(live=None):
    """live(sid, kind) -> (pct, message) | None lets the caller refresh running entries from the
    session store, where the worker threads already publish their progress."""
    with _lock:
        active = sorted(_active.values(), key=lambda e: e["_queued_at"])
        recent = list(_recent)
    out = []
    for e in active:
        e = dict(e)
        if live and e["status"] == "running":
            got = live(e["_sid"], e["kind"])
            if got:
                e["pct"], e["message"] = round(float(got[0] or 0), 3), got[1] or e["message"]
        out.append(_public(e))
    return {"active": out, "recent": [_public(e) for e in recent]}


def queue_counts():
    with _lock:
        vals = list(_active.values())
    return {"active": sum(1 for e in vals if e["status"] == "running"),
            "queued": sum(1 for e in vals if e["status"] == "queued")}


def _live(sid, kind):
    import sessions
    s = sessions.get_session(sid)
    if not s:
        return None
    return (s.get("pct"), s.get("message")) if kind == "transcribe" else (s.get("notes_pct"), s.get("notes_message"))


router = APIRouter(prefix="/api")


@router.get("/jobs", dependencies=[Depends(auth.require_admin)])
def list_jobs():
    return snapshot(live=_live)
