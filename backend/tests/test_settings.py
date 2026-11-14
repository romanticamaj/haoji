# -*- coding: utf-8 -*-
import pytest
import config, settings


@pytest.fixture(autouse=True)
def _db(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "s.db"))
    for k in ("OLLAMA_BASE_URL", "LLM_MODEL", "LLM_PROVIDER", "OPENAI_BASE_URL", "OPENAI_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    settings.init()


def test_default_when_unset():
    assert settings.ollama_base() == "http://127.0.0.1:11434"
    assert settings.llm_model() == "gemma4:e4b-it-qat"


def test_stored_value_wins_over_default():
    settings.set("llm_model", "qwen3:8b")
    assert settings.llm_model() == "qwen3:8b"
    assert settings.describe()["llm_model"] == {
        "value": "qwen3:8b", "locked": False, "default": "gemma4:e4b-it-qat"}


def test_env_wins_and_locks(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "x")
    settings.set  # noqa
    assert settings.llm_model() == "x"
    assert settings.describe()["llm_model"]["locked"] is True
    with pytest.raises(settings.SettingError) as e:
        settings.set("llm_model", "y")
    assert e.value.code == "setting_locked"


@pytest.mark.parametrize("bad", ["ftp://x", "", "   ", "not a url", "http://"])
def test_put_rejects_bad_url(bad):
    with pytest.raises(settings.SettingError) as e:
        settings.set("ollama_base_url", bad)
    assert e.value.code == "invalid_setting"
    assert settings.ollama_base() == "http://127.0.0.1:11434"


def test_trailing_slash_normalized():
    settings.set("ollama_base_url", " http://h:11434/ ")
    assert settings.ollama_base() == "http://h:11434"


def test_unknown_key_rejected():
    with pytest.raises(settings.SettingError) as e:
        settings.set("nope", "1")
    assert e.value.code == "invalid_setting"


def test_api_key_write_only():
    settings.set("openai_api_key", "sk-secret")
    d = settings.describe()
    assert d["openai_api_key"] == {"configured": True, "locked": False}
    assert "sk-secret" not in repr(d)
    assert settings.get("openai_api_key") == "sk-secret"


def test_provider_validated():
    with pytest.raises(settings.SettingError):
        settings.set("llm_provider", "gpt")
    settings.set("llm_provider", "openai")
    assert settings.get("llm_provider") == "openai"


def test_error_shape():
    import errors, json
    r = errors.api_error("setting_locked", "m", "h", status=409)
    assert r.status_code == 409
    assert json.loads(r.body) == {"error": {"code": "setting_locked", "message": "m", "hint": "h"}}
