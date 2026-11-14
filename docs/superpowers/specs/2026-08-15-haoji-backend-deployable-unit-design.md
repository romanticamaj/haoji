# 好記 Haoji — 後端「可部署、可複製單元」設計

- **日期**：2026-08-15
- **狀態**：DRAFT（設計定案，待審 → 進實作計畫）
- **目標讀者**：好記維運者、未來接手部署的第三方公司

---

## 1. 目標與動機

把目前**綁死在單一 Windows GPU 機器**上的好記後端，改造成一個 **`docker compose` 一鍵起、可複製、可交付**的單元：換一台有 NVIDIA GPU 的機器 → `docker compose up` → 整套好記後端就會動。

**為什麼要做：**
- 現在後端跟同機十幾個 GPU 服務搶資源、一直打架、掛掉要人救火（AI Service Manager、GPU 互斥、keepalive、serve_editor 撞 8765…）。
- 要能**交付給別的公司自行部署**，不能依賴「gary 這台機器的環境」。
- 一台專用機只跑好記這一包時，上述搶資源的問題**根本不存在**——這個改造同時解決穩定性。

## 2. 範圍與非目標

**範圍（本 spec）：** 把 **好記 backend + Breeze ASR + Ollama** 三個服務打包成一個需 GPU 的 compose 單元，設定全面 env 化，模型/資料走 volume，附交付文件與授權清單。

**非目標（本輪暫緩，日後另議）：**
- **上雲 / serverless / 按分鐘計費的雲 ASR**（Modal、Soniox、Chirp…）——先做本地可複製單元。
- **GPU 成本 / 付費點重新設計**（免費逐字稿先燒 GPU 的商模問題）——待**先研究競品商模**後再決定。
- **為了「更準」而換 ASR / 分軌模型**——經評估後**維持現狀**（見 §5.3）。

## 3. 現況架構（問題所在）

```
📱App ──HTTPS(Tailscale <tailscale-ip>:8780)──▶ 好記 backend :8780 (FastAPI, CPU)
                                                   ├─ HTTP :8765 ─▶ 🔴 Breeze ASR (GPU, C:\ai-servers\asr)
                                                   └─ HTTP :11434 ─▶ 🔴 Ollama gemma4 (GPU)
本機專用 ops 層：AI Service Manager :8760（GPU 互斥）· start.bat/ps1 · keepalive.ps1
```

**綁死本機的點：** ffmpeg winget 路徑、asr.py 掃本機 IP 找 :8765、Ollama 位址、模型名、Tailscale IP、Breeze `MODEL_PATH=C:\ai-models\breeze-asr`、整個 Windows ops 腳本層。

## 4. 目標架構

```
docker compose（一台有 NVIDIA GPU 的機器）
┌───────────────────────────────────────────────────────────┐
│  haoji-backend   CPU     :8780   ← 我們的碼，env 驅動         │
│      │  ASR_BASE_URL          │  OLLAMA_BASE_URL             │
│      ▼                        ▼                             │
│  breeze-asr      GPU     :8765     ollama       GPU  :11434  │
│   Breeze-ASR-25(Whisper)          gemma4:e4b-it-qat          │
│   + pyannote 3.1(分軌)                                       │
│           └──────── 共享同一顆 GPU（~16GB 夠）───────┘        │
│  volumes: models（模型）· data（SQLite+暫存音檔，用完即刪）    │
└───────────────────────────────────────────────────────────┘
App 只需把 Config.API_BASE 指到這台的 :8780
```

**關鍵簡化：** 專用機上三個服務直接共存（Breeze ~5GB + gemma4 ~4GB 同顆 16GB GPU 放得下），**不需要 AI Service Manager、GPU 互斥、keepalive**——那層 ops 只為「共享機搶資源」而生，交付單元裡整層拿掉。

## 5. 關鍵決策與理由

### 5.1 邊界＝三服務全包成一個 GPU compose 單元
交付對象有自己的 GPU 機器、要整套自建。Breeze/Ollama 都可容器化（見下），全包才是「可複製、可交付」。

