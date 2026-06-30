# Eject Haoji app from Expo to bare React Native

**Status:** DRAFT — approved design, pending implementation plan
**Date:** 2026-06-30
**Scope:** `app/` only. The `backend/` (FastAPI on the Windows GPU box) is untouched.

## Goal

Convert the Haoji app from Expo (SDK 54) to a standard `@react-native-community/cli`
("bare") React Native app that the team fully owns — no Expo abstraction layer — built
and shipped to TestFlight locally from the Mac via fastlane.

This is a **full eject**, chosen for full native control rather than to work around a
specific blocker. Device testing and TestFlight were already possible under Expo (the repo
has a prebuilt `ios/` and an `eas.json` with App Store Connect submit config); ejecting does
not unlock new capability, it removes the Expo layer by choice.

## Guiding principle: keep the seams stable

The app already isolates platform concerns behind three interfaces. Every Expo swap happens
*behind* these seams so screens and behavioral tests barely change:

- `RecorderApi` (`hooks/useRecorder.ts`) — recording lifecycle
- `SessionStore` (`lib/store.ts`) — local persistence (already Expo-free; no change)
- the `api.ts` wrappers — backend calls (already Expo-free; no change)

`RecorderApi`, `SessionStore`, and the `api.ts` signatures stay byte-for-byte identical.

## Blast radius

Only these source files import Expo directly:

- `index.ts` — `registerRootComponent` from `expo`
- `hooks/useRecorder.ts`, `hooks/usePlayer.ts` — `expo-av`
- `lib/recordings.ts` — `expo-file-system/legacy`
- `screens/AnalysisTab.tsx` — `expo-clipboard`, `expo-sharing`, `expo-file-system/legacy`
- `screens/RecordScreen.tsx` — `expo-document-picker`

Everything else (navigation, store, AsyncStorage, reanimated visuals, markdown rendering,
all screen logic) is already Expo-free and stays. The larger lift is the toolchain and
native projects, plus the audio swap.

## 1. Scaffold & versions

Init a fresh `@react-native-community/cli` project pinned to **React Native 0.81.5 /
React 19.1.0** (matching the current Expo SDK 54 pins, so `react-native-reanimated@4` and
`react-native-worklets` stay compatible — both require the New Architecture, which RN 0.81
enables by default). Bundle id stays `com.garyhsieh.haoji`; display name stays `好記`.

Approach: scaffold the clean project, port our TS source
(`screens/ components/ lib/ hooks/ App.tsx navigation.tsx assets/`) into it, and delete the
Expo shell (`app.json` Expo config, `eas.json`, `.expo/`, every `expo*` dependency,
`babel-preset-expo`, `jest-expo`).

## 2. Library swaps (behind the seams)

| Expo package | Bare-RN replacement | Files touched | Risk |
|---|---|---|---|
| `expo-file-system/legacy` | `react-native-fs` | `lib/recordings.ts`, `AnalysisTab.tsx` | low |
| `expo-clipboard` | `@react-native-clipboard/clipboard` | `AnalysisTab.tsx` | trivial |
| `expo-sharing` | `react-native-share` | `AnalysisTab.tsx` | trivial |
| `expo-document-picker` | `@react-native-documents/picker` | `RecordScreen.tsx` | low |
| `expo-av` | `react-native-nitro-sound` | `useRecorder.ts`, `usePlayer.ts` | **high** |
| `expo` (`registerRootComponent`) | `AppRegistry.registerComponent` in `index.js` | `index.ts` → `index.js` | trivial |
| `expo-status-bar` | RN `StatusBar` (or drop if unused) | — | trivial |
| `EXPO_PUBLIC_API_BASE` env | `react-native-config` (`.env` per scheme) | `lib/config.ts` | low |

`react-native-fs` notes: paths are plain filesystem paths; `lib/recordings.ts` and the
recorder/player/upload call sites must normalize `file://` prefixes consistently where RN
APIs require them. Map: `documentDirectory`→`DocumentDirectoryPath`, `makeDirectoryAsync`→
`mkdir`, `moveAsync`→`moveFile`, `deleteAsync`→`unlink`.

## 3. Audio swap — the high-risk item

`react-native-nitro-sound` covers recording-to-m4a, metering, pause/resume, and playback, so:

- metering callback → `Waveform` / `BreathingRing` level (maps to `meteringLevel`)
- manual pause/resume → `pause()` / `resume()`

**What it likely will not surface is the OS-interruption event** that the existing
`C1`/`I2` logic in `useRecorder` depends on: an interruption (incoming call, etc.) must
finalize the current part and start a **new** part on resume.

Plan: add a small `AVAudioSession` interruption observer — a ~30-line Swift native module
that emits an `audioInterruption` event — and wire it into the hook's existing
`onInterrupted()` path. The `RecorderApi` shape does not change; only the hook internals do.
This is the single highest-risk item and gets explicit device QA (a real phone call mid-
recording, then resume, verifying a new part is created).

If `react-native-nitro-sound` proves unable to deliver metering + pause/resume reliably on
device, the fallback is `react-native-audio-recorder-player` (same author, older
architecture); the design's seams make that substitution local to the two hooks.

## 4. Toolchain

- `babel.config.js`: `babel-preset-expo` → `@react-native/babel-preset`; keep
  `react-native-worklets/plugin` **last**.
