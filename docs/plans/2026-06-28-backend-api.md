# 好記 Haoji — Backend API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mobile-facing FastAPI service that takes an uploaded audio/video file, returns a diarized Traditional-Chinese transcript, and on request turns it into a Markdown meeting record via a switchable LLM provider.

**Architecture:** Port the already-proven `multi-speaker-extractor` pipeline (ffmpeg → Breeze ASR + diarization → normalize → Ollama LLM → OpenCC) into a clean backend under `D:\projects\haoji\backend`. Sessions are tracked in SQLite with a background worker. The service calls the existing Breeze ASR (`:8765`) and Ollama (`:11434`) running on the dev machine. Uploaded audio is deleted once the transcript is produced.

**Tech Stack:** Python 3.10+, FastAPI, uvicorn, requests, python-multipart, OpenCC, ffmpeg/ffprobe (subprocess), pytest.

## Global Constraints

- Output language for meeting notes: **Traditional Chinese (zh-TW)**; normalize stray simplified chars with OpenCC `s2tw`.
- Default LLM model: **`gemma4:e4b-it-qat`** (overridable per request). Thinking ON for thinking-capable models.
- LLM context: size `num_ctx` to the transcript (floor 8192, ceil to 8192 steps, cap 32768) — never rely on Ollama's 4096 default (causes one-token truncation).
- ASR backend base URL: auto-detect Breeze on `:8765` (`127.0.0.1` then LAN IPs).
- Ollama base URL: `http://127.0.0.1:11434`.
- No user accounts. Uploaded media is deleted after the transcript is produced; transcripts/notes are returned to the client and not retained long-term.
- Accept media extensions: `.mp4 .mov .mkv .avi .m4v .webm .flv .ts .mpg .mpeg .wmv .wav .mp3 .m4a .aac .flac .ogg .opus .wma`.

---

### Task 1: Backend scaffold, config, health endpoint

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/config.py`
- Create: `backend/app.py`
- Create: `backend/tests/__init__.py`
- Test: `backend/tests/test_health.py`

**Interfaces:**
- Produces: FastAPI `app` in `backend/app.py`; `config` module with `MEDIA_EXTS`, `OLLAMA_BASE`, `LLM_MODEL`, `ASR_PORT`, `UPLOAD_DIR`, `DATA_DIR`, `DB_PATH`, `FFMPEG`, `FFPROBE`.

- [ ] **Step 1: Write `backend/requirements.txt`**

```
fastapi==0.135.2
uvicorn==0.34.0
python-multipart==0.0.22
requests==2.32.3
opencc==1.1.9
pytest==8.3.4
httpx==0.28.1
```

- [ ] **Step 2: Write `backend/config.py`**

```python
# -*- coding: utf-8 -*-
"""Central config for the Haoji backend."""
import os, shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
DB_PATH = os.path.join(DATA_DIR, "haoji.db")

WEB_HOST = "0.0.0.0"
WEB_PORT = 8780

# Breeze ASR + diarization backend (separate process on the dev machine)
ASR_PORT = 8765
ASR_HEALTH = "/health"
ASR_DIARIZE = "/transcribe_diarize"
ASR_TIMEOUT = 7200
ASR_CONNECT_TIMEOUT = 2

# Local LLM (Ollama)
OLLAMA_BASE = "http://127.0.0.1:11434"
LLM_MODEL = "gemma4:e4b-it-qat"
LLM_TIMEOUT = 300
LLM_NUM_CTX_MAX = 32768
LLM_OUTPUT_TOKENS = 4096
LLM_THINK = True

MEDIA_EXTS = {
    ".mp4", ".mov", ".mkv", ".avi", ".m4v", ".webm", ".flv", ".ts", ".mpg", ".mpeg", ".wmv",
    ".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma",
}

def _find(name, fallback):
    p = shutil.which(name)
    if p:
        return p
    return fallback if os.path.exists(fallback) else name

