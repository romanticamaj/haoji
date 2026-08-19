# 好記 Haoji — Backend

FastAPI service: record **parts** upload → ffmpeg concat → diarized transcript (Breeze ASR) → Markdown meeting notes (local LLM).

**Where it runs:** on the **GPU machine (this Windows box)** — Breeze ASR + Ollama need the GPU. The Expo app (developed on Mac / shipped via TestFlight) connects here over **Tailscale**. Don't run this backend on the Mac.

## Prerequisites (same machine)
- Python 3.10, `pip install -r requirements.txt`
- ffmpeg / ffprobe on PATH (or the winget path baked into `config.py`)
- **Breeze ASR** on `:7765` — served by the containerized stack (`backend/deploy`, published locally via the compose override); the legacy native install (`C:\ai-servers`, AI Service Manager, `:8765`) is retired
- **Ollama** on `:11434` with the `gemma4:e4b-it-qat` model (tray app, auto-starts)
- **Tailscale** running (so the Mac/phone reach this box anywhere)

## Run
Just double-click **`start.bat`** (→ `start.ps1`). It brings the whole backend up in order:
1. **AI Service Manager** (`:8760`) — starts it if not already running
2. **Breeze ASR** (`:7765`) via the manager — the GPU is mutually exclusive (one `gpu:true`
   service at a time), so if another model (e.g. Flamingo Suite) owns it, the script **asks
   before stopping it**, then starts ASR and waits until it's healthy
3. **Ollama** (`:11434`) — best-effort auto-start (only needed at `/analyze`)
4. **好記 backend** (`:7780`) — `python app.py`

Flags: `-Force` (stop the GPU owner without asking), `-NoStop` (abort if GPU is busy),
`-RestartBackend` (kill + relaunch an already-running `:7780`).

Manual equivalent, if you prefer:
```
pip install -r requirements.txt
# open http://127.0.0.1:8760 → stop whatever owns the GPU → start "Breeze ASR"
python app.py            # serves on http://0.0.0.0:7780
```

App reaches it at `http://100.106.118.45:7780` (Tailscale) or `http://192.168.100.10:7780` (same-WiFi LAN). Keep this machine on.

## API (v2 — parts flow)
- `GET  /health`
- `POST /api/sessions` → `{session_id}` (empty body — creates a draft)
- `POST /api/sessions/{id}/parts` (multipart `file`) → `{count}` (append one recording part; once per part)
- `POST /api/sessions/{id}/transcribe` → starts background transcription (concat all parts → Breeze ASR + diarization)
- `GET  /api/sessions/{id}` → `{status, pct, message, transcript?}`
- `POST /api/sessions/{id}/analyze` `{model?, names?}` → `{notes}` (Traditional-Chinese meeting notes)
- `GET  /api/llm/models`

## Tests
```
python -m pytest -q
```
