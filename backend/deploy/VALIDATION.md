# 交付前驗證流程（乾淨 GPU 機器）

在一台**非開發機**的乾淨機器上，照本流程從零跑一遍。全部通過才算「可交付」。
每一步都有指令與預期結果；結果記錄在文末的表格。

> 執行者：＿＿＿＿　日期：＿＿＿＿　機器（GPU/驅動/OS）：＿＿＿＿＿＿＿＿

---

## Phase 0 — 主機前提

1. 確認 GPU 與驅動：
   ```bash
   nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
   ```
   預期：NVIDIA GPU、VRAM ≥ 16GB、新版驅動。
2. 安裝 Docker + Compose v2 + **NVIDIA Container Toolkit**（照各官方文件）。
3. 驗證容器看得到 GPU：
   ```bash
   docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu22.04 nvidia-smi
   ```
   預期：印出 GPU 資訊。若失敗 → Container Toolkit 沒裝好（見 DEPLOY.md 常見故障）。

## Phase 1 — 取得程式與 image

4. `git clone` 本 repo，checkout 本分支/版本；確認 `deploy/` 齊全。
5. 二選一：
   - **拿到交付 image**：`docker load -i haoji-breeze-asr.tar` → `.env` 的 HF_TOKEN **留空**。
   - **自行 build**：`.env` 填 HF_TOKEN → `cd backend/deploy && docker compose build`（預期 log 出現 `pyannote pre-baked`）。

## Phase 2 — 啟動

6. ```bash
   cd backend/deploy && cp .env.example .env   # 按 Phase 1 決定 HF_TOKEN 填/不填
   docker compose up -d                # 用交付 image 時「不要」加 --build
   ```
7. 首次啟動等模型下載（Breeze ~3GB、gemma4 ~1GB，5–20 分鐘）。觀察：
   ```bash
   docker compose logs -f breeze-asr   # 預期: [Download] ... -> [Loading] ... -> Uvicorn running
   docker compose ps                   # 預期: breeze-asr 從 (health: starting) 變 (healthy)
   ```
   預期：`haoji-backend` 會**等到 breeze-asr healthy 才起**（這是設計）。

## Phase 3 — 健康檢查

8. ```bash
   curl -s http://127.0.0.1:7780/health
   #  {"status":"ok","service":"haoji-backend"}
   curl -s http://127.0.0.1:7780/api/llm/models
   #  {"ok":true,"models":["gemma4:e4b-it-qat"],...}   （首次需等 pull 完）
   docker exec haoji-breeze-asr-1 python -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:7765/health').read().decode())"
   #  {"status":"ok","model":"breeze-asr-25","device":"cuda",...,"hf_token_set":false}
   ```
   關鍵確認：`device` 必須是 **cuda**（不是 cpu）；`hf_token_set:false` 仍能運作（權重預烤成功）。

> 💡 Phase 4–6 也可以不用 curl：瀏覽器開 `backend/deploy/test-ui.html`（file:// 直開即可），
> 它會跑完整 pipeline（上傳 → 轉錄進度 → 講者逐字稿 → 生成會議記錄）。

## Phase 4 — 端到端冒煙（合成音檔）

9. ```bash
   ffmpeg -y -f lavfi -i "sine=frequency=440:duration=3" -c:a aac /tmp/tone.m4a
   SID=$(curl -s -X POST http://127.0.0.1:7780/api/sessions -H "Content-Type: application/json" \
         -d '{"client_id":"validation-smoke"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['session_id'])")
   curl -s -X POST "http://127.0.0.1:7780/api/sessions/$SID/parts" -F "file=@/tmp/tone.m4a"
   curl -s -X POST "http://127.0.0.1:7780/api/sessions/$SID/transcribe"
   sleep 40 && curl -s "http://127.0.0.1:7780/api/sessions/$SID"
   ```
   預期：`"status":"done"`（純音無語音 → `segments` 為空是正確的；**不得是 error**）。

## Phase 5 — 真實音檔迴歸（品質把關）

10. 準備 2–3 段**真實會議錄音**（含多人對話；建議含一段 >10 分鐘）。
11. 每段用 Phase 4 相同流程跑（換 client_id），記錄：
    - 逐字稿內容抽查（專有名詞、數字是否正確）
    - `speakers` 數是否符合實際人數；講者切換點抽查
    - 總耗時（音檔長度 vs 處理時間）
12. `analyze` 生會議記錄：
    ```bash
    curl -s -X POST "http://127.0.0.1:7780/api/sessions/$SID/analyze" -H "Content-Type: application/json" -d '{}'
    ```
    預期：回繁中 Markdown 記錄；講者代號未被擅自替換成人名。
13. 與開發機（原生版）同音檔結果對照，差異在可接受範圍。
    ⚠️ 已知限制（兩邊一致）：**單一講者連續 >30 秒的長獨白只會轉出前 30 秒**（vendored 自原生版的既有行為，本次打包未改）。迴歸時確認容器版沒有**更差**即可。

## Phase 6 — App 實機

14. App 的 `Config.API_BASE` 指到 `http://<驗證機>:7780`（iOS ATS / Android network config 同步）。
15. 實機：錄音（含暫停/續錄多 part）→ 上傳 → 轉錄 → 講者改名 → 生成記錄 → 解鎖預覽。全流程通。

## Phase 7 — 韌性與隱私

16. **重開機**驗證機 → 預期三容器自動恢復（`restart: unless-stopped`），App 再打一次能用。
17. **音檔即刪**：跑完一次轉錄後——
    ```bash
    docker exec haoji-haoji-backend-1 ls /data/uploads/parts
    ```
    預期：空（無殘留音檔）。
18. **中斷韌性**：轉錄進行中 `docker compose restart breeze-asr` → 該筆 job 允許失敗，
    但服務恢復後**新 job 必須正常**（haoji 端有 3×5s 重試緩衝）。

---

## 結果記錄

| Phase | 項目 | 結果 (✅/❌) | 備註 |
|---|---|---|---|
| 0 | GPU/驅動/Toolkit | | |
| 1 | image 取得（load 或 build） | | token-less 路徑？ |
| 2 | compose up + healthy 閘門 | | 首啟耗時： |
| 3 | 三服務健康（cuda、token-less） | | |
| 4 | e2e 冒煙 done | | |
| 5 | 真實音檔迴歸 | | 音檔數/時長/耗時： |
| 5 | analyze 繁中記錄 | | |
| 6 | App 實機全流程 | | |
| 7 | 重開機自動恢復 | | |
| 7 | 音檔即刪 | | |
| 7 | 中斷後新 job 正常 | | |

**結論**：☐ 可交付　☐ 需修正（列問題）：
