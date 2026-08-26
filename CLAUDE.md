# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

好記 Haoji — an account-free Traditional-Chinese meeting recorder. Record/upload audio → diarized transcript (speaker separation) → AI meeting notes. Results live only on the user's phone; no audio is retained server-side. Free transcript + free notes preview; full notes unlock via IAP.

Two independently-deployed pieces, in one repo:

- `app/` — bare React Native client (`@react-native-community/cli`, **not Expo**), native iOS + Android. Developed on Mac, shipped to TestFlight via fastlane.
- `backend/` — FastAPI service, deployed as a **Docker Compose unit** (`backend/deploy`: `haoji-backend` + `breeze-asr` + `ollama`) on a machine with an NVIDIA GPU (Breeze ASR + Ollama need it). The app reaches it over Tailscale (`http://100.106.118.45:7780`) or same-WiFi LAN (`http://192.168.100.10:7780`). Do not run the backend on the Mac.

## Bare React Native discipline

The app was ejected from Expo (see `docs/plans/2026-06-30-eject-expo-to-bare-rn.md`) — **no `expo*` packages**. Pinned to **RN 0.81.5 / React 19.1.0**, New Architecture on. Verify RN APIs against the RN 0.81 docs, not memory. Version-pinned workarounds carry inline comments: reanimated v4 + `react-native-worklets/plugin` (must be last), the `RCTEventEmitter`+`DeviceEventEmitter` interruption module (New-Arch safe), the `file://`↔bare-path convention in `lib/recordings.ts`, and `jest-setup.js` mocking native modules (async-storage/reanimated/config/fs). System Ruby is 2.6, so run `pod`/`fastlane` **globally**, never via `bundle exec`.

## Commands

App (`cd app`):
```
npm install                              # legacy-peer-deps (see .npmrc)
npm start                                # Metro
npm run ios                              # build+run on device/simulator
npm run pods                             # cd ios && pod install (after native dep changes)
npm test                                 # jest (react-native preset)
npx jest path/to/file.test.tsx          # single file
npx jest -t "test name substring"       # single test
npm run e2e:recording                    # recording + call interruption on a simulator
cd ios && fastlane beta                  # archive + sign + upload to TestFlight (ASC API key)
```

Backend — deploy (`cd backend/deploy`, on the GPU machine; full guide in `backend/deploy/DEPLOY.md`):
```
docker compose up -d                        # bring up all three containers
docker compose ps                           # status (all restart: unless-stopped)
docker compose logs -f haoji-backend        # backend log
docker compose restart haoji-backend        # restart one service
git pull && docker compose up -d --build    # update
```
Only `haoji-backend` is published to the host, on **:7780**.

Backend — editing/testing the FastAPI code (`cd backend`, no GPU needed for tests):
```
pip install -r requirements.txt
python app.py            # serves on 0.0.0.0:${WEB_PORT:-7780}
python -m pytest -q
python -m pytest tests/test_parts.py -q  # single file
```

`react-native-config` (`.env` → `Config.API_BASE`) selects the backend URL, read in `app/lib/config.ts` (fallback = Tailscale IP so TestFlight works without `.env` wiring). The iOS ATS exception (`ios/Haoji/Info.plist`) and Android `network_security_config.xml` are pinned to the Tailscale + LAN IPs — keep them in sync if those change. Signing/TestFlight config lives in `ios/fastlane/`.

## Backend architecture (v2 "parts" flow)

The pipeline is split so the phone uploads recording **parts** incrementally, then triggers processing once:

1. `POST /api/sessions` → creates a draft session (SQLite, `sessions.py`).
2. `POST /api/sessions/{id}/parts` (multipart) → appends one `.m4a` part to disk; called once per part.
3. `POST /api/sessions/{id}/transcribe` → submits a background job (`ThreadPoolExecutor`, max 2 workers): ffmpeg concats all parts to 16 kHz mono WAV (`media.py`) → Breeze ASR diarized transcription (`asr.py`) → normalized JSON stored on the session. **Parts and the WAV are deleted in `finally`** — nothing is retained.
4. `GET /api/sessions/{id}` → polled by the app for `{status, pct, message, transcript?}`.
5. `POST /api/sessions/{id}/analyze` `{model?, names?}` → builds speaker-labeled text from segments and calls the local LLM to produce Markdown notes.

