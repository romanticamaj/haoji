# 好記 Haoji v2 — UI fixes + recording robustness + TestFlight pipeline

- 日期：2026-06-29
- 狀態：DRAFT（待 review）
- 目標：把下列改動全部做完，並做到**可發 TestFlight 給使用者實機測試**的程度。

## 範圍總覽

三塊一起規劃、一起做：

- **A. UI 修正**（4 項，純 app 程式碼）
- **B. 錄音強化**（分段防丟失 + 可續接 + 背景錄音）+ 後端多段支援
- **C. Dev build → TestFlight pipeline**（EAS + Apple 憑證 + Tailscale API base）

IAP 真實付費**不在這輪**（解鎖維持 dev stub；真 IAP = 之後的 B3）。

---

## A. UI 修正

### A1. AI 分析狀態跨分頁保留
**問題：** 切到別的分頁時，AnalysisTab 被卸載，生成中的狀態與結果消失。
**做法：** ResultsScreen 同時掛載「逐字稿」與「AI 分析」兩個 tab，用 `display:'none'` 切換可見性（不卸載），元件本地狀態（生成中、notes）自然保留。生成出的 `notes` 仍照舊寫回 store，所以重開也在。

### A2. 講者改名 → 點擊式清單（取代擠在上面的 line editor）
**問題：** 目前一排小 TextInput 很難用。
**做法：** 在逐字稿 tab 頂部放一個**講者清單**，每個講者一列：左邊彩色圓點 + 「SPEAKER_00」代號 + 右邊目前名字（沒改過顯示淡灰提示「點此命名」）。**點該列 → 跳出一個簡單的命名輸入**（底部 sheet 或 inline 展開的大輸入框，自動聚焦鍵盤），輸入完即套用到該講者所有段落並寫回 store。觸控目標大、一次點一個、清楚對應哪個講者。

### A3. 所有原始錄音檔可在頁面看到
**做法：** 結果頁（或錄音/session 詳情）顯示該 session 的**錄音分段清單**：每段顯示序號 + 長度（mm:ss）+ 播放鍵（用既有 `usePlayer`，現在有真實本機 URI 了）。檔案存在手機上、不會被刪（除非刪 session）。

### A4. AI 分析 Markdown 漂亮渲染
**問題：** 目前 notes 是純文字 `<Text>`。
**做法：** 用 `react-native-markdown-display` 渲染會議記錄 Markdown（標題、粗體、清單、checkbox 待辦），套用紅色重點色的樣式。預覽段與解鎖後完整內容都用它渲染。

---

## B. 錄音強化（背景錄音 + 中斷可續接，不主動切段）

**設計原則（依使用者意見調整）：不做固定 60 秒切段，正常就連續錄一個檔；只有在「真的被中斷」時才產生新的一段。**

### 資料模型
一場錄音 = 一或多個 part：
```ts
type SavedSession = { ...; parts: { uri: string; durationMs: number }[]; ... }
```
part 檔存在 `FileSystem.documentDirectory + 'haoji/<sessionId>/part-<n>.m4a'`。**乾淨錄完通常只有 1 個 part**；被中斷才會 >1。

### B1. 背景 / 上鎖持續錄（需 dev/TestFlight build）
- `app.json` → `ios.infoPlist.UIBackgroundModes: ['audio']` + `NSMicrophoneUsageDescription`。
- `expo-av` audio mode：`allowsRecordingIOS:true, staysActiveInBackground:true, playsInSilentModeIOS:true`。
- app 推背景、手機上鎖 → 當前 part 持續錄、不中斷（Expo Go 不支援，僅 dev/TestFlight build 生效）。

### B2. 中斷可續接（來電等）
- 訂閱 expo-av 錄音狀態 / iOS audio-session 中斷事件。
- 被強制中斷時（來電…）→ **立刻把當前 part finalize 存檔**（中斷前全部保住），記下「被中斷」狀態。
- 回到 app → 提示「錄音中途被中斷，要接著錄嗎？」→ 按「繼續」開新 part 接續；按「結束」就以現有 parts 收尾。
- 手動暫停/繼續 → 用 expo-av pause/resume（同一 part，不切）。

