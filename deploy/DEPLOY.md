# 好記 Haoji 後端 — 部署指南

本目錄是好記後端的**可部署單元**：三個容器（`haoji-backend` + `breeze-asr` + `ollama`）
用一份 `docker compose` 拉起，在任何一台有 NVIDIA GPU 的機器上提供完整服務：
錄音分段上傳 → 講者分離逐字稿（Breeze ASR + pyannote）→ 繁中會議記錄（Ollama gemma4）。

## 1. 主機前提

| 項目 | 要求 |
|---|---|
| OS | Linux（建議），或 Windows + WSL2 |
| GPU | NVIDIA，**VRAM ≥ 16GB**（Breeze ~5GB + gemma4 ~4GB + pyannote ~2GB 同時載入） |
| 驅動 | 新版 NVIDIA 驅動 |
| 容器 | Docker + Docker Compose v2 + **NVIDIA Container Toolkit** |

> **軟體/硬體分工**：交付物（image）內含 CUDA toolkit + 模型 + 程式碼；**GPU 硬體與驅動由
> 部署主機提供**，執行時由 NVIDIA Container Toolkit 接起來。所以 image 不綁特定 GPU 或特定
> 機器——換任一張夠力的 NVIDIA GPU 皆可，不需要複製原開發機的環境。
>
> **常見故障**：若 `breeze-asr` / `ollama` 容器起得來但偵測不到 GPU，最常見原因是主機
> **沒裝 NVIDIA Container Toolkit** 或**驅動過舊**——更新後即可（不是 image 的問題）。

## 2. 啟動步驟

```bash
cd deploy
cp .env.example .env        # 需要 build breeze-asr image 時，填入 HF_TOKEN（僅 build 用）
docker compose up -d --build
```

- **HF_TOKEN 只在 build `breeze-asr` image 時需要**（pyannote 權重預烤，經 BuildKit secret
  傳入，不會留在 image 裡）。拿到**已建好的 image** 的部署方完全不需要 token。
- 首次啟動會自動下載模型到 volume（Breeze ~3GB、gemma4 ~1GB），依網速需 5–20 分鐘；
  之後啟動為秒級。

### 驗證

```bash
curl -s http://127.0.0.1:8780/health          # {"status":"ok","service":"haoji-backend"}
curl -s http://127.0.0.1:8780/api/llm/models  # {"ok":true,"models":["gemma4:e4b-it-qat"],...}
curl -s http://127.0.0.1:8765/health          # 由容器網路內部可及；對外僅開 8780
```

端到端冒煙（合成音檔，驗流程通）：

```bash
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=3" -c:a aac /tmp/tone.m4a
SID=$(curl -s -X POST http://127.0.0.1:8780/api/sessions -H "Content-Type: application/json" \
      -d '{"client_id":"deploy-smoke-1"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['session_id'])")
curl -s -X POST "http://127.0.0.1:8780/api/sessions/$SID/parts" -F "file=@/tmp/tone.m4a"
curl -s -X POST "http://127.0.0.1:8780/api/sessions/$SID/transcribe"
sleep 30
curl -s "http://127.0.0.1:8780/api/sessions/$SID"    # 期望 "status":"done"（純音無語音，segments 可為空）
```

## 3. App 指向

把 App 的 `Config.API_BASE`（`app/lib/config.ts` / `.env` 的 `API_BASE`）指到
`http://<部署機>:8780`，並同步 iOS ATS 例外（`ios/Haoji/Info.plist`）與 Android
`network_security_config.xml` 的位址。

## 4. 資料與隱私

- **音檔轉錄完即刪**（後端 `finally` 保證）；伺服器不保留任何錄音。
- `data` volume 只存 SQLite（session 狀態/逐字稿/記錄暫存）。
- 清空重來：`docker compose down && docker volume rm haoji_data`。
- 模型 volume（`haoji_models-*`）可保留，重建不必重新下載。

## 5. 維運

```bash
docker compose logs -f haoji-backend    # 後端活動 log（session/上傳/轉錄/analyze）
docker compose ps                       # 三容器狀態
docker compose restart <service>        # 重啟單一服務
```

- 三個服務皆 `restart: unless-stopped`——當機/重開機自動恢復。
- 更新版本：`git pull && docker compose up -d --build`。

## 6. 授權

散佈/商用前請讀 [`LICENSES.md`](LICENSES.md)。
