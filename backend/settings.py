# -*- coding: utf-8 -*-
"""Runtime settings the console can change, stored in SQLite (key -> JSON value).

Precedence: environment variable > stored value > default. A field set by env is *locked*: the
console shows it read-only, and set() refuses it — the deployer's .env stays the source of truth.
Env is read at call time (not import time) so tests and restarts see the current value."""
import json, os, sqlite3
from urllib.parse import urlparse
import config


class SettingError(Exception):
    def __init__(self, code, message, hint=""):
        super().__init__(message)
        self.code, self.message, self.hint = code, message, hint


def _url(v):
    v = (v or "").strip().rstrip("/")
    p = urlparse(v)
    if p.scheme not in ("http", "https") or not p.netloc:
        raise SettingError("invalid_setting", "網址格式不對，請用 http:// 或 https:// 開頭。",
                           "例如 http://ollama:11434")
    return v


def _optional_url(v):
    return "" if not (v or "").strip() else _url(v)


def _name(v):
    v = (v or "").strip()
    if not v or len(v) > 200 or any(c.isspace() for c in v):
        raise SettingError("invalid_setting", "模型名稱不對。", "例如 gemma4:e4b-it-qat")
    return v


def _provider(v):
    v = (v or "").strip()
    if v not in ("ollama", "openai"):
        raise SettingError("invalid_setting", "只支援 ollama 或 openai（OpenAI 相容 API）。")
    return v


def _secret(v):
    return (v or "").strip()


# key: (env var, default, validator, secret?)
SETTINGS = {
    "ollama_base_url": ("OLLAMA_BASE_URL", "http://127.0.0.1:11434", _url, False),
    "llm_model": ("LLM_MODEL", "gemma4:e4b-it-qat", _name, False),
    "llm_provider": ("LLM_PROVIDER", "ollama", _provider, False),
    "openai_base_url": ("OPENAI_BASE_URL", "", _optional_url, False),
    "openai_api_key": ("OPENAI_API_KEY", "", _secret, True),
}


def _conn():
    os.makedirs(os.path.dirname(config.DB_PATH) or ".", exist_ok=True)
    return sqlite3.connect(config.DB_PATH)


def init():
    with _conn() as c:
        c.execute("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)")


def _stored(key):
    try:
        with _conn() as c:
            row = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    except sqlite3.OperationalError:
        return None                     # table not created yet (init not run): fall through
    return json.loads(row[0]) if row else None


def _env(key):
    v = os.environ.get(SETTINGS[key][0])
    return v if v not in (None, "") else None


def _default(key):
    """Built-in default, overridable by <ENV>_DEFAULT — a deployer-supplied default that, unlike the
    plain env var, does NOT lock the field (docker-compose uses this for the ollama URL and model)."""
    env_name, default, _, _ = SETTINGS[key]
    return (os.environ.get(env_name + "_DEFAULT") or "").strip() or default


def get(key):
    env_name, _, validate, _ = SETTINGS[key]
    default = _default(key)
    v = _env(key)
    if v is not None:
        return v.strip().rstrip("/") if validate in (_url, _optional_url) else v.strip()
    stored = _stored(key)
    return stored if stored is not None else default


def set(key, value):  # noqa: A001 — mirrors get()
    if key not in SETTINGS:
        raise SettingError("invalid_setting", f"沒有這個設定：{key}")
    env_name = SETTINGS[key][0]
    if _env(key) is not None:
        raise SettingError("setting_locked", "這個設定由環境變數決定，不能在這裡修改。",
                           f"修改 .env 的 {env_name} 後重新啟動。")
    value = SETTINGS[key][2](value if isinstance(value, str) else str(value))
    with _conn() as c:
        c.execute("INSERT INTO settings(key,value) VALUES(?,?) "
                  "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, json.dumps(value)))


def describe():
    out = {}
    for key, (_, _, _, secret) in SETTINGS.items():
        default = _default(key)
        locked = _env(key) is not None
        if secret:
            out[key] = {"configured": bool(get(key)), "locked": locked}
        else:
            out[key] = {"value": get(key), "locked": locked, "default": default}
    return out


def ollama_base():
    return get("ollama_base_url")


def llm_model():
    return get("llm_model")
