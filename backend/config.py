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
