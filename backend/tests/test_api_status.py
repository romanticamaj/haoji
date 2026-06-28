import json
from fastapi.testclient import TestClient
import app as appmod, sessions

def test_status_returns_transcript(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    sessions.init_db()
    sid = sessions.create_session("m.m4a")
    sessions.update_session(sid, status="done", pct=1.0,
        transcript=json.dumps({"segments": [{"start":0,"end":1,"speaker":"SPEAKER_00","text":"hi"}],
                               "speakers": ["SPEAKER_00"]}, ensure_ascii=False))
    c = TestClient(appmod.app)
    r = c.get(f"/api/sessions/{sid}")
    assert r.status_code == 200
    assert r.json()["transcript"]["speakers"] == ["SPEAKER_00"]

def test_status_404(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    sessions.init_db()
    assert TestClient(appmod.app).get("/api/sessions/nope").status_code == 404
