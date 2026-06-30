# 好記 — 錄音頁視覺升級（波形 + 呼吸燈）

- 日期：2026-06-30
- 狀態：APPROVED
- 目標：錄音時的 RecordScreen 更有生命感 —— 即時波形 + 錄音鍵呼吸燈,流暢 60fps。

## 設計

驅動來源：`useRecorder` 已提供 `meteringLevel`（0..1，expo-av metering，~150ms 一次）與 `state`。

- **Waveform 元件** `app/components/Waveform.tsx`
  - props：`level: number`（0..1）、`active: boolean`。
  - 維護一條最近 N 根（~48）音量歷史；每次 `level` 變動 push 進來、最舊的移除。
  - 渲染一排垂直長條（置中鏡像、紅 `#E5342B`），高度 = 該根歷史值。用 reanimated 對高度做平滑過渡 → 即使資料 ~7Hz 也看起來流暢、像滾動波形。
  - 誠實限制：expo-av 只給單一音量值（非頻譜），所以這是「音量歷史波形」，視覺上等同 iOS 語音備忘錄。
  - `active=false`（idle/暫停）時歸零、不更新。

- **BreathingRing 元件** `app/components/BreathingRing.tsx`
  - props：`active: boolean`、`level: number`。
  - 錄音鍵外圈一圈紅色光暈；reanimated `withRepeat(withTiming(...))` 做 scale 1→1.18→1 + opacity 0.35→0 的連續循環（~1.6s），像呼吸。
  - 光暈基礎強度再隨 `level` 微微加強（呼吸 + 收音雙重回饋）。
  - `active=false` 時停止、收起。

- **RecordScreen 組裝**：錄音中，計時器下方放 `Waveform`，錄音鍵底層放 `BreathingRing`。其餘邏輯（錄音/停止/中斷續接/上傳）不動。

## 技術

- `react-native-reanimated`（Expo SDK 內建，Expo Go + EAS 都支援）。需在 `app/babel.config.js` 加 `plugins: ['react-native-reanimated/plugin']`（必須是最後一個 plugin）。
- 動畫在 UI thread → 60fps。

## 測試

- 動畫本身在裝置/Expo Go 用眼睛驗證（無法有意義地單元測試）。
- 兩個元件各加一個 render 測試：給定 props 能正常 render、不 crash（reanimated 在 jest 用其內建 mock）。
- 跑完整 `npm test` 維持綠燈。

## 範圍外
- 真頻譜 FFT 波形（expo-av 給不到；要換更底層的錄音模組才行，不值得）。
