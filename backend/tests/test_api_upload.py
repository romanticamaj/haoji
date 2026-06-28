import io, json, time
from fastapi.testclient import TestClient
import app as appmod, sessions

def test_upload_rejects_bad_ext(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    sessions.init_db()
    c = TestClient(appmod.app)
    r = c.post("/api/sessions", files={"file": ("x.txt", b"nope", "text/plain")})
    assert r.status_code == 400

def test_upload_accepts_and_runs_job(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setattr(appmod.config, "UPLOAD_DIR", str(tmp_path))
    sessions.init_db()
    # stub the heavy pipeline so the worker runs instantly
    monkeypatch.setattr(appmod, "_run_transcribe", lambda sid, path: sessions.update_session(
        sid, status="done", pct=1.0, transcript=json.dumps({"segments": [], "speakers": []})))
    c = TestClient(appmod.app)
    r = c.post("/api/sessions", files={"file": ("m.m4a", b"\x00\x01\x02", "audio/mp4")})
    assert r.status_code == 200
    sid = r.json()["session_id"]
    for _ in range(50):
        if sessions.get_session(sid)["status"] == "done":
            break
        time.sleep(0.02)
    assert sessions.get_session(sid)["status"] == "done"
