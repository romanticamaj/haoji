# 好記 App — Manual QA (Expo Go)

Jest covers logic + component behaviour with native modules mocked. Verify these on a real device / simulator (`npx expo start`, open in Expo Go). Set `EXPO_PUBLIC_API_BASE` to the dev machine's LAN/Tailscale IP:8780 so the phone reaches the backend.

- [ ] Mic permission prompt appears on first record.
- [ ] Big red button records; timer counts up; button shows stop (square) while recording.
- [ ] Pause then 繼續 resumes; level/animation responds to voice.
- [ ] Stop → uploads → Processing shows progress → Results opens.
- [ ] Upload 音檔/影片 picker works; same flow to Results.
- [ ] 逐字稿 tab: paragraphs grouped by speaker; renaming a speaker updates all their lines and persists (re-open from Home).
- [ ] AI 分析 tab: 生成會議記錄 returns notes in Traditional Chinese; preview (摘要) visible, rest blurred + 解鎖 button.
- [ ] Tap 解鎖 → full notes show; 複製 copies; 匯出 opens share sheet.
- [ ] Kill + reopen app → session still listed on Home and fully readable offline.
