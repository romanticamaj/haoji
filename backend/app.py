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
import config
import asr, sessions

app = FastAPI(title="好記 Haoji API")

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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=config.WEB_HOST, port=config.WEB_PORT, log_level="warning")
