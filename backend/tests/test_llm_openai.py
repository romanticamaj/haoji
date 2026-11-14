# -*- coding: utf-8 -*-
import pytest
import config, llm, settings


class R:
    def __init__(self, d, ok=True): self._d, self.ok = d, ok
    def json(self): return self._d
    def raise_for_status(self):
        if not self.ok: raise llm.requests.HTTPError("500")


@pytest.fixture(autouse=True)
def _db(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "s.db"))
    for k in ("LLM_PROVIDER", "OPENAI_BASE_URL", "OPENAI_API_KEY", "LLM_MODEL"):
        monkeypatch.delenv(k, raising=False)
    settings.init()


def test_provider_switch_by_setting():
    assert llm.active_provider().name == "ollama"
    settings.set("llm_provider", "openai")
    assert llm.active_provider().name == "openai"


def test_openai_payload_and_auth_header(monkeypatch):
    settings.set("openai_base_url", "https://api.deepinfra.com/v1/openai/")
    settings.set("openai_api_key", "sk-x")
    seen = {}
    def post(url, json=None, headers=None, timeout=None):
        seen.update(url=url, json=json, headers=headers)
        return R({"choices": [{"message": {"content": "# 主題\n\n## 會議目的\n- 討论"}}]})
    monkeypatch.setattr(llm.requests, "post", post)
    out = llm.OpenAICompatProvider().generate_meeting_notes("[00:00] A: hi", model="google/gemma-4-E4B-it")
    assert seen["url"] == "https://api.deepinfra.com/v1/openai/chat/completions"
    assert seen["headers"]["Authorization"] == "Bearer sk-x"
    assert seen["json"]["model"] == "google/gemma-4-E4B-it"
    assert seen["json"]["messages"][0]["content"] == llm.MEETING_NOTES_PROMPT
    assert "討論" in out                          # s2tw applied


def test_base_without_v1_gets_it(monkeypatch):
    settings.set("openai_base_url", "http://localhost:8000")
    seen = {}
    monkeypatch.setattr(llm.requests, "post", lambda url, **k: seen.update(url=url) or R({"choices": [{"message": {"content": "x"}}]}))
    llm.OpenAICompatProvider().generate_meeting_notes("t")
    assert seen["url"] == "http://localhost:8000/v1/chat/completions"


def test_no_key_no_auth_header(monkeypatch):
    settings.set("openai_base_url", "http://localhost:8000/v1")
    seen = {}
    monkeypatch.setattr(llm.requests, "post", lambda url, headers=None, **k: seen.update(h=headers) or R({"choices": [{"message": {"content": "x"}}]}))
    llm.OpenAICompatProvider().generate_meeting_notes("t")
    assert "Authorization" not in seen["h"]


def test_think_block_stripped(monkeypatch):
    settings.set("openai_base_url", "http://localhost:8000/v1")
    monkeypatch.setattr(llm.requests, "post", lambda url, **k: R({"choices": [{"message": {"content": "<think>hmm</think>\n# 結果"}}]}))
    assert llm.OpenAICompatProvider().generate_meeting_notes("t") == "# 結果"


def test_unconfigured_raises_clear_error():
    with pytest.raises(RuntimeError) as e:
        llm.OpenAICompatProvider().generate_meeting_notes("t")
    assert "OPENAI_BASE_URL" in str(e.value)


def test_progress_called_once_at_end(monkeypatch):
    settings.set("openai_base_url", "http://localhost:8000/v1")
    monkeypatch.setattr(llm.requests, "post", lambda url, **k: R({"choices": [{"message": {"content": "abcd"}}]}))
    seen = []
    llm.OpenAICompatProvider().generate_meeting_notes("t", on_progress=seen.append)
    assert seen == [4]