### 5.2 交付單元不含本機 ops 層
manager / 互斥 / keepalive / start.bat / serve_editor 撞 port 全部只存在於共享機，不進交付物。本機現況維持不動當過渡備援，直到單元驗證完成。

### 5.3 分軌維持 pyannote 3.1（評估後不換）
評估過 2026 主要對手 **NeMo Sortformer**，對好記**更糟**：主要版本 **CC-BY-NC（禁商用）**、**不擅長對話型會議**（會亂切）、又慢又吃 GPU（建議 48GB）。pyannote 3.1 反而最合會議、**MIT 可商用**、社群最成熟。→ **不換。**

### 5.4 pyannote 權重「預烤」進交付物 → 部署方免 HF token
HF token 只在**下載** pyannote gated 權重時需要，執行時不需要。pyannote 3.1 授權是 **MIT（可再散佈）**，所以：**我們 build 時用自己的 token 下載一次、把權重烤進 image/volume**，部署方拿到就有、**零 token、免去 HF 註冊**。
> ⚠️ 商業交付前需人工複核 pyannote HF gate 的「使用條款」措辭一次（授權 MIT 無虞，措辭確認為保險）。

### 5.5 LLM 維持 Ollama + gemma4（保留 provider 抽象）
`llm.py` 既有 `get_provider()` 抽象，日後要換雲端 LLM 只改 provider。本單元內建 Ollama 官方 image + gemma4，自成一體。

## 6. 元件設計

### 6.1 `haoji-backend` 容器（CPU）
- Base：`python:3.11-slim` + `ffmpeg`（apt）。純 CPU。
- 內容：現有 `backend/`（app.py / sessions / media / asr / llm / zhtw）。
- 改動：`config.py` 所有寫死值改讀 env（§7）；`asr.py` 拿掉「掃本機 IP」改直接用 `ASR_BASE_URL`。
- 資料：SQLite + 暫存音檔掛 `data` volume；音檔轉錄後即刪（維持隱私）。

### 6.2 `breeze-asr` 容器（GPU）
- Base：CUDA runtime + PyTorch（如 `pytorch/pytorch` cuda 版）。
- 相依：`transformers`、`pyannote.audio`、`librosa`、`fastapi`、`uvicorn`（全 pip、Linux 友善）。
- 模型：
  - **Breeze-ASR-25**（Apache 2.0，公開非 gated）→ build 或首啟拉到 `models` volume。
  - **pyannote 3.1 + segmentation-3.0**（MIT，gated）→ **build 時用我方 token 預烤進交付物**（§5.4）。
- 改動：`MODEL_PATH` → env；`server.py` 已 `host=0.0.0.0`，其餘幾乎不動。

### 6.3 `ollama` 容器（GPU）
- 官方 `ollama/ollama` image + NVIDIA runtime。
- 首啟 `ollama pull gemma4:e4b-it-qat` 到 `models` volume（或 entrypoint 自動拉）。

### 6.4 `docker-compose.yml`
- 三服務 + 兩 volume（`models`、`data`）+ GPU 保留（`deploy.resources.reservations.devices` / `--gpus all`）。
- 內部網路互連：haoji 用 service name（`http://breeze-asr:8765`、`http://ollama:11434`）。
- 只對外暴露 `:8780`。
- `.env` 提供所有設定；附 `.env.example`。

## 7. Config env 化（要抽的寫死值）

| 現在寫死（檔案） | 新環境變數 | 容器內預設 |
|---|---|---|
| `FFMPEG/FFPROBE` winget 路徑 (config.py) | —（改用 PATH） | `ffmpeg` / `ffprobe` |
| asr.py 掃 IP 找 :8765 | `ASR_BASE_URL` | `http://breeze-asr:8765` |
| `OLLAMA_BASE` (config.py) | `OLLAMA_BASE_URL` | `http://ollama:11434` |
| `LLM_MODEL=gemma4:e4b-it-qat` | `LLM_MODEL` | 同左 |
| `WEB_PORT=8780` | `WEB_PORT` | 8780 |
| `DATA_DIR/UPLOAD_DIR/DB_PATH` | `DATA_DIR` | `/data`（volume） |
| Breeze `MODEL_PATH=C:\ai-models\breeze-asr` | `BREEZE_MODEL` | HF id 或 `/models/breeze-asr` |
| Breeze `HF_TOKEN` | `HF_TOKEN` | **僅 build 時需要**（預烤後執行不需） |

