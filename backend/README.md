# 好記 Haoji — Backend

FastAPI service: record **parts** upload → ffmpeg concat → diarized transcript (Breeze ASR) → Markdown meeting notes (local LLM).

**Deployed as a Docker Compose unit** — three containers (`haoji-backend` + `breeze-asr` + `ollama`)
brought up by one `docker compose up -d` on any machine with an NVIDIA GPU. The app (Mac dev /
TestFlight) reaches it over **Tailscale**.

## Run

👉 **Full guide: [`deploy/DEPLOY.md`](deploy/DEPLOY.md)** — host prerequisites (GPU ≥16GB VRAM,
NVIDIA Container Toolkit), pre-built-image vs. self-build paths, verification, data/privacy, ops.

Quick start (deployer who received the image tar — no HuggingFace token needed):

```bash
docker load -i haoji-breeze-asr.tar
cd backend/deploy
cp .env.example .env          # HF_TOKEN can stay empty
docker compose up -d          # do NOT pass --build
```

Verify:

```bash
curl -s http://127.0.0.1:7780/health          # {"status":"ok","service":"haoji-backend"}
curl -s http://127.0.0.1:7780/api/llm/models  # {"ok":true,"models":["gemma4:e4b-it-qat"],...}
```

### Ports

| Service | Port | Exposed? |
|---|---|---|
| `haoji-backend` | **7780** | ✅ the only port published to the host — the app connects here |
| `breeze-asr` | 7765 | container network only |
| `ollama` | 11434 | container network only |

App reaches it at `http://<tailscale-ip>:7780` (Tailscale) or `http://<lan-ip>:7780` (same-WiFi LAN).

### Uptime

All three services are `restart: unless-stopped`, so a crash or a host reboot brings them back
automatically — no external watchdog needed. (The old native launcher/keepalive scripts —
`start.bat`, `start.ps1`, `keepalive.ps1`, `run-forever.bat`, and the `C:\ai-servers` AI Service
Manager — are **retired**; see git history if you need them.)

Ops:

```bash
docker compose ps                       # three-container status
docker compose logs -f haoji-backend    # backend activity log
docker compose restart <service>        # restart one service
git pull && docker compose up -d --build   # update
```

## Development (no Docker)

Only for editing/testing the FastAPI code on a dev box — the ASR/LLM dependencies still have to come
from somewhere (point `ASR_BASE_URL` / `OLLAMA_BASE_URL` at a running stack).

```bash
pip install -r requirements.txt
python app.py            # serves on 0.0.0.0:${WEB_PORT:-7780}
python -m pytest -q      # tests (no GPU needed)
```

Config is env-driven (`config.py`): `WEB_PORT`, `ASR_BASE_URL`, `OLLAMA_BASE_URL`, `LLM_MODEL`, `DATA_DIR`.

## API (v2 — parts flow)
- `GET  /health`
- `POST /api/sessions` → `{session_id}` (empty body — creates a draft)
- `POST /api/sessions/{id}/parts` (multipart `file`) → `{count}` (append one recording part; once per part)
- `POST /api/sessions/{id}/transcribe` → starts background transcription (concat all parts → Breeze ASR + diarization)
- `GET  /api/sessions/{id}` → `{status, pct, message, transcript?}`
- `POST /api/sessions/{id}/analyze` `{model?, names?}` → `{notes}` (Traditional-Chinese meeting notes)
- `GET  /api/llm/models`

## Data & privacy
- **Audio is deleted as soon as transcription finishes** (backend `finally`) — nothing is retained server-side.
- The `data` volume holds only SQLite (session state / transcript / notes).
