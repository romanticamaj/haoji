# 好記 — KEEPLACE-style UI renovation

**Status:** requested by the owner (2026-10-29). This supersedes the 2026-07 "Dusty Rose" tokens in
`2026-07-redesign-goal.md`. Behaviour from that spec stays (seek/skip, grouping, rename sheet,
notes document); only the look, icons and wording change.

**Goal:** make 好記 look, read and behave like the owner's app **留著 KEEPLACE** (`~/keeplace`).
That covers the palette, type, spacing, components, icons, logo/app icon and wording.

**Guideline (read first):** `design/keeplace-style/GUIDELINE.md`. It comes with:
- the references in `design/keeplace-style/references/` (the real KEEPLACE screenshots are the ground truth);
- a drop-in token file, `design/keeplace-style/theme.ts`;
- generated app icons in `design/keeplace-style/brand/out/`.

The KEEPLACE source can be read for exact implementations: `~/keeplace/src/components/*`, `~/keeplace/src/theme/tokens.ts`.
**Do not edit `~/keeplace`.**

## Hard constraints (unchanged from the repo contract)

- **Platform:** bare React Native 0.81.5 / React 19.1.0, New Arch ON.
  - No `expo*` packages.
  - No `react-native-gesture-handler`.
  - `lucide-react-native` is allowed: it is JS-only on the existing `react-native-svg`, so no pod change. Add the Jest mapping described in GUIDELINE §6.
- **No regressions:** `lib/` stays UI-free and unit-tested. Do not regress local-first recording, relative-path persistence, swipe-to-delete, upload idempotency, the interruption handling, or push.
- **Before every ship:** `npx jest` green and `npx tsc --noEmit` clean. Update tests that assert old strings or colours. Do not delete those tests.
- **Ship:** `cd app/ios && fastlane beta`. Commit the code, then commit the build bump, using the repo's commit trailers.

## Order (one TestFlight build per step unless trivial)

1. **Foundation.**
   - Replace `app/lib/theme.ts` with `design/keeplace-style/theme.ts`; the aliases keep everything compiling.
   - Add `AppText`.
   - Restyle the native stack header (ivory, no shadow).
   - Install the new app icon and launch screen: iOS from `brand/out/`, Android mipmaps from the adaptive layers.
   - Swap `components/icons.tsx` to Lucide, or restroke it to 1.8.
2. **Home.**
   - Brand header (好記 HAOJI + tagline, round search button).
   - Outlined meeting cards with an inline icon+text status.
   - `section` group headers.
   - Bottom bar with the centre **記下來** mic action and 匯入.
   - Empty state.
   - Keep swipe-to-delete. Soft-delete + 復原 snackbar is a *should*.
3. **Record + Review + ImportConfirm.**
   - Sage record/stop.
   - Peach "recording" dot only.
   - Restyled BreathingRing/Waveform, with Reduce Motion respected.
   - Sticky primary CTA.
4. **Results.**
   - Underline tabs 逐字稿 / 會議記錄.
   - Player in the new style.
   - Transcript avatars and the unnamed-speaker chip.
   - OptionSheet-style rename/keyword sheets.
   - Notes rendered as a document with a Lucide checklist.
   - Outline secondary buttons for copy/export.
   - DangerButton for delete.
5. **Processing + wording pass.**
   - Processing becomes an EmptyState-like progress view.
   - Apply GUIDELINE §5 to every string, starting with the §5.1 table.
   - Grep `screens/ components/ App.tsx` for 「LLM」「後端」「！」「您」「確定」 and emoji.
6. **Cleanup.**
   - Migrate call sites from the alias keys (`paper/ink/brand/…`) to the semantic tokens.
   - Delete the aliases and `cardShadow`.
   - Ensure no hex literals remain in screens or components.

## Acceptance (per step)

- Side-by-side with `references/screens/keeplace_ios_*.png`, a reader would say it is the same design family:
  - ivory canvas;
  - 1px outlines and no shadows;
  - radius 18;
  - sage single primary;
  - muted 12pt meta;
  - tracked Latin wordmark.
- No red or rose, no emoji, no pure white canvas.
- Simulator screenshots with no personal data are committed under `app/qa/screenshots/keeplace-style/` (or the repo's existing QA folder).
- Accessibility labels on every control. Empty, loading, error and permission states exist.
- Report the build number and what to check on device.

## Open for the owner

- **Tagline.** The default is 「把說過的話，好好記下來。」; alternatives are in GUIDELINE §4. It changes in one place (`brand.tagline`).
- **Icon mark.** The default is a speech bubble plus waveform seed. Regenerate with `make_icons.py` if the owner wants a different seed.
