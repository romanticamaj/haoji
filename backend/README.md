# 好記 Haoji — Backend

FastAPI service: record **parts** upload → ffmpeg concat → diarized transcript (Breeze ASR) → Markdown meeting notes (local LLM).

**Where it runs:** on the **GPU machine (this Windows box)** — Breeze ASR + Ollama need the GPU. The Expo app (developed on Mac / shipped via TestFlight) connects here over **Tailscale**. Don't run this backend on the Mac.

## Prerequisites (same machine)
- Python 3.10, `pip install -r requirements.txt`
- ffmpeg / ffprobe on PATH (or the winget path baked into `config.py`)
- **Breeze ASR** on `:8765` — start it via the AI Service Manager at `C:\ai-servers` (`start_manager.bat`, then start the "Breeze ASR" service)
- **Ollama** on `:11434` with the `gemma4:e4b-it-qat` model (tray app, auto-starts)
- **Tailscale** running (so the Mac/phone reach this box anywhere)

## Run
```
pip install -r requirements.txt
python app.py            # serves on http://0.0.0.0:8780
```
…or just double-click **`start.bat`** (checks Ollama/ASR are up, then launches).

App reaches it at `http://100.106.118.45:8780` (Tailscale) or `http://192.168.100.10:8780` (same-WiFi LAN). Keep this machine on.

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
