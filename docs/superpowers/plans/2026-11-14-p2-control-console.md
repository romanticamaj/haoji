# P2 Control console: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build a web control console for self-hosters, served by the backend at `/console`, in the KEEPLACE design language. It covers overview/status, models, the Ollama connection, jobs, phone pairing and settings.

**Architecture:**
- A Vite + React 19 + TS single-page app in `backend/console/`.
- Data access goes through one typed `api.ts` (fetch, plus Bearer from sessionStorage, plus SSE).
- Pages are plain components behind a hash router.
- Design tokens are generated from `app/lib/theme.ts` into `src/tokens.css`.
- Tests use Vitest + @testing-library/react with fetch mocked from the backend's contract fixtures (`backend/tests/fixtures/contracts/*.json`).

**Tech stack:** vite 6, react 19.1, typescript 5.9, vitest 3, @testing-library/react 16, jsdom, lucide-react, qrcode (pure-JS QR to SVG string), tsx (runs the token script).

**Spec:** `docs/superpowers/specs/2026-11-14-open-source-platform-design.md` §5.2. The backend contract is `docs/superpowers/plans/2026-11-14-p1-backend-control-plane.md`.

## Global constraints

- **Dependencies:** no UI kit, no Tailwind, no state library.
- **Colours:** every colour comes from `var(--token)`; a test bans hex literals in `src/**/*.tsx` and `*.css`, except in `tokens.css`. No `box-shadow`.
- **Status display:** a dot plus a word. `ready` → sage `--primary`, `working` → peach `--accent`, `offline` → a muted ring. Never red or green.
- **Density:** body 14/22, controls 40px high, radius 12 for controls and 18 for cards, table rows 44. Content max-width 960, left rail 220.
- **Polling:** every 3 s, never overlapping (the next poll is scheduled only after the previous one settles), with errors shown inline and no toast spam.
- **Auth:** on any 401, show the login card ("貼上管理金鑰 Admin token", with a hint saying where the token is: `docker compose logs haoji-backend | grep admin` or `DATA_DIR/admin_token`). `POST /api/console/login` sets the cookie, and the token is also kept in sessionStorage for the Bearer header.
- **Content:** never render transcript content; the jobs table shows `id`/`kind`/`status` only.
- **Base path:** `vite.config.ts` sets `base: '/console/'`.

## Review focus

1. **Backend unreachable.** The overview shows "連不到主機" with a retry, and the app does not crash or render a blank screen. Test: `Overview offline state`.
2. **Pull of a nonexistent model.** An SSE `status: "error"` shows the error and re-enables the button. Test: `pull error re-enables`.
3. **Locked settings** (env-set). The input is disabled, with a "由環境變數設定" badge. Test: `locked field disabled`.
4. **A long model list** (more than 30 models) must not break the layout: the table scrolls inside its card. Test: render 40 rows; the rail is still present.
5. **A token pasted with surrounding whitespace or newline** is trimmed. Test: `login trims token`.

---

### Task 1: scaffold, tokens and design guard

**Files:**
- Create: `backend/console/{package.json, vite.config.ts, tsconfig.json, index.html, src/main.tsx, src/App.tsx, src/styles.css, scripts/gen-tokens.ts, src/tokens.css, src/__tests__/tokens.test.ts, src/__tests__/designGuard.test.ts, vitest.setup.ts}`

**Interfaces:**
- Produces: `npm run tokens`, `npm test`, `npm run build`. CSS vars `--background --surface --primary --primaryDark --heading --body --muted --hint --outline --accent --danger --primarySoft --accentSoft --overlay` and `--speaker-0..5`.
- [ ] **Test:** `tokens.test.ts` imports `colors` from `../../../../app/lib/theme` and asserts that every key appears in `tokens.css` with the same hex (drift guard). `designGuard.test.ts` greps `src/` for `#[0-9a-fA-F]{3,8}` outside tokens.css, and for `box-shadow`.
- [ ] Run it and confirm it fails. Implement. Run `npm test` and confirm it passes. Commit `feat(console): scaffold with tokens generated from the app theme`.

### Task 2: api client + polling hook + auth gate

