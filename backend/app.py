# -*- coding: utf-8 -*-
import sys
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import math, os, json, re, time, logging, threading
from typing import Optional
from logging.handlers import RotatingFileHandler
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
import config
import asr, sessions, llm, media, push
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
# Notes generation gets its OWN pool. Sharing the transcription pool meant a couple of long jobs
# starved every later request: a third submission simply sat in the queue with no sign of progress,
# which is exactly what "生成會議記錄卡住" looked like. Kept small — the local LLM is the bottleneck.
_notes_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="notes")

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
    # expected_parts lets the server finish the job on its own: once this many parts have arrived it
    # starts transcription itself, so an upload completed by the OS (background URLSession, app
    # closed) is still processed without the client calling /transcribe.
    expected = body.get("expected_parts") if isinstance(body, dict) else None
    # The phone's APNs token: the job finishes here, server-side, typically with the app suspended, so
    # this is the only way to tell the user it is done. Used once, then cleared (_notify_done).
    push_fields = _push_fields(body)
    if client_id:
        existing = sessions.get_session_by_client(client_id)
        if existing:
            if expected and not existing.get("expected_parts"):
                sessions.update_session(existing["id"], expected_parts=int(expected))
            if push_fields:
                sessions.update_session(existing["id"], **push_fields)
            log.info("[%s] session reused (client_id)", existing["id"])
            return {"session_id": existing["id"], "reused": True}
    sid = sessions.create_session("recording", client_id=client_id,
                                  expected_parts=int(expected) if expected else None)
    if push_fields:
        sessions.update_session(sid, **push_fields)
    log.info("[%s] session created%s", sid, " (push)" if push_fields else "")
    return {"session_id": sid}


_PUSH_TOKEN_RE = re.compile(r"^[0-9a-fA-F]{32,200}$")


def _push_fields(body):
    if not isinstance(body, dict):
        return {}
    token = body.get("push_token")
    if not isinstance(token, str) or not _PUSH_TOKEN_RE.match(token):
        return {}
    env = "sandbox" if body.get("push_env") == "sandbox" else "production"
    title = body.get("push_title") if isinstance(body.get("push_title"), str) else ""
    return {"push_token": token, "push_env": env, "push_title": title[:80]}


def _notify_done(sid):
    """Tell the phone the transcription ended (done or failed), then forget its token."""
    s = sessions.get_session(sid)
    if not s or not s.get("push_token"):
        return
    sessions.update_session(sid, push_token=None, push_env=None, push_title=None)
    name = s.get("push_title") or "會議"
    if s.get("status") == "done":
        title, body = "逐字稿完成", f"「{name}」的逐字稿好了，點一下查看。"
    else:
        title, body = "逐字稿失敗", f"「{name}」轉譯沒有成功，點一下重試。"
    ok = push.send(s["push_token"], s.get("push_env"), title, body,
                   {"session": s.get("client_id") or "", "kind": "transcript"})
    log.info("[%s] push %s", sid, "sent" if ok else "not sent")

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
    # All expected parts in → start transcription ourselves. This is what lets a background/OS-driven
    # upload complete the whole pipeline with the app closed.
    started = False
    if sessions.parts_complete(sid):
        started = _submit_transcribe(sid)
        if started:
            log.info("[%s] all %s parts in — transcription auto-started", sid, count)
    return {"count": count, "transcribe_started": started}

# Sessions with a notes generation in flight (guards a duplicate submit from launching a second,
# expensive LLM run for the same transcript).
_analyzing = {}
# Submission order of notes jobs that have not started executing yet. A ThreadPoolExecutor queues
# silently, so without this a job waiting its turn looked identical to one being generated — the
# user saw "生成中" with nothing happening. Position in this list is what tells them they're waiting.
_notes_waiting = []
_analyze_lock = threading.Lock()


def notes_queue_position(sid):
    """1-based place in the notes queue, or 0 if it is running / not queued."""
    with _analyze_lock:
        return _notes_waiting.index(sid) + 1 if sid in _notes_waiting else 0


def _notes_target_chars(transcript_text):
    """Roughly how long the notes will be, used to turn 'characters produced' into a percentage.
    Notes condense the transcript, so scale off its length with sane floor/ceiling."""
    return max(500, min(2500, int(len(transcript_text) * 0.15)))


