# 好記後端「可部署單元」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 好記 backend + Breeze ASR + Ollama 打包成一個 `docker compose up` 即起、可交付給第三方 GPU 機器的單元。

**Architecture:** 三容器（haoji-backend CPU、breeze-asr GPU、ollama GPU）共享一顆 GPU；設定全走環境變數；模型放 `models` volume（pyannote 權重於 build 時預烤進 image，部署方免 HF token）；資料放 `data` volume。

**Tech Stack:** Docker / Compose v2、NVIDIA Container Toolkit、python:3.11-slim、pytorch CUDA runtime image、ollama/ollama、FastAPI、transformers、pyannote.audio。

**Spec:** `docs/superpowers/specs/2026-08-15-haoji-backend-deployable-unit-design.md`

## Global Constraints

- 不破壞本機現行運作：Windows 上直跑 `python app.py` 的行為必須完全不變（env 沒設就用原預設；winget ffmpeg fallback 保留）。
- 交付單元的部署方**不需要 HF token**（pyannote 權重 build 時預烤，spec §5.4）。
- 音檔轉錄完即刪的隱私行為維持不變。
- 模型不散進 app image：Breeze/gemma4 進 `models` volume；pyannote 預烤例外（權重小）。
- 對外只暴露 `:8780`。
- Python 相依鎖版（requirements.txt 既有鎖版風格）。
- 所有新檔案 UTF-8、LF。

**工作目錄**：repo 根 `D:\projects\haoji`。新增部署材料放 `deploy/`，backend Dockerfile 放 `backend/Dockerfile`。
**測試指令**：`cd backend && python -m pytest -q`（Windows 本機）。
**Breeze 原始碼來源**：`C:\ai-servers\asr\server.py`（我們自己的碼，vendor 進本 repo）。

---

### Task 1: config.py 全面 env 化（含測試）

**Files:**
- Modify: `backend/config.py`
- Test: `backend/tests/test_config_env.py`（新建）

**Interfaces:**
- Produces: `config.ASR_BASE_URL: str`（空字串 = 未設定，走自動偵測）、`config.OLLAMA_BASE`/`config.LLM_MODEL`/`config.WEB_PORT`/`config.DATA_DIR` 可被同名（`OLLAMA_BASE_URL`）env 覆寫。後續 Task 依賴這些名稱。

- [ ] **Step 1: 寫失敗測試**

`backend/tests/test_config_env.py`：

```python
# -*- coding: utf-8 -*-
"""Env-override behaviour of config.py. Reloads the module per-test so
os.environ changes take effect, and restores the pristine module afterwards."""
import importlib
import os
import pytest

import config as config_module


@pytest.fixture()
def reload_config(monkeypatch):
    """Yield a fn that sets env vars then reloads config; always restore after."""
    def _reload(**env):
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        return importlib.reload(config_module)
    yield _reload
    # restore module state computed from a clean environment
    for k in ("ASR_BASE_URL", "OLLAMA_BASE_URL", "LLM_MODEL", "WEB_PORT", "DATA_DIR"):
        os.environ.pop(k, None)
    importlib.reload(config_module)


def test_defaults_unchanged_without_env(reload_config):
    cfg = reload_config()
    assert cfg.WEB_PORT == 8780
    assert cfg.OLLAMA_BASE == "http://127.0.0.1:11434"
    assert cfg.LLM_MODEL == "gemma4:e4b-it-qat"
    assert cfg.ASR_BASE_URL == ""          # empty = autodetect
    assert cfg.DATA_DIR.endswith("data")


def test_env_overrides(reload_config, tmp_path):
    cfg = reload_config(
        ASR_BASE_URL="http://breeze-asr:8765",
        OLLAMA_BASE_URL="http://ollama:11434",
        LLM_MODEL="test-model",
        WEB_PORT="9999",
        DATA_DIR=str(tmp_path / "d"),
    )
    assert cfg.ASR_BASE_URL == "http://breeze-asr:8765"
    assert cfg.OLLAMA_BASE == "http://ollama:11434"
    assert cfg.LLM_MODEL == "test-model"
    assert cfg.WEB_PORT == 9999
    assert cfg.DATA_DIR == str(tmp_path / "d")
    assert cfg.UPLOAD_DIR == os.path.join(str(tmp_path / "d"), "uploads")
    assert cfg.DB_PATH == os.path.join(str(tmp_path / "d"), "haoji.db")
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend && python -m pytest tests/test_config_env.py -q`
Expected: FAIL（`AttributeError: ... has no attribute 'ASR_BASE_URL'` 等）

