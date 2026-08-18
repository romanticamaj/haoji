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

def test_normalize_converts_transcript_to_traditional(monkeypatch):
    # 好記 is Traditional-Chinese; ASR (language="zh") can emit Simplified, so normalize must run each
    # segment through s2tw. Stub the converter (a small char map) so the test needs no opencc install.
    monkeypatch.setattr(asr, "to_traditional",
                        lambda t: t.translate(str.maketrans({"们": "們", "进": "進", "测": "測", "试": "試"})))
    raw = {"segments": [{"start": 0.0, "end": 1.0, "speaker": "SPEAKER_00", "text": "我们进行测试 "}], "duration": 1.0}
    out = asr.normalize(raw)
    assert out["segments"][0]["text"] == "我們進行測試"

def test_transcribe_diarize_posts_to_breeze(monkeypatch, tmp_path):
    wav = tmp_path / "a.wav"; wav.write_bytes(b"RIFF....")
    monkeypatch.setattr(asr, "detect_asr_base", lambda force=False: "http://127.0.0.1:7765")
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


def test_detect_asr_base_uses_env_url(monkeypatch):
    """ASR_BASE_URL set -> returned directly when healthy, no IP scanning."""
    import asr, config
    monkeypatch.setattr(config, "ASR_BASE_URL", "http://breeze-asr:7765")
    monkeypatch.setattr(asr, "_asr_cache", None)
    monkeypatch.setattr(asr, "_is_breeze", lambda url: url == "http://breeze-asr:7765")
    assert asr.detect_asr_base(force=True) == "http://breeze-asr:7765"


def test_detect_asr_base_env_url_unhealthy_returns_none(monkeypatch):
    import asr, config
    monkeypatch.setattr(config, "ASR_BASE_URL", "http://breeze-asr:7765")
    monkeypatch.setattr(asr, "_asr_cache", None)
    monkeypatch.setattr(asr, "_is_breeze", lambda url: False)
    assert asr.detect_asr_base(force=True) is None
