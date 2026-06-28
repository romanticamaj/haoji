import json
from fastapi.testclient import TestClient
import app as appmod, sessions, llm

def test_analyze_uses_transcript_and_names(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    sessions.init_db()
    sid = sessions.create_session("m.m4a")
    sessions.update_session(sid, status="done",
        transcript=json.dumps({"segments": [
            {"start":0,"end":2,"speaker":"SPEAKER_00","text":"今天開會"}], "speakers":["SPEAKER_00"]}))
    seen = {}
    class FakeProvider:
        def generate_meeting_notes(self, transcript, model=None):
            seen["transcript"] = transcript; seen["model"] = model
            return "## 會議摘要\n好"
    monkeypatch.setattr(appmod.llm, "get_provider", lambda name="ollama": FakeProvider())
    c = TestClient(appmod.app)
    r = c.post(f"/api/sessions/{sid}/analyze", json={"model": "gemma4:e4b-it-qat", "names": {"SPEAKER_00": "Gary"}})
    assert r.status_code == 200
    assert r.json()["notes"].startswith("## 會議摘要")
    assert "Gary: 今天開會" in seen["transcript"]
    assert seen["model"] == "gemma4:e4b-it-qat"
