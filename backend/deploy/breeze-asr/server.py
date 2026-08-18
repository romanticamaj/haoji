"""
Breeze ASR 25 — FastAPI Server
啟動時載入模型到 GPU，常駐記憶體提供推理 API

Endpoints:
  /transcribe          — 單人語音辨識（librosa 切靜音 + Whisper）
  /transcribe_diarize  — 多人對談分軌（pyannote diarization + Whisper per segment）
"""
import os
import time
import torch
import librosa
import tempfile
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Query
from fastapi.responses import JSONResponse

MODEL_PATH = os.environ.get("BREEZE_MODEL_PATH", "/models/breeze-asr")
BREEZE_MODEL_ID = os.environ.get("BREEZE_MODEL_ID", "MediaTek-Research/Breeze-ASR-25")
DIARIZE_MODEL = "pyannote/speaker-diarization-3.1"
app = FastAPI(title="Breeze ASR 25", version="1.1")
# (the dev box's web UI / static dir is not shipped in this image — API only)

# Global model holders
processor = None
model = None
diarize_pipeline = None  # lazy-loaded on first /transcribe_diarize call
device = "cuda"

@app.on_event("startup")
async def load_model():
    global processor, model
    from transformers import WhisperProcessor, WhisperForConditionalGeneration
    # A weights file must actually exist — a directory left half-full by an
    # interrupted first download must NOT skip the (resumable) download.
    import glob as _glob
    def _weights_present(p):
        return bool(_glob.glob(os.path.join(p, "*.safetensors"))
                    or _glob.glob(os.path.join(p, "pytorch_model*.bin")))
    if not _weights_present(MODEL_PATH):
        from huggingface_hub import snapshot_download
        print(f"[Download] {BREEZE_MODEL_ID} -> {MODEL_PATH} (first boot only, resumable)...")
        snapshot_download(BREEZE_MODEL_ID, local_dir=MODEL_PATH)
    print(f"[Loading] Breeze ASR 25 from {MODEL_PATH}...")
    start = time.time()
    processor = WhisperProcessor.from_pretrained(MODEL_PATH)
    model = WhisperForConditionalGeneration.from_pretrained(
        MODEL_PATH, torch_dtype=torch.float16
    ).to(device)
    print(f"[OK] Model loaded in {time.time()-start:.1f}s (device: {device})")

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": "breeze-asr-25",
        "device": device,
        "diarize_loaded": diarize_pipeline is not None,
        "diarize_model": DIARIZE_MODEL,
        "hf_token_set": bool(os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")),
    }


def _get_diarize_pipeline():
    """Lazy-load pyannote pipeline on first diarize call.

    Requires HF_TOKEN env var and accepted gated access for
    pyannote/speaker-diarization-3.1 and pyannote/segmentation-3.0.
    """
    global diarize_pipeline
    if diarize_pipeline is not None:
        return diarize_pipeline

    hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN") or None
    # Weights are pre-baked into the image's HF cache at build time (see
    # Dockerfile), so no token is needed at runtime; a token env var still
    # works and simply re-authenticates.

    from pyannote.audio import Pipeline as PyannotePipeline
    print(f"[Loading] {DIARIZE_MODEL}...")
    start = time.time()
    # No token kwarg: huggingface_hub reads HF_TOKEN from the env if present,
    # and the weights are pre-baked into the image's HF cache anyway. Keeping
    # the call kwarg-free works across pyannote 3.x (use_auth_token) and 4.x (token).
    if hf_token:
        os.environ.setdefault("HF_TOKEN", hf_token)
    pipeline = PyannotePipeline.from_pretrained(DIARIZE_MODEL)
    pipeline.to(torch.device(device))
    diarize_pipeline = pipeline
    print(f"[OK] Diarization pipeline loaded in {time.time()-start:.1f}s")
    return diarize_pipeline


def _fmt_srt_ts(t: float) -> str:
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    ms = int(round((t - int(t)) * 1000))
    if ms == 1000:
        s += 1
        ms = 0
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _segments_to_srt(segments):
    lines = []
    for i, seg in enumerate(segments, 1):
        lines.append(str(i))
        lines.append(f"{_fmt_srt_ts(seg['start'])} --> {_fmt_srt_ts(seg['end'])}")
        lines.append(f"[{seg['speaker']}] {seg['text']}")
        lines.append("")
    return "\n".join(lines)

@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Query("zh", description="Language code: zh, en, auto")
):
    # Save uploaded file to temp
    suffix = Path(file.filename).suffix or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        start = time.time()

        # Load and resample
        audio, sr = librosa.load(tmp_path, sr=16000, mono=True)
        duration = len(audio) / sr

        # Split on silence for finer segments, each capped at max_samples (10s)
        max_samples = 10 * sr
        intervals = librosa.effects.split(audio, top_db=25, frame_length=2048, hop_length=512)

        # Group speech intervals into chunks ≤ max_samples
        chunk_list = []  # (audio_array, offset_seconds)
        if len(intervals) == 0:
            chunk_list = [(audio, 0.0)]
        else:
            buf_start = intervals[0][0]
            buf_end = intervals[0][1]
            for iv in intervals[1:]:
                # If adding this interval exceeds 30s, flush current buffer
                if iv[1] - buf_start > max_samples:
                    chunk_list.append((audio[buf_start:buf_end], buf_start / sr))
                    buf_start = iv[0]
                buf_end = iv[1]
            chunk_list.append((audio[buf_start:buf_end], buf_start / sr))

        # Set language
        forced_decoder_ids = None
        if language and language != "auto":
            forced_decoder_ids = processor.get_decoder_prompt_ids(
                language=language, task="transcribe"
            )

        # Transcribe chunks
        all_text = []
        segments = []

        for chunk_audio, chunk_offset in chunk_list:
            input_features = processor(
                chunk_audio, sampling_rate=sr, return_tensors="pt"
            ).input_features.to(device).half()

            with torch.no_grad():
                predicted_ids = model.generate(
                    input_features,
                    forced_decoder_ids=forced_decoder_ids,
                    max_new_tokens=440,
                    return_timestamps=True,
                )

            text = processor.decode(predicted_ids[0], skip_special_tokens=True).strip()
            if text:
                all_text.append(text)
                segments.append({
                    "start": round(chunk_offset, 2),
                    "text": text,
                })

        inference_time = time.time() - start
        full_text = " ".join(all_text)

        return JSONResponse({
            "text": full_text,
            "segments": segments,
            "duration": round(duration, 2),
            "inference_time": round(inference_time, 2),
            "language": language,
        })
    finally:
        os.unlink(tmp_path)


