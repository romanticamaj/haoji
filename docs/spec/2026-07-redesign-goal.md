# 好記 App — Presentation-Level UI/UX Redesign

**Status:** approved (2026-07). **Goal:** ship the redesign to match the approved mockup, one
screen per TestFlight build, in order: 1) Audio player 2) Meeting list 3) Transcript
speaker-rename 4) Meeting-notes document.

**Visual reference (approved):** https://claude.ai/code/artifact/d1578923-cc30-49e9-8e28-9eb971669c4a

Work in `app/`; the **backend needs no changes**.

## Hard constraints

- Bare React Native 0.81.5 / React 19.1.0, New Arch ON. **No `expo*` packages.** Verify RN APIs
  against the RN 0.81 docs, not memory.
- Prefer core RN (PanResponder/Animated/Modal) over new native deps. **Do not add
  react-native-gesture-handler** (3.x is incompatible with RN 0.81). Any new native dep =
  `cd ios && pod install` (global cocoapods/fastlane, never `bundle exec` — system Ruby is 2.6)
  + rebuild, and update `jest-setup.js` / per-suite mocks.
- `lib/` stays UI-free and unit-tested. The device stays the source of truth (`store.ts`).
- Before every ship: `npx jest` all green **and** `npx tsc --noEmit` clean. Update/extend tests
  for anything changed; add tests for new pure logic.
- Ship each screen separately: `cd app/ios && fastlane beta` (auto-bumps build number). Commit the
  code, then commit the build-number bump. Use the repo's commit trailers (Co-Authored-By +
  Claude-Session, see recent `git log`).
- Do not regress: local-first recording, relative-path persistence (`resolvePartUri`),
  swipe-to-delete, upload idempotency (`client_id` + part index).

## Design tokens

Centralized in `app/lib/theme.ts`:

```
paper #F4F4F7 · card #FFFFFF · ink #16161A · ink-2 #6E6E76 · ink-3 #A2A2AC · hairline #EAEAEF
brand #E5342B (accent only) · brand-soft #FDECEA · good #1FA971 (semantic) · good-soft #E7F6EF
speaker palette (6): #2C6BED #12A150 #DE8500 #8256E0 #0E9AA5 #E5342B
```

Type: iOS system stack incl `"PingFang TC"`; `fontVariant: ['tabular-nums']` for all
times/durations. Cards: 16px radius, soft shadow, generous whitespace. Red used sparingly.

## Screen specs & acceptance

### 1) Audio player — `screens/RecordingsList.tsx` (+ `hooks/usePlayer.ts` as needed)
- Waveform-style progress bar; tap **and** drag to seek (`usePlayer` exposes `positionMs` +
  `seek(ms)`; source total duration from `part.durationMs` or the playback listener's `e.duration`).
- Transport: skip-back 15s, play/pause (large), skip-forward 30s; live "current / total" timecode;
  playback-speed toggle (1.0× / 1.5× / 2.0×) — verify nitro-sound's speed API first.
- Merge parts into one continuous timeline if feasible; else per-part rows each with a scrubber.
- **Accept:** can seek, ±skip works, timecode updates live, matches mockup.

### 2) Meeting list — `screens/HomeScreen.tsx`
- Card per session: title; relative time ("今天 14:30" / "週二") + duration (sum of part
  `durationMs`); speaker avatars (colored initials) + count; status badges derived from data
  (逐字稿 ✓ when `transcript.segments>0`, 記錄 ✓ when `notes` present). Group by 今天 / 本週 / 更早.
- Keep `SwipeRow` swipe-to-delete. Put relative-time + grouping + duration formatting in `lib/`
  with unit tests.
- **Accept:** cards match mockup, derivation correct, delete still works.

### 3) Transcript speaker-rename — `screens/TranscriptTab.tsx`
- Each turn shows a colored avatar chip + name; unnamed speakers show a dashed "點一下命名" chip.
  Tapping any speaker opens a bottom sheet (core RN `Modal`/`Animated`) to rename; the name
  (`session.names`) applies across the whole transcript **and** notes.
- Remove the old speaker-list + inline `TextInput` pattern.
- **Accept:** rename once → updates everywhere, unnamed clearly tappable, matches mockup.

### 4) Meeting-notes document — `screens/AnalysisTab.tsx`
- Render the notes markdown as a styled document: section headers (摘要 / 重點討論 / 決議事項 /
  待辦) with clear hierarchy (no emoji markers, no accent-bar-on-card cliché); 待辦 as a checklist
  with owner avatars where derivable. Replace the hard blur paywall with a tasteful gradient fade +
  unlock CTA (keep `gating.ts` `splitNotesForPreview` semantics). Keep copy-Markdown /
  copy-plain-text / export.
- **Accept:** reads like a document, paywall tasteful, copy/export intact.

## Process

For each screen: implement (using `lib/theme.ts`) → `npx jest` + `npx tsc --noEmit` green →
verify against the mockup → commit → `fastlane beta` → commit build bump → report the build number
and what to verify on-device. Then the next screen.
