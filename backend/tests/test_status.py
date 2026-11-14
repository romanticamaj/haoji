# -*- coding: utf-8 -*-
import json, os, subprocess, time
import pytest
import requests
from fastapi.testclient import TestClient
import app as appmod, auth, config, jobs, sessions, settings, status

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "contracts")
CONTRACT = json.load(open(os.path.join(FIX, "status.json"), encoding="utf-8"))
DETAIL = json.load(open(os.path.join(FIX, "status_detail.json"), encoding="utf-8"))


class _Resp:
    def __init__(self, data, ok=True):
        self._d, self.ok, self.status_code = data, ok, 200 if ok else 500
    def json(self): return self._d
    def raise_for_status(self):
        if not self.ok: raise requests.HTTPError("x")


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "t.db"))
    for k in ("OLLAMA_BASE_URL", "LLM_MODEL", "HAOJI_ADMIN_TOKEN", "HAOJI_REQUIRE_TOKEN"):
        monkeypatch.delenv(k, raising=False)
    sessions.init_db(); settings.init(); jobs.reset(); status.clear_cache()
    monkeypatch.setattr(status.asr, "quick_probe", lambda: ("http://breeze-asr:7765", {"status": "ok"}))
    monkeypatch.setattr(status, "_ffmpeg_ok", lambda: (True, "/usr/bin/ffmpeg"))
    calls = {"n": 0}

    def fake_get(url, timeout=None, **kw):
        calls["n"] += 1
        if url.endswith("/api/version"):
            return _Resp({"version": "0.12.3"})
        if url.endswith("/api/tags"):
            return _Resp({"models": [{"name": "gemma4:e4b-it-qat", "size": 1}]})
        raise AssertionError(url)
    monkeypatch.setattr(status.requests, "get", fake_get)
    monkeypatch.setattr(status, "gpu_info", lambda run=None: {"available": False})
    return calls


def _keys(d):
    return set(d)


def test_status_all_green(env):
    j = TestClient(appmod.app).get("/api/status").json()
    assert _keys(j) == _keys(CONTRACT)
    assert j["ok"] is True
    assert [c["id"] for c in j["checks"]] == [c["id"] for c in CONTRACT["checks"]]
    assert all(_keys(c) == {"id", "ok", "label", "hint"} for c in j["checks"])
    assert j["llm"] == {"model": "gemma4:e4b-it-qat", "reachable": True}
    assert j["queue"] == {"active": 0, "queued": 0}
    assert j["version"] == config.VERSION
    assert "gpu" not in j and "message" not in j["checks"][0]   # public view stays thin


def test_status_ollama_down_is_fast_and_hinted(env, monkeypatch):
    def down(url, timeout=None, **kw):
        raise requests.ConnectionError("refused")
    monkeypatch.setattr(status.requests, "get", down)
    t0 = time.time()
    j = TestClient(appmod.app).get("/api/status").json()
    assert time.time() - t0 < 3
    c = {c["id"]: c for c in j["checks"]}
    assert c["ollama"]["ok"] is False and "OLLAMA_BASE_URL" in c["ollama"]["hint"]
    assert c["llm_model"]["ok"] is False
    assert j["ok"] is False and j["llm"]["reachable"] is False


def test_llm_model_missing_hint_pull(env, monkeypatch):
    settings.set("llm_model", "qwen3:8b")
    j = TestClient(appmod.app).get("/api/status").json()
    c = {c["id"]: c for c in j["checks"]}
    assert c["ollama"]["ok"] is True
    assert c["llm_model"]["ok"] is False and "qwen3:8b" in c["llm_model"]["hint"]


def test_asr_down_hinted(env, monkeypatch):
    monkeypatch.setattr(status.asr, "quick_probe", lambda: (None, None))
    c = {c["id"]: c for c in TestClient(appmod.app).get("/api/status").json()["checks"]}
    assert c["breeze_asr"]["ok"] is False and "breeze-asr" in c["breeze_asr"]["hint"]


def test_gpu_absent():
    def run(*a, **k): raise FileNotFoundError("nvidia-smi")
    assert status.gpu_info(run=run) == {"available": False}


def test_gpu_garbage_output():
    def run(*a, **k): return subprocess.CompletedProcess(a, 0, stdout="garbage\n", stderr="")
    assert status.gpu_info(run=run) == {"available": False}


def test_gpu_parses_csv():
    def run(*a, **k):
        return subprocess.CompletedProcess(a, 0, stdout="NVIDIA GeForce RTX 4090, 5120, 24564, 37\n", stderr="")
    assert status.gpu_info(run=run) == {"available": True, "name": "NVIDIA GeForce RTX 4090",
                                        "vram_used_mb": 5120, "vram_total_mb": 24564, "util_pct": 37}


def test_detail_requires_admin(env):
    c = TestClient(appmod.app)
    assert c.get("/api/status?detail=1").status_code == 401
    j = c.get("/api/status?detail=1", headers={"Authorization": f"Bearer {auth.admin_token()}"}).json()
    assert _keys(j) == _keys(DETAIL)
    assert _keys(j["server"]) == _keys(DETAIL["server"])
    assert all("message" in c for c in j["checks"])
    assert j["gpu"] == {"available": False}
    assert auth.admin_token() not in json.dumps(j)


def test_cached_within_ttl(env):
    c = TestClient(appmod.app)
    c.get("/api/status"); n = env["n"]
    c.get("/api/status")
    assert env["n"] == n


def test_queue_counts_reflected(env):
    jobs.start("abcdef", "transcribe")
    jobs.queued("ghijkl", "analyze")
    j = TestClient(appmod.app).get("/api/status").json()
    assert j["queue"] == {"active": 1, "queued": 1}


def test_pairing_required_flag(env, monkeypatch):
    monkeypatch.setenv("HAOJI_REQUIRE_TOKEN", "1")
    assert TestClient(appmod.app).get("/api/status").json()["pairing_required"] is True
