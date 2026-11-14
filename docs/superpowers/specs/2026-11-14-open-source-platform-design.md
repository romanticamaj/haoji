# 好記 Haoji — open-source platform: self-hostable backend + control console + fluent mobile UX

**Status:** design, 2026-11-14. Requested by the owner through `/goal`. The owner asked us to proceed without pausing for questions, so every call below that the owner did not spell out is marked **(call)**.
**Consulted:**
- Fable 5.2, for the UI/UX critique and plan; quoted inline.
- A research pass over `jamiepine/voicebox` and `romanticamaj/openaudiofix`.

**Builds on:** the KEEPLACE-style redesign (builds 75–80, `design/keeplace-style/GUIDELINE.md`). That work is now on master.

## 1. Intent

The owner wants to publish 好記 as a **public open-source project**. Today it only works for the owner:
- the app hardcodes the owner's Tailscale IP;
- the backend has no way to see what state it is in;
- there is no README a stranger could follow.

"Done" means a stranger with a GPU box can:
1. `docker compose up -d`;
2. open a **control console** in a browser, see whether ASR, Ollama and the GPU are healthy, pull or select the notes model, and watch jobs;
3. **pair their phone** by scanning a QR code;
4. record → transcript → notes, in an app that feels **modern and fluent on both iOS and Android**.

All of this is built test-first.

## 2. Goals, non-goals, anti-goals

**Goals**
- G1: Backend control plane:
  - a status/health API with a checks array plus GPU;
  - Ollama connection settings, test, list, pull with progress, delete and select;
  - a jobs view;
  - a pairing token;
  - a uniform error shape;
  - console auth.
- G2: A web control console served by the backend at `/console`, in the KEEPLACE design language.
- G3: Mobile:
  - runtime server URL and pairing;
  - Settings and server status;
  - a Results restructure;
  - search;
  - a motion/haptics language;
  - Android parity;
  - accessibility.
- G4: Open-source hygiene:
  - README in English and zh-TW, LICENSE, CONTRIBUTING, SECURITY;
  - issue and PR templates;
  - CI for pytest, jest, tsc, vitest and a docker build;
  - personal identifiers scrubbed from the tree.
- G5: Comprehensive TDD: unit → contract → component → e2e on every surface (§7).

**Non-goals (this milestone)**
- Dark mode. Every screen reads a static `colors` object, so the refactor touches every file and doubles the screenshot matrix. Build the console on CSS variables so it can go dark cheaply later.
- LAN/mDNS discovery and an in-app QR camera. The system camera opens `haoji://pair?...`, so no native camera dependency is needed.
- A desktop shell (Tauri), as voicebox has. The backend is headless-first (Docker on a GPU box), the same as openaudiofix. **(call)** Voicebox's desktop sidecar adds a whole packaging pipeline, and the GPU-box audience runs Docker anyway.
- Managing Breeze ASR weights from the console. They live in the `breeze-asr` container; the console reports them read-only (`managed_by: "breeze-asr"`).

**Anti-goals: a failure even if it works**
- Accounts, a cloud relay, or a hosted default server. These break the "results only on your phone" promise.
- Recording that depends on pairing or server state. Local-first recording stays.
- Showing transcript content in the console. The no-retention promise covers the server operator too.
- Springs, parallax, Lottie, gradients, glass or shadows. Red/green traffic lights, or tech words (GPU, Ollama, model) on the phone.
- Snapshot-everything tests that freeze a layout we are about to restructure.
- Forking design tokens for the web. Console tokens are **generated** from `app/lib/theme.ts`.

## 3. Constraints

- App: bare RN 0.81.5 / React 19.1, New Architecture on. No Expo, no gesture-handler. reanimated v4, svg and lucide are available.
- New native dependencies are allowed only when unavoidable and must be justified in the issue. The haptics library is the only candidate.
- KEEPLACE guideline rules hold: ivory/sage, 1px outlines, radius 18, motion ≤250 ms with no bounce, Reduce Motion respected, copy rules from §5.
- Backend: FastAPI with the module layout kept, and a Docker Compose unit (backend + breeze-asr + ollama). pytest is the safety net.
- The existing contract stays backward compatible:
  - The existing `/api/sessions*` endpoints are unchanged.
  - Pairing tokens are **optional** in this milestone. A backend with `HAOJI_REQUIRE_TOKEN` unset accepts tokenless phone calls, so build 80 on the owner's phone keeps working.

## 4. Approaches considered