- [ ] **Step 3: 改 `backend/config.py`**

整檔改為（保留原註解精神；winget fallback 保留）：

```python
# -*- coding: utf-8 -*-
"""Central config for the Haoji backend.

Every deploy-specific value can be overridden by an environment variable so the
same code runs unchanged on the Windows dev box (no env vars -> old defaults)
and inside the docker-compose deployable unit (.env-driven).
"""
import os, shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(ROOT, "data")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
DB_PATH = os.environ.get("DB_PATH") or os.path.join(DATA_DIR, "haoji.db")

WEB_HOST = "0.0.0.0"
WEB_PORT = int(os.environ.get("WEB_PORT", "8780"))

# Breeze ASR + diarization backend.
# ASR_BASE_URL set (e.g. http://breeze-asr:8765 in compose) -> use it directly;
# empty -> legacy auto-detect across local IPs (dev box behaviour).
ASR_BASE_URL = os.environ.get("ASR_BASE_URL", "")
ASR_PORT = 8765
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

MEDIA_EXTS = {
    ".mp4", ".mov", ".mkv", ".avi", ".m4v", ".webm", ".flv", ".ts", ".mpg", ".mpeg", ".wmv",
    ".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma",
}

def _find(name, fallback):
    p = shutil.which(name)
    if p:
        return p
    return fallback if os.path.exists(fallback) else name

# Windows dev-box fallback; inside the container ffmpeg is on PATH so _find wins.
_WINGET = (r"C:\Users\gary.hsieh\AppData\Local\Microsoft\WinGet\Packages"
           r"\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0.1-full_build\bin")
FFMPEG = os.environ.get("FFMPEG_PATH") or _find("ffmpeg", os.path.join(_WINGET, "ffmpeg.exe"))
FFPROBE = os.environ.get("FFPROBE_PATH") or _find("ffprobe", os.path.join(_WINGET, "ffprobe.exe"))

os.makedirs(UPLOAD_DIR, exist_ok=True)
```

- [ ] **Step 4: 跑測試確認通過（含既有全套不退步）**

Run: `cd backend && python -m pytest -q`
Expected: 全數 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/config.py backend/tests/test_config_env.py
git commit -m "feat(backend): env-driven config (ASR_BASE_URL/OLLAMA_BASE_URL/LLM_MODEL/WEB_PORT/DATA_DIR)"
```

---

### Task 2: asr.py 支援 ASR_BASE_URL 直連（含測試）

**Files:**
- Modify: `backend/asr.py:30-40`（`detect_asr_base`）
- Test: `backend/tests/test_asr.py`（append）

**Interfaces:**
- Consumes: Task 1 的 `config.ASR_BASE_URL`。
- Produces: `detect_asr_base()` 行為——env 設定時直接回傳該 URL（health 檢查通過）或 `None`；未設定時維持舊自動偵測。呼叫端（`transcribe_diarize`）簽名不變。

- [ ] **Step 1: 寫失敗測試（append 到 `backend/tests/test_asr.py`）**

```python
def test_detect_asr_base_uses_env_url(monkeypatch):
    """ASR_BASE_URL set -> returned directly when healthy, no IP scanning."""
    import asr, config
    monkeypatch.setattr(config, "ASR_BASE_URL", "http://breeze-asr:8765")
    monkeypatch.setattr(asr, "_asr_cache", None)
    monkeypatch.setattr(asr, "_is_breeze", lambda url: url == "http://breeze-asr:8765")
    assert asr.detect_asr_base(force=True) == "http://breeze-asr:8765"


def test_detect_asr_base_env_url_unhealthy_returns_none(monkeypatch):
    import asr, config
    monkeypatch.setattr(config, "ASR_BASE_URL", "http://breeze-asr:8765")
    monkeypatch.setattr(asr, "_asr_cache", None)
    monkeypatch.setattr(asr, "_is_breeze", lambda url: False)
    assert asr.detect_asr_base(force=True) is None
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend && python -m pytest tests/test_asr.py -q`
Expected: 新增 2 測試 FAIL（現行實作對 env URL 一無所知，會走 IP 掃描）

- [ ] **Step 3: 改 `backend/asr.py` 的 `detect_asr_base`**

```python
def detect_asr_base(force=False):
    global _asr_cache
    # Explicit base URL (compose / any remote deploy) wins over auto-detection.
    if config.ASR_BASE_URL:
        if _is_breeze(config.ASR_BASE_URL):
            _asr_cache = config.ASR_BASE_URL
            return _asr_cache
        _asr_cache = None
        return None
    if _asr_cache and not force and _is_breeze(_asr_cache):
        return _asr_cache
    for ip in ["127.0.0.1"] + _local_ips():
        url = f"http://{ip}:{config.ASR_PORT}"
        if _is_breeze(url):
            _asr_cache = url
            return url
    _asr_cache = None
    return None