@app.post("/transcribe_diarize")
async def transcribe_diarize(
    file: UploadFile = File(...),
    language: str = Query("zh", description="Language code: zh, en, auto"),
    num_speakers: Optional[int] = Query(None, description="Exact speaker count (recommended if known, e.g. 2 for 2-host podcast)"),
    min_speakers: Optional[int] = Query(None),
    max_speakers: Optional[int] = Query(None),
    format: str = Query("json", description="json | srt | txt"),
    merge_gap: float = Query(0.5, description="Merge consecutive same-speaker segments closer than this (seconds)"),
    min_segment: float = Query(0.3, description="Skip diarization segments shorter than this (seconds)"),
):
    """Speaker-diarized transcription. Pyannote splits speakers, then each segment goes through Breeze ASR."""
    try:
        pipeline = _get_diarize_pipeline()
    except RuntimeError as e:
        return JSONResponse({"error": str(e)}, status_code=503)

    suffix = Path(file.filename).suffix or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        start = time.time()

        # Load audio at 16kHz mono (shared by diarization and ASR)
        audio, sr = librosa.load(tmp_path, sr=16000, mono=True)
        duration = len(audio) / sr

        # Diarization — pass waveform directly to avoid re-decoding the file
        waveform = torch.from_numpy(audio).unsqueeze(0)
        diarize_kwargs = {}
        if num_speakers is not None:
            diarize_kwargs["num_speakers"] = num_speakers
        else:
            if min_speakers is not None:
                diarize_kwargs["min_speakers"] = min_speakers
            if max_speakers is not None:
                diarize_kwargs["max_speakers"] = max_speakers

        diarize_start = time.time()
        diarization = pipeline({"waveform": waveform, "sample_rate": sr}, **diarize_kwargs)
        diarize_time = time.time() - diarize_start

        # pyannote 4.x returns DiarizeOutput; older versions return an Annotation directly
        annotation = getattr(diarization, "speaker_diarization", diarization)

        # Collect raw turns
        raw_segments = []
        for turn, _, speaker in annotation.itertracks(yield_label=True):
            if turn.duration < min_segment:
                continue
            raw_segments.append({"start": float(turn.start), "end": float(turn.end), "speaker": speaker})
        raw_segments.sort(key=lambda s: s["start"])

        # Merge adjacent same-speaker segments separated by < merge_gap
        merged = []
        for seg in raw_segments:
            if merged and merged[-1]["speaker"] == seg["speaker"] and (seg["start"] - merged[-1]["end"]) < merge_gap:
                merged[-1]["end"] = seg["end"]
            else:
                merged.append(dict(seg))

        print(f"[diarize] {len(raw_segments)} raw segments -> {len(merged)} after merge")

        # Language prompt for Whisper
        forced_decoder_ids = None
        if language and language != "auto":
            forced_decoder_ids = processor.get_decoder_prompt_ids(language=language, task="transcribe")

        # ASR per merged segment
        asr_start = time.time()
        min_chunk_samples = int(0.1 * sr)
        for seg in merged:
            s_idx = max(0, int(seg["start"] * sr))
            e_idx = min(len(audio), int(seg["end"] * sr))
            chunk = audio[s_idx:e_idx]
            if len(chunk) < min_chunk_samples:
                seg["text"] = ""
                continue

            input_features = processor(
                chunk, sampling_rate=sr, return_tensors="pt"
            ).input_features.to(device).half()

            with torch.no_grad():
                predicted_ids = model.generate(
                    input_features,
                    forced_decoder_ids=forced_decoder_ids,
                    max_new_tokens=440,
                    return_timestamps=True,
                )

            seg["text"] = processor.decode(predicted_ids[0], skip_special_tokens=True).strip()

        asr_time = time.time() - asr_start

        # Drop empty segments after ASR
        merged = [s for s in merged if s.get("text")]
        for s in merged:
            s["start"] = round(s["start"], 2)
            s["end"] = round(s["end"], 2)

        speakers = sorted({s["speaker"] for s in merged})
        timing = {
            "duration": round(duration, 2),
            "diarize_time": round(diarize_time, 2),
            "asr_time": round(asr_time, 2),
            "total_time": round(time.time() - start, 2),
        }

        if format == "srt":
            return JSONResponse({
                "format": "srt",
                "content": _segments_to_srt(merged),
                "segments": merged,
                "speakers": speakers,
                **timing,
            })
        if format == "txt":
            return JSONResponse({
                "format": "txt",
                "content": "\n".join(f"[{s['speaker']}] {s['text']}" for s in merged),
                "segments": merged,
                "speakers": speakers,
                **timing,
            })
        return JSONResponse({
            "format": "json",
            "segments": merged,
            "speakers": speakers,
            "language": language,
            **timing,
        })
    finally:
        os.unlink(tmp_path)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7765, workers=1)