**Console stack**
1. **Vite + React + TS + Vitest + plain CSS variables (chosen).** Contributors already write React and TS in `app/`, with the same Testing Library idiom. Tokens can be generated from `theme.ts`.
2. htmx + Jinja inside FastAPI. Smallest bundle, but UI logic ends up in Python templates, which are harder to unit-test, and it shares nothing with the app.
3. Reusing the app through react-native-web. One codebase, but heavy, and a phone layout is wrong for an admin console.

**Backend shape**
1. **Keep the single FastAPI app; add routers `status`, `llm`, `jobs`, `pairing`, `settings` and a static mount (chosen).** This is the openaudiofix pattern, the smallest change that fits the existing tests.
2. A Voicebox-style `routes/` + `services/` rewrite. Cleaner on paper, but it churns every existing test for no user-visible gain. We take the router split only for the new code.
3. A separate console server. An extra container and CORS, for nothing.

**Phone ↔ server connection**
1. **Runtime URL in AsyncStorage, set by a `haoji://pair?url=&token=` deep link (QR) or manual entry, validated against `/api/status` (chosen).**
2. Build-time `.env` only, which is today's approach. Strangers would need to compile the app, so it is a non-starter.
3. mDNS discovery. Needs a native module and the iOS local-network prompt, and does nothing over Tailscale.

## 5. Design

### 5.1 Backend control plane (G1)

- **`GET /api/status`** returns:
  ```
  {version, ok, checks:[{id, ok, message, hint?}], gpu:{available, name?, vram_used_mb?, vram_total_mb?, util_pct?}, queue:{active, queued}, llm:{base_url, model, reachable}}
  ```
  - `checks` ids: `data_writable`, `sqlite`, `ffmpeg`, `breeze_asr`, `ollama`, `llm_model`.
  - GPU comes from `nvidia-smi --query-gpu`, absent-tolerant.
  - Probes are cached for 5 s, so polling is cheap.
  - `GET /health` stays as is.
- **Settings store** (SQLite `settings` table, key → JSON):
  - Keys: `ollama_base_url`, `llm_model`.
  - Env vars win and **lock** the field (`locked: true` in `GET /api/settings`).
  - `PUT /api/settings` validates each value. Everything the backend reads at call time goes through `settings.get()`; config constants become defaults.
- **LLM endpoints:**
  - `POST /api/llm/test {base_url?}` returns `{ok, version, models}`.
  - `GET /api/llm/models` keeps its existing shape and adds `details:[{name, size, modified_at, loaded}]`.
  - `POST /api/llm/pull {name}` starts a background pull that proxies Ollama's streaming `/api/pull`.
  - `GET /api/llm/pull/{name}/events` is an SSE stream of `{status, completed, total, pct}`.
  - `DELETE /api/llm/models/{name}` returns 409 if that model is selected while a job is running.
  - `PUT /api/settings {llm_model}` selects the model.
- **Models overview: `GET /api/models`.** One list across kinds:
  - `[{id, kind:"asr"|"diarization"|"llm", name, state:"ready"|"missing"|"downloading"|"unknown", size_bytes?, managed_by}]`.
  - ASR and diarization state comes from the breeze-asr `/health` payload.
- **Jobs: `GET /api/jobs`** returns `{active:[...], recent:[...]}`, built from the existing in-memory job registry plus session rows.
  - Each entry is `{session_id_short, kind:"transcribe"|"analyze", status, pct, message, started_at, finished_at?, duration_s?, error?}`.
  - **No transcript text or titles.**
- **Errors:** new endpoints return `{error:{code, message, hint}}` with a fixed code list (`errors.py`). Old endpoints keep their shapes.
- **Security:**
  - **Console/admin token.** It is generated on first boot into `DATA_DIR/admin_token` and printed in the log, and can be overridden by `HAOJI_ADMIN_TOKEN`. It is required (Bearer, or a cookie set by `/console/login`) on `/api/settings` (PUT), `/api/llm/pull|test|delete`, `/api/jobs`, `/api/pairing*` and `/api/status?detail=1`.
  - Plain `GET /api/status` is public: no secrets, no GPU detail. The phone uses it.
  - **Pairing token.**
    - `GET /api/pairing` (admin) returns `{urls:[...candidates], token, qr_payload}`. The candidate URLs come from host interfaces plus `HAOJI_PUBLIC_URLS`.
    - `POST /api/pairing/rotate` rotates the token.
    - The phone sends `Authorization: Bearer <pairing token>`, which is enforced only when `HAOJI_REQUIRE_TOKEN=1`. Defaulting to on is a later issue.
  - **Origin check.** A state-changing request that carries an `Origin` header must be same-origin. This is the openaudiofix DNS-rebinding guard.