_WINGET = (r"C:\Users\gary.hsieh\AppData\Local\Microsoft\WinGet\Packages"
           r"\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0.1-full_build\bin")
FFMPEG = _find("ffmpeg", os.path.join(_WINGET, "ffmpeg.exe"))
FFPROBE = _find("ffprobe", os.path.join(_WINGET, "ffprobe.exe"))

os.makedirs(UPLOAD_DIR, exist_ok=True)
```

- [ ] **Step 3: Write `backend/app.py` (health only for now)**

```python
# -*- coding: utf-8 -*-
import sys
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from fastapi import FastAPI
import config

app = FastAPI(title="好記 Haoji API")

@app.get("/health")
def health():
    return {"status": "ok", "service": "haoji-backend"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=config.WEB_HOST, port=config.WEB_PORT, log_level="warning")
```

- [ ] **Step 4: Write the failing test `backend/tests/test_health.py`**

```python
from fastapi.testclient import TestClient
import app as appmod

client = TestClient(appmod.app)

def test_health_ok():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["service"] == "haoji-backend"
```

- [ ] **Step 5: Install deps and run the test**

Run (from `backend/`): `pip install -r requirements.txt && pytest tests/test_health.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat(backend): scaffold FastAPI app, config, health endpoint"
```

---

### Task 2: LLM module — provider abstraction + Ollama + meeting notes

**Files:**
- Create: `backend/llm.py`
- Test: `backend/tests/test_llm.py`

**Interfaces:**
- Produces:
  - `llm_status() -> (ok: bool, names: list[str], thinking: list[str])`
  - `to_traditional(text: str) -> str`
  - `class OllamaProvider` with `generate_meeting_notes(transcript: str, model: str|None) -> str`
  - `get_provider(name: str = "ollama") -> Provider` (provider registry; only "ollama" for MVP)
  - `MEETING_NOTES_PROMPT: str`

- [ ] **Step 1: Write the failing test `backend/tests/test_llm.py`**

```python
import llm

def test_to_traditional_converts_simplified():
    assert llm.to_traditional("我们进行测试") == "我們進行測試"

def test_num_ctx_sizing_floor_and_step(monkeypatch):
    sizes = {}
    def fake_post(url, json, timeout):
        sizes["num_ctx"] = json["options"]["num_ctx"]
        class R:
            def raise_for_status(self): pass
            def json(self): return {"message": {"content": "## 會議摘要\n好"}}
        return R()
    monkeypatch.setattr(llm, "llm_status", lambda: (True, ["gemma4:e4b-it-qat"], []))
    monkeypatch.setattr(llm.requests, "post", fake_post)
    p = llm.OllamaProvider()
    out = p.generate_meeting_notes("短逐字稿", model="gemma4:e4b-it-qat")
    assert sizes["num_ctx"] == 8192        # floor
    assert out.startswith("## 會議摘要")

def test_strips_thinking_block(monkeypatch):
    def fake_post(url, json, timeout):
        class R:
            def raise_for_status(self): pass
            def json(self): return {"message": {"content": "推理...</think>## 會議摘要\n內容"}}
        return R()
    monkeypatch.setattr(llm, "llm_status", lambda: (True, ["m"], ["m"]))
    monkeypatch.setattr(llm.requests, "post", fake_post)
    out = llm.OllamaProvider().generate_meeting_notes("x", model="m")
    assert "</think>" not in out and out.startswith("## 會議摘要")
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_llm.py -v`
Expected: FAIL (no module `llm`).

- [ ] **Step 3: Write `backend/llm.py`**

```python
# -*- coding: utf-8 -*-
"""LLM provider abstraction + Ollama provider for Traditional-Chinese meeting notes."""
import re
import requests
import config

