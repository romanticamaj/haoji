# 好記 Haoji — End-to-End Manual / Simulator Test Plan (2026-07)

Executable top-to-bottom by a human tester **or** the mobile MCP driver on an iOS simulator/device.
Covers the 4-screen redesign (audio player, meeting-list cards, transcript speaker-rename bottom
sheet, notes document). This **extends** `app/MANUAL-QA.md` — it does not repeat its device-only
smoke items; instead it adds structured, reproducible cases per feature area, with a dedicated,
detailed **Audio Player state** section for the reported cross-session/transport bugs.

## Conventions

- **Simulator caveats:** the iOS simulator has **no microphone** and cannot take a real phone call.
  Recording capture and the call-interruption → new-part flow are **device-only** (marked 📱). On the
  simulator, exercise these via seeded sessions / uploaded files instead.
- **Backend dependency:** transcription and AI notes require the GPU box reachable over Tailscale
  (`100.106.118.45:8780`) or LAN (`192.168.100.10:8780`). Cases needing it are marked 🖥. Cases that
  can run fully offline (list, player, rename persistence, paywall unlock) are marked 🔌.
- **Seeding:** to test list/player/results without the backend, pre-populate sessions via a memory
  store (`createMemoryStore`) or by completing one real recording/upload first, then reuse it.
- **Backend URL** comes from `.env` (`react-native-config`); default is the Tailscale IP.
- Each case: **ID · Preconditions · Steps · Expected**. Check the box when Expected is met exactly.

---

## A. Home / Meeting list (HomeScreen) 🔌

- [ ] **A1 — Empty state.**
  Pre: fresh install, zero sessions.
  Steps: launch app → land on Home.
  Expected: title 「好記」; NO 「N 場會議」 count; centered text 「還沒有錄音，點下面開始第一筆。」;
  a red 「＋ 新錄音」 button pinned at the bottom.

- [ ] **A2 — Meeting count.**
  Pre: ≥1 saved session.
  Steps: open Home.
  Expected: right of the title shows 「N 場會議」 with N = total session count.

- [ ] **A3 — Day grouping 今天 / 本週 / 更早.**
  Pre: seed 3 sessions with `createdAt` = now, 2 days ago, 10 days ago.
  Steps: open Home.
  Expected: three section headers in order 今天 → 本週 → 更早; each session under the correct header;
  empty groups are NOT rendered; within a group newest is first.

- [ ] **A4 — Relative-day boundary.**
  Pre: seed one session at yesterday 23:59 and one at today 00:01 (relative to `now`).
  Steps: open Home.
  Expected: the 23:59 one reads 「昨天 23:59」 (under 本週), the 00:01 one reads 「今天 00:01」 (under 今天)
  — grouping is by calendar day, not raw 24h.

- [ ] **A5 — Card meta line.**
  Pre: a transcribed multi-part session with named speakers.
  Steps: inspect a card.
  Expected: title (1 line, ellipsized) + 「›」 chevron; meta row 「<relativeDay> · mm:ss · N 位講者」.
  The 「mm:ss」 chip is **omitted** when total duration is 0 (uploaded parts carry `durationMs: 0`);
  the 「N 位講者」 chip is **omitted** when there is no transcript.

- [ ] **A6 — Avatar cluster + overflow.**
  Pre: a session with 4+ diarized speakers, some named some not.
  Steps: inspect the card footer.
  Expected: up to 3 overlapping colored avatars; named speaker → first char of the mapped name;
  unnamed → 1-based index (1/2/3), NOT the raw speaker code; if speakers > 3 a grey 「+K」 chip
  appears (K = speakers − 3). Avatar colors follow `speakerColor(i)`.

- [ ] **A7 — Status badges.**
  Pre: (a) transcript+notes, (b) transcript only, (c) neither.
  Steps: inspect each card's pills.
  Expected: (a) green ✓「逐字稿」 + green ✓「記錄」; (b) green ✓「逐字稿」 + grey 「未生成記錄」;
  (c) no pills.

- [ ] **A8 — Open a session.**
  Steps: tap a card.
  Expected: navigates to Results for that `sessionId` (player + tabs render).

- [ ] **A9 — Swipe-to-delete reveal.**
  Steps: on a card, swipe **left** horizontally (short vertical noise must NOT trigger it).
  Expected: a red 「刪除」 button is revealed on the right; the row snaps open past the halfway point
  and snaps closed if released before halfway. A vertical drag scrolls the list instead of opening.

