# -*- coding: utf-8 -*-
"""Central config for the Haoji backend.

Every deploy-specific value can be overridden by an environment variable so the
same code runs unchanged on the Windows dev box (no env vars -> old defaults)
and inside the docker-compose deployable unit (.env-driven).
"""
import os, shutil

VERSION = "1.0.0"

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(ROOT, "data")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
DB_PATH = os.environ.get("DB_PATH") or os.path.join(DATA_DIR, "haoji.db")

WEB_HOST = "0.0.0.0"
WEB_PORT = int(os.environ.get("WEB_PORT") or "7780")  # `or` tolerates WEB_PORT= (blank)

# Breeze ASR + diarization backend.
# ASR_BASE_URL set (e.g. http://breeze-asr:7765 in compose) -> use it directly;
# empty -> legacy auto-detect across local IPs (dev box behaviour).
ASR_BASE_URL = os.environ.get("ASR_BASE_URL", "")
ASR_PORT = 7765
ASR_HEALTH = "/health"
ASR_DIARIZE = "/transcribe_diarize"
ASR_TIMEOUT = 7200
ASR_CONNECT_TIMEOUT = 2

# Local LLM (Ollama)
OLLAMA_BASE = os.environ.get("OLLAMA_BASE_URL") or "http://127.0.0.1:11434"
LLM_MODEL = os.environ.get("LLM_MODEL") or "gemma4:e4b-it-qat"
LLM_TIMEOUT = 300
LLM_NUM_CTX_MAX = 32768
LLM_OUTPUT_TOKENS = 4096
LLM_THINK = True

# How long the server keeps a finished transcript/notes before blanking them (hours). The phone is the
# source of truth; the server copy only exists so a backgrounded client can collect its result.
RETENTION_HOURS = int(os.environ.get("HAOJI_RETENTION_HOURS") or "24")

# Push notifications (APNs, token-based .p8 auth). All three of key/key-id/team must be set or push is
# a no-op — see push.py. The topic is the app's bundle id.
APNS_KEY_PATH = os.environ.get("APNS_KEY_PATH") or ""
APNS_KEY_ID = os.environ.get("APNS_KEY_ID") or ""
APNS_TEAM_ID = os.environ.get("APNS_TEAM_ID") or ""
APNS_TOPIC = os.environ.get("APNS_TOPIC") or "com.garyhsieh.haoji"

MEDIA_EXTS = {
    ".mp4", ".mov", ".mkv", ".avi", ".m4v", ".webm", ".flv", ".ts", ".mpg", ".mpeg", ".wmv",
    ".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma",
}

def _find(name, fallback):
    p = shutil.which(name)
    if p:
        return p
    return fallback if os.path.exists(fallback) else name

# ffmpeg/ffprobe: PATH (the Docker image ships them), or FFMPEG_PATH / FFPROBE_PATH.
FFMPEG = os.environ.get("FFMPEG_PATH") or _find("ffmpeg", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_PATH") or _find("ffprobe", "ffprobe")

# Built control console (backend/console → npm run build). Served at /console when present.
CONSOLE_DIR = os.environ.get("HAOJI_CONSOLE_DIR") or os.path.join(ROOT, "console", "dist")

os.makedirs(UPLOAD_DIR, exist_ok=True)
