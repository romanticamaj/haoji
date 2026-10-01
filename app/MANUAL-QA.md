# 好記 App — Manual QA (dev build / TestFlight)

Jest covers logic + component behaviour with native modules mocked. The backend URL comes
from `.env` (`react-native-config`), defaulting to the Tailscale IP `100.106.118.45:7780`.

**Recording and call interruption are no longer on this list.** They run on a simulator:

```bash
npm run e2e:recording     # XCUITest drives the UI; ffprobe checks the audio on disk
```

Believing those needed a real device is what let a bug that silently discarded recordings survive
three TestFlight cycles. See `scripts/README-sim.md`. What is left below genuinely needs hardware.

- [ ] Mic permission prompt appears on first record.
- [ ] Big red button records; timer counts up; button shows stop (square) while recording.
- [ ] Pause then 繼續 resumes; level/animation responds to voice.
- [ ] **Interruption on real hardware:** take an actual phone call mid-record. The simulator posts
      the same system notification, but a real call also takes the audio hardware away — so this
      confirms the one thing `npm run e2e:recording` cannot: that 繼續 still works afterwards, and
      the transcript covers both sides of the call.
- [ ] Stop → uploads → Processing shows progress → Results opens.
- [ ] Upload 音檔/影片 picker works; same flow to Results.
- [ ] **Player (react-native-audio-waveform):** each part shows a real full-width waveform; ▶ plays,
      the played portion fills rose up to an accurate playhead, timecode tracks. Verified in sim:
      play/pause, playhead accuracy, one-at-a-time across parts, clean switch between sessions.
- [ ] **Player — needs REAL touch (sim can't replay native pans):** drag the waveform to scrub to any
      position → playback continues from there, no snap back to the head. ⏪15 / ⏩30 seek relative to
      the live position while playing. 1.0×/1.5×/2.0× changes speed live.
- [ ] Missing audio file → card shows "音檔不存在" instead of a dead player (delete a part file to test).
- [ ] 逐字稿 tab: paragraphs grouped by speaker. 講者 N/M opens one sheet listing every speaker with their speaking time; naming several at once persists after re-opening from Home.
- [ ] AI 分析 tab: 生成會議記錄 returns notes in Traditional Chinese, shown in full; 複製 copies; 匯出 opens share sheet.
- [ ] 重新分析 after naming the speakers → the new notes use the real names, and 版本紀錄 can revert to the old ones.
- [ ] Kill + reopen app → session still listed on Home and fully readable offline.
- [ ] **Push (needs a real device + the deployed backend with the APNs key):** first 生成逐字稿 asks for
      notification permission. Lock the phone → when transcription ends a 「逐字稿完成」 notification
      arrives; tapping it opens that meeting. A failed job sends 「逐字稿失敗」. Declining permission
      must not affect transcription.