App 端：`Config.API_BASE` 從 Tailscale IP 改指到部署機的 `:8780`（app/lib/config.ts、iOS ATS、Android network_security_config 同步）。

## 8. 模型與資料策略
- **models volume**：Breeze（HF 拉，Apache）、pyannote（預烤，MIT）、gemma4（Ollama 拉）。模型不散在 image 裡 → image 精簡、首次啟動一次到位。
- **data volume**：SQLite（session/狀態/逐字稿/notes 暫存）+ 暫存音檔。**音檔轉錄完即刪**——無狀態容器 + 即刪讓「不存音檔」的隱私故事反而更乾淨。
- 交付時可選擇附「已下載好的 models volume 快照」讓對方完全離線起動。

## 9. 平台需求（交付前提，寫進部署文件）
- **OS**：Linux，或 Windows + WSL2。
- **GPU**：NVIDIA + 最新驅動 + **NVIDIA Container Toolkit**。
- **VRAM**：建議 **≥16GB**（Breeze ~5GB + gemma4 ~4GB + pyannote ~2GB 同時載）。
- Docker + Docker Compose v2。

> **軟體/硬體分工**：交付物（image）內含 CUDA toolkit + 模型 + 程式碼；**GPU 硬體與驅動由部署主機提供**，執行時由 NVIDIA Container Toolkit 接起來。所以 image 不綁特定 GPU 或特定機器——換任一張夠力的 NVIDIA GPU 皆可，不需要複製原開發機的環境。
>
> **常見故障**：若 `breeze-asr` / `ollama` 容器起得來但偵測不到 GPU，最常見原因是主機**沒裝 NVIDIA Container Toolkit**或**驅動過舊**——更新後即可（不是 image 的問題）。

## 10. 授權交付清單（商用散佈前確認）
| 元件 | 授權 | 商用/散佈 | 備註 |
|---|---|---|---|
| Breeze-ASR-25 | Apache 2.0 | ✅ | 附授權副本+標註 |
| Whisper-large-v2（base） | MIT | ✅ | |
| pyannote 3.1 / segmentation-3.0 | MIT | ✅ | 下載 gated，權重可預烤散佈；**gate 條款複核一次** |
| gemma4 | Gemma Terms | ✅ 有條件 | 遵守 Google 使用政策 |
| 好記後端碼 | （自有） | — | |

## 11. 分階段落地
- **P1**：`haoji-backend` + `ollama` 容器化，本機驗證跑通（ASR 先指回現有 :8765）。config env 化。
- **P2**：`breeze-asr` 容器化（含 pyannote 權重預烤、模型拉取），單獨驗證 `/transcribe_diarize`。
- **P3**：三服務整合成一份 compose，共享 GPU，端到端跑通。
- **P4**：**換一台乾淨 GPU 機器**做 `docker compose up` 驗證（含真實會議音檔的品質/速度回歸）。
- 全程保留本機現況當過渡備援，P4 通過才切換 App 指向。

## 12. 風險與待確認
- **Breeze 容器化的 CUDA/torch 版本相容**（P2 主要不確定性）——用 PyTorch 官方 cuda image 降風險。
- **pyannote gate 條款措辭**需人工複核一次（§5.4）。
- **模型下載體積/時間**（首次）——用 models volume + 可附快照緩解。
- **WSL2 GPU passthrough**（若對方用 Windows）比純 Linux 麻煩——文件標註建議純 Linux。
- gemma4 品質是否滿足交付對象——保留 provider 抽象，可換。

## 13. 驗證
- 單元測試：`python -m pytest`（維持現有）在容器內可跑。
- 端到端：乾淨機器 `docker compose up` → App 錄音 → 上傳 → 轉錄（含講者分離）→ 生繁中記錄，全綠。
- 回歸：同一批真實音檔，容器版 vs 本機版的逐字稿/講者/速度差異在可接受範圍。