**Files:**
- `src/api.ts`
- `src/usePoll.ts`
- `src/components/LoginCard.tsx`
- `src/__tests__/api.test.ts`
- `src/__tests__/usePoll.test.tsx`

**Interfaces:**
- `api.get<T>(path)`, `api.put`, `api.post`, `api.del`. Each throws `ApiError {status, code, message, hint}`.
- `api.events(path, onMsg): () => void` (EventSource)
- `setToken(t)` and `getToken()`
- `usePoll<T>(fn, ms = 3000): {data, error, loading, refresh}`
- [ ] **Tests:**
  - Bearer header attached.
  - A 401 surfaces `ApiError.status === 401`.
  - `usePoll` never overlaps: a fake timer plus a slow promise gives one in-flight call.
  - `login trims token`.
- [ ] Implement, run the tests, and commit.

### Task 3: shell layout (rail and routes)

**Files:**
- `src/components/{Rail.tsx, StatusDot.tsx, Card.tsx, Button.tsx, Field.tsx, ProgressBar.tsx}`
- `src/App.tsx`
- `src/__tests__/App.test.tsx`

Routes: `#/` 總覽, `#/models` 模型, `#/ollama` 連線, `#/jobs` 工作, `#/pair` 配對手機, `#/settings` 設定.

- [ ] **Tests:** the rail links have `aria-current` on the active route; StatusDot renders a label for each of the three states.
- [ ] Implement and commit.

### Task 4: Overview page

**File:** `src/pages/Overview.tsx`

- The page uses `GET /api/status?detail=1`.
- It shows four cards: GPU (name, VRAM bar used/total, utilisation), 語音辨識, Ollama/會議記錄模型, 佇列.
- Below them is the setup checklist: one row per failing check, with its hint. It is hidden when all checks are ok.
- [ ] **Tests:** all green → no checklist; ollama down → its hint is shown; `Overview offline state`; no GPU → "沒有偵測到 GPU（會用 CPU，較慢）".
- [ ] Implement and commit.

### Task 5: Models and Ollama pages

**Files:**
- `src/pages/Models.tsx`
- `src/pages/Ollama.tsx`

Models page:
- A table of `GET /api/models`.
- An LLM row has a radio button that selects it (`PUT /api/settings {llm_model}`) and a delete button that asks for confirmation inline. ASR rows are read-only with "由 breeze-asr 容器管理".
- A pull form takes a name, then `POST /api/llm/pull`, then subscribes to events and shows a ProgressBar with the pct and status text.

Ollama page:
- A base URL field, a 測試連線 button (`POST /api/llm/test`) showing the version and model count, and a 儲存 button (`PUT`).
- A locked badge.

- [ ] **Tests:** `select model PUTs`, `pull shows progress then success`, `pull error re-enables`, `delete 409 shows message`, `test connection ok/unreachable`, `locked field disabled`.
- [ ] Implement and commit.

### Task 6: Jobs, Pair and Settings pages

**Files:**
- `src/pages/Jobs.tsx`
- `src/pages/Pair.tsx`
- `src/pages/Settings.tsx`

- **Jobs:** a table of active and recent jobs with a relative time, a status dot and a duration. The error expands inline.
- **Pair:**
  - A QR from `qr_payload` (`qrcode.toString(payload, {type: 'svg'})`) at 240px, on `--surface` with an outline.
  - The URL list, each with a copy button.
  - A rotate button that confirms inline.
  - Step copy: 「用手機相機掃描，好記會自動打開並連上這台主機。」
- **Settings:** read-only facts from `/api/status?detail=1` and `/api/settings`, plus where the admin token lives.

- [ ] **Tests:** `jobs renders no transcript text` (the fixture includes a `message` only); `qr svg rendered with payload`; `copy url writes clipboard`; `rotate updates qr`.
- [ ] Implement and commit.

### Task 7: Playwright smoke (local)

**Files:**
- `backend/console/e2e/console.spec.ts`
- `playwright.config.ts`

The webServer runs `HAOJI_ADMIN_TOKEN=test python app.py` with Ollama and ASR unreachable.

- [ ] **Flow:** log in → overview shows the ollama hint → navigate all six pages without console errors.
- [ ] Run `npx playwright test` locally and confirm it passes. Commit.
