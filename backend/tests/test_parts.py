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
