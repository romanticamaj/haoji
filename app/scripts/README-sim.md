# 在模擬器上重現測試情境

手動重建這些狀態很花時間，也容易漏掉；這裡把它變成一個指令。

```bash
./scripts/sim-setup.sh            # 建置(必要時) → 安裝 → 灌資料 → 啟動
./scripts/sim-setup.sh --rebuild  # 程式改過後強制重建
node scripts/seed-sim.mjs --list  # 看有哪些情境
node scripts/seed-sim.mjs --only=appended,broken   # 只灌特定情境
```

資料是**真的音檔**（用 ffmpeg 產生，16 kHz 單聲道 PCM，跟 App 錄音設定一致）加上對應的
AsyncStorage 紀錄。用假路徑的話，清單畫面會過，但一按播放或上傳就爆——而那正是過去出問題的地方。

## 情境與預期

| 情境 | 應該看到 |
|---|---|
| `fresh` | 「還沒有逐字稿」+ **生成逐字稿** 按鈕 |
| `analysed` | 逐字稿與會議記錄齊全；可編輯、複製、關鍵字取代、版本紀錄 |
| `appended` | 補錄後按**重新生成逐字稿 → 停在「分析中」**，不會立刻跳回結果頁 |
| `multipart` | 三段各一個播放器；點逐字稿可跨段跳轉；匯出可用 |
| `broken` | 「音檔無法播放」，並說明是舊格式中斷、無法修復 |
| `unclosed` | 開 App 後檔頭自動修好，**可以播放** |
| `orphan` | 只有檔案、沒有紀錄 → 列表出現「已復原的錄音（日期）」 |
| `longtitle` | 超長標題不撐爆版面；顯示「未生成記錄」 |

## 錄音與通話中斷：模擬器驗得到

一度以為這兩件事只能發 TestFlight 到真機測。**不是**——那個誤解讓一個把錄音洗掉的 bug
多花了三個發版週期才找到。實際上：

- **模擬器錄得到音**。走的是真的 `AVAudioRecorder`，寫出真的檔案（16 kHz 單聲道）。
- **通話中斷驗得到**。`ios/Haoji/E2EHooks.swift`（僅編譯進模擬器版本）會發出**真正的**
  `AVAudioSession.interruptionNotification`。中斷的「來源」是假的，之後的每一段都是正式流程。

```bash
npm run e2e:recording          # 建置 → 跑 XCUITest → 用 ffprobe 驗音檔
```

跑的是 **Release** 組態。Debug 版本的 JS 要跟 Metro 拿，沒開 packager 的話受測 App 只是一張錯誤畫面，
每個測試都會停在第一個點擊；Release 把 bundle 打包進去，而且就是實際出貨的組態。

這條指令有兩層斷言，缺一不可：

| 層 | 由誰驗 | 抓什麼 |
|---|---|---|
| 畫面 | `ios/HaojiUITests/RecordingInterruptionTests.swift` | 該暫停有沒有暫停、秒數有沒有歸零 |
| 音檔 | `scripts/e2e-recording.mjs`（ffprobe） | 磁碟上的秒數對不對、有沒有被覆蓋 |

**兩層都要**。被靜靜刪掉的錄音，畫面看起來完全正常；而畫面卡住不動時，檔案可能好端端在磁碟上。
先前那個 bug 三層原因的畫面症狀一模一樣（錄音中、秒數繼續跑），只有音檔能分辨誰對誰錯。

UI 測試用 Darwin notification 觸發中斷，因為 XCUITest 跑在自己的行程裡，沒有 simctl、沒有 shell，
也沒辦法叫受測 App 開 URL。手動要觸發的話：

```bash
xcrun simctl openurl booted "haoji://e2e/interrupt?type=began"
xcrun simctl openurl booted "haoji://e2e/interrupt?type=ended&resume=1"
xcrun simctl openurl booted "haoji://e2e/deactivate"   # 通話搶走音訊工作階段
```

第一次跑要手動點一次麥克風權限的「允許」。

## 仍然只能真機驗的

- **背景上傳**（滑掉 App 後繼續傳）：需要 iOS 背景 URLSession 的真實行為
- **拖曳排序的手感**：邏輯有單元測試，觸感仍需真機
- **真實來電**：模擬器發的是同一個系統通知，但真的通話還會搶走音訊硬體
