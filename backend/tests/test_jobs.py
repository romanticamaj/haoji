# -*- coding: utf-8 -*-
import json
import pytest
from fastapi.testclient import TestClient
import app as appmod, auth, config, jobs, sessions

CONTRACT = json.load(open(__import__("os").path.join(
    __import__("os").path.dirname(__file__), "fixtures", "contracts", "jobs.json"), encoding="utf-8"))


@pytest.fixture(autouse=True)
def _reset(tmp_path, monkeypatch):
    jobs.reset()
    monkeypatch.setattr(config, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setattr(config, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.delenv("HAOJI_ADMIN_TOKEN", raising=False)
    sessions.init_db()
    yield
    jobs.reset()


def test_lifecycle_moves_active_to_recent():
    jobs.queued("abcdef123456", "transcribe")
    snap = jobs.snapshot()
    assert snap["active"][0]["status"] == "queued" and snap["active"][0]["id"] == "abcdef"
    assert jobs.queue_counts() == {"active": 0, "queued": 1}
    jobs.start("abcdef123456", "transcribe")
    assert jobs.queue_counts() == {"active": 1, "queued": 0}
    jobs.progress("abcdef123456", "transcribe", 0.5, "辨識中…")
    assert jobs.snapshot()["active"][0]["pct"] == 0.5
    jobs.finish("abcdef123456", "transcribe", ok=True)
    snap = jobs.snapshot()
    assert snap["active"] == []
    r = snap["recent"][0]
    assert r["status"] == "done" and r["pct"] == 1.0 and r["duration_s"] is not None
    assert set(r) == set(CONTRACT["recent"][0])


def test_error_kept_in_recent():
    jobs.start("s1", "analyze")
    jobs.finish("s1", "analyze", ok=False, error="boom")
    r = jobs.snapshot()["recent"][0]
    assert r["status"] == "error" and r["error"] == "boom"


def test_recent_capped_50():
    for i in range(60):
        jobs.start(f"s{i}", "analyze")
        jobs.finish(f"s{i}", "analyze", ok=True)
    recent = jobs.snapshot()["recent"]
    assert len(recent) == 50
    assert recent[0]["id"] == "s59"


def test_no_titles_or_text_leak(monkeypatch, tmp_path):
    sid = sessions.create_session("週會-機密檔名.m4a")
    p = tmp_path / "p0.wav"
    p.write_bytes(b"x")
    sessions.add_part(sid, str(p))
    monkeypatch.setattr(appmod.media, "concat_to_wav", lambda parts, wav: open(wav, "wb").close())
    monkeypatch.setattr(appmod.asr, "probe_duration", lambda w: 1.0)
    monkeypatch.setattr(appmod.asr, "transcribe_diarize", lambda w: {
        "segments": [{"start": 0, "end": 1, "speaker": "SPEAKER_00", "text": "這是機密內容"}],
        "duration": 1.0})
    appmod._run_transcribe(sid)
    blob = json.dumps(jobs.snapshot(), ensure_ascii=False)
    assert "機密" not in blob
    assert sid not in blob            # full session id is a capability; only a short prefix is shown
    assert jobs.snapshot()["recent"][0]["status"] == "done"


def test_failed_transcribe_recorded(monkeypatch, tmp_path):
    sid = sessions.create_session("x")
    sessions.add_part(sid, str(tmp_path / "missing.wav"))
    def boom(parts, wav): raise RuntimeError("ffmpeg 音訊抽取失敗")
    monkeypatch.setattr(appmod.media, "concat_to_wav", boom)
    appmod._run_transcribe(sid)
    r = jobs.snapshot()["recent"][0]
    assert r["status"] == "error" and "ffmpeg" in r["error"]


def test_jobs_requires_admin():
    c = TestClient(appmod.app)
    assert c.get("/api/jobs").status_code == 401
    j = c.get("/api/jobs", headers={"Authorization": f"Bearer {auth.admin_token()}"}).json()
    assert set(j) == {"active", "recent"}
