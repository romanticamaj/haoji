import asr

def test_normalize_shapes_segments_and_speakers():
    raw = {"segments": [
        {"start": 0.0, "end": 2.0, "speaker": "SPEAKER_00", "text": "你好 "},
        {"start": 2.0, "end": 5.0, "speaker": "SPEAKER_01", "text": " 嗨"},
    ], "duration": 5.0}
    out = asr.normalize(raw)
    assert out["speakers"] == ["SPEAKER_00", "SPEAKER_01"]
    assert out["segments"][0]["text"] == "你好"
    assert out["duration"] == 5.0
    assert {s["speaker"] for s in out["stats"]} == {"SPEAKER_00", "SPEAKER_01"}

def test_transcribe_diarize_posts_to_breeze(monkeypatch, tmp_path):
    wav = tmp_path / "a.wav"; wav.write_bytes(b"RIFF....")
    monkeypatch.setattr(asr, "detect_asr_base", lambda force=False: "http://127.0.0.1:8765")
    captured = {}
    def fake_post(url, params, files, timeout):
        captured["url"] = url; captured["params"] = params
        class R:
            def raise_for_status(self): pass
            def json(self): return {"segments": [], "duration": 0}
        return R()
    monkeypatch.setattr(asr.requests, "post", fake_post)
    asr.transcribe_diarize(str(wav), num_speakers=2, language="zh")
    assert captured["url"].endswith("/transcribe_diarize")
    assert captured["params"]["num_speakers"] == 2
