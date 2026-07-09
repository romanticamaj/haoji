# -*- coding: utf-8 -*-
import sys
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import os, json, threading
from typing import Optional
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import config
import asr, sessions, llm, media
from fastapi import Request

app = FastAPI(title="好記 Haoji API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

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
            return {"session_id": existing["id"], "reused": True}
    sid = sessions.create_session("recording", client_id=client_id)
    return {"session_id": sid}

@app.post("/api/sessions/{sid}/parts")
async def add_part(sid: str, index: Optional[int] = None, file: UploadFile = File(...)):
    if not sessions.get_session(sid):
        return JSONResponse({"error": "查無此工作"}, status_code=404)
    # Idempotent by index: a re-uploaded part overwrites the same slot/file rather than appending a
    # duplicate. Falls back to append (old behaviour) when the client doesn't pass an index.
    idx = index if index is not None else len(sessions.get_parts(sid))
    dest = os.path.join(PARTS_DIR, f"{sid}-{idx}.m4a")
    with open(dest, "wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk: break
            out.write(chunk)
    await file.close()
    return {"count": sessions.set_part(sid, idx, dest)}

def _run_transcribe(sid):
    parts = [p for p in sessions.get_parts(sid) if p]  # skip empty index slots
    try:
        sessions.update_session(sid, status="running", pct=0.1, message="串接音檔…")
        wav = os.path.join(config.UPLOAD_DIR, sid + ".wav")
        media.concat_to_wav(parts, wav)
        sessions.update_session(sid, pct=0.35, message="辨識中（含講者分離）…")
        norm = asr.normalize(asr.transcribe_diarize(wav))
        sessions.update_session(sid, status="done", pct=1.0, message="完成",
                                transcript=json.dumps(norm, ensure_ascii=False))
    except Exception as e:
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
            return {"ok": True, "dedup": True}
        _submitted.add(sid)
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
    try:
        notes = llm.get_provider("ollama").generate_meeting_notes(text, model=body.get("model") or None)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)
    sessions.update_session(sid, notes=notes)
    return {"notes": notes, "model": body.get("model") or config.LLM_MODEL}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=config.WEB_HOST, port=config.WEB_PORT, log_level="warning")
