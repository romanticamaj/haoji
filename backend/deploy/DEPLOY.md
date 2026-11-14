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

有兩種角色，走不同路：

**A. 拿到已建好 image 的部署方（一般情況，不需要任何 token）：**

```bash
docker load -i haoji-breeze-asr.tar   # 交付附帶的 image 檔
cd backend/deploy
cp .env.example .env                  # HF_TOKEN 留空即可
docker compose up -d                  # 不要加 --build
```

**B. 自行 build image 者（需要 HuggingFace token，僅 build 時用）：**

```bash
cd backend/deploy
cp .env.example .env                  # 填入 HF_TOKEN（pyannote 權重預烤用）
docker compose build                  # HF_TOKEN 經 BuildKit secret 傳入，不留在 image
docker compose up -d
# 交付給別人： docker save haoji-breeze-asr:latest -o haoji-breeze-asr.tar
```

- 首次啟動會自動下載模型到 volume（Breeze ~3GB、gemma4 ~1GB），依網速需 5–20 分鐘；
  之後啟動為秒級。`haoji-backend` 會等 `breeze-asr` healthy 才起（healthcheck 已涵蓋
  首次下載的等待期）。

### 驗證

```bash
curl -s http://127.0.0.1:7780/health          # {"status":"ok","service":"haoji-backend"}
curl -s http://127.0.0.1:7780/api/llm/models  # {"ok":true,"models":["gemma4:e4b-it-qat"],...}
curl -s http://127.0.0.1:7765/health          # 由容器網路內部可及；對外僅開 7780
```

端到端冒煙（合成音檔，驗流程通）：

```bash
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=3" -c:a aac /tmp/tone.m4a
SID=$(curl -s -X POST http://127.0.0.1:7780/api/sessions -H "Content-Type: application/json" \
      -d '{"client_id":"deploy-smoke-1"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['session_id'])")
curl -s -X POST "http://127.0.0.1:7780/api/sessions/$SID/parts" -F "file=@/tmp/tone.m4a"
curl -s -X POST "http://127.0.0.1:7780/api/sessions/$SID/transcribe"
sleep 30
curl -s "http://127.0.0.1:7780/api/sessions/$SID"    # 期望 "status":"done"（純音無語音，segments 可為空）
```

## 3. 連接手機與管理頁

1. 取得管理金鑰：`docker compose exec haoji-backend cat /data/admin_token`（或在 `.env` 設 `HAOJI_ADMIN_TOKEN`）。
2. 打開 `http://<部署機>:7780/console`，登入後「總覽」會列出還沒就緒的項目與怎麼處理。
3. 在 `.env` 設 `HAOJI_PUBLIC_URLS=http://<手機連得到的位址>:7780`（Tailscale／區網，可多個，第一個放進 QR code），
   重新 `docker compose up -d`。
4. 管理頁「配對手機」→ 用手機相機掃 QR code，好記會打開並連上。也可以在 App 的「設定 → 連接主機」手動輸入網址。
5. 手機都配對好後，建議設 `HAOJI_REQUIRE_TOKEN=1`：沒有配對碼的請求一律拒絕。

App 不再需要在編譯時寫死後端位址；`app/.env` 的 `API_BASE` 只是維護者自己 build 的預設值。

### 推播通知（逐字稿完成）

轉錄在伺服器上跑完時 App 通常已被 iOS 暫停，所以「逐字稿完成」由後端透過 APNs 推給手機。

1. 把 APNs 金鑰（`.p8`）放到 `backend/deploy/secrets/apns.p8`（已被 `.gitignore` 排除，勿提交）。
2. `.env` 設定 `APNS_KEY_ID`（金鑰 ID）與 `APNS_TEAM_ID`（`64N77Z6TV3`）。
3. `docker compose up -d --build`。轉錄結束後 log 會出現 `push sent`。

`APNS_KEY_ID` 留空＝不推播，其他功能照常。

## 4. 資料與隱私

- **音檔轉錄完即刪**（後端 `finally` 保證）；伺服器不保留任何錄音。
- `data` volume 只存 SQLite（session 狀態/逐字稿/記錄暫存）。
- 推播用的裝置 token 只在轉錄進行中保存，推送後立即清除。
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
