# -*- coding: utf-8 -*-
"""The "your transcript is ready" push: the token arrives with the session, fires exactly once when the
job ends (done OR failed), and is not kept afterwards."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
import app as appmod, sessions, push

TOKEN = "ab" * 32


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setattr(appmod.config, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(appmod, "PARTS_DIR", str(tmp_path / "parts"))
    os.makedirs(tmp_path / "parts", exist_ok=True)
    sessions.init_db()
    sent = []
    monkeypatch.setattr(appmod.push, "send",
                        lambda token, env, title, body, data=None: (sent.append(
                            dict(token=token, env=env, title=title, body=body, data=data)), True)[1])
    monkeypatch.setattr(appmod.media, "concat_to_wav", lambda parts, wav: open(wav, "wb").close())
    monkeypatch.setattr(appmod.asr, "probe_duration", lambda wav: 1)
    return tmp_path, sent


def _session_with_part(c, tmp_path, **body):
    sid = c.post("/api/sessions", json={"client_id": "local-1", **body}).json()["session_id"]
    p = tmp_path / "parts" / f"{sid}-0.m4a"
    p.write_bytes(b"x")
    sessions.set_part(sid, 0, str(p))
    return sid


def test_done_pushes_once_to_the_registered_token_then_forgets_it(env, monkeypatch):
    tmp_path, sent = env
    monkeypatch.setattr(appmod.asr, "transcribe_diarize", lambda wav: {"segments": []})
    c = TestClient(appmod.app)
    sid = _session_with_part(c, tmp_path, push_token=TOKEN, push_env="sandbox", push_title="週會")

    appmod._run_transcribe(sid)

    assert len(sent) == 1
    assert sent[0]["token"] == TOKEN and sent[0]["env"] == "sandbox"
    assert sent[0]["title"] == "逐字稿完成" and "週會" in sent[0]["body"]
    # the app opens the meeting by its LOCAL id, not the server's
    assert sent[0]["data"]["session"] == "local-1"
    assert sessions.get_session(sid)["push_token"] is None


def test_a_failed_transcription_also_pushes(env, monkeypatch):
    tmp_path, sent = env
    def boom(wav): raise RuntimeError("asr down")
    monkeypatch.setattr(appmod.asr, "transcribe_diarize", boom)
    c = TestClient(appmod.app)
    sid = _session_with_part(c, tmp_path, push_token=TOKEN)

    appmod._run_transcribe(sid)

    assert [s["title"] for s in sent] == ["逐字稿失敗"]
    assert sent[0]["env"] == "production"          # default when the client doesn't say


def test_no_token_means_no_push(env, monkeypatch):
    tmp_path, sent = env
    monkeypatch.setattr(appmod.asr, "transcribe_diarize", lambda wav: {"segments": []})
    c = TestClient(appmod.app)
    sid = _session_with_part(c, tmp_path)
    appmod._run_transcribe(sid)
    assert sent == []


def test_a_retry_reusing_the_session_can_supply_the_token(env):
    tmp_path, _ = env
    c = TestClient(appmod.app)
    sid = c.post("/api/sessions", json={"client_id": "local-1"}).json()["session_id"]
    again = c.post("/api/sessions", json={"client_id": "local-1", "push_token": TOKEN}).json()
    assert again["session_id"] == sid
    assert sessions.get_session(sid)["push_token"] == TOKEN


def test_a_malformed_token_is_ignored(env):
    c = TestClient(appmod.app)
    sid = c.post("/api/sessions", json={"client_id": "x", "push_token": "../../etc"}).json()["session_id"]
    assert sessions.get_session(sid)["push_token"] is None


def test_send_is_a_noop_without_an_apns_key(monkeypatch):
    monkeypatch.setattr(push.config, "APNS_KEY_PATH", "")
    assert push.send(TOKEN, "production", "t", "b") is False
