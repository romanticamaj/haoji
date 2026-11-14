# -*- coding: utf-8 -*-
import json, os, time
import pytest
import requests
from fastapi.testclient import TestClient
import app as appmod, auth, config, jobs, ollama_admin, sessions, settings, status

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "contracts")
MODELS = json.load(open(os.path.join(FIX, "models.json"), encoding="utf-8"))
SETTINGS = json.load(open(os.path.join(FIX, "settings.json"), encoding="utf-8"))
PULL = json.load(open(os.path.join(FIX, "pull_events.json"), encoding="utf-8"))


class R:
    def __init__(self, data=None, ok=True, lines=None):
        self._d, self.ok, self._lines = data, ok, lines or []
        self.status_code = 200 if ok else 404
    def json(self): return self._d
    def raise_for_status(self):
        if not self.ok: raise requests.HTTPError("404")
    def iter_lines(self, decode_unicode=True):
        yield from self._lines


@pytest.fixture()
def c(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "t.db"))
    for k in ("OLLAMA_BASE_URL", "LLM_MODEL", "HAOJI_ADMIN_TOKEN", "LLM_PROVIDER"):
        monkeypatch.delenv(k, raising=False)
    sessions.init_db(); settings.init(); jobs.reset(); status.clear_cache(); ollama_admin.PULLS.clear()
    client = TestClient(appmod.app)
    client.headers["Authorization"] = f"Bearer {auth.admin_token()}"
    return client


def _ollama(monkeypatch, tags=None, ps=None, version="0.12.3", down=False):
    tags = tags if tags is not None else [{"name": "gemma4:e4b-it-qat", "size": 4200000000},
                                          {"name": "qwen3:8b", "size": 5200000000}]
    ps = ps if ps is not None else [{"name": "gemma4:e4b-it-qat"}]

    def get(url, timeout=None, **kw):
        if down:
            raise requests.ConnectionError("refused")
        if url.endswith("/api/version"): return R({"version": version})
        if url.endswith("/api/tags"): return R({"models": tags})
        if url.endswith("/api/ps"): return R({"models": ps})
        raise AssertionError(url)
    monkeypatch.setattr(ollama_admin.requests, "get", get)
    monkeypatch.setattr(status, "asr_health", lambda: {"status": "ok", "model": "Breeze-ASR-25"})


def test_admin_required(c):
    bare = TestClient(appmod.app)
    for m, p in (("get", "/api/settings"), ("get", "/api/models"), ("post", "/api/llm/test"),
                 ("post", "/api/llm/pull"), ("delete", "/api/llm/models/x")):
        assert getattr(bare, m)(p).status_code == 401, p


def test_settings_get_put_roundtrip(c):
    j = c.get("/api/settings").json()
    assert set(j) == set(SETTINGS)
    j = c.put("/api/settings", json={"llm_model": "qwen3:8b"}).json()
    assert j["llm_model"]["value"] == "qwen3:8b"
    assert settings.llm_model() == "qwen3:8b"