def _run_analyze(sid, text, model_arg, model_label):
    """Background notes generation. Writes the result (or the error) to the session so the client can
    pick it up later — the whole point of background mode."""
    t0 = time.time()
    target = _notes_target_chars(text)

    # Progress has TWO sources, because most of the wait is prompt processing, during which the model
    # has produced no output at all — character-based progress alone sits at 0 and then rushes to
    # 100%. So a ticker supplies an elapsed-time floor until tokens start flowing, and the character
    # count takes over once it overtakes that floor. Only the larger of the two is ever published, so
    # the bar never goes backwards.
    state = {"pct": 0.0}
    stop_tick = threading.Event()

    def publish(pct, message):
        pct = min(0.95, max(state["pct"], pct))     # monotonic, and never claims to be done
        state["pct"] = pct
        sessions.update_session(sid, notes_pct=round(pct, 3), notes_message=message)

    def on_progress(chars):
        publish(chars / target if target else 0.0, f"生成中…（已寫 {chars} 字）")

    def _tick():
        t_gen = time.time()
        while not stop_tick.wait(2.0):
            if state["pct"] >= 0.1:
                continue                            # real output is flowing; let it drive
            elapsed = time.time() - t_gen
            mm, ss = divmod(int(elapsed), 60)
            # Reading the transcript takes a while before the first token appears; creep towards 0.35
            # so the user can see it working rather than staring at a dead 0%.
            publish(0.35 * (1 - math.exp(-elapsed / 45.0)), f"生成中…（讀取逐字稿… 已 {mm}:{ss:02d}）")

    # We are executing now — leave the queue and say so.
    with _analyze_lock:
        if sid in _notes_waiting:
            _notes_waiting.remove(sid)
    try:
        sessions.update_session(sid, notes_status="running", notes_pct=0.0, notes_message="生成中…")
        threading.Thread(target=_tick, daemon=True, name=f"notes-tick-{sid}").start()
        notes = llm.get_provider("ollama").generate_meeting_notes(
            text, model=model_arg, on_progress=on_progress)
        sessions.update_session(sid, notes=notes, notes_status="done", notes_error=None,
                                notes_pct=1.0, notes_message="完成")
        log.info("[%s] analyze(bg) done: %d chars notes, took %.0fs", sid, len(notes), time.time() - t0)
    except Exception as e:
        log.exception("[%s] analyze(bg) FAILED: %s", sid, e)
        sessions.update_session(sid, notes_status="error", notes_error=str(e))
    finally:
        stop_tick.set()
        with _analyze_lock:
            _analyzing.pop(sid, None)
            if sid in _notes_waiting:
                _notes_waiting.remove(sid)


def _submit_transcribe(sid):
    """Queue transcription for a session, at most once. Returns True if this call queued it.
    Shared by the /transcribe endpoint and the auto-start path in add_part."""
    s = sessions.get_session(sid)
    if not s:
        return False
    if not [p for p in sessions.get_parts(sid) if p]:
        return False
    with _submit_lock:
        if sid in _submitted or s["status"] == "running":
            return False
        _submitted.add(sid)
    sessions.update_session(sid, status="queued", message="排隊中…", error=None)
    _executor.submit(_run_transcribe, sid)
    return True


@app.put("/api/sessions/{sid}/parts/{index}")
async def put_part(sid: str, index: int, req: Request):
    """Raw-body variant of the part upload.

    iOS background uploads (NSURLSession with a background configuration) can only send a FILE as the
    body — they cannot build a multipart form. So the phone PUTs the audio bytes straight here, which
    lets the OS finish the transfer even after the app is swiped away. Same idempotency as the
    multipart route: index N overwrites slot N, and the last expected part auto-starts transcription.
    """
    if not sessions.get_session(sid):
        return JSONResponse({"error": "查無此工作"}, status_code=404)
    dest = os.path.join(PARTS_DIR, f"{sid}-{index}.m4a")
    nbytes = 0
    with open(dest, "wb") as out:
        async for chunk in req.stream():
            out.write(chunk)
            nbytes += len(chunk)
    if nbytes == 0:
        try: os.remove(dest)
        except OSError: pass
        return JSONResponse({"error": "空的檔案"}, status_code=400)
    count = sessions.set_part(sid, index, dest)
    log.info("[%s] part idx %s received via PUT (%.1f KB, %d total)", sid, index, nbytes / 1024, count)
    started = False
    if sessions.parts_complete(sid):
        started = _submit_transcribe(sid)
        if started:
            log.info("[%s] all %s parts in (PUT) — transcription auto-started", sid, count)
    return {"count": count, "transcribe_started": started}


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
        # Recognition is ONE blocking call to Breeze ASR — it reports nothing while it works, so the
        # bar used to sit frozen at the same number for the entire (longest) phase, which reads as
        # "stuck". Tick an estimate instead, scaled off the audio length: it always moves, never goes
        # backwards, and approaches but never reaches the end of the phase however long it takes.
        # The elapsed time in the message is the honest part; the percentage is openly an estimate.
        stop_tick = threading.Event()

        def _tick():
            t_asr = time.time()
            try:
                dur = asr.probe_duration(wav) or 0
            except Exception:
                dur = 0
            expected = max(20.0, dur * 0.5)      # rough: ASR runs faster than real time on the GPU
            while not stop_tick.wait(2.0):
                elapsed = time.time() - t_asr
                frac = 1 - math.exp(-elapsed / expected)     # asymptotic: never claims to be done
                mm, ss = divmod(int(elapsed), 60)
                sessions.update_session(
                    sid, pct=round(0.35 + 0.6 * frac, 3),
                    message=f"辨識中（含講者分離）…（已 {mm}:{ss:02d}）")

        ticker = threading.Thread(target=_tick, daemon=True, name=f"asr-tick-{sid}")
        ticker.start()
        try:
            norm = asr.normalize(asr.transcribe_diarize(wav))
        finally:
            stop_tick.set()
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
        _notify_done(sid)

