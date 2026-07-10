# 好記 App — Manual QA (dev build / TestFlight)

Jest covers logic + component behaviour with native modules mocked. Recording, playback, and
call-interruption behaviour can only be verified on a **real device** — run a local dev build
(`npm run ios` on a connected device) or install the TestFlight build. The backend URL comes
from `.env` (`react-native-config`), defaulting to the Tailscale IP `100.106.118.45:8780`.

- [ ] Mic permission prompt appears on first record.
- [ ] Big red button records; timer counts up; button shows stop (square) while recording.
- [ ] Pause then 繼續 resumes; level/animation responds to voice.
- [ ] **Interruption:** take a phone call (or trigger Siri) mid-record → recording finalizes that
      part; on 繼續 a NEW part starts; final transcript still covers everything.
- [ ] Stop → uploads → Processing shows progress → Results opens.
- [ ] Upload 音檔/影片 picker works; same flow to Results.
- [ ] **Player (react-native-audio-waveform):** each part shows a real full-width waveform; ▶ plays,
      the played portion fills rose up to an accurate playhead, timecode tracks. Verified in sim:
      play/pause, playhead accuracy, one-at-a-time across parts, clean switch between sessions.
- [ ] **Player — needs REAL touch (sim can't replay native pans):** drag the waveform to scrub to any
      position → playback continues from there, no snap back to the head. ⏪15 / ⏩30 seek relative to
      the live position while playing. 1.0×/1.5×/2.0× changes speed live.
- [ ] Missing audio file → card shows "音檔不存在" instead of a dead player (delete a part file to test).
- [ ] 逐字稿 tab: paragraphs grouped by speaker; renaming a speaker updates all their lines and persists (re-open from Home).
- [ ] AI 分析 tab: 生成會議記錄 returns notes in Traditional Chinese; preview (摘要) visible, rest blurred + 解鎖 button.
- [ ] Tap 解鎖 → full notes show; 複製 copies; 匯出 opens share sheet.
- [ ] Kill + reopen app → session still listed on Home and fully readable offline.
