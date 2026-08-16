# -*- coding: utf-8 -*-
"""Env-override behaviour of config.py. Reloads the module per-test so
os.environ changes take effect, and restores the pristine module afterwards."""
import importlib
import os
import pytest

import config as config_module


@pytest.fixture()
def reload_config(monkeypatch):
    """Yield a fn that sets env vars then reloads config; always restore after."""
    def _reload(**env):
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        return importlib.reload(config_module)
    yield _reload
    # restore module state computed from a clean environment
    for k in ("ASR_BASE_URL", "OLLAMA_BASE_URL", "LLM_MODEL", "WEB_PORT", "DATA_DIR"):
        os.environ.pop(k, None)
    importlib.reload(config_module)


def test_defaults_unchanged_without_env(reload_config):
    cfg = reload_config()
    assert cfg.WEB_PORT == 8780
    assert cfg.OLLAMA_BASE == "http://127.0.0.1:11434"
    assert cfg.LLM_MODEL == "gemma4:e4b-it-qat"
    assert cfg.ASR_BASE_URL == ""          # empty = autodetect
    assert cfg.DATA_DIR.endswith("data")


def test_env_overrides(reload_config, tmp_path):
    cfg = reload_config(
        ASR_BASE_URL="http://breeze-asr:8765",
        OLLAMA_BASE_URL="http://ollama:11434",
        LLM_MODEL="test-model",
        WEB_PORT="9999",
        DATA_DIR=str(tmp_path / "d"),
    )
    assert cfg.ASR_BASE_URL == "http://breeze-asr:8765"
    assert cfg.OLLAMA_BASE == "http://ollama:11434"
    assert cfg.LLM_MODEL == "test-model"
    assert cfg.WEB_PORT == 9999
    assert cfg.DATA_DIR == str(tmp_path / "d")
    assert cfg.UPLOAD_DIR == os.path.join(str(tmp_path / "d"), "uploads")
    assert cfg.DB_PATH == os.path.join(str(tmp_path / "d"), "haoji.db")