MEETING_NOTES_PROMPT = """你是專業的會議記錄助理。下面是一份多人對話的逐字稿(格式「[時間] 講者: 內容」)。請整理成一份**詳盡、結構完整**的繁體中文會議記錄。

寫作要求:
- 忠實根據逐字稿,不要捏造。
- **講者一律照逐字稿標示的名字或代號(例如 SPEAKER_00)原樣使用。絕對不要自己猜測某個代號對應到對話中提到的哪個人名,也不要把某位講者的發言挪到另一位講者身上。**
- 角色或負責的項目,只有在「該講者自己說出口的內容」明確透露時才標註;不要憑空編造誰是客戶、誰是開發方。
- 內容要有細節、有資訊量。討論重點分主題逐項展開,把「為什麼這樣決定」「考慮過哪些方案/取捨」也寫進去。
- 條列盡量具體(數字、時間、服務名稱、指標都要保留)。

用 Markdown 輸出,章節:會議目的 / 與會者 / 會議摘要 / 討論重點(分主題) / 決策 / 待辦事項(依負責人) / 後續安排 / 一句話結論。某節若逐字稿真的沒提到,寫「(無)」。直接輸出會議記錄,不要開場白或客套話。"""

_opencc = None
def to_traditional(text):
    global _opencc
    try:
        if _opencc is None:
            import opencc
            _opencc = opencc.OpenCC("s2tw")
        return _opencc.convert(text)
    except Exception:
        return text

def llm_status():
    try:
        r = requests.get(config.OLLAMA_BASE + "/api/tags", timeout=3)
        r.raise_for_status()
        models = r.json().get("models", [])
        names = [m["name"] for m in models]
        thinking = [m["name"] for m in models if "thinking" in (m.get("capabilities") or [])]
        return True, names, thinking
    except Exception:
        return False, [], []

class OllamaProvider:
    name = "ollama"

    def generate_meeting_notes(self, transcript, model=None):
        model = model or config.LLM_MODEL
        ok, names, thinking = llm_status()
        if not ok:
            raise RuntimeError(f"連不到本機 LLM（Ollama，{config.OLLAMA_BASE}）。")
        if names and model not in names:
            raise RuntimeError(f"本機沒有模型「{model}」。可用：{', '.join(names) or '（無）'}")
        approx_prompt = int((len(MEETING_NOTES_PROMPT) + len(transcript)) * 0.8) + 16
        need = approx_prompt + config.LLM_OUTPUT_TOKENS
        num_ctx = max(8192, min(config.LLM_NUM_CTX_MAX, ((need + 8191) // 8192) * 8192))
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": MEETING_NOTES_PROMPT},
                {"role": "user", "content": transcript},
            ],
            "stream": False,
            "options": {"temperature": 0.3, "num_ctx": num_ctx},
        }
        if model in thinking and not config.LLM_THINK:
            payload["think"] = False
        try:
            r = requests.post(config.OLLAMA_BASE + "/api/chat", json=payload, timeout=config.LLM_TIMEOUT)
            r.raise_for_status()
        except requests.exceptions.RequestException as e:
            raise RuntimeError(f"本機 LLM 請求失敗：{e}")
        content = (r.json().get("message", {}) or {}).get("content", "")
        if "</think>" in content:
            content = content.rsplit("</think>", 1)[-1]
        content = re.sub(r"<think>.*?</think>", "", content, flags=re.S).strip()
        return to_traditional(content)

_PROVIDERS = {"ollama": OllamaProvider()}
def get_provider(name="ollama"):
    return _PROVIDERS.get(name) or _PROVIDERS["ollama"]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_llm.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/llm.py backend/tests/test_llm.py
git commit -m "feat(backend): LLM provider abstraction + Ollama meeting notes"
```

---

### Task 3: ASR module — extract audio, diarized transcription, normalize

**Files:**
- Create: `backend/asr.py`
- Test: `backend/tests/test_asr.py`

**Interfaces:**
- Produces:
  - `detect_asr_base(force=False) -> str|None`
  - `probe_duration(path) -> float`
  - `extract_audio(src, wav, on_progress=None, total_dur=None) -> None`
  - `transcribe_diarize(wav, num_speakers=None, language="zh") -> dict`
  - `normalize(raw: dict) -> {"segments","speakers","duration","stats"}`

- [ ] **Step 1: Write the failing test `backend/tests/test_asr.py`**

```python
import asr

def test_normalize_shapes_segments_and_speakers():
    raw = {"segments": [
        {"start": 0.0, "end": 2.0, "speaker": "SPEAKER_00", "text": "你好 "},
        {"start": 2.0, "end": 5.0, "speaker": "SPEAKER_01", "text": " 嗨"},
    ], "duration": 5.0}
    out = asr.normalize(raw)
    assert out["speakers"] == ["SPEAKER_00", "SPEAKER_01"]
    assert out["segments"][0]["text"] == "你好"
    assert out["duration"] == 5.0
    assert {s["speaker"] for s in out["stats"]} == {"SPEAKER_00", "SPEAKER_01"}

def test_transcribe_diarize_posts_to_breeze(monkeypatch, tmp_path):
    wav = tmp_path / "a.wav"; wav.write_bytes(b"RIFF....")
    monkeypatch.setattr(asr, "detect_asr_base", lambda force=False: "http://127.0.0.1:8765")
    captured = {}
    def fake_post(url, params, files, timeout):
        captured["url"] = url; captured["params"] = params
        class R:
            def raise_for_status(self): pass
            def json(self): return {"segments": [], "duration": 0}
        return R()
    monkeypatch.setattr(asr.requests, "post", fake_post)
    asr.transcribe_diarize(str(wav), num_speakers=2, language="zh")
    assert captured["url"].endswith("/transcribe_diarize")
    assert captured["params"]["num_speakers"] == 2
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_asr.py -v`
Expected: FAIL (no module `asr`).

- [ ] **Step 3: Write `backend/asr.py`** (ported verbatim from the proven `multi-speaker-extractor/pipeline.py`)

```python
# -*- coding: utf-8 -*-
"""Breeze ASR detection, audio extraction, diarized transcription, normalization."""
import os, socket, subprocess
import requests
import config

_asr_cache = None

def _local_ips():
    ips = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None):
            ip = info[4][0]
            if ":" not in ip and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    return ips

