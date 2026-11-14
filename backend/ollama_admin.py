# -*- coding: utf-8 -*-
"""Console endpoints for the notes model: settings, Ollama connection test, model list, pull with
progress (SSE), delete. All admin-only.

Breeze ASR / pyannote weights live inside the breeze-asr container, so they're reported read-only
(managed_by="breeze-asr") from its /health — the console can't download or delete them."""
import json, re, threading, time
import requests
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
import auth, errors, jobs, settings, status

router = APIRouter(prefix="/api", dependencies=[Depends(auth.require_admin)])

PULLS = {}            # name -> {name, status, completed, total, pct, error?}
_pull_lock = threading.Lock()
_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$")
TERMINAL = ("success", "error")


async def _json(request):
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:
        return {}


@router.get("/settings")
def get_settings():
    return settings.describe()


@router.put("/settings")
async def put_settings(request: Request):
    body = await _json(request)
    for key, value in body.items():
        try:
            settings.set(key, value)
        except settings.SettingError as e:
            return errors.api_error(e.code, e.message, e.hint,
                                    status=409 if e.code == "setting_locked" else 400)
    status.clear_cache()
    return settings.describe()


def _ollama(base, path, timeout=3):
    r = requests.get(base + path, timeout=timeout)
    r.raise_for_status()
    return r.json() or {}


@router.post("/llm/test")
async def llm_test(request: Request):
    body = await _json(request)
    base = settings.ollama_base()
    if body.get("base_url"):
        try:
            base = settings._url(body["base_url"])
        except settings.SettingError as e:
            return errors.api_error(e.code, e.message, e.hint)
    try:
        version = _ollama(base, "/api/version").get("version", "")
        models = [m["name"] for m in _ollama(base, "/api/tags").get("models", [])]
    except Exception as e:
        return {"ok": False, **errors.body("ollama_unreachable", f"連不到 {status.redact(base)}。",
                                           "確認 Ollama 在跑、網址和連接埠正確，且這台主機連得到它。"),
                "detail": str(e)[:200]}
    return {"ok": True, "version": version, "models": models}


def _asr_rows():
    h = status.asr_health() or {}
    state = "ready" if h else "unknown"
    return [
        {"id": "breeze-asr", "kind": "asr", "name": "Breeze ASR 25", "state": state, "size_bytes": None,
         "managed_by": "breeze-asr", "selected": True},
        {"id": "pyannote", "kind": "diarization", "name": "pyannote speaker-diarization 3.1",
         "state": state, "size_bytes": None, "managed_by": "breeze-asr", "selected": True},
    ]


@router.get("/models")
def list_models():
    base, selected = settings.ollama_base(), settings.llm_model()
    try:
        tags = _ollama(base, "/api/tags").get("models", [])
    except Exception:
        tags = []
    try:
        loaded = {m.get("name") for m in _ollama(base, "/api/ps").get("models", [])}
    except Exception:
        loaded = set()
    rows = []
    for m in tags:
        name = m["name"]
        pulling = PULLS.get(name, {}).get("status") not in (None, *TERMINAL)
        rows.append({"id": name, "kind": "llm", "name": name,
                     "state": "downloading" if pulling else ("loaded" if name in loaded else "ready"),
                     "size_bytes": m.get("size"), "managed_by": "ollama", "selected": name == selected})
    if selected not in {r["id"] for r in rows}:
        pulling = PULLS.get(selected, {}).get("status") not in (None, *TERMINAL)
        rows.insert(0, {"id": selected, "kind": "llm", "name": selected,
                        "state": "downloading" if pulling else "missing", "size_bytes": None,
                        "managed_by": "ollama", "selected": True})
    rows.sort(key=lambda r: (not r["selected"], r["name"]))
    return {"models": _asr_rows() + rows}


def _set(name, **kw):
    with _pull_lock:
        cur = PULLS.setdefault(name, {"name": name, "status": "queued", "completed": 0, "total": 0, "pct": 0})
        cur.update(kw)
        if cur.get("total"):
            cur["pct"] = round(min(1.0, cur["completed"] / cur["total"]), 4)


def _run_pull(name, base):
    try:
        r = requests.post(base + "/api/pull", json={"model": name, "stream": True}, stream=True, timeout=3600)
        r.raise_for_status()
        for line in r.iter_lines(decode_unicode=True):
            if not line:
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            if obj.get("error"):
                _set(name, status="error", error=str(obj["error"]))
                return
            st = obj.get("status", "")
            if st == "success":
                _set(name, status="success", pct=1, completed=PULLS[name].get("total") or 0)
                PULLS[name]["pct"] = 1
                status.clear_cache()
                return
            kw = {"status": "downloading" if obj.get("total") else st}
            if obj.get("total"):
                kw.update(total=int(obj["total"]), completed=int(obj.get("completed") or 0))
            _set(name, **kw)
        if PULLS[name]["status"] not in TERMINAL:
            _set(name, status="error", error="下載中斷了，請再試一次。")
    except Exception as e:
        _set(name, status="error", error=f"連不到 Ollama：{e}"[:300])


def wait(name, timeout):
    """Test helper: block until a pull reaches a terminal state."""
    end = time.time() + timeout
    while time.time() < end:
        if PULLS.get(name, {}).get("status") in TERMINAL:
            return True
        time.sleep(0.02)
    return False


@router.post("/llm/pull", status_code=202)
async def llm_pull(request: Request):
    name = str((await _json(request)).get("name") or "").strip()
    if not _NAME.match(name):
        return errors.api_error("bad_request", "模型名稱不對。", "例如 gemma4:e4b-it-qat 或 qwen3:8b")
    with _pull_lock:
        if PULLS.get(name, {}).get("status") not in (None, *TERMINAL):
            return {"ok": True, "already": True}
        PULLS[name] = {"name": name, "status": "queued", "completed": 0, "total": 0, "pct": 0}
    threading.Thread(target=_run_pull, args=(name, settings.ollama_base()), daemon=True,
                     name=f"pull-{name}").start()
    return {"ok": True}


@router.get("/llm/pull/{name:path}/events")
def llm_pull_events(name: str):
    if name not in PULLS:
        return errors.api_error("not_found", "沒有這個下載。", status=404)

    def gen():
        last = None
        while True:
            with _pull_lock:
                cur = dict(PULLS.get(name) or {})
            if cur != last:
                yield f"data: {json.dumps(cur, ensure_ascii=False)}\n\n"
                last = cur
            if cur.get("status") in TERMINAL:
                return
            time.sleep(0.25)
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/llm/pulls")
def llm_pulls():
    with _pull_lock:
        return {"pulls": list(PULLS.values())}


@router.delete("/llm/models/{name:path}")
def llm_delete(name: str):
    if name == settings.llm_model() and jobs.queue_counts()["active"] > 0:
        return errors.api_error("model_in_use", "這個模型正在寫會議記錄，等工作結束再刪除。", status=409)
    try:
        r = requests.delete(settings.ollama_base() + "/api/delete", json={"model": name}, timeout=30)
        r.raise_for_status()
    except Exception as e:
        return errors.api_error("ollama_unreachable", f"刪除失敗：{e}"[:200], status=502)
    status.clear_cache()
    return {"ok": True}