```

- [ ] **Step 4: 跑全套測試確認通過**

Run: `cd backend && python -m pytest -q`
Expected: 全數 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/asr.py backend/tests/test_asr.py
git commit -m "feat(backend): ASR_BASE_URL direct mode in detect_asr_base (compose service name)"
```

---

### Task 3: haoji-backend Dockerfile（CPU）＋本機 build 驗證

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/.dockerignore`

**Interfaces:**
- Consumes: Task 1/2 的 env 行為。
- Produces: image `haoji-backend`（`docker build -t haoji-backend backend/`），listen `$WEB_PORT`（預設 8780），`GET /health` 回 `{"status":"ok"}`。Task 4/6 直接引用。

- [ ] **Step 0: 確認 Docker 可用**

Run: `docker --version && docker compose version`
若未安裝：Windows 裝 Docker Desktop（WSL2 backend）。這是本機驗證前提。

- [ ] **Step 1: 寫 `backend/.dockerignore`**

```
venv/
__pycache__/
*.pyc
data/
logs/
.pytest_cache/
keepalive.log
```

（`tests/` 刻意**不**排除——spec §13 要求單元測試能在容器內跑：`docker run --rm haoji-backend python -m pytest -q`。）

- [ ] **Step 2: 寫 `backend/Dockerfile`**

```dockerfile
FROM python:3.11-slim

# ffmpeg/ffprobe on PATH (config._find picks them up; no Windows fallback used)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV DATA_DIR=/data \
    PYTHONUNBUFFERED=1
VOLUME ["/data"]
EXPOSE 8780

CMD ["python", "app.py"]
```

- [ ] **Step 3: build**

Run: `docker build -t haoji-backend backend/`
Expected: build 成功

- [ ] **Step 4: 冒煙測試（不需 ASR/Ollama，只驗 /health 與啟動）**

```bash
docker run --rm -d --name haoji-smoke -p 18780:8780 haoji-backend
sleep 3
curl -s http://127.0.0.1:18780/health
docker rm -f haoji-smoke
```
Expected: `{"status":"ok","service":"haoji-backend"}`

- [ ] **Step 5: Commit**

```bash
git add backend/Dockerfile backend/.dockerignore
git commit -m "feat(deploy): haoji-backend CPU Dockerfile (ffmpeg on PATH, /data volume)"
```

---

### Task 4: compose 骨架（haoji + ollama）＋ .env.example

**Files:**
- Create: `deploy/docker-compose.yml`
- Create: `deploy/.env.example`
- Create: `deploy/ollama/entrypoint.sh`

**Interfaces:**
- Consumes: Task 3 image、Task 1 env 名稱。
- Produces: `deploy/docker-compose.yml`——服務名 `haoji-backend`/`ollama`（Task 6 會加 `breeze-asr`）；volume `models`/`data`。`LLM_MODEL` 由 `.env` 注入兩個服務。

- [ ] **Step 1: 寫 `deploy/ollama/entrypoint.sh`**

```sh
#!/bin/sh
# Start ollama, then make sure the configured model is present (first boot pulls
# it into the models volume; later boots are no-ops).
set -e
ollama serve &
SERVE_PID=$!
sleep 3
if ! ollama list | grep -q "${LLM_MODEL}"; then
  echo "[ollama-init] pulling ${LLM_MODEL}..."
  ollama pull "${LLM_MODEL}"
fi
wait $SERVE_PID
```

- [ ] **Step 2: 寫 `deploy/.env.example`**

```env
# 好記 deployable unit — copy to .env and adjust.
LLM_MODEL=gemma4:e4b-it-qat
WEB_PORT=8780
# Only needed when BUILDING the breeze-asr image (pyannote pre-bake), never at runtime:
HF_TOKEN=
```

- [ ] **Step 3: 寫 `deploy/docker-compose.yml`（本 Task 先兩服務；GPU 段落先只掛 ollama）**

```yaml
name: haoji