def test_put_invalid_400(c):
    r = c.put("/api/settings", json={"ollama_base_url": "ftp://x"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_setting"


def test_put_locked_409(c, monkeypatch):
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://ollama:11434")
    r = c.put("/api/settings", json={"ollama_base_url": "http://x:1"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "setting_locked"


def test_put_clears_status_cache(c, monkeypatch):
    called = []
    monkeypatch.setattr(status, "clear_cache", lambda: called.append(1))
    c.put("/api/settings", json={"llm_model": "qwen3:8b"})
    assert called


def test_llm_test_ok(c, monkeypatch):
    _ollama(monkeypatch)
    j = c.post("/api/llm/test", json={}).json()
    assert j == {"ok": True, "version": "0.12.3", "models": ["gemma4:e4b-it-qat", "qwen3:8b"]}


def test_llm_test_other_url_without_saving(c, monkeypatch):
    seen = []
    def get(url, timeout=None, **kw):
        seen.append(url)
        return R({"version": "1"}) if url.endswith("version") else R({"models": []})
    monkeypatch.setattr(ollama_admin.requests, "get", get)
    c.post("/api/llm/test", json={"base_url": "http://other:11434/"})
    assert seen[0].startswith("http://other:11434/api/")
    assert settings.ollama_base() == "http://127.0.0.1:11434"


def test_llm_test_unreachable(c, monkeypatch):
    _ollama(monkeypatch, down=True)
    j = c.post("/api/llm/test", json={}).json()
    assert j["ok"] is False and j["error"]["code"] == "ollama_unreachable"


def test_models_merges_asr_and_ollama(c, monkeypatch):
    _ollama(monkeypatch)
    ms = c.get("/api/models").json()["models"]
    assert [m["id"] for m in ms] == [m["id"] for m in MODELS["models"]]
    assert all(set(m) == set(MODELS["models"][0]) for m in ms)
    by = {m["id"]: m for m in ms}
    assert by["gemma4:e4b-it-qat"]["state"] == "loaded" and by["gemma4:e4b-it-qat"]["selected"]
    assert by["qwen3:8b"]["state"] == "ready" and not by["qwen3:8b"]["selected"]
    assert by["breeze-asr"]["state"] == "ready" and by["breeze-asr"]["managed_by"] == "breeze-asr"


def test_models_selected_but_missing_listed(c, monkeypatch):
    _ollama(monkeypatch, tags=[], ps=[])
    ms = c.get("/api/models").json()["models"]
    sel = [m for m in ms if m["kind"] == "llm"]
    assert sel == [{"id": "gemma4:e4b-it-qat", "kind": "llm", "name": "gemma4:e4b-it-qat",
                    "state": "missing", "size_bytes": None, "managed_by": "ollama", "selected": True}]


def test_models_asr_down_unknown(c, monkeypatch):
    _ollama(monkeypatch, down=True)
    monkeypatch.setattr(status, "asr_health", lambda: {})
    ms = {m["id"]: m for m in c.get("/api/models").json()["models"]}
    assert ms["breeze-asr"]["state"] == "unknown"


def _pull_stream(monkeypatch, lines):
    def post(url, json=None, stream=False, timeout=None, **kw):
        assert url.endswith("/api/pull") and json["stream"] is True
        return R(lines=[__import__("json").dumps(x) for x in lines])
    monkeypatch.setattr(ollama_admin.requests, "post", post)


def _events(c, name):
    with c.stream("GET", f"/api/llm/pull/{name}/events") as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        return [json.loads(l[5:]) for l in r.iter_lines() if l.startswith("data:")]


def test_pull_progress_parses_stream(c, monkeypatch):
    _pull_stream(monkeypatch, [{"status": "pulling manifest"},
                               {"status": "downloading", "digest": "sha256:a", "total": 100, "completed": 50},
                               {"status": "success"}])
    assert c.post("/api/llm/pull", json={"name": "qwen3:8b"}).status_code == 202
    ollama_admin.wait("qwen3:8b", 3)
    ev = _events(c, "qwen3:8b")
    assert ev[-1]["status"] == "success" and ev[-1]["pct"] == 1
    assert set(ev[-1]) == set(PULL[-1])


def test_pull_error_terminates_stream(c, monkeypatch):
    _pull_stream(monkeypatch, [{"status": "pulling manifest"},
                               {"error": "pull model manifest: file does not exist"}])
    c.post("/api/llm/pull", json={"name": "nope:1b"})
    ollama_admin.wait("nope:1b", 3)
    ev = _events(c, "nope:1b")
    assert ev[-1]["status"] == "error" and "file does not exist" in ev[-1]["error"]


def test_pull_bad_name_400(c):
    assert c.post("/api/llm/pull", json={"name": "a b"}).status_code == 400


def test_events_unknown_name_404(c):
    assert c.get("/api/llm/pull/never/events").status_code == 404


def test_delete_in_use_409(c, monkeypatch):
    jobs.start("abcdef", "analyze")
    r = c.delete("/api/llm/models/gemma4:e4b-it-qat")
    assert r.status_code == 409 and r.json()["error"]["code"] == "model_in_use"


def test_delete_ok(c, monkeypatch):
    seen = []
    monkeypatch.setattr(ollama_admin.requests, "delete",
                        lambda url, json=None, timeout=None: seen.append(json) or R({}))
    assert c.delete("/api/llm/models/qwen3:8b").json() == {"ok": True}
    assert seen == [{"model": "qwen3:8b"}]