- [ ] **A10 — Delete confirm + cancel.**
  Steps: open the swipe, tap 「刪除」 → in the alert tap 「取消」.
  Expected: alert titled 「刪除「<title>」」 with body 「刪除後無法復原…」; 取消 closes the alert and
  snaps the row shut; the session remains.

- [ ] **A11 — Delete confirm + delete.** 🔌
  Steps: open swipe → 「刪除」 → 「刪除」.
  Expected: the card disappears immediately; on returning to Home later it's still gone; the
  session's audio files + store entry are removed (free disk). Re-launching the app does not
  resurrect it.

- [ ] **A12 — 新錄音 entry.**
  Steps: tap 「＋ 新錄音」.
  Expected: navigates to Record; a new local session id is created.

- [ ] **A13 — Focus refresh.**
  Pre: on Home, then create/delete a session and navigate back.
  Steps: return to Home.
  Expected: the list re-fetches on focus (`useFocusEffect`) and reflects the change without a manual
  reload.

---

## B. Record (RecordScreen + useRecorder) 📱

> Simulator has no mic — B1–B7 require a real device. On the simulator verify only that the record
> button shows the 「啟動麥克風中…」 spinner then an error (no mic), and that the upload row is present.

- [ ] **B1 — Mic permission prompt.**
  Pre: first ever record, permission not yet granted.
  Steps: tap the big red circle.
  Expected: OS mic-permission prompt appears; on Allow, recording starts.

- [ ] **B2 — Permission denied path.**
  Pre: mic permission denied in Settings.
  Steps: tap record.
  Expected: red error 「沒有麥克風權限，請到「設定 > 好記」開啟麥克風後再試。」 plus a 「前往設定開啟麥克風」
  link that opens iOS Settings.

- [ ] **B3 — Start feedback.**
  Steps: tap record.
  Expected: button immediately shows a spinner ('starting' state) and 「啟動麥克風中…」 — the tap is
  never silently ignored; button is disabled while starting.

- [ ] **B4 — Recording UI.**
  Steps: while recording.
  Expected: timer counts up (mm:ss, tabular); button becomes a white circle with red square (stop);
  the Waveform reacts to voice level and the BreathingRing pulses; 「暫停」 button visible.

- [ ] **B5 — Pause / resume (same part).**
  Steps: 暫停 → speak → 繼續.
  Expected: 暫停 stops the meter/animation and shows 「繼續」; 繼續 resumes the SAME part (no new part
  created); timer continues.

- [ ] **B6 — Call interruption → new part.** 📱
  Pre: recording in progress.
  Steps: trigger a phone call or Siri to interrupt audio.
  Expected: the current part is finalized; the UI switches to 「錄音被中斷，要接著錄嗎？」 with 「繼續」/「結束」;
  tapping 繼續 starts a **new** part (parts.length increments); 結束 goes to Processing. Final
  transcript covers all parts.

- [ ] **B7 — Interruption resume failure.** 📱
  Pre: interrupted, mic still held by the call.
  Steps: tap 繼續 before the call fully ends.
  Expected: instead of hanging, an error surfaces via `recorderErrorMessage` and state returns to
  idle (retryable).

- [ ] **B8 — Stop → Processing.**
  Steps: stop a recording.
  Expected: parts persisted to the store, navigate (replace) to Processing with the same
  `sessionId`.

---

## C. Upload (RecordScreen import) 🔌 ingest / 🖥 processing

- [ ] **C1 — 從圖庫選影片 happy path.**
  Pre: Photos library has a downloaded video.
  Steps: with recorder idle, tap 「從圖庫選影片」 → pick a video.
  Expected: immediately after selection a full-screen spinner with 「讀取影片中…」 then 「準備中…」 shows
  (feedback while the picker copies the clip); then navigate to Processing. No blank frozen screen.

- [ ] **C2 — 圖庫 cancel.**
  Steps: open the video picker, cancel.
  Expected: busy screen clears, returns to the idle Record screen, no error.

