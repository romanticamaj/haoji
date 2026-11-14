import json, sessions

def test_session_lifecycle(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    sessions.init_db()
    sid = sessions.create_session("meeting.m4a")
    assert sessions.get_session(sid)["status"] == "queued"
    sessions.update_session(sid, status="done", pct=1.0,
                            transcript=json.dumps({"segments": []}))
    s = sessions.get_session(sid)
    assert s["status"] == "done" and s["pct"] == 1.0

def test_build_transcript_text_merges_and_names():
    segs = [
        {"start": 0, "end": 2, "speaker": "SPEAKER_00", "text": "你好"},
        {"start": 2, "end": 4, "speaker": "SPEAKER_00", "text": "今天開會"},
        {"start": 4, "end": 6, "speaker": "SPEAKER_01", "text": "好"},
    ]
    out = sessions.build_transcript_text(segs, {"SPEAKER_00": "Gary"})
    assert "[00:00] Gary: 你好今天開會" in out
    assert "[00:04] SPEAKER_01: 好" in out