- `metro.config.js`: add, using `@react-native/metro-config` `mergeConfig`.
- `jest.config.js`: `jest-expo` → `preset: 'react-native'`; update
  `transformIgnorePatterns` for the new native libs; **keep** `setupFilesAfterEnv` for
  `@testing-library/jest-native`.
- `jest-setup.js`: drop the AsyncStorage/expo mocks that came from jest-expo; add manual
  mocks for `react-native-nitro-sound`, `react-native-fs`,
  `@react-native-clipboard/clipboard`, `react-native-share`,
  `@react-native-documents/picker`; **keep** the `react-native-reanimated/mock` line and
  add the AsyncStorage mock explicitly (jest-expo previously provided it).
- `tsconfig.json`: extend `@react-native/typescript-config` instead of `expo/tsconfig.base`;
  keep `strict: true`.
- `index.js`: `AppRegistry.registerComponent(appName, () => App)` with `appName` from the
  RN-CLI `app.json` (`{ "name": "Haoji", "displayName": "好記" }`).

## 5. Native configuration (ported from `app.json`)

iOS `Info.plist`:
- `NSMicrophoneUsageDescription` = `好記需要麥克風來錄製會議音訊。`
- `UIBackgroundModes` = `[audio]`
- `NSAppTransportSecurity` exception for `100.106.118.45` (and `192.168.100.10`) allowing
  insecure HTTP loads.

Android `AndroidManifest.xml` + `res/xml/network_security_config.xml`:
- `RECORD_AUDIO` permission.
- A network security config permitting cleartext HTTP to `100.106.118.45` and
  `192.168.100.10` (Android blocks cleartext by default — the equivalent of the iOS ATS
  exception). Reference it via `android:networkSecurityConfig` on `<application>`.

`react-native-config` carries the backend base URL per scheme (Debug → LAN/Tailscale IP,
Release → Tailscale IP `http://100.106.118.45:8780`), replacing the old
`EXPO_PUBLIC_API_BASE` mechanism. `lib/config.ts` reads it via `react-native-config`.

## 6. TestFlight via fastlane

`ios/fastlane/` with:
- `Appfile`: `app_identifier "com.garyhsieh.haoji"`, `team_id "64N77Z6TV3"`.
- `Fastfile` `beta` lane: `build_app` (gym, archive) + `upload_to_testflight` (pilot),
  authenticating with the **App Store Connect API key** (key id `S4KA24P9A5`, issuer
  `efcfbd71-5d12-4d85-8efc-5cee020286d9`) via `app_store_connect_api_key`.
- Auto-increment the build number from `latest_testflight_build_number`.

Signing: **start with manual signing** — a one-time Xcode setup placing an Apple
Distribution certificate and an App Store provisioning profile for `com.garyhsieh.haoji` on
this Mac. `fastlane match` (cert/profile management via a private git repo) is noted as a
later upgrade, out of scope for the first pass.

Two carry-over flags:
- The `.p8` key path in `eas.json` is a **Windows** path
  (`C:/Users/.../Downloads/AuthKey_S4KA24P9A5.p8`). Builds run on the Mac, so the `.p8`
  must be placed locally on the Mac and **gitignored**; the Fastfile points at the Mac path.
- EAS previously held signing credentials in the cloud; the distribution cert + App Store
  profile must be provisioned locally once before the first `beta` run.

## 7. Testing strategy

- Keep all logic/behavior tests (parts grouping, gating, transcript, store, screens).
- Rewrite the module mocks for the swapped libraries; the behavioral `useRecorder` parts
  tests stay but their `expo-av` mock becomes a `react-native-nitro-sound` mock that can
  simulate the record-back listener and an interruption event.
- Update `MANUAL-QA.md`: replace "Expo Go" with "dev build / TestFlight"; add an explicit
  interruption case (phone call mid-record → resume → new part is created).

## 8. Sequencing (drives the implementation plan)

1. **Scaffold + toolchain + native config** — clean RN 0.81 project, ported screens,
   builds and runs on a real device with audio/picker temporarily stubbed.
2. **Trivial lib swaps** — `react-native-fs`, clipboard, share, document-picker; rewrite
   `lib/recordings.ts` and the `AnalysisTab`/`RecordScreen` call sites; fix their tests.
3. **Audio port** — `useRecorder`/`usePlayer` on `react-native-nitro-sound` + the
   `AVAudioSession` interruption native module; fix tests; device QA (including
   interruption).
4. **fastlane `beta` lane** — first remote TestFlight build from the Mac.
5. **Docs cleanup** — `CLAUDE.md`, `app/AGENTS.md`, `app/CLAUDE.md`, `README.md`,
   `backend/README.md` references updated to reflect bare RN; remove the Expo SDK 54/56
   guidance.

## 9. Out of scope

- Android distribution (Play Console / internal testing track).
- `fastlane match` shared signing repo.
- Any backend change.
- New product features — this is a platform migration with behavior parity as the bar.

## Acceptance criteria

- App contains **zero** `expo*` dependencies and no Expo config files.
- `npm test` passes with the `react-native` jest preset.
- App builds and runs on a real iOS device via the RN-CLI / Xcode toolchain (no Expo Go).
- Record → multi-part (incl. interruption) → upload → processing → results works on device,
  matching the pre-eject behavior in `MANUAL-QA.md`.
- `fastlane beta` produces a build visible in TestFlight, installable for remote testing.