Module responsibilities:
- `config.py` — central config: ports, Breeze ASR endpoints, Ollama model (`gemma4:e4b-it-qat`), ffmpeg/ffprobe path resolution (PATH → winget fallback).
- `asr.py` — resolves the Breeze ASR base URL: `ASR_BASE_URL` (set by compose to `http://breeze-asr:7765`) wins; otherwise it falls back to probing `:7765/health` across local IPs (cached). Plus ffmpeg audio extraction with progress; `normalize()` shapes segments + speaker stats.
- `llm.py` — provider abstraction (`get_provider("ollama")`). Dynamically sizes Ollama `num_ctx` from transcript length, strips `<think>` blocks, and converts output to Traditional Chinese via OpenCC (`s2tw`). The meeting-notes prompt is here and deliberately forbids the model from guessing which speaker code maps to which real name.
- `sessions.py` — SQLite store + `build_transcript_text()` which merges consecutive same-speaker segments into `[mm:ss] Name: text` paragraphs.

The backend's dependencies ship as sibling containers in the same compose unit — Breeze ASR (`breeze-asr:7765`) and Ollama (`ollama:11434`), reachable only on the container network — and ffmpeg/ffprobe are baked into the backend image. Config is env-driven (`ASR_BASE_URL` / `OLLAMA_BASE_URL` / `LLM_MODEL` / `WEB_PORT` / `DATA_DIR`); see `config.py`. Tailscale runs on the host.

## App architecture

Stack-based navigation (`App.tsx` / `navigation.tsx`): Home → Record → Processing → Results.

- `lib/` is the logic core, kept UI-free and unit-tested:
  - `api.ts` — typed wrappers over the backend endpoints above.
  - `store.ts` / `store-context.tsx` — `SessionStore` interface with two impls: `createAsyncStorageStore` (production, AsyncStorage) and `createMemoryStore` (tests/seeding). Components get the store via `useStore()`; tests inject a memory store through `StoreProvider`'s `store` prop. **All session data — transcript, notes, speaker renames, unlock state, raw parts — persists locally; the device is the source of truth.**
  - `recordings.ts` — moves finished recordings (`react-native-fs`) out of the recorder's temp cache into the persistent per-session document dir so raw parts survive app restarts; `partPath`/`moveToPart` both return `file://` URIs (strip to bare paths only at RNFS calls).
  - `gating.ts` — `splitNotesForPreview()` defines the IAP paywall: preview = everything up to and including the `## 會議摘要` section; the rest is locked.
  - `transcript.ts` — `mergedParagraphs()` / `mmss()` / `nameOf()` for rendering diarized transcripts with editable speaker names.
- `hooks/useRecorder.ts` — the trickiest piece. Manages multi-part recording (pause/resume, interruption handling) on `react-native-nitro-sound` (`startRecorder(..., meteringEnabled=true)` — the `true` is required or the waveform is flat). It keeps a `stateRef` mirror of React state so the interruption handler never reads a stale closure; an OS interruption (via the `lib/audioInterruption.ts` → native `AudioInterruption` event) finalizes the current part and starts a new one on resume. Comments tagged `C1`/`I2` mark these fixes — preserve that ordering logic when editing.
- `screens/` + `components/` (`Waveform`, `BreathingRing` — reanimated v4 visuals during recording).

### App testing

Jest (`react-native` preset) with native modules mocked (`jest-setup.js` mocks AsyncStorage, reanimated, react-native-config, react-native-fs; nitro-sound / clipboard / share / picker are mocked per-suite). Logic and component behaviour are covered in CI.

**Recording and call interruption run on a simulator, not a real device** — `npm run e2e:recording`. `ios/HaojiUITests/` drives the real UI while `ios/Haoji/E2EHooks.swift` (simulator-only, triggered by Darwin notification or `haoji://e2e/…`) posts a genuine `AVAudioSession.interruptionNotification`; `scripts/e2e-recording.mjs` then verifies the audio on disk with ffprobe. **Both layers are required**: a silently deleted recording still leaves a convincing UI behind, and a frozen screen can sit on top of perfectly good files. Assuming these needed real hardware is what let a recording-loss bug survive three TestFlight cycles. See `app/scripts/README-sim.md`.

`app/MANUAL-QA.md` is what genuinely still needs hardware before shipping (mic permission, waveform scrubbing by touch, a real phone call taking the audio hardware, background upload, IAP unlock).

## Docs

- `docs/spec/` — design specs (MVP, v2 UI/recording/TestFlight, record visuals).
- `docs/plans/` — dated implementation plans (foundation, screens, backend-api, v2 batches).
- `docs/product-discussion.md` — product wedge and key decisions.
- `docs/backend-followups.md` — backend TODOs.