### 5.2 Control console (G2)

- `backend/console/`: Vite + React 19 + TS + Vitest + @testing-library/react, with lucide-react and a hash router. No UI kit, no Tailwind, no state library.
- `npm run tokens` generates `src/tokens.css` from `app/lib/theme.ts`. A test fails if they drift.
- A multi-stage Dockerfile builds it, and FastAPI mounts `dist/` at `/console` when present.
- Pages (220 px left rail; content max 960 px):

| Page | Contents |
|---|---|
| 總覽 Overview | Status cards: GPU (VRAM bar), 語音辨識 ASR, Ollama, 佇列 Queue. A setup checklist shows until all are green. |
| 模型 Models | ASR and diarization rows, read-only state. Ollama models with install and select (radio), pull by name with a progress bar over SSE, delete. |
| 連線 Ollama | Base URL field with a 測試連線 button showing version and model count; a locked badge when env-set. |
| 工作 Jobs | Table of time, kind, status, progress, duration, error. Polls every 3 s with no overlap, quiet on failure. |
| 配對手機 Pair | Large QR (a pure-JS generator, `qrcode` npm), candidate URLs with copy buttons, rotate token. |
| 設定 Settings | Read-only config: port, data dir, APNs state, version, and where the admin token lives. |

- Visual rules:
  - KEEPLACE tokens, density stepped down for desktop: body 14/22, controls 40 high, table rows 44.
  - Status is a dot plus a word (sage = ready, peach = working, muted ring = offline). Never red or green.
  - Tech words are allowed here. The 「你」 voice and the "what is kept" error pattern still apply.
  - Focus ring 2 px `primaryDark`. The language toggle is out of scope; console copy is bilingual where short (`模型 Models`). **(call)**

### 5.3 Mobile (G3), Fable's plan with ranks kept

- **A. Server URL and pairing (P0).**
  - `lib/server.ts` holds the runtime base URL plus token, persisted in AsyncStorage. `api.ts` resolves the base per call.
  - The `haoji://pair?url=…&token=…` deep link opens a Pair confirmation screen.
  - Manual entry is validated against `/api/status`, with specific errors: unreachable / not a Haoji server / version too old.
  - First-run onboarding has three cards: what it is → 「你需要自己的主機」 → pair. It is skippable, because recording works unpaired.
  - Build-time `Config.API_BASE` stays as the default for the owner's builds.
  - Transport: iOS `NSAllowsLocalNetworking` plus `NSAllowsArbitraryLoads`, scoped and documented **(call)**. Self-hosters use arbitrary hosts, so a pinned exception list cannot work for strangers. DEPLOY.md recommends `tailscale serve` HTTPS. Android gets a cleartext-permitted base config.
- **B. Settings and status (P0).**
  - A Home header status button: 8 pt dot, sage ready / peach busy / muted offline.
  - The Settings screen has cards: 主機 (URL, latency, re-pair, forget), 狀態 (語音辨識 / 會議記錄 / 排隊中 N), 隱私, 關於 (version, open-source link).
  - `useServerStatus` polls on focus and every 15 s while foregrounded.
  - Offline disables 生成逐字稿 with 「主機沒有回應，錄音還在手機上。」.
  - Processing shows the stages 上傳 → 排隊 → 辨識 → 整理.
- **C. Results restructure (P0).**
  - A custom header with the title and a `…` overflow (重新命名, 匯出錄音, 繼續錄音, 重新生成, 刪除).
  - Tabs directly under the header.
  - The player becomes a docked 64 pt mini-bar that expands to the waveform.
  - The speakers chip becomes an avatar stack.
  - Each speaker gets their palette colour even when unnamed. The naming prompt shows only on that speaker's first turn.
- **D. Search (P1).** A pure, debounced `lib/search.ts` over title, transcript, notes and speaker names. A snippet highlights the hit; tapping opens Results at that turn.
- **E. Motion and haptics (P1).**
  - `lib/motion.ts` sets durations: 120 / 180 / 240 ms, one ease-out curve.
  - Patterns:
    - The tab underline slides.
    - First-load list rows fade and rise 8 pt.
    - Progress width animates.
    - Skeleton rows replace the spinner on Results.
  - `lib/haptics.ts` wraps the platform haptics behind a mapping table: light / success / warning. Never per scroll.
  - Everything goes instant under Reduce Motion.
