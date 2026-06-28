# -*- coding: utf-8 -*-
import sys
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import os, uuid, json
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import config
import asr, sessions, llm
from fastapi import Request

app = FastAPI(title="好記 Haoji API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_executor = ThreadPoolExecutor(max_workers=2)

@app.on_event("startup")
def _startup():
    sessions.init_db()

def _safe_name(name):
    name = os.path.basename(name or "").strip()
    keep = "-_.()[] "
    name = "".join(c for c in name if c.isalnum() or c in keep or ord(c) > 127).strip()
    return name or ("upload_" + uuid.uuid4().hex[:8])

def _run_transcribe(sid, path):
    try:
        sessions.update_session(sid, status="running", pct=0.05, message="讀取媒體…")
        dur = asr.probe_duration(path)
        wav = path + ".wav"
        sessions.update_session(sid, pct=0.1, message="抽取音訊…")
        asr.extract_audio(path, wav, on_progress=lambda fr: sessions.update_session(sid, pct=0.1 + fr * 0.2), total_dur=dur)
        sessions.update_session(sid, pct=0.35, message="辨識中（含講者分離）…")
        raw = asr.transcribe_diarize(wav)
        norm = asr.normalize(raw)
        sessions.update_session(sid, status="done", pct=1.0, message="完成",
                                transcript=json.dumps(norm, ensure_ascii=False))
    except Exception as e:
        sessions.update_session(sid, status="error", message=str(e), error=str(e))
    finally:
        for p in (path, path + ".wav"):   # delete media; keep only the transcript
            try: os.remove(p)
            except OSError: pass

@app.get("/health")
def health():
    return {"status": "ok", "service": "haoji-backend"}

@app.post("/api/sessions")
async def create_session(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in config.MEDIA_EXTS:
        return JSONResponse({"error": f"不支援的檔案格式：{ext or '未知'}"}, status_code=400)
    sid = sessions.create_session(file.filename or "audio")
    dest = os.path.join(config.UPLOAD_DIR, sid + ext)
    try:
        with open(dest, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk: break
                out.write(chunk)
    except Exception as e:
        try: os.remove(dest)
        except OSError: pass
        sessions.update_session(sid, status="error", message="上傳失敗", error=str(e))
        return JSONResponse({"error": "上傳失敗"}, status_code=500)
    await file.close()
    _executor.submit(_run_transcribe, sid, dest)
    return {"session_id": sid}

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