def _is_breeze(url):
    try:
        r = requests.get(url + config.ASR_HEALTH, timeout=config.ASR_CONNECT_TIMEOUT)
        if not r.ok:
            return False
        j = r.json()
        return "breeze" in str(j.get("model", "")).lower() or j.get("status") == "ok"
    except Exception:
        return False

def detect_asr_base(force=False):
    global _asr_cache
    if _asr_cache and not force and _is_breeze(_asr_cache):
        return _asr_cache
    for ip in ["127.0.0.1"] + _local_ips():
        url = f"http://{ip}:{config.ASR_PORT}"
        if _is_breeze(url):
            _asr_cache = url
            return url
    _asr_cache = None
    return None

def probe_duration(path):
    out = subprocess.run([config.FFPROBE, "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nw=1:nk=1", path], capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 0.0

def extract_audio(src, wav, on_progress=None, total_dur=None):
    cmd = [config.FFMPEG, "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000",
           "-c:a", "pcm_s16le", "-progress", "pipe:1", "-nostats", wav]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    for line in proc.stdout:
        if on_progress and total_dur and line.startswith("out_time_us="):
            val = line.strip().split("=", 1)[1]
            if val.isdigit():
                on_progress(min(0.99, int(val) / 1e6 / total_dur))
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError("ffmpeg 音訊抽取失敗")

def transcribe_diarize(wav, num_speakers=None, language="zh", merge_gap=0.6):
    base = detect_asr_base()
    if not base:
        raise RuntimeError(f"找不到 Breeze ASR server（port {config.ASR_PORT}）。")
    params = {"language": language, "format": "json", "merge_gap": merge_gap}
    if num_speakers:
        params["num_speakers"] = int(num_speakers)
    with open(wav, "rb") as f:
        r = requests.post(base + config.ASR_DIARIZE, params=params,
                          files={"file": (os.path.basename(wav), f, "audio/wav")},
                          timeout=config.ASR_TIMEOUT)
    r.raise_for_status()
    return r.json()

def speaker_stats(segs):
    talk, cnt = {}, {}
    for s in segs:
        sp = s["speaker"]
        talk[sp] = talk.get(sp, 0) + (s["end"] - s["start"])
        cnt[sp] = cnt.get(sp, 0) + 1
    return [{"speaker": sp, "seconds": round(talk[sp], 1), "segments": cnt[sp]}
            for sp in sorted(talk, key=lambda x: -talk[x])]

def normalize(data):
    segs = [{"start": float(s["start"]), "end": float(s["end"]),
             "speaker": s["speaker"], "text": s["text"].strip()}
            for s in data.get("segments", [])]
    return {
        "segments": segs,
        "speakers": sorted({s["speaker"] for s in segs}),
        "duration": float(data.get("duration", segs[-1]["end"] if segs else 0)),
        "stats": speaker_stats(segs),
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_asr.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/asr.py backend/tests/test_asr.py
git commit -m "feat(backend): port ASR detection, extraction, diarized transcription"
```

---

### Task 4: Session store (SQLite) + transcript text builder

**Files:**
- Create: `backend/sessions.py`
- Test: `backend/tests/test_sessions.py`

**Interfaces:**
- Produces:
  - `init_db() -> None`
  - `create_session(filename: str) -> str` (returns `session_id`)
  - `get_session(sid: str) -> dict|None` (keys: id, status, pct, message, transcript(json), notes, error)
  - `update_session(sid: str, **fields) -> None`
  - `build_transcript_text(segments: list[dict], names: dict[str,str]) -> str` (format `[mm:ss] name: text`, merges consecutive same-speaker)

- [ ] **Step 1: Write the failing test `backend/tests/test_sessions.py`**

```python
import json, sessions

def test_session_lifecycle(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    sessions.init_db()
    sid = sessions.create_session("meeting.m4a")
    assert sessions.get_session(sid)["status"] == "queued"
    sessions.update_session(sid, status="done", pct=1.0,
                            transcript=json.dumps({"segments": []}))
    s = sessions.get_session(sid)
    assert s["status"] == "done" and s["pct"] == 1.0

def test_build_transcript_text_merges_and_names():
    segs = [
        {"start": 0, "end": 2, "speaker": "SPEAKER_00", "text": "你好"},
        {"start": 2, "end": 4, "speaker": "SPEAKER_00", "text": "今天開會"},
        {"start": 4, "end": 6, "speaker": "SPEAKER_01", "text": "好"},
    ]
    out = sessions.build_transcript_text(segs, {"SPEAKER_00": "Gary"})
    assert "[00:00] Gary: 你好今天開會" in out
    assert "[00:04] SPEAKER_01: 好" in out
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_sessions.py -v`
Expected: FAIL (no module `sessions`).

- [ ] **Step 3: Write `backend/sessions.py`**

```python
# -*- coding: utf-8 -*-
"""SQLite-backed session store + transcript text builder."""
import os, sqlite3, uuid, time
import config

def _conn():
    os.makedirs(os.path.dirname(config.DB_PATH), exist_ok=True)
    c = sqlite3.connect(config.DB_PATH)
    c.row_factory = sqlite3.Row
    return c

def init_db():
    with _conn() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS sessions(
            id TEXT PRIMARY KEY, filename TEXT, status TEXT, pct REAL,
            message TEXT, transcript TEXT, notes TEXT, error TEXT, created REAL)""")

def create_session(filename):
    sid = uuid.uuid4().hex[:12]
    with _conn() as c:
        c.execute("INSERT INTO sessions(id,filename,status,pct,message,created) VALUES(?,?,?,?,?,?)",
                  (sid, filename, "queued", 0.0, "排隊中…", time.time()))
    return sid

def get_session(sid):
    with _conn() as c:
        row = c.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
    return dict(row) if row else None

def update_session(sid, **fields):
    if not fields:
        return
    cols = ", ".join(f"{k}=?" for k in fields)
    with _conn() as c:
        c.execute(f"UPDATE sessions SET {cols} WHERE id=?", (*fields.values(), sid))

def _mmss(t):
    t = max(0, int(t)); return f"{t // 60:02d}:{t % 60:02d}"

def build_transcript_text(segments, names=None):
    names = names or {}
    out, cur = [], None
    for s in segments:
        sp = s["speaker"]
        if cur and cur["sp"] == sp:
            cur["text"] += s["text"]; cur["end"] = s["end"]
        else:
            if cur: out.append(cur)
            cur = {"sp": sp, "start": s["start"], "end": s["end"], "text": s["text"]}
    if cur: out.append(cur)
    return "\n\n".join(f"[{_mmss(p['start'])}] {names.get(p['sp'], p['sp'])}: {p['text'].strip()}"
                       for p in out)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_sessions.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/sessions.py backend/tests/test_sessions.py
git commit -m "feat(backend): SQLite session store + transcript text builder"
```

---

### Task 5: POST /api/sessions — upload + background transcription job

**Files:**
- Modify: `backend/app.py`
- Test: `backend/tests/test_api_upload.py`

**Interfaces:**
- Consumes: `asr.*`, `sessions.*`, `config.*`.
- Produces: `POST /api/sessions` (multipart `file`) → `{"session_id": str}`; background worker that fills the session's transcript and deletes the upload.

- [ ] **Step 1: Write the failing test `backend/tests/test_api_upload.py`**

```python
import io, json, time
from fastapi.testclient import TestClient
import app as appmod, sessions

def test_upload_rejects_bad_ext(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    sessions.init_db()
    c = TestClient(appmod.app)
    r = c.post("/api/sessions", files={"file": ("x.txt", b"nope", "text/plain")})
    assert r.status_code == 400

def test_upload_accepts_and_runs_job(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setattr(appmod.config, "UPLOAD_DIR", str(tmp_path))
    sessions.init_db()
    # stub the heavy pipeline so the worker runs instantly
    monkeypatch.setattr(appmod, "_run_transcribe", lambda sid, path: sessions.update_session(
        sid, status="done", pct=1.0, transcript=json.dumps({"segments": [], "speakers": []})))
    c = TestClient(appmod.app)
    r = c.post("/api/sessions", files={"file": ("m.m4a", b"\x00\x01\x02", "audio/mp4")})
    assert r.status_code == 200
    sid = r.json()["session_id"]
    for _ in range(50):
        if sessions.get_session(sid)["status"] == "done":
            break
        time.sleep(0.02)
    assert sessions.get_session(sid)["status"] == "done"
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_api_upload.py -v`
Expected: FAIL (no `/api/sessions` route).

- [ ] **Step 3: Modify `backend/app.py`** — add imports, startup, upload route, worker

```python
import os, uuid, json
from concurrent.futures import ThreadPoolExecutor
from fastapi import UploadFile, File
from fastapi.responses import JSONResponse
import asr, sessions

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
        sessions.update_session(sid, status="running", stage="probe", pct=0.05, message="讀取媒體…")
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

@app.post("/api/sessions")
async def create_session(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in config.MEDIA_EXTS:
        return JSONResponse({"error": f"不支援的檔案格式：{ext or '未知'}"}, status_code=400)
    sid = sessions.create_session(file.filename or "audio")
    dest = os.path.join(config.UPLOAD_DIR, sid + ext)
    with open(dest, "wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk: break
            out.write(chunk)
    await file.close()
    _executor.submit(_run_transcribe, sid, dest)
    return {"session_id": sid}
```

Also add a `stage` column tolerance: update `sessions.update_session` call sites only use existing columns — add `stage` to the table in `sessions.init_db` (`stage TEXT`) and re-run. (If the DB file already exists from a prior task run, delete `backend/data/haoji.db` before re-testing.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_api_upload.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app.py backend/sessions.py backend/tests/test_api_upload.py
git commit -m "feat(backend): POST /api/sessions upload + background transcription"
```

---

### Task 6: GET /api/sessions/{id} — progress + transcript

**Files:**
- Modify: `backend/app.py`
- Test: `backend/tests/test_api_status.py`

**Interfaces:**
- Produces: `GET /api/sessions/{id}` → `{status, pct, message, transcript?: {segments, speakers, stats, duration}}` (404 if unknown).

- [ ] **Step 1: Write the failing test `backend/tests/test_api_status.py`**

```python
import json
from fastapi.testclient import TestClient
import app as appmod, sessions

def test_status_returns_transcript(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    sessions.init_db()
    sid = sessions.create_session("m.m4a")
    sessions.update_session(sid, status="done", pct=1.0,
        transcript=json.dumps({"segments": [{"start":0,"end":1,"speaker":"SPEAKER_00","text":"hi"}],
                               "speakers": ["SPEAKER_00"]}, ensure_ascii=False))
    c = TestClient(appmod.app)
    r = c.get(f"/api/sessions/{sid}")
    assert r.status_code == 200
    assert r.json()["transcript"]["speakers"] == ["SPEAKER_00"]

def test_status_404(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    sessions.init_db()
    assert TestClient(appmod.app).get("/api/sessions/nope").status_code == 404
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_api_status.py -v`
Expected: FAIL (no route).

- [ ] **Step 3: Modify `backend/app.py`** — add status route

```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_api_status.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app.py backend/tests/test_api_status.py
git commit -m "feat(backend): GET /api/sessions/{id} status + transcript"
```

---

### Task 7: POST /api/sessions/{id}/analyze — meeting notes, and GET /api/llm/models

**Files:**
- Modify: `backend/app.py`
- Test: `backend/tests/test_api_analyze.py`

**Interfaces:**
- Consumes: `llm.get_provider`, `sessions.build_transcript_text`.
- Produces:
  - `GET /api/llm/models` → `{ok, models, default}`
  - `POST /api/sessions/{id}/analyze` body `{model?: str, names?: {speaker: name}}` → `{notes: markdown, model}` (uses the session's stored transcript)

- [ ] **Step 1: Write the failing test `backend/tests/test_api_analyze.py`**

```python
import json
from fastapi.testclient import TestClient
import app as appmod, sessions, llm

def test_analyze_uses_transcript_and_names(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    sessions.init_db()
    sid = sessions.create_session("m.m4a")
    sessions.update_session(sid, status="done",
        transcript=json.dumps({"segments": [
            {"start":0,"end":2,"speaker":"SPEAKER_00","text":"今天開會"}], "speakers":["SPEAKER_00"]}))
    seen = {}
    class FakeProvider:
        def generate_meeting_notes(self, transcript, model=None):
            seen["transcript"] = transcript; seen["model"] = model
            return "## 會議摘要\n好"
    monkeypatch.setattr(appmod.llm, "get_provider", lambda name="ollama": FakeProvider())
    c = TestClient(appmod.app)
    r = c.post(f"/api/sessions/{sid}/analyze", json={"model": "gemma4:e4b-it-qat", "names": {"SPEAKER_00": "Gary"}})
    assert r.status_code == 200
    assert r.json()["notes"].startswith("## 會議摘要")
    assert "Gary: 今天開會" in seen["transcript"]
    assert seen["model"] == "gemma4:e4b-it-qat"
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_api_analyze.py -v`
Expected: FAIL (no route).

- [ ] **Step 3: Modify `backend/app.py`** — add models + analyze routes

```python
from fastapi import Request
import llm

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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_api_analyze.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app.py backend/tests/test_api_analyze.py
git commit -m "feat(backend): analyze endpoint (meeting notes) + llm models"
```

---

### Task 8: CORS, run script, and end-to-end integration smoke test

**Files:**
- Modify: `backend/app.py`
- Create: `backend/README.md`
- Test: `backend/tests/test_integration.py` (marked, opt-in)

**Interfaces:**
- Produces: CORS enabled for app dev; documented run command; a smoke test that exercises the real Breeze ASR + Ollama when available.

- [ ] **Step 1: Add CORS to `backend/app.py`** (after `app = FastAPI(...)`)

```python
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
```

- [ ] **Step 2: Write `backend/README.md`**

```markdown
# 好記 Haoji — Backend

FastAPI service: upload audio → diarized transcript → Markdown meeting notes.

## Run
    pip install -r requirements.txt
    python app.py        # serves on http://0.0.0.0:8780

Requires Breeze ASR on :8765 and Ollama on :11434 (dev machine).

## Endpoints
- `GET  /health`
- `POST /api/sessions`            (multipart file) -> {session_id}
- `GET  /api/sessions/{id}`       -> status + transcript
- `POST /api/sessions/{id}/analyze` {model?, names?} -> {notes}
- `GET  /api/llm/models`
```

- [ ] **Step 3: Write opt-in integration smoke test `backend/tests/test_integration.py`**

```python
import os, json, time, pytest
from fastapi.testclient import TestClient
import app as appmod, asr, llm

pytestmark = pytest.mark.skipif(os.environ.get("HAOJI_INTEGRATION") != "1",
                                reason="set HAOJI_INTEGRATION=1 and provide SAMPLE_AUDIO")

def test_end_to_end_real_services():
    assert asr.detect_asr_base(), "Breeze ASR not reachable on :8765"
    assert llm.llm_status()[0], "Ollama not reachable on :11434"
    sample = os.environ["SAMPLE_AUDIO"]   # path to a short wav/m4a
    c = TestClient(appmod.app)
    with open(sample, "rb") as f:
        sid = c.post("/api/sessions", files={"file": (os.path.basename(sample), f, "audio/mp4")}).json()["session_id"]
    for _ in range(600):
        s = c.get(f"/api/sessions/{sid}").json()
        if s["status"] in ("done", "error"): break
        time.sleep(1)
    assert s["status"] == "done", s
    notes = c.post(f"/api/sessions/{sid}/analyze", json={}).json()["notes"]
    assert "##" in notes
```

- [ ] **Step 4: Run unit suite (fast) and confirm green**

Run: `pytest -v -k "not integration"`
Expected: all PASS.

- [ ] **Step 5: (Manual, when GPU services up) run the smoke test**

Run: `HAOJI_INTEGRATION=1 SAMPLE_AUDIO=/path/to/short.m4a pytest tests/test_integration.py -v`
Expected: PASS (produces real transcript + notes).

- [ ] **Step 6: Commit**

```bash
git add backend/app.py backend/README.md backend/tests/test_integration.py
git commit -m "feat(backend): CORS, run docs, end-to-end integration smoke test"
```

---

## Self-Review

- **Spec coverage:** upload+transcribe (T5/T6), speaker-name editing applied at analyze time via `names` (T7), LLM provider abstraction + model picker default-hidden (T2/T7 — app hides it), Traditional-Chinese notes + OpenCC (T2), num_ctx fix (T2), audio deleted after processing (T5 `finally`), no accounts (no auth anywhere). IAP/preview-unlock and on-device storage live in the **app** plan, not here.
- **Out of scope here (app plan):** recording UI, local SQLite on device, RevenueCat IAP, preview/blur gating, copy/export.
- **Type consistency:** `normalize()` dict keys (`segments/speakers/duration/stats`) consumed identically in T5/T6/T7; `build_transcript_text(segments, names)` signature matches its T7 call; `generate_meeting_notes(transcript, model)` consistent across T2 and T7.
- **Deferred decision:** final pricing is an app/store-config concern, not backend.

## Next plan

**Plan B: Expo App** — record/upload screens, transcript+results screens (tabs), speaker rename, model dropdown (hidden by default), preview/unlock gating, RevenueCat IAP, on-device SQLite storage, copy/export. Written after this backend is testable.