- **F. Android parity (P1).**
  - Edge-to-edge insets.
  - `BackHandler` order: sheet → record confirm → processing goes home.
  - `android_ripple` in `primarySoft` instead of opacity.
  - `includeFontPadding:false`.
  - A Light (not DayNight) AppTheme.
  - An emulator screenshot set mirroring iOS.
- **G. Accessibility (P1).**
  - Speaker chip labels, a play action on transcript turns, a live region for progress.
  - `muted` raised to ≥4.5:1 (`#6F6C66`).
  - No clipping at 1.5× font scale.
- **H. Home polish (P1).**
  - Status goes inline in the meta line, and empty status rows are removed.
  - One 匯入 opens a sheet (audio / video), which frees a slot for 設定.
  - zh-TW date formatting for recovered titles.
  - Record: controls centred in the thumb zone; back mid-recording confirms 「要結束這段錄音嗎？」.

### 5.4 Open-source hygiene (G4)

- Root `LICENSE` is MIT **(call)**, matching both reference projects. `app/LICENSE` is the leftover Expo template license and is removed.
- `README.md` (English) and `README.zh-TW.md` follow the openaudiofix order:
  1. pitch;
  2. screenshots;
  3. how it works (diagram);
  4. quick start (`docker compose up -d` → open console → scan QR → install app);
  5. GPU requirements;
  6. config table;
  7. build the app yourself;
  8. contributing;
  9. license and third-party (Breeze ASR, pyannote, Ollama, gemma licences already in `deploy/LICENSES.md`).
- `CONTRIBUTING.md` (TDD rule: every bug gets a test), `SECURITY.md` (private advisories), `CODE_OF_CONDUCT.md`, `.github/ISSUE_TEMPLATE/{bug_report,feature_request}.yml` plus `config.yml`, `PULL_REQUEST_TEMPLATE.md`, `dependabot.yml`.
- CI (`.github/workflows/ci.yml`) has four jobs:
  - backend pytest;
  - app jest + tsc;
  - console vitest + build + token-drift;
  - a docker build of the backend image with a curl smoke test of `/api/status`. GPU services are not built in CI.
- Scrub the tree:
  - The fastlane `key_id`/`issuer_id`/`team_id` move to env (`ASC_KEY_ID`, …). They are identifiers, not secrets, so history is not rewritten. **(call)**
  - The Windows winget path with the username goes.
  - Owner IPs move out of code into `.env.example` and docs.
- The repo visibility flip happens **last**, after the scrub, and is confirmed with the owner.

## 6. Delivery

GitHub milestone **"v1.0 Open source"**, one issue per bullet above, labelled `backend`, `console`, `app`, `android`, `infra` and `P0`/`P1`. Order:

1. Backend control plane: status, settings, llm, jobs, auth/pairing.
2. Console, against fixture contracts.
3. App A+B (pairing, status).
4. App C (Results).
5. App E/F/G/H.
6. App D (search).
7. OSS hygiene and CI, last before the flip, except that CI lands first so later work runs against it.

Each issue lands as its own commit series on `feat/open-source-platform`, with tests first. Fable reviews the finished UI before the TestFlight build.

## 7. Testing strategy (G5)

| Layer | Tool | Covers |
|---|---|---|
| Unit | pytest / jest / vitest | settings precedence and locking, status aggregation, nvidia-smi parsing, pull progress parsing, the token guard, server URL parse/validate, search ranking, the motion/haptics tables, status state machine |
| Contract | JSON fixtures in `backend/tests/fixtures/contracts/*.json` | pytest asserts the API emits them (keys and types); jest and vitest load the same files as mock responses, so the three surfaces cannot drift |
| Component | RNTL / Testing Library | every screen × {empty, loading, error, offline, unpaired}; asserts roles and labels, no snapshots; Android branches under `Platform.OS='android'`; the design-token guard extended to durations over 250 ms |
| E2E | XCUITest (existing), Maestro flows (new), Playwright (console) | iOS record and interruption (kept). Maestro flows in `app/e2e/maestro/` (pair deep link → record → results) run on the iOS sim and an Android emulator. Playwright drives the console against FastAPI with fake ASR and Ollama. |
| Visual | Scripted screenshots | the iOS and Android sets committed under `app/qa/screenshots/`, reviewed by eye; no pixel diffs on mobile |

## 8. Left to the builder

- Exact component splits, file names inside the new modules, and copy beyond the strings quoted here (following GUIDELINE §5).
- Whether pull progress uses SSE or polling. SSE is preferred; polling is the fallback if a proxy buffers it.
- Whether Maestro runs in CI. Local is fine for this milestone; CI emulators are slow and flaky.