services:
  haoji-backend:
    build: ../backend
    ports:
      - "${WEB_PORT:-8780}:8780"
    environment:
      ASR_BASE_URL: http://breeze-asr:8765
      OLLAMA_BASE_URL: http://ollama:11434
      LLM_MODEL: ${LLM_MODEL:-gemma4:e4b-it-qat}
      DATA_DIR: /data
    volumes:
      - data:/data
    depends_on:
      - ollama
    restart: unless-stopped

  ollama:
    image: ollama/ollama:latest
    entrypoint: ["/entrypoint.sh"]
    environment:
      LLM_MODEL: ${LLM_MODEL:-gemma4:e4b-it-qat}
    volumes:
      - models-ollama:/root/.ollama
      - ./ollama/entrypoint.sh:/entrypoint.sh:ro
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    restart: unless-stopped

volumes:
  data:
  models-ollama:
```

- [ ] **Step 4: 本機驗證（ASR 尚未容器化——此階段 transcribe 會失敗是預期；驗 haoji↔ollama）**

```bash
cd deploy && cp .env.example .env
docker compose up -d --build
sleep 5
curl -s http://127.0.0.1:8780/health          # -> {"status":"ok",...}
curl -s http://127.0.0.1:8780/api/llm/models  # -> {"ok":true,"models":[...gemma4...]}（首次要等 pull 完）
docker compose down
```
Expected: 兩個端點如上（`/api/llm/models` 的 `ok:true` 證明 haoji 容器透過 service name 連上了 ollama 容器）。

- [ ] **Step 5: Commit**

```bash
git add deploy/docker-compose.yml deploy/.env.example deploy/ollama/entrypoint.sh
git commit -m "feat(deploy): compose skeleton (haoji-backend + ollama, models/data volumes)"
```

---

### Task 5: breeze-asr 容器（vendor server.py + pyannote 預烤 + Breeze 首啟下載）

**Files:**
- Create: `deploy/breeze-asr/server.py`（vendor 自 `C:\ai-servers\asr\server.py`，三處修改如下）
- Create: `deploy/breeze-asr/Dockerfile`
- Create: `deploy/breeze-asr/requirements.txt`

**Interfaces:**
- Consumes: 無（獨立服務）。
- Produces: image `haoji-breeze-asr`；`GET /health` 回 `{"status":"ok","model":"breeze-asr-25",...}`；`POST /transcribe_diarize` 同現有介面（haoji 的 `asr.py` 已相容）。env：`BREEZE_MODEL_PATH`（預設 `/models/breeze-asr`）、`BREEZE_MODEL_ID`（預設 `MediaTek-Research/Breeze-ASR-25`）。**執行時不需要 HF_TOKEN。**

- [ ] **Step 1: vendor + 修改 server.py**

複製 `C:\ai-servers\asr\server.py` → `deploy/breeze-asr/server.py`，然後套用以下三個修改：

修改 A——`MODEL_PATH` 改 env + 首啟自動下載（取代原 `MODEL_PATH = r"C:\ai-models\breeze-asr"` 一行）：

```python
MODEL_PATH = os.environ.get("BREEZE_MODEL_PATH", "/models/breeze-asr")
BREEZE_MODEL_ID = os.environ.get("BREEZE_MODEL_ID", "MediaTek-Research/Breeze-ASR-25")
```

修改 B——`load_model()` 開頭加首啟下載（放在 `from transformers import ...` 之後、`print(f"[Loading] ...` 之前）：

```python
    if not os.path.isdir(MODEL_PATH) or not os.listdir(MODEL_PATH):
        from huggingface_hub import snapshot_download
        print(f"[Download] {BREEZE_MODEL_ID} -> {MODEL_PATH} (first boot only)...")
        snapshot_download(BREEZE_MODEL_ID, local_dir=MODEL_PATH)
```

修改 C——`_get_diarize_pipeline()`：token 改為可選（權重已預烤在 image 的 HF cache，離線可載）。把「沒 token 就 raise」整段換成：

```python
    hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN") or None
    # Weights are pre-baked into the image's HF cache at build time (see
    # Dockerfile), so no token is needed at runtime; a token env var still
    # works and simply re-authenticates.
```
（`Pipeline.from_pretrained(DIARIZE_MODEL, token=hf_token)` 原呼叫保留——`token=None` 時直接吃 cache。）

- [ ] **Step 2: 寫 `deploy/breeze-asr/requirements.txt`**

```
transformers==4.48.3
pyannote.audio==3.3.2
librosa==0.10.2.post1
fastapi==0.135.2
uvicorn==0.34.0
python-multipart==0.0.22
huggingface_hub==0.28.1
```

- [ ] **Step 3: 寫 `deploy/breeze-asr/Dockerfile`（pyannote 預烤在 build 層）**

```dockerfile
FROM pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends libsndfile1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# --- Pre-bake pyannote weights (gated on HF; MIT-licensed so redistribution in
# --- this image is fine). HF_TOKEN is a BUILD argument only — the final image
# --- and its deployers never need it.
ARG HF_TOKEN
ENV HF_HOME=/opt/hf-cache
RUN test -n "$HF_TOKEN" || (echo "HF_TOKEN build-arg required (pyannote pre-bake)"; exit 1)
RUN HF_TOKEN=$HF_TOKEN python -c "\
import os; from pyannote.audio import Pipeline; \
Pipeline.from_pretrained('pyannote/speaker-diarization-3.1', token=os.environ['HF_TOKEN']); \
print('pyannote pre-baked')"

COPY server.py .
ENV BREEZE_MODEL_PATH=/models/breeze-asr \
    BREEZE_MODEL_ID=MediaTek-Research/Breeze-ASR-25 \
    PYTHONUNBUFFERED=1
VOLUME ["/models"]
EXPOSE 8765
CMD ["python", "server.py"]
```

- [ ] **Step 4: build（帶你自己的 HF token；只此一次需要）**

Run: `docker build -t haoji-breeze-asr --build-arg HF_TOKEN=<你的hf_token> deploy/breeze-asr/`
Expected: build 成功，log 出現 `pyannote pre-baked`

- [ ] **Step 5: 單容器驗證（GPU + 首啟模型下載 + health）**

```bash
docker run --rm -d --name breeze-smoke --gpus all -p 18765:8765 -v haoji-models-breeze:/models haoji-breeze-asr
sleep 60   # 首啟要下載 Breeze (~3GB) + 載入模型；之後啟動只需秒級
curl -s http://127.0.0.1:18765/health
docker rm -f breeze-smoke
```
Expected: `{"status":"ok","model":"breeze-asr-25","device":"cuda",...}`。
若 `device` 錯誤或起不來 → 檢查主機 NVIDIA Container Toolkit（spec §9 gotcha）。

- [ ] **Step 6: Commit**

```bash
git add deploy/breeze-asr/
git commit -m "feat(deploy): breeze-asr GPU container (vendored server, pyannote pre-baked, model volume)"
```

---

### Task 6: 三服務整合 compose ＋ 端到端驗證

**Files:**
- Modify: `deploy/docker-compose.yml`（加 `breeze-asr`）

**Interfaces:**
- Consumes: Task 3/4/5 全部產物。
- Produces: 完整可交付 compose——`docker compose up -d --build` 起整套。

- [ ] **Step 1: 在 `deploy/docker-compose.yml` 的 `services:` 加入**

```yaml
  breeze-asr:
    build:
      context: ./breeze-asr
      args:
        HF_TOKEN: ${HF_TOKEN}
    environment:
      BREEZE_MODEL_PATH: /models/breeze-asr
    volumes:
      - models-breeze:/models
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    restart: unless-stopped
```

並在 `volumes:` 加 `models-breeze:`，且 `haoji-backend.depends_on` 改為 `[ollama, breeze-asr]`。

- [ ] **Step 2: 起整套**

```bash
cd deploy
docker compose up -d --build
sleep 90   # 首次：ollama pull gemma4 + breeze 下載模型
curl -s http://127.0.0.1:8780/health
curl -s http://127.0.0.1:8780/api/llm/models
```
Expected: 兩者 ok。

- [ ] **Step 3: 端到端管線驗證（合成音檔冒煙——驗流程通，品質留給 Task 8 真實音檔）**

```bash
# 3 秒 440Hz 正弦波當測試音檔
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=3" -c:a aac /tmp/tone.m4a
SID=$(curl -s -X POST http://127.0.0.1:8780/api/sessions -H "Content-Type: application/json" -d '{"client_id":"e2e-compose-1"}' | python -c "import sys,json;print(json.load(sys.stdin)['session_id'])")
curl -s -X POST "http://127.0.0.1:8780/api/sessions/$SID/parts" -F "file=@/tmp/tone.m4a"
curl -s -X POST "http://127.0.0.1:8780/api/sessions/$SID/transcribe"
sleep 30
curl -s "http://127.0.0.1:8780/api/sessions/$SID"
```
Expected: 最後回 `{"status":"done",...}`（純音無語音 → transcript segments 可為空，但**狀態必須 done、不得 error**——證明 haoji→breeze-asr→回寫全鏈通）。

- [ ] **Step 4: Commit**

```bash
git add deploy/docker-compose.yml
git commit -m "feat(deploy): full three-service compose (haoji + breeze-asr + ollama, shared GPU)"
```

---

### Task 7: 部署文件 DEPLOY.md ＋ 授權清單

**Files:**
- Create: `deploy/DEPLOY.md`
- Create: `deploy/LICENSES.md`

**Interfaces:**
- Consumes: spec §9/§10 內容（照抄其表格與 image/host 分工說明）。
- Produces: 交付對象唯一需要讀的兩份文件。

- [ ] **Step 1: 寫 `deploy/DEPLOY.md`**

內容必含（依 spec §9、§11、§13）：
1. **主機前提**：Linux（或 Windows+WSL2）、NVIDIA GPU ≥16GB VRAM、NVIDIA 驅動（新版）、NVIDIA Container Toolkit、Docker + Compose v2。
2. **軟體/硬體分工**與**GPU 偵測不到的常見故障**——照 spec §9 兩段引文抄入。
3. **啟動步驟**：`cp .env.example .env` → 填 `HF_TOKEN`（僅 build 用）→ `docker compose up -d --build` → 首次等模型下載 → 驗證指令（`/health`、`/api/llm/models`、Task 6 Step 3 的端到端腳本）。
4. **App 指向**：把 App 的 `Config.API_BASE` 指到 `http://<部署機>:8780`（iOS ATS / Android network_security_config 同步）。
5. **資料與隱私**：音檔轉錄完即刪；`data` volume 只有 SQLite 狀態；備份/清除方式（`docker volume rm`）。
6. **維運**：`docker compose logs -f haoji-backend`、`restart: unless-stopped` 已內建、更新流程（`git pull && docker compose up -d --build`）。

- [ ] **Step 2: 寫 `deploy/LICENSES.md`**

照 spec §10 表格全文抄入（Breeze Apache-2.0 / Whisper MIT / pyannote MIT+gate 條款複核註記 / Gemma Terms / 自有碼），並加一行：「pyannote 權重已於 build 時預烤進 image；其授權為 MIT，散佈時保留本清單即可」。

- [ ] **Step 3: Commit**

```bash
git add deploy/DEPLOY.md deploy/LICENSES.md
git commit -m "docs(deploy): deployment guide + license inventory for the deliverable unit"
```

---

### Task 8: 乾淨機器驗證（P4，人工 gate）

**Files:**
- Create: `deploy/VALIDATION.md`（驗證檢核表，執行時逐項打勾）

**Interfaces:**
- Consumes: 全部前置 Task。
- Produces: 交付判準——此檢核表全綠才算「可交付」。

- [ ] **Step 1: 寫 `deploy/VALIDATION.md` 檢核表**

```markdown
# 交付前驗證（在一台非開發機的乾淨 GPU 機器上執行）

- [ ] 依 DEPLOY.md 從零安裝前提（驅動/Toolkit/Docker）
- [ ] `docker compose up -d --build` 一次成功（僅 .env 的 HF_TOKEN 供 build）
- [ ] 三容器 healthy：/health、/api/llm/models、breeze /health(device=cuda)
- [ ] 端到端冒煙（合成音檔）status=done
- [ ] 真實會議音檔迴歸：與本機版比 逐字稿內容 / 講者分離段數 / 總耗時，
      差異在可接受範圍（人工判定，記錄數字）
- [ ] App 改指部署機 :8780，實機錄音→轉錄→講者→繁中記錄 全流程通
- [ ] 重開機後 compose 自動恢復（restart policy）
- [ ] 音檔即刪驗證：轉錄完 `docker exec haoji-backend ls /data/uploads/parts` 為空
```

- [ ] **Step 2: Commit**

```bash
git add deploy/VALIDATION.md
git commit -m "docs(deploy): clean-machine validation checklist (delivery gate)"
```

- [ ] **Step 3: 實際執行檢核表**（需要一台乾淨 GPU 機器＋真實音檔；人工完成後回報結果）
