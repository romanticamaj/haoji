# 好記 Haoji — MVP 設計規格

- 日期：2026-06-27
- 狀態：DRAFT（待 review）
- 產品名：**好記 Haoji**（handle: `haoji`）

---

## 一句話

不綁帳號的繁體中文會議錄音工具：錄音/上傳 → 逐字稿（含講者分離）→ AI 會議記錄，結果存在使用者手機上；逐字稿免費、AI 會議記錄預覽免費、解鎖完整付費。原生 iOS / Android。

## 產品論點 / 楔子

大廠（Otter、Fireflies、Granola、tl;dv、Fathom）英文優先，繁中與台灣口音、專有名詞常常爛，而且都要綁帳號。好記的差異化來自三點：

1. **繁體中文 / 台灣準確度** — ASR 用 Breeze（聯發科台灣模型），會議記錄用本機 LLM 生成繁中（OpenCC s2tw 收尾）。
2. **不綁帳號、不留資料** — 沒有註冊/登入，結果只存使用者手機，音檔處理完即刪。
3. **死簡單的 UX** — 一顆大紅錄音鍵 + 即時訊號；結束就「分析」。

（來源：先前 POC 已驗證 ASR + 講者分離 + 本機 LLM 會議記錄可行；office-hours 收斂出上述楔子。）

## 目標使用者

需要把會議/訪談/上課內容變成繁中逐字稿與會議記錄、又不想為了一次性需求註冊帳號或把敏感內容丟給雲端 SaaS 的台灣使用者。

## 範圍

### MVP 要做
- 錄音（大紅鍵、即時波形、暫停/繼續）
- 上傳本機音檔或影片
- 上傳到後端做 ASR + 講者分離，回傳逐字稿（Speaker + 時間戳）
- 使用者可編輯 Speaker 名稱
- LLM 分析產生繁中會議記錄（摘要 / 重點 / 決議 / 待辦…）
- 結果頁 Tab 切「逐字稿 / AI 分析」
- AI 會議記錄：預覽（露摘要前幾行）+ 其餘模糊鎖住 → 一鍵 IAP 解鎖完整
- 解鎖後可複製 / 匯出（逐字檔 + 會議記錄）
- 結果存本機，離線可重看

### MVP 不做（YAGNI）
- 帳號 / 登入 / 雲端同步
- 即時逐字稿（錄音當下即時轉）— 先做錄完再分析
- 多人協作 / 分享連結
- 背景錄音、跨裝置
- 自訂 prompt / 人格（之後再說）

## 使用流程（對應 moodboard）

詳見 `design/moodboard/`：

1. **錄音頁**：正中大紅圓「開始錄音」+ 即時紅色波形；下方暫停/停止/播放；底部「上傳音檔/影片」。
2. **錄音完成**：紅圈顯示「錄音已完成」→ 大紅「開始分析」→ 音檔上傳後端、輪詢進度。
3. **逐字稿頁**：頂部 Tab「逐字稿 / AI 分析」。逐字稿分 Speaker（可改名）+ 時間戳，底部紅色迷你播放列；點段落跳播。
4. **AI 分析頁**：會議記錄。未解鎖時露摘要前幾行、其餘模糊 + 解鎖鍵；解鎖後完整顯示 + 複製 / 匯出。

設計語言：白底 + 紅色重點色、iOS 原生質感、大量留白、極簡。

## 架構

### App（前端）— Expo / React Native
- 跨 iOS/Android，單人開發最快。
- 錄音：`expo-av`（支援暫停/繼續），錄成壓縮音檔（m4a/aac）。
- 本機儲存：SQLite（`expo-sqlite`）存 session（音檔路徑、逐字稿、會議記錄、解鎖狀態、Speaker 命名）；大檔放 app 檔案系統。
- 狀態：每個錄音 = 一個 session，列表可回看。

### 後端（分析服務）
沿用已驗證的 pipeline（ffmpeg → Breeze ASR `:8765` + 講者分離 → 正規化 → LLM → OpenCC），包成 mobile-facing API：

- `POST /api/sessions`（multipart 音檔/影片）→ 回 `session_id`，背景開始處理
- `GET /api/sessions/{id}` → 進度 + 完成後的逐字稿（segments：start/end/speaker/text）
- `POST /api/sessions/{id}/analyze` → body 帶（可選）`model`、編輯後的 speaker 名稱 → 回會議記錄 Markdown
- 音檔處理完即刪，不長期保存。
- 部署：先跑開發者本機這台（manager 管理的小服務），之後上雲 scale（GPU 機）。

### LLM provider 抽象層
後端一個 `LLMProvider` 介面（`generate_meeting_notes(transcript, model) -> markdown`）：
- 現接 **Ollama**（預設 `gemma4:e4b-it-qat`，繁中、num_ctx 依長度調、thinking on、OpenCC 收尾）。
- 之後可加 OpenAI / Claude provider。
- App 端「選模型」下拉預設隱藏，展開才顯示可選 model id；預設不讓使用者選。

### 金流 — RevenueCat
- 包 StoreKit（iOS）+ Google Play Billing（Android），用匿名 app user id，**免帳號就能賣**。
- 商品：**consumable**「解鎖這份分析」。
- 解鎖狀態存本機 session；RevenueCat 負責收據驗證。

## 付費模式

- **預覽 + 解鎖完整**：逐字稿免費；AI 會議記錄露摘要前幾行、其餘模糊鎖住；一鍵購買解鎖該份完整內容 + 匯出。
- 商品型態：consumable IAP（每份分析一次性購買）。
- **初始定價：NT$60 / 份（可調）**；可考慮「首份免費」降低嘗試門檻，上線後依轉換調整。

### ⚠️ 平台政策（重要）
- iOS 解鎖 app 內數位內容**必須走 In-App Purchase（StoreKit）**，不能用 Apple Pay，也不能用 Line Pay（違反 App Store guideline 3.1.1，會被退件，Apple 抽 15–30%）。
- Android 同理走 Google Play Billing。
- 因此 MVP 金流 = IAP（透過 RevenueCat），**不是** Apple Pay / Line Pay。IAP 的購買視窗 + Face ID 一樣是「一鍵付」，UX 仍然超簡單。

## 隱私定位（誠實版）

不是「音檔不出手機」（分析需送後端處理），而是：**不綁帳號、不保存你的音檔（處理完即刪）、結果只存你手機**。對外訊息要照這個寫，避免「傳給我也是雲」的自打臉。

## 成功標準（MVP）

- 能在手機上：錄音/上傳 → 拿到繁中逐字稿 → 改講者名 → 生成會議記錄 → 解鎖付費 → 複製/匯出，全程不需註冊。
- 逐字稿與會議記錄存本機、離線可重看。
- 至少跑通一筆真實付費（IAP sandbox → 正式）。

## 待拍板 / 後續

- 定價最終值（先用 NT$60，上線後調）。
- 後端上雲時機與 GPU 機規格（MVP 先本機）。
- 之後：即時逐字稿、分享、自訂分析模板。

## 相關檔案

- `design/moodboard/01-record-upload-flow.png`、`02-transcript-results-flow.png`
- `docs/product-discussion.md`（決策過程與楔子）