### B3. 不丟失 + 誠實取捨
- 來電、上鎖、背景、手動暫停 → 都接得回、不丟。
- **唯一補不到**：整個 app crash / 被系統強殺（無中斷事件）→ expo-av 錄音檔要「停止」才寫完整，會丟掉「當下尚未停止的 part」。這是「不主動切段」的代價（錄音中被強殺機率很低）。預設不加固定切段；未來若需要可加「每 N 分鐘自動 finalize 保險」。

### 送分析流程
按「分析」→ app 依序上傳該 session 所有 parts → 後端 ffmpeg 串接 → ASR。

---

## C. 後端多段支援

現有 `POST /api/sessions` 收單一檔。改成支援多 part：
- `POST /api/sessions` → 建立空 session，回 `session_id`（不帶檔）。
- `POST /api/sessions/{id}/parts` → multipart 上傳一個 part，append（可多次呼叫；多數情況只呼叫 1 次）。
- `POST /api/sessions/{id}/transcribe` → ffmpeg **concat 所有 parts** → wav → Breeze ASR + 分離 → transcript（取代舊的背景 job 觸發）。
- `GET /api/sessions/{id}`、`POST /analyze` 不變。
- 後端的 part 暫存檔在 transcribe 完即刪（隱私）；**原始錄音保留在手機端**（給 A3）。

向後相容：保留舊單檔 `POST /api/sessions(file)` 或直接改掉（app 是唯一 client，可直接改）。決定：**直接改成多段流程**（app 同步改）。

---

## D. Native 設定 + EAS + TestFlight

### app.json
- `name: 好記`、`slug: haoji`、`ios.bundleIdentifier: com.haoji.app`（待你確認）、`ios.buildNumber`、`version`。
- `ios.infoPlist`：
  - `NSMicrophoneUsageDescription`（中文說明）
  - `UIBackgroundModes: ['audio']`
  - **`NSAppTransportSecurity`**：對 Tailscale 後端是 **http**（非 https），iOS ATS 預設擋明文 → 加例外允許 `100.106.118.45`（`NSExceptionDomains` 或針對該 IP 的例外），否則 TestFlight build 連不到後端。

### API base
- build 時 `EXPO_PUBLIC_API_BASE = http://100.106.118.45:8780`（Tailscale）。手機需裝 Tailscale 並登入同一 tailnet。

### EAS
- `eas.json`：一個 `preview`/`production` profile（internal distribution → TestFlight）。
- 簽章/上架憑證：用 **App Store Connect API key**（`AuthKey_S4KA24P9A5.p8`，Key ID `S4KA24P9A5`，**Issuer ID = 待你提供**），Team ID `64N77Z6TV3`。
- 流程：`eas build -p ios` → `eas submit -p ios`（上傳 App Store Connect）→ TestFlight 處理完 → 你（帳號持有人，自動是 internal tester）在 TestFlight app 安裝。
- TestFlight internal testing **不需要註冊裝置 UDID**（那是 ad-hoc 才要）。

### 需要你提供 / 你來操作（安全）
- **App Store Connect Issuer ID**（App Store Connect → Users and Access → Integrations → App Store Connect API → Issuer ID）。
- 確認 **bundle identifier**（建議 `com.haoji.app`）。
- 互動式登入步驟由你執行：`eas login`、任何 Apple 2FA。`.p8` 我只用路徑引用、不開啟內容。

---

## 不做 / 之後（YAGNI）

- 真實 IAP 付費（B3，RevenueCat）— 本輪解鎖維持 dev stub。
- 後端 server 端付費 gating。
- 後端上雲（先維持家裡機器 + Tailscale）。
- 逐字稿點段落跳播到「原影片」（影片已刪；用 A3 的分段播放替代）。

## 成功標準

- TestFlight 裝到你 iPhone，能：錄音（含背景持續、中斷可續接、分段不丟）→ 看到原始錄音分段清單 → 上傳分析 → 逐字稿（點擊式改講者名）→ AI 分析（漂亮 Markdown、切分頁狀態不丟）→ 解鎖（dev stub）。
- 全程透過 Tailscale 連家裡後端，離開家也能用。

## 已拍板 / 待拍板

- ✅ Issuer ID：`efcfbd71-5d12-4d85-8efc-5cee020286d9`，Key ID：`S4KA24P9A5`，Team：`64N77Z6TV3`。
- ✅ 錄音：不主動切段，連續錄 + 中斷才分 part（依使用者意見）。
- ⏳ bundle identifier（建議 `com.haoji.app`）— 待確認。
