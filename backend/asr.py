# -*- coding: utf-8 -*-
"""Breeze ASR detection, audio extraction, diarized transcription, normalization."""
import os, socket, subprocess
import requests
import config
from zhtw import to_traditional

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
    # Convert each segment to Traditional Chinese (s2tw). Breeze ASR is invoked with language="zh" and
    # can emit Simplified/mixed characters; without this the 逐字稿 leaked Simplified even though the
    # AI notes were already converted. This makes the whole pipeline Traditional (the app displays
    # these segments AND feeds them to the notes LLM via build_transcript_text).
    segs = [{"start": float(s["start"]), "end": float(s["end"]),
             "speaker": s["speaker"], "text": to_traditional(s["text"].strip())}
            for s in data.get("segments", [])]
    return {
        "segments": segs,
        "speakers": sorted({s["speaker"] for s in segs}),
        "duration": float(data.get("duration", segs[-1]["end"] if segs else 0)),
        "stats": speaker_stats(segs),
    }
