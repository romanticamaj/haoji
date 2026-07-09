import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import sessions

def test_add_and_get_parts(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    sessions.init_db()
    sid = sessions.create_session("rec")
    assert sessions.get_parts(sid) == []
    assert sessions.add_part(sid, "/a/p1.m4a") == 1
    assert sessions.add_part(sid, "/a/p2.m4a") == 2
    assert sessions.get_parts(sid) == ["/a/p1.m4a", "/a/p2.m4a"]

def test_set_part_is_idempotent_by_index(tmp_path, monkeypatch):
    # Re-uploading the same index must OVERWRITE, not append — this is what prevents a retried
    # upload from concatenating the same audio N times (the 5x-duplicate bug).
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    sessions.init_db()
    sid = sessions.create_session("rec")
    assert sessions.set_part(sid, 0, "/a/p0.m4a") == 1
    assert sessions.set_part(sid, 0, "/a/p0-again.m4a") == 1   # same index → still one part
    assert sessions.get_parts(sid) == ["/a/p0-again.m4a"]
    assert sessions.set_part(sid, 1, "/a/p1.m4a") == 2
    assert sessions.get_parts(sid) == ["/a/p0-again.m4a", "/a/p1.m4a"]

def test_create_session_idempotent_on_client_id(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    sessions.init_db()
    a = sessions.create_session("rec", client_id="local-123")
    assert sessions.get_session_by_client("local-123")["id"] == a
    assert sessions.get_session_by_client("nope") is None

def test_concat_builds_list_and_calls_ffmpeg(tmp_path, monkeypatch):
    import media
    calls = {}
    def fake_run(cmd, **kw):
        calls["cmd"] = cmd
        class R: returncode = 0; stderr = ""
        open(cmd[-1], "wb").close()  # create the output file
        return R()
    monkeypatch.setattr(media.subprocess, "run", fake_run)
    media.concat_to_wav([str(tmp_path/"a.m4a"), str(tmp_path/"b.m4a")], str(tmp_path/"out.wav"))
    assert "-f" in calls["cmd"] and "concat" in calls["cmd"]

from fastapi.testclient import TestClient
import app as appmod, json as _json

def test_parts_then_transcribe(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path/"t.db"))
    monkeypatch.setattr(appmod, "PARTS_DIR", str(tmp_path)); sessions.init_db()
    monkeypatch.setattr(appmod, "_run_transcribe", lambda sid: sessions.update_session(
        sid, status="done", transcript=_json.dumps({"segments": [], "speakers": []})))
    c = TestClient(appmod.app)
    sid = c.post("/api/sessions").json()["session_id"]
    assert c.post(f"/api/sessions/{sid}/parts", files={"file": ("p.m4a", b"\x00", "audio/mp4")}).json()["count"] == 1
    assert c.post(f"/api/sessions/{sid}/transcribe").status_code == 200
    assert c.get(f"/api/sessions/{sid}").json()["status"] == "done"

def test_duplicate_pipeline_dedupes_end_to_end(tmp_path, monkeypatch):
    # Simulate the client firing the whole pipeline 5x for one recording: same client_id, same part
    # index. The backend must land on ONE session with ONE part (not five concatenated copies).
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setattr(appmod, "PARTS_DIR", str(tmp_path)); sessions.init_db()
    c = TestClient(appmod.app)
    sids = set()
    for _ in range(5):
        sid = c.post("/api/sessions", json={"client_id": "local-abc"}).json()["session_id"]
        sids.add(sid)
        c.post(f"/api/sessions/{sid}/parts?index=0", files={"file": ("p.m4a", b"\x00", "audio/mp4")})
    assert len(sids) == 1                                   # all 5 mapped to one server session
    sid = sids.pop()
    assert len([p for p in sessions.get_parts(sid) if p]) == 1   # one part, not five