@app.post("/api/sessions/{sid}/transcribe")
def transcribe(sid: str):
    s = sessions.get_session(sid)
    if not s:
        return JSONResponse({"error": "查無此工作"}, status_code=404)
    if not [p for p in sessions.get_parts(sid) if p]:
        return JSONResponse({"error": "沒有錄音段落"}, status_code=400)
    # Idempotent: if a job is already in flight (or running) for this session, don't launch another.
    if not _submit_transcribe(sid):
        log.info("[%s] transcribe dedup (already in flight)", sid)
        return {"ok": True, "dedup": True}
    log.info("[%s] transcribe queued (%d parts)", sid, len([p for p in sessions.get_parts(sid) if p]))
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
    # Notes are reported here too so a client that vanished mid-generation (backgrounded, killed) can
    # collect the finished result on its next run instead of re-running the LLM.
    if s.get("notes"):
        out["notes"] = s["notes"]
    if s.get("notes_status"):
        out["notes_status"] = s["notes_status"]
    if s.get("notes_error"):
        out["notes_error"] = s["notes_error"]
    if s.get("notes_pct") is not None:
        out["notes_pct"] = s["notes_pct"]
    if s.get("notes_message"):
        out["notes_message"] = s["notes_message"]
    if s.get("notes_status") == "queued":
        pos = notes_queue_position(sid)
        if pos:
            out["notes_queue_position"] = pos
    return out

@app.get("/api/debug/jobs")
def debug_jobs():
    """What the server is actually working on — the first thing to check when something 'hangs'.

    `queued` > 0 with nothing finishing means the pool is saturated, not that a job died."""
    with _submit_lock:
        transcribing = sorted(_submitted)
    with _analyze_lock:
        analyzing = sorted(_analyzing)
    return {
        "transcribe": {"in_flight": transcribing,
                       "workers": _executor._max_workers,
                       "queued": _executor._work_queue.qsize()},
        "notes": {"in_flight": analyzing,
                  "waiting": list(_notes_waiting),
                  "workers": _notes_executor._max_workers,
                  "queued": _notes_executor._work_queue.qsize()},
    }


@app.get("/api/llm/models")
def llm_models():
    ok, names, _ = llm.llm_status()
    return {"ok": ok, "models": names, "default": config.LLM_MODEL}

@app.post("/api/sessions/{sid}/analyze")
async def analyze(sid: str, req: Request):
    s = sessions.get_session(sid)
    body = await req.json()
    # Prefer the transcript the CLIENT sends. The phone is the source of truth: it holds the user's
    # corrections (inline edits, keyword fixes) and it still has the transcript long after the server
    # copy is gone (backend restarted, DB reset, session cleaned up). Relying on the stored copy meant
    # "查無逐字稿" for sessions the app could see perfectly well — and notes generated from the
    # UNCORRECTED text. Fall back to the stored copy for older clients.
    client_tr = body.get("transcript") if isinstance(body, dict) else None
    if isinstance(client_tr, dict) and client_tr.get("segments"):
        data = client_tr
        # The client brought everything needed, so it does not matter whether we have ever seen this
        # session: create the row on demand purely to hold the async result. Without this a phone
        # whose stored id had gone (redeploy, DB reset, pruning) got "查無此工作" for a meeting whose
        # transcript it was holding in its hand.
        if not s:
            s = sessions.ensure_session(sid, "notes", client_id=body.get("client_id"))
            log.info("[%s] analyze: session recreated on demand from the client's transcript", sid)
    elif s and s.get("transcript"):
        data = json.loads(s["transcript"])
    elif not s:
        return JSONResponse({"error": "查無此工作"}, status_code=404)
    else:
        return JSONResponse({"error": "查無逐字稿"}, status_code=404)
    text = sessions.build_transcript_text(data["segments"], body.get("names") or {})
    if not text.strip():
        return JSONResponse({"error": "沒有逐字稿內容"}, status_code=400)
    model = body.get("model") or config.LLM_MODEL

    # Background mode: queue the generation and return immediately. The notes are written to the DB
    # when it finishes, so a client that is backgrounded/killed mid-generation collects them from
    # GET /api/sessions/{sid} on its next run instead of losing the work (and paying for it twice).
    # Clients that don't pass `background` keep the original synchronous behaviour.
    if body.get("background"):
        with _analyze_lock:
            if _analyzing.get(sid):
                log.info("[%s] analyze dedup (already generating)", sid)
                return {"ok": True, "dedup": True}
            _analyzing[sid] = True
        # queued, NOT running: the worker flips it to running when it actually starts.
        with _analyze_lock:
            _notes_waiting.append(sid)
        sessions.update_session(sid, notes_status="queued", notes_error=None,
                                notes_pct=0.0, notes_message="排隊中…")
        _notes_executor.submit(_run_analyze, sid, text, body.get("model") or None, model)
        log.info("[%s] analyze queued in background -> LLM %s", sid, model)
        return {"ok": True, "background": True}

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
