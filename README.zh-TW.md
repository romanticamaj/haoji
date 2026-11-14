<p align="center">
  <img src="design/keeplace-style/brand/out/icon-180.png" width="88" alt="好記 Haoji" />
</p>

<h1 align="center">好記 Haoji</h1>

<p align="center"><b>把說過的話，好好記下來。</b><br/>
錄音 → 分講者的繁中逐字稿 → 會議記錄。不用帳號，不經過雲端：資料在你的手機，處理在你自己的主機。</p>

<p align="center"><a href="README.md">English</a> · <a href="#快速開始">快速開始</a> · <a href="#設定">設定</a> · <a href="CONTRIBUTING.md">參與開發</a></p>

---

## 為什麼

一般的會議 App 會把你的對話傳到別人的伺服器。好記不會。**手機**負責錄音，也保存所有結果：錄音、逐字稿、會議記錄和講者名字。**你自己的主機**（任何一台有 NVIDIA GPU 的 Linux）負責處理：用 [Breeze ASR 25](https://huggingface.co/MediaTek-Research/Breeze-ASR-25) 加 pyannote 產生分講者的逐字稿，再透過 Ollama 用本機模型寫會議記錄。處理完，音檔就刪除。

- 🎙 **隨時能錄**：錄音不需要主機。可以暫停、繼續，接電話也不會中斷，之後再處理。
- 🗣 **誰說了什麼**：自動分出講者，命名一次就好。點一下段落，就從那裡開始播放。
- 📝 **不只是逐字稿**：會議記錄整理出目的、決策，以及依負責人列出的待辦。
- 🔒 **屬於你**：不用帳號，結果存在手機上。主機不保留它用不到的東西。
- 🖥 **完整的管理頁**：可以看主機狀態和 GPU、管理模型、連線 Ollama、查看工作，並用 QR code 配對手機。

## 快速開始

**你需要準備：**
- Linux（或 Windows + WSL2）。
- NVIDIA GPU，VRAM **至少 16 GB**。
- Docker + Compose v2，以及 NVIDIA Container Toolkit。
- Hugging Face token。只有建置語音辨識 image 時會用到，用來下載 pyannote。

```bash
git clone https://github.com/romanticamaj/haoji && cd haoji/backend/deploy
cp .env.example .env            # 填 HF_TOKEN，以及 HAOJI_PUBLIC_URLS=http://<主機IP>:7780
docker compose up -d --build    # 第一次啟動會下載約 4 GB 的模型（5–20 分鐘）
docker compose exec haoji-backend cat /data/admin_token
```

1. 打開 **`http://<主機>:7780/console`**，貼上管理金鑰登入。在語音辨識、Ollama 和會議記錄模型都就緒之前，總覽頁會列出還沒完成的步驟。
2. 到 **配對手機**，用手機相機掃描 QR code，好記會自動打開並連上主機。
3. 開始錄音。

手機可以透過區網、VPN 或 Tailscale 連到主機（`tailscale serve` 可以加上 HTTPS）。**不要把連接埠直接開到網際網路上**，原因見 [SECURITY.md](SECURITY.md)。完整部署說明（預先建好的 image、推播、疑難排解）在 [backend/deploy/DEPLOY.md](backend/deploy/DEPLOY.md)。

## 設定

設定寫在 `backend/deploy/.env`，完整表格見 [README.md › Configuration](README.md#configuration)。常用的有：

- `LLM_MODEL`：會議記錄用的模型。也可以在管理頁切換。
- `LLM_PROVIDER=openai`：改用任何 OpenAI 相容的 API，就不需要 ollama 容器，GPU 需求大約少一半。
- `HAOJI_REQUIRE_TOKEN=1`：手機配對好之後建議開啟。開啟後，只有掃過 QR code 的手機能使用主機。
- `HAOJI_RETENTION_HOURS`：處理完的逐字稿在主機上留多久，預設 24 小時。設為 `0` 表示手機取回後就刪除。

## 自己建置 App

```bash
cd app && npm ci
npm run pods && npm run ios       # 或 npm run android
```

## 授權

本專案採用 [MIT](LICENSE) 授權。模型與第三方元件各自適用原本的授權，見 [backend/deploy/LICENSES.md](backend/deploy/LICENSES.md)。