- [ ] **C3 — 圖庫 iCloud-not-downloaded / unsupported.**
  Pre: a video that lives only in iCloud (not downloaded) or an unsupported format.
  Steps: pick it.
  Expected: error 「無法讀取這支影片，可能是 iCloud 尚未下載或格式不支援，請改用「從檔案上傳」。」 (or the
  picker's own message); busy screen clears; recorder stays idle.

- [ ] **C4 — 從檔案上傳音檔 happy path.**
  Pre: an `.m4a`/audio file in Files (On My iPhone / iCloud Drive).
  Steps: tap 「從檔案上傳音檔」 → pick the file.
  Expected: 「讀取檔案中…」 spinner; the file is copied locally (keepLocalCopy) then ingested; navigate
  to Processing. It must NOT hang on 上傳中 (security-scoped URI copied before nav).

- [ ] **C5 — 檔案 cancel.**
  Steps: open the file picker, dismiss it.
  Expected: silent return to idle Record, no error.

- [ ] **C6 — 檔案 copy failure.**
  Pre: force a copy failure if possible.
  Expected: error 「檔案複製失敗…」 / 「上傳失敗」; busy screen clears.

- [ ] **C7 — Upload part durations.**
  Pre: complete an upload → open Results.
  Expected: the uploaded session has one part with `durationMs: 0`; Home card omits the mm:ss chip;
  the player shows 「--:--」 for total until playback starts and reports a real duration.

---

## D. Processing / idempotency (ProcessingScreen) 🖥

- [ ] **D1 — Full pipeline.**
  Pre: a session with parts, backend up.
  Steps: reach Processing.
  Expected: messages progress 準備中… → 連線後端… → 上傳中… i/N → 開始辨識… → backend status messages →
  navigate (replace) to Results with a transcript.

- [ ] **D2 — No duplicate transcription (single mount).**
  Steps: watch the backend during one Processing run.
  Expected: the pipeline runs **at most once** per mount (`started` ref guard); exactly one backend
  session is created and one transcribe job submitted — no double upload.

- [ ] **D3 — Idempotent client id.**
  Steps: reach Processing, note the backend session, background/return so the effect could re-run.
  Expected: the same `backendId` is reused (persisted to the store after creation); a re-run maps to
  ONE server session (client_id idempotency key), not a duplicate.

- [ ] **D4 — Backend unreachable.**
  Pre: backend down / Tailscale off.
  Steps: reach Processing.
  Expected: error 「無法連線後端，請確認手機已連上 Tailscale／後端已啟動。」 with 「重試」 and 「返回」 buttons.

- [ ] **D5 — Upload failure.**
  Expected: error 「上傳失敗：…」; 重試 available.

- [ ] **D6 — Retry uses a fresh backend session (regen).**
  Steps: after an error, tap 「重試」.
  Expected: Processing re-mounts with `regen: true`; a brand-new backend session is created and parts
  re-uploaded (old server session's parts were deleted). No duplicate final session on the device
  (same local `sessionId`).

- [ ] **D7 — Backend status = error.**
  Pre: backend returns `status: 'error'`.
  Expected: the error message is shown; 重試/返回 offered; the existing local transcript (if any) is
  NOT overwritten.

- [ ] **D8 — Poll timeout resilience.**
  Steps: cause a transient poll failure.
  Expected: polling retries every ~1.5s and continues (no crash); on 「返回」 the polling loop is
  cancelled (`cancelled` ref) and does not navigate after unmount.

---

## E. Results tabs (ResultsScreen) 🔌

- [ ] **E1 — Tab switch.**
  Steps: in Results, tap 「逐字稿」 / 「AI 分析」.
  Expected: active tab has a red underline + red label; the other is grey; content swaps. Both
  panes stay mounted (`display: none`) so scroll position and player state persist across switches.

- [ ] **E2 — Player above tabs.**
  Expected: the RecordingsList (audio player card[s]) renders above the tab bar; one card per part.

- [ ] **E3 — Loading guard.**
  Pre: session still loading.
  Expected: a centered spinner until `store.get` resolves; no crash on missing session.

---

## F. Transcript tab (TranscriptTab) 🔌 / regenerate 🖥

- [ ] **F1 — Paragraph grouping.**
  Expected: consecutive same-speaker segments merge into one paragraph; each turn shows a speaker
  header + `mm:ss` start + body text.

- [ ] **F2 — Colored speaker chips.**
  Expected: each speaker's avatar/chip uses a stable color by its index in `transcript.speakers`
  (same hue everywhere for that speaker).

- [ ] **F3 — Unnamed dashed chip.**
  Pre: a speaker with no mapped name.
  Expected: a dashed-border brand-soft pill 「講者 N · 點一下命名」 with a pinkish avatar showing the
  1-based index.

- [ ] **F4 — Open rename sheet.**
  Steps: tap a speaker header/chip.
  Expected: a bottom sheet slides up: title 「命名這位講者」, sub 「名字會自動套用到整份逐字稿與會議記錄」,
  an autofocused text field prefilled with the current name, 「套用到這位講者的所有段落（N 處）」 where N =
  that speaker's turn count, and a 「完成」 CTA.

- [ ] **F5 — Rename commits + propagates in transcript.**
  Steps: type a name → 完成 (or keyboard done).
  Expected: sheet closes; EVERY paragraph by that speaker now shows a named avatar (first char of the
  name) + the name; the dashed unnamed chip is gone for all their turns.

- [ ] **F6 — Rename propagates into notes.** 🔌
  Pre: notes already generated referencing that speaker's task owner.
  Steps: rename the speaker, switch to AI 分析.
  Expected: task-owner avatars / any name references reflect the new name (names map is the single
  source; `OwnerAvatar` matches by mapped name).

- [ ] **F7 — Rename persists.** 🔌
  Steps: rename → go Home → reopen the session (and/or kill+relaunch app).
  Expected: the name persists (stored in `session.names`).

- [ ] **F8 — Rename cancel via scrim.**
  Steps: open the sheet, tap the dark scrim.
  Expected: sheet closes with NO change to the name.

- [ ] **F9 — Empty transcript regenerate.** 🖥
  Pre: a session whose transcription failed (0 segments) but has parts.
  Expected: 「還沒有逐字稿」 + hint 「這次辨識沒有完成…可以重新生成逐字稿再試一次。」 + 「重新生成逐字稿」 button.
  With no parts: hint 「找不到可辨識的錄音檔。」 and NO regenerate button.

- [ ] **F10 — Regenerate from footer.** 🖥
  Steps: with a transcript, scroll to the footer 「重新生成逐字稿」 → tap.
  Expected: navigates (replace) to Processing with `regen: true`; on success returns a fresh
  transcript; on failure the existing transcript/backendId are preserved (store untouched until
  success).

---

## G. Notes / AI 分析 (AnalysisTab) 🖥 generate / 🔌 unlock+copy

- [ ] **G1 — Generate gate (needs transcript).**
  Pre: no transcript, no notes.
  Expected: 「還沒有逐字稿。請先完成「逐字稿」，才能生成 AI 會議記錄。」 + 「前往逐字稿」 button that switches to the
  transcript tab.

- [ ] **G2 — Generate CTA + advanced model picker.**
  Pre: transcript exists, no notes.
  Expected: hint + 「生成會議記錄」 + 「進階」. Tapping 進階 lists available models (fetched via getModels);
  selecting one marks it ●; default model is the first when none selected.

- [ ] **G3 — Generate notes.**
  Steps: tap 「生成會議記錄」.
  Expected: spinner 「本機 LLM 生成中…」; on success a document renders. On failure, red error 「生成失敗」
  (or backend message) and the CTA remains.

- [ ] **G4 — Document layout.**
  Expected: `session.title` as doc title; a meta line (`notesMetaLine`); Markdown rendered with ##
  → small brand uppercase section labels, ### → ink sub-headings, bullets with grey dots.

- [ ] **G5 — 待辦 checklist rendering.**
  Pre: notes contain GFM task items 「- [ ]」/「- [x]」.
  Expected: each becomes a checklist row with a checkbox (green ✓ when done, strikethrough text);
  a trailing owner name renders a colored `OwnerAvatar` (colored by the owner's speaker index, else
  brand).

- [ ] **G6 — Paywall preview split.**
  Pre: notes with a 「## 會議摘要」 section, locked, not yet unlocked.
  Expected: everything up to & including 會議摘要 shows fully; the rest sits under a stacked
  gradient-fade with a 「🔒 解鎖完整會議記錄」 button. (If no 會議摘要 heading, first 3 non-empty lines are
  the preview.)

- [ ] **G7 — Unlock.** 🔌
  Steps: tap 「🔒 解鎖完整會議記錄」.
  Expected: full notes render (locked section revealed); the action row 「複製 Markdown / 複製純文字 /
  匯出」 appears. Unlock persists (`session.unlocked`) across Home round-trip and relaunch.

- [ ] **G8 — Copy Markdown.** 🔌
  Steps (unlocked): tap 「複製 Markdown」 → paste elsewhere.
  Expected: clipboard = the raw Markdown notes.

- [ ] **G9 — Copy 純文字.** 🔌
  Steps: tap 「複製純文字」 → paste.
  Expected: clipboard = `markdownToPlainText(notes)` (markdown stripped).

- [ ] **G10 — 匯出.** 🔌
  Steps: tap 「匯出」.
  Expected: the iOS share sheet opens for `會議記錄.md`; dismissing it does NOT crash; the temp file is
  cleaned up afterward.

---

## H. AUDIO PLAYER STATE (RecordingsList + usePlayer) — CRITICAL 🔌

> **Root-cause context for the tester.** `react-native-nitro-sound` is a **singleton native player**
> (one shared native instance). But each `PlayerRow` mounts its **own** `usePlayer()` hook with its
> own React state + `startedRef`. So (i) two player cards / two sessions' players fight over one native
> player, and (ii) `seek()` early-returns when `startedRef.current` is false (before play). These two
> facts are exactly what the reported bugs stem from. Test precisely; record the observed
> **playhead position, timecode text, and play/pause icon** for each step.

### H1 — Skip before play (Bug #1)

- [ ] **H1a — Skip-forward before ever pressing play.**
  Pre: open a single-part session, player at 0:00, icon ▶ (not playing), total known (or unknown).
  Steps: tap 「30」 (skip-forward) WITHOUT pressing play first.
  Expected: the timecode jumps to 0:30, the waveform playhead moves to the 0:30 position, and
  (per intended behavior) playback is ready to start from 0:30 on the next ▶.
  ⚠️ **Suspected current bug:** `seek()` no-ops because `startedRef.current` is false → timecode stays
  0:00 and the playhead doesn't move. FLAG if nothing moves.

- [ ] **H1b — Skip-back before play.**
  Steps: from 0:00 (or after H1a), tap 「15」 (skip-back).
  Expected: position clamps to 0:00 (never negative); timecode 0:00, playhead at far left.

- [ ] **H1c — Skip while paused (mid-clip).**
  Steps: play a few seconds → pause (icon ▶) → tap skip-forward.
  Expected: while paused the timecode + playhead advance by 30s immediately; pressing play resumes
  from the new position. FLAG if the skip is ignored until playing.

### H2 — Session switch carry-over (Bug #2 — 帶入別天的波形)

- [ ] **H2a — Play A, then open B.**
  Pre: two sessions A and B on different days, each with its own audio/duration.
  Steps: open A → play to ~0:20 (playhead mid-bar, icon ❚❚) → navigate Back to Home → open B.
  Expected: **B starts clean**: position 0:00, timecode 0:00 / B's own total, icon ▶ (not playing),
  waveform playhead at far left, NO highlighted "played" bars carried from A.
  ⚠️ FLAG if B shows A's position, A's playing state, or A's played-bar highlight (the singleton
  native player continuing under B).

- [ ] **H2b — Return to A after B.**
  Steps: from H2a, go Back → reopen A.
  Expected: A re-mounts fresh at 0:00 / ▶ (state is not globally persisted); playing A again works
  and controls B's card is not affected.

- [ ] **H2c — Rapid A↔B toggling.**
  Steps: play A, Back, open B, play B, Back, open A — a few cycles.
  Expected: no stuck 「❚❚」 on the wrong card, no audio from the previous session still playing after
  navigation, no frozen playhead. Only the currently-visible, currently-toggled card plays.

### H3 — Tap-and-drag seek sync (Bug #3)

- [ ] **H3a — Tap to seek.**
  Pre: total known (played once, or a part with a real duration).
  Steps: tap the waveform at ~75% width.
  Expected: playhead jumps to ~75%, timecode = ~75% of total immediately; if playing, audio
  continues from there; on release it does NOT snap back to 0:00.

- [ ] **H3b — Drag to seek.**
  Steps: press and drag the playhead left↔right across the bar.
  Expected: playhead + timecode follow the finger continuously (`dragMs` live feedback); on
  release the displayed position equals the audio position (no snap-back to 0). The played-bar
  coloring updates as you drag.

- [ ] **H3c — Seek gated when total unknown.**
  Pre: an uploaded part, never played (total = --:--).
  Steps: try to tap/drag the bar.
  Expected: no playhead is shown and pan is disabled (`totalKnown` false) — tap/drag is a no-op
  until playback establishes the duration. Document this as expected (not a bug), but note it as a
  UX gap if the tester finds it confusing.

- [ ] **H3d — Play/pause vs. displayed position stay in sync.**
  Steps: play → let it run 5s → pause → read timecode → play again.
  Expected: timecode is monotonic with audio; pausing freezes it at the true position; resuming
  continues from there; the icon toggles ▶↔❚❚ correctly on every press.

### H4 — Speed toggle

- [ ] **H4a — Cycle speed.**
  Steps: tap the speed button repeatedly.
  Expected: label cycles 1.0× → 1.5× → 2.0× → 1.0×.

- [ ] **H4b — Speed takes effect immediately while playing.**
  Steps: start playing at 1.0× → tap to 2.0×.
  Expected: audio audibly speeds up right away (setPlaybackSpeed on the active player); the
  timecode advances faster.

- [ ] **H4c — Speed set before play is applied on start.**
  Steps: from stopped, set 1.5× → press play.
  Expected: playback begins at 1.5× (speed applied on `startPlayer`).

### H5 — End / reset

- [ ] **H5a — Reaching the end resets.**
  Steps: play to the very end.
  Expected: at end the icon returns to ▶, position resets to 0:00, timecode 0:00, playhead far
  left; pressing play replays from the start.

### H6 — Multi-part sessions (one card per 段)

- [ ] **H6a — Independent cards.**
  Pre: a session with ≥2 parts (recorded with an interruption).
  Expected: each part renders its own card with a 「段 K」 header + its own duration (or --:--);
  each has independent transport.

- [ ] **H6b — No cross-update between parts.**
  Steps: play 段 1 to ~0:10.
  Expected: 段 1 shows ❚❚ + advancing playhead; 段 2 stays at 0:00 / ▶ with its playhead at 0.
  ⚠️ **Suspected shared-singleton bug:** pressing play on 段 2 while 段 1 plays may hijack the one
  native player — verify only one card actually plays and the other doesn't show a phantom moving
  playhead. FLAG any cross-updating of the two cards' positions/icons.

- [ ] **H6c — Switching parts stops the other.**
  Steps: play 段 1 → press play on 段 2.
  Expected: only one audio stream is audible; ideally 段 1 pauses/stops when 段 2 starts. FLAG if
  both play simultaneously or 段 1's icon stays ❚❚ while silent.

### H7 — Navigation stops audio

- [ ] **H7a — Back while playing.**
  Steps: play a session → navigate Back to Home.
  Expected: audio STOPS on unmount (`usePlayer` cleanup calls `unload` → `stopPlayer`); Home is
  silent. FLAG if audio keeps playing after leaving Results.

- [ ] **H7b — Tab switch keeps player alive but not double-playing.**
  Steps: play → switch 逐字稿↔AI 分析 (player stays mounted above the tabs).
  Expected: playback continues uninterrupted (panes use `display:none`, not unmount); the player is
  not reset by the tab switch.

- [ ] **H7c — Backgrounding the app.**
  Steps: play → send app to background → return.
  Expected: define/record actual behavior (pause vs. continue vs. reset). Note any mismatch between
  the on-screen icon/timecode and the true audio state after returning.

---

## I. Cross-cutting persistence & resilience 🔌

- [ ] **I1 — Kill + relaunch.**
  Steps: create sessions (record + upload), rename speakers, generate + unlock notes → force-quit →
  relaunch.
  Expected: all sessions listed on Home, fully readable offline; names, notes, unlock state, and raw
  parts (playable) all persist (device is the source of truth).

- [ ] **I2 — Relative part paths survive.**
  Pre: a session recorded on a prior build (or simulate a container-UUID change).
  Steps: open the session, play a part.
  Expected: audio still plays — parts are stored as relative paths and resolved against the current
  Documents dir (`resolvePartUri`), so a changed app-container UUID does not break playback.

- [ ] **I3 — Offline behavior.**
  Steps: with backend unreachable, browse Home, open a session, play audio, view transcript/notes,
  rename speakers, unlock.
  Expected: everything local works; only transcribe/analyze/regenerate require the backend and fail
  gracefully with clear zh-TW errors.

---

## Execution notes for the mobile MCP driver

- Prefer accessibility labels/testIDs where present: play button `play-<index>`, transcript speaker
  head `turn-head-<speaker>`, rename input `rename-input-<speaker>`, rename done
  `rename-done-<speaker>`, rename scrim `rename-scrim`, session row `session-<id>`, delete button
  `session-<id>-delete`. Player controls expose zh-TW `accessibilityLabel`s (播放/暫停/倒退 15 秒/
  快進 30 秒/播放速度 …/播放進度，可點擊或拖曳跳轉).
- For the player bugs (Section H) capture a screenshot at each step recording the **timecode text**,
  **playhead x-position**, and **play/pause icon** so regressions are provable.
- Skip 📱 cases on the simulator; run them on a device or TestFlight. Skip 🖥 cases when the GPU box
  is offline; run 🔌 cases anywhere.
