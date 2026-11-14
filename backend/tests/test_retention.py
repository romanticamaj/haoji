# -*- coding: utf-8 -*-
import json, time
import pytest
from fastapi.testclient import TestClient
import app as appmod, auth, config, sessions

SEG = {"segments": [{"start": 0, "end": 1, "speaker": "SPEAKER_00", "text": "內容"}], "speakers": ["SPEAKER_00"]}


@pytest.fixture()
def c(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.delenv("HAOJI_ADMIN_TOKEN", raising=False)
    monkeypatch.delenv("HAOJI_REQUIRE_TOKEN", raising=False)
    sessions.init_db()
    return TestClient(appmod.app)


def _done(created=None):
    sid = sessions.create_session("m")
    sessions.update_session(sid, status="done", pct=1.0, transcript=json.dumps(SEG), notes="# 筆記")
    if created is not None:
        sessions.update_session(sid, created=created)
    return sid


def test_debug_jobs_requires_admin(c):
    assert c.get("/api/debug/jobs").status_code == 401
    assert c.get("/api/debug/jobs", headers={"Authorization": f"Bearer {auth.admin_token()}"}).status_code == 200


def test_cors_not_wildcard(c):
    r = c.options("/api/sessions", headers={"Origin": "https://evil.example",
                                            "Access-Control-Request-Method": "POST"})
    assert r.headers.get("access-control-allow-origin") not in ("*", "https://evil.example")


def test_delete_session(c):
    sid = _done()
    assert c.delete(f"/api/sessions/{sid}").json() == {"ok": True}
    assert sessions.get_session(sid) is None
    assert c.get(f"/api/sessions/{sid}").status_code == 404
    assert c.delete(f"/api/sessions/{sid}").status_code == 404


def test_purge_expired_blanks_text_keeps_row(c):
    old = _done(created=time.time() - 25 * 3600)
    new = _done()
    n = sessions.purge_expired(time.time(), 24 * 3600)
    assert n == 1
    o = sessions.get_session(old)
    assert o is not None and o["transcript"] is None and o["notes"] is None and o["status"] == "expired"
    assert sessions.get_session(new)["transcript"] is not None
    assert c.get(f"/api/sessions/{old}").json()["status"] == "expired"


def test_purge_skips_unfinished(c):
    sid = sessions.create_session("m")
    sessions.update_session(sid, created=time.time() - 99 * 3600, status="running")
    assert sessions.purge_expired(time.time(), 3600) == 0


def test_retention_zero_purges_after_fetch(c, monkeypatch):
    monkeypatch.setattr(config, "RETENTION_HOURS", 0)
    sid = _done()
    first = c.get(f"/api/sessions/{sid}").json()
    assert first["transcript"]["speakers"] == ["SPEAKER_00"]
    assert sessions.get_session(sid)["fetched_at"] is not None
    sessions.purge_expired(time.time() + 1, 0)
    assert sessions.get_session(sid)["transcript"] is None


def test_retention_zero_keeps_notes_pending(c, monkeypatch):
    # fetched transcript, but notes still generating -> keep the row's notes slot alive
    sid = _done()
    sessions.update_session(sid, notes=None, notes_status="running")
    c.get(f"/api/sessions/{sid}")
    assert sessions.purge_expired(time.time() + 1, 0) == 0


def test_notes_written_after_expiry_are_purged_too(c):
    sid = _done(created=time.time() - 25 * 3600)
    sessions.purge_expired(time.time(), 24 * 3600)
    # a late background notes job lands on the expired row
    sessions.update_session(sid, notes="# 晚到的筆記", notes_status="done")
    assert sessions.purge_expired(time.time(), 24 * 3600) == 1
    assert sessions.get_session(sid)["notes"] is None


def test_notes_only_session_purged_after_fetch_with_retention_zero(c, monkeypatch):
    sessions.ensure_session("notesonly1", "notes")
    sessions.update_session("notesonly1", notes="# 筆記", notes_status="done")
    c.get("/api/sessions/notesonly1")                 # client collects the notes
    assert sessions.purge_expired(time.time() + 1, 0) == 1


def test_delete_removes_part_files(c, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "UPLOAD_DIR", str(tmp_path))
    sid = sessions.create_session("m")
    p = tmp_path / "part0.m4a"; p.write_bytes(b"audio")
    wav = tmp_path / f"{sid}.wav"; wav.write_bytes(b"w")
    sessions.add_part(sid, str(p))
    assert c.delete(f"/api/sessions/{sid}").status_code == 200
    assert not p.exists() and not wav.exists()


def test_retention_zero_waits_for_notes_to_be_collected(c, monkeypatch):
    sid = _done()
    sessions.update_session(sid, notes=None)
    c.get(f"/api/sessions/{sid}")                         # transcript collected
    # background notes finish afterwards
    monkeypatch.setattr(appmod.llm, "active_provider", lambda: type("P", (), {
        "generate_meeting_notes": lambda self, t, model=None, on_progress=None: "# 筆記"})())
    appmod._run_analyze(sid, "text", None, "m")
    assert sessions.purge_expired(time.time() + 1, 0) == 0    # not collected yet: keep
    assert c.get(f"/api/sessions/{sid}").json()["notes"] == "# 筆記"
    assert sessions.purge_expired(time.time() + 1, 0) == 1
