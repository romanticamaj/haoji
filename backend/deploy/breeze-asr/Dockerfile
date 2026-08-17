# syntax=docker/dockerfile:1
# CUDA 12.8 build — required for Blackwell GPUs (sm_120, e.g. RTX 50-series);
# older cu121 wheels top out at sm_90 and fail at inference with
# "no kernel image is available".
FROM pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends libsndfile1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
# pyannote 4.x's deps upgrade torch past the base image's pin; the base image's
# torchvision then no longer matches and breaks lightning's import. Nothing in
# this service needs torchvision (the reference native install runs without it)
# — remove it after the upgrade.
RUN pip install --no-cache-dir -r requirements.txt \
    && pip uninstall -y torchvision

# --- Pre-bake pyannote weights (gated on HF; MIT-licensed so redistribution in
# --- this image is fine). The HF token is supplied as a BuildKit SECRET so it
# --- never persists in any image layer — deployers of the built image need no
# --- token at all.
ENV HF_HOME=/opt/hf-cache
RUN --mount=type=secret,id=hf_token,required=true \
    HF_TOKEN=$(cat /run/secrets/hf_token) python -c "\
from pyannote.audio import Pipeline; \
Pipeline.from_pretrained('pyannote/speaker-diarization-3.1'); \
print('pyannote pre-baked')"
# (huggingface_hub reads the HF_TOKEN env var itself — no kwarg, so the same
#  call works on pyannote 3.x and 4.x)

COPY server.py .
ENV BREEZE_MODEL_PATH=/models/breeze-asr \
    BREEZE_MODEL_ID=MediaTek-Research/Breeze-ASR-25 \
    PYTHONUNBUFFERED=1
VOLUME ["/models"]
EXPOSE 8765
CMD ["python", "server.py"]
