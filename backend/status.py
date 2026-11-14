# -*- coding: utf-8 -*-
"""GET /api/status: is this server ready to turn a recording into notes, and if not, what to do.

Public view (the phone uses it to validate a URL and show a status dot): ok, check ids/labels/hints,
queue counts, selected model. ?detail=1 (admin, the console) adds probe messages, URLs, GPU and
server facts. Probes are cached STATUS_TTL seconds so polling from several clients is cheap; queue
counts are live."""
import os, shutil, sqlite3, subprocess, tempfile, threading, time
import requests
from fastapi import APIRouter, Request
import asr, auth, config, errors, jobs, settings

STATUS_TTL = 5.0
_cache = {"at": 0.0, "probe": None}
_lock = threading.Lock()


def asr_health():
    """Cached Breeze /health payload ({} when down) — models.py reads model names from it."""
    return _probe_cached()["asr"]["health"]


def clear_cache():
    with _lock:
        _cache.update(at=0.0, probe=None)


def gpu_info(run=subprocess.run):
    try:
        out = run(["nvidia-smi", "--query-gpu=name,memory.used,memory.total,utilization.gpu",
                   "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=3)
        line = (out.stdout or "").strip().splitlines()[0]
        name, used, total, util = [p.strip() for p in line.split(",")]
        return {"available": True, "name": name, "vram_used_mb": int(float(used)),
                "vram_total_mb": int(float(total)), "util_pct": int(float(util))}
    except Exception:
        return {"available": False}


def _ffmpeg_ok():
    path = shutil.which(config.FFMPEG) or (config.FFMPEG if os.path.exists(config.FFMPEG) else None)
    return bool(path), path or config.FFMPEG


def _check(id_, ok, label, hint="", message=""):
    return {"id": id_, "ok": bool(ok), "label": label, "hint": "" if ok else hint, "message": message}


def _probe():
    checks = []
    # data dir
    try:
        os.makedirs(config.DATA_DIR, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=config.DATA_DIR):
            pass
        checks.append(_check("data_writable", True, "資料夾可寫入", message=config.DATA_DIR))
    except Exception as e:
        checks.append(_check("data_writable", False, "資料夾可寫入",
                             f"確認 {config.DATA_DIR} 存在且可寫入（Docker 的 data volume）。", str(e)))
    # sqlite
    try:
        with sqlite3.connect(config.DB_PATH) as c:
            c.execute("SELECT 1")
        checks.append(_check("sqlite", True, "資料庫", message=config.DB_PATH))
    except Exception as e:
        checks.append(_check("sqlite", False, "資料庫", "資料庫打不開，檢查 DATA_DIR 的權限與空間。", str(e)))
    # ffmpeg
    ok, path = _ffmpeg_ok()
    checks.append(_check("ffmpeg", ok, "ffmpeg", "安裝 ffmpeg 或設定 FFMPEG_PATH（Docker 映像已內建）。", path))
    # ASR
    base, health = asr.quick_probe()
    checks.append(_check("breeze_asr", bool(base), "語音辨識（Breeze ASR）",
                         "breeze-asr 容器還沒就緒：第一次啟動會下載約 3GB 模型，"
                         "用 `docker compose logs -f breeze-asr` 看進度。", base or ""))
    # Ollama
    llm_base, model = settings.ollama_base(), settings.llm_model()
    version, names, reachable = "", [], False
    try:
        r = requests.get(llm_base + "/api/version", timeout=2)
        version = (r.json() or {}).get("version", "")
        r = requests.get(llm_base + "/api/tags", timeout=2)
        r.raise_for_status()
        names = [m["name"] for m in (r.json() or {}).get("models", [])]
        reachable = True
    except Exception:
        pass
    checks.append(_check("ollama", reachable, "Ollama",
                         f"連不到 {llm_base}。確認 ollama 容器在跑，或到「連線」頁修改網址"
                         "（由 OLLAMA_BASE_URL 設定時要改 .env）。",
                         f"{version} · {llm_base}" if reachable else llm_base))
    has_model = reachable and model in names
    checks.append(_check("llm_model", has_model, "會議記錄模型",
                         f"到「模型」頁下載 {model}，或改選已安裝的模型。" if reachable
                         else "先讓 Ollama 連得上。", model))
    return {"checks": checks, "llm": {"model": model, "reachable": reachable, "base_url": llm_base,
                                      "provider": settings.get("llm_provider")},
            "asr": {"base_url": base or "", "health": health or {}}}


def _probe_cached():
    with _lock:
        if _cache["probe"] is not None and time.monotonic() - _cache["at"] < STATUS_TTL:
            return _cache["probe"]
    p = _probe()
    with _lock:
        _cache.update(at=time.monotonic(), probe=p)
    return p


def collect(detail=False):
    p = _probe_cached()
    checks = [dict(c) for c in p["checks"]]
    if not detail:
        for c in checks:
            c.pop("message", None)
    out = {"version": config.VERSION, "ok": all(c["ok"] for c in checks), "checks": checks,
           "queue": jobs.queue_counts(),
           "llm": {"model": p["llm"]["model"], "reachable": p["llm"]["reachable"]},
           "pairing_required": auth.pairing_required()}
    if detail:
        out["llm"].update(provider=p["llm"]["provider"], base_url=p["llm"]["base_url"])
        out["asr"] = {"base_url": p["asr"]["base_url"]}
        out["gpu"] = gpu_info()
        out["server"] = {"port": config.WEB_PORT, "data_dir": config.DATA_DIR,
                         "retention_hours": config.RETENTION_HOURS,
                         "push_enabled": bool(config.APNS_KEY_ID and config.APNS_TEAM_ID),
                         "admin_token_source": auth.admin_token_source()}
    return out


router = APIRouter(prefix="/api")


@router.get("/status")
def get_status(request: Request, detail: int = 0):
    if detail:
        auth.require_admin(request)
    return collect(detail=bool(detail))
