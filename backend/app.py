# -*- coding: utf-8 -*-
import sys
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import os, json, re, time, logging, threading
from typing import Optional
from logging.handlers import RotatingFileHandler
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
import config
import asr, sessions, llm, media
from fastapi import Request

# --- logging: rotating file (backend/logs/haoji.log) + console ---------------
LOG_DIR = os.path.join(config.ROOT, "logs")
os.makedirs(LOG_DIR, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        RotatingFileHandler(os.path.join(LOG_DIR, "haoji.log"),
                            maxBytes=2_000_000, backupCount=5, encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("haoji")
# quiet the benign Windows "ConnectionResetError (WinError 10054)" noise that
# asyncio logs when a client drops the connection mid-response (e.g. app closes
# during a long analyze). It's harmless — the request still completed.
logging.getLogger("asyncio").setLevel(logging.CRITICAL)

app = FastAPI(title="好記 Haoji API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# skip noisy pollers: /health and the GET status poll during transcription
_SKIP_LOG = re.compile(r"^/health$|^/api/sessions/[^/]+$")

@app.middleware("http")
async def _log_requests(request: Request, call_next):
    t0 = time.time()
    resp = await call_next(request)
    if not (request.method == "GET" and _SKIP_LOG.match(request.url.path)):
        log.info("%s %s -> %s (%.0fms)", request.method, request.url.path,
                 resp.status_code, (time.time() - t0) * 1000)
    return resp

_executor = ThreadPoolExecutor(max_workers=2)

# Sessions with a transcription job in flight. Guards against a client that submits transcribe more
# than once (the duplicate-upload class of bug) launching a second, redundant job for the same audio.
_submitted = set()
_submit_lock = threading.Lock()

PARTS_DIR = os.path.join(config.UPLOAD_DIR, "parts")
os.makedirs(PARTS_DIR, exist_ok=True)

@app.on_event("startup")
def _startup():
    sessions.init_db()
    log.info("好記 backend up on :%s", config.WEB_PORT)

@app.get("/health")
def health():
    return {"status": "ok", "service": "haoji-backend"}

@app.post("/api/sessions")
async def create_session(req: Request):
    # Idempotent on an optional client task-id: a client that retries the pipeline (or whose upload
    # fires more than once) reuses the SAME server session instead of spawning duplicates.
    try:
        body = await req.json()
    except Exception:
        body = {}
    client_id = body.get("client_id") if isinstance(body, dict) else None
    if client_id:
        existing = sessions.get_session_by_client(client_id)
        if existing:
            log.info("[%s] session reused (client_id)", existing["id"])
            return {"session_id": existing["id"], "reused": True}
    sid = sessions.create_session("recording", client_id=client_id)
    log.info("[%s] session created", sid)
    return {"session_id": sid}

@app.post("/api/sessions/{sid}/parts")
async def add_part(sid: str, index: Optional[int] = None, file: UploadFile = File(...)):
    if not sessions.get_session(sid):
        return JSONResponse({"error": "查無此工作"}, status_code=404)
    # Idempotent by index: a re-uploaded part overwrites the same slot/file rather than appending a
    # duplicate. Falls back to append (old behaviour) when the client doesn't pass an index.
    idx = index if index is not None else len(sessions.get_parts(sid))
    dest = os.path.join(PARTS_DIR, f"{sid}-{idx}.m4a")
    nbytes = 0
    with open(dest, "wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk: break
            out.write(chunk); nbytes += len(chunk)
    await file.close()
    count = sessions.set_part(sid, idx, dest)
    log.info("[%s] part idx %s received (%.1f KB, %d total)", sid, idx, nbytes / 1024, count)
    return {"count": count}

def _run_transcribe(sid):
    parts = [p for p in sessions.get_parts(sid) if p]  # skip empty index slots
    t0 = time.time()
    try:
        log.info("[%s] transcribe start: concat %d part(s)", sid, len(parts))
        sessions.update_session(sid, status="running", pct=0.1, message="串接音檔…")
        wav = os.path.join(config.UPLOAD_DIR, sid + ".wav")
        media.concat_to_wav(parts, wav)
        log.info("[%s] ASR + diarization…", sid)
        sessions.update_session(sid, pct=0.35, message="辨識中（含講者分離）…")
        norm = asr.normalize(asr.transcribe_diarize(wav))
        sessions.update_session(sid, status="done", pct=1.0, message="完成",
                                transcript=json.dumps(norm, ensure_ascii=False))
        log.info("[%s] transcribe done: %d segs, %d speakers, %.0fs audio, took %.0fs",
                 sid, len(norm["segments"]), len(norm["speakers"]),
                 norm.get("duration", 0), time.time() - t0)
    except Exception as e:
        log.exception("[%s] transcribe FAILED: %s", sid, e)
        sessions.update_session(sid, status="error", message=str(e), error=str(e))
    finally:
        for p in parts + [os.path.join(config.UPLOAD_DIR, sid + ".wav")]:
            try: os.remove(p)
            except OSError: pass
        with _submit_lock:
            _submitted.discard(sid)

@app.post("/api/sessions/{sid}/transcribe")
def transcribe(sid: str):
    s = sessions.get_session(sid)
    if not s:
        return JSONResponse({"error": "查無此工作"}, status_code=404)
    if not [p for p in sessions.get_parts(sid) if p]:
        return JSONResponse({"error": "沒有錄音段落"}, status_code=400)
    # Idempotent: if a job is already in flight (or running) for this session, don't launch another.
    with _submit_lock:
        if sid in _submitted or s["status"] == "running":
            log.info("[%s] transcribe dedup (already in flight)", sid)
            return {"ok": True, "dedup": True}
        _submitted.add(sid)
    log.info("[%s] transcribe queued (%d parts)", sid, len([p for p in sessions.get_parts(sid) if p]))
    sessions.update_session(sid, status="queued", message="排隊中…", error=None)
    _executor.submit(_run_transcribe, sid)
    return {"ok": True}

@app.get("/api/sessions/{sid}")
def session_status(sid: str):
    s = sessions.get_session(sid)
    if not s:
        return JSONResponse({"error": "查無此工作"}, status_code=404)
    out = {"status": s["status"], "pct": s["pct"], "message": s["message"]}
    if s.get("transcript"):
        out["transcript"] = json.loads(s["transcript"])
    if s.get("error"):
        out["error"] = s["error"]
    return out

@app.get("/api/llm/models")
def llm_models():
    ok, names, _ = llm.llm_status()
    return {"ok": ok, "models": names, "default": config.LLM_MODEL}

@app.post("/api/sessions/{sid}/analyze")
async def analyze(sid: str, req: Request):
    s = sessions.get_session(sid)
    if not s or not s.get("transcript"):
        return JSONResponse({"error": "查無逐字稿"}, status_code=404)
    body = await req.json()
    data = json.loads(s["transcript"])
    text = sessions.build_transcript_text(data["segments"], body.get("names") or {})
    if not text.strip():
        return JSONResponse({"error": "沒有逐字稿內容"}, status_code=400)
    model = body.get("model") or config.LLM_MODEL
    log.info("[%s] analyze -> LLM %s (%d chars transcript)", sid, model, len(text))
    t0 = time.time()
    try:
        # run the blocking LLM call in a thread so the event loop stays
        # responsive (otherwise /health and every other request freeze for the
        # whole 10-20s generation).
        notes = await run_in_threadpool(
            llm.get_provider("ollama").generate_meeting_notes, text, model=body.get("model") or None)
    except Exception as e:
        log.error("[%s] analyze FAILED: %s", sid, e)
        return JSONResponse({"error": str(e)}, status_code=502)
    sessions.update_session(sid, notes=notes)
    log.info("[%s] analyze done: %d chars notes, took %.0fs", sid, len(notes), time.time() - t0)
    return {"notes": notes, "model": model}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=config.WEB_HOST, port=config.WEB_PORT, log_level="warning")
