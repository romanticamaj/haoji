# P3 Mobile: pairing, status and fluent UX on iOS and Android. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let any self-hoster connect the app to their own server, and see that server's state. Restructure Results, add search, and give both platforms one motion and haptics language. Android reaches parity with iOS, and accessibility gaps are closed.

**Architecture:**
- New UI-free modules in `app/lib/` hold all logic and are unit-tested: `server.ts`, `serverStatus.ts`, `pairLink.ts`, `search.ts`, `motion.ts`, `haptics.ts`.
- Screens are thin.
- New screens: `Onboarding`, `Pair`, `Settings`.
- Results gets a custom header and a docked mini-player.

**Tech stack:**
- RN 0.81.5 and React 19.1.
- Testing: jest + RNTL, with contract fixtures from `backend/tests/fixtures/contracts`.
- Native dependency: `react-native-haptic-feedback` only. It is autolinked, has no gesture-handler or Expo, and needs a pod install.

**Spec:** `docs/superpowers/specs/2026-11-14-open-source-platform-design.md` §5.3. The backend contract is the P1 plan.

## Global constraints

- **GUIDELINE rules hold.** Tokens only, with no hex in screens or components (`designTokens.test.ts`). Copy uses 「你」, avoids tech words, and ends with 「。」. Never 「確定」.
- **Motion.** Durations are 120/180/240 ms. One curve: `Easing.out(Easing.cubic)`. No springs. Under Reduce Motion every duration is 0.
- **Local-first.** Recording never depends on pairing or server state.
- **Server base precedence.** The paired base URL wins. Next comes `Config.API_BASE`. If neither exists, the URL is `null`, which means "not paired", and actions that need the server show the pairing CTA.
- **Bearer token.** It is sent on every `api.ts` call when paired.
- **Status words on the phone.**
  - 主機已連線 / 主機忙碌中 / 連不到主機 / 還沒連接主機.
  - The phone never says GPU, Ollama, model or 後端.
- **Testing rules.** Tests assert roles, labels and behaviour, never snapshots. Each screen is tested in its empty, loading, error, offline and unpaired states, where these apply.

## Review focus

1. **Pair link with a URL-encoded `url`, a missing token, or a non-http scheme** (`haoji://pair?url=javascript:...`). Expect it to be rejected with 「這不是好記主機的配對連結。」. Test: `pairLink rejects non-http`.
2. **Server reachable but not Haoji** (some other web server on that port). Expect 「這個網址不是好記主機。」. Test: `validate not-haoji`.
3. **The app is offline while a recording is open on Results.** Playback and the transcript still work; only the server actions are disabled. Test: `Results offline keeps player`.
4. **Very long titles or speaker names at 1.5× font scale.** The header truncates to one line, and the overflow menu stays reachable. Test: `header truncates long title`.
5. **Search across 200 sessions, each with a 2-hour transcript.** It must finish in under 100 ms and be case- and width-insensitive (full-width ＡＢＣ matches abc). Test: `search perf` and `search width-insensitive`.

---

### Task 1: runtime server config (`lib/server.ts`) and per-call base in `api.ts`

**Files:**
- Create `lib/server.ts` and `lib/__tests__/server.test.ts`.
- Modify `lib/api.ts`, replacing every `${API_BASE}` with `${await base()}`.
- Modify `lib/config.ts`: drop the hardcoded IP fallback, so `API_BASE: string | null = Config.API_BASE || null`.
- Modify `lib/backgroundUpload.ts` (uploadUrl) and `jest-setup.js`.

**Interfaces:**
- `type ServerConfig = {url: string; token?: string; name?: string; pairedAt: number}`
- `loadServer(): Promise<ServerConfig|null>`
- `saveServer(c)`
- `forgetServer()`
- `serverBase(): Promise<string|null>`: the paired URL, else `Config.API_BASE`, else `null`.
- `authHeaders(): Promise<Record<string,string>>`
- `normalizeUrl(input: string): string|null`: trims; adds `http://` if no scheme; rejects anything not http(s); strips the trailing slash; keeps the port.
- `NotPairedError extends Error`, which `api.ts` throws when the base is null.
- `subscribe(fn): () => void`, which notifies listeners on save and on forget.

Steps:
- [ ] Write the tests:
  - `normalizeUrl` cases: `"100.1.2.3:7780"` → `"http://100.1.2.3:7780"`; `" https://h/ "` → `"https://h"`; `"ftp://x"` → `null`; `""` → `null`.
  - Precedence.
  - The Bearer header is attached in `api.createSession` when a token is set.
  - `api.*` rejects with `NotPairedError` when unpaired.
- [ ] Run the tests and watch them fail. Implement. Run `npx jest lib` and `npx tsc --noEmit` and see them pass. Commit.

### Task 2: pair link and server validation (`lib/pairLink.ts`, `lib/serverStatus.ts`)

**Interfaces:**
- `parsePairLink(url: string): {url: string; token?: string} | {error: string}`, which accepts `haoji://pair?url=…&token=…`.
- `validateServer(url, token?, fetchImpl = fetch): Promise<{ok: true; status: PublicStatus} | {ok: false; reason: 'unreachable'|'not_haoji'|'too_old'|'unauthorized'; message: string}>`.
  - It GETs `/api/status` with a 5 s timeout. `not_haoji` means the JSON lacks `checks`/`version`. `too_old` means the response is a 404 but `/health` answers `haoji-backend`.
  - Messages: 「連不到這個網址，確認主機有開、手機和主機在同一個網路或 Tailscale 上。」 / 「這個網址不是好記主機。」 / 「主機版本太舊，請更新主機後再試。」 / 「配對金鑰不對，請重新掃描主機上的 QR code。」
- `type PublicStatus` mirrors `contracts/status.json`.
- `summarize(s: PublicStatus|null, err?): {tone: 'ready'|'busy'|'offline'|'unpaired'; label: string; detail: string[]}`.
  - Tone: `ready` when `ok` is true and nothing is active; `busy` when `queue.active + queue.queued > 0`; `offline` on an error or when `ok` is false.
  - `detail` uses phone words: 語音辨識 for `breeze_asr`, 會議記錄 for `ollama`/`llm_model`.

Steps:
- [ ] Write the tests, including `pairLink rejects non-http`, `validate not-haoji`, and all four reasons. Then implement and commit.

### Task 3: `useServerStatus` hook, Settings screen and the Home status button

**Files:**
- Create `hooks/useServerStatus.ts`, `screens/SettingsScreen.tsx`, `components/StatusDot.tsx`.
- Modify `screens/HomeScreen.tsx` and `components/BrandHeader.tsx` (add a status button next to search), `navigation.tsx` and `App.tsx`.

**Behaviour:**
- **Polling.** Polls on focus and every 15 s while the app is active (`AppState`). It pauses in the background.
- **Settings screen.** It has four cards:
  - **主機:** URL, latency in ms, 重新配對 → Pair, and 中斷連線 with a confirm dialog. The dialog title is 「中斷和這台主機的連線？」 and the body is 「手機上的錄音和會議記錄都會留著。」.
  - **狀態:** one row per detail line.
  - **隱私:** 「錄音只在處理時傳到你的主機，處理完就刪除。」
  - **關於:** version and a GitHub link.
- **Status button.** The dot is sage when the server is ready, peach when busy, and a muted ring when offline or unpaired. Its accessibility label is 「主機狀態：{label}」.

Steps:
- [ ] Write the tests. Settings renders each tone from fixtures. The unpaired state shows 「連接主機」 as the primary action. Forget asks for confirmation and then clears the server. The Home dot label follows the tone. Polling stops on background (fake timers plus a mocked AppState).
- [ ] Implement and commit.

### Task 4: Pair screen, Onboarding, and deep-link wiring

**Files:**
- Create `screens/PairScreen.tsx` and `screens/OnboardingScreen.tsx`.
- Modify `App.tsx` with a `linking` config: `haoji://pair` → Pair with params, and the existing `e2e` paths untouched.
- Modify `lib/store.ts` to add an `onboarded` flag in AsyncStorage key `haoji.onboarded`.

**Pair screen:**
- Shows the URL field (prefilled from the link) and a 連接 button that runs `validateServer`.
- On success it saves and shows 「已連上 {host}」, then pops.
- An inline error shows the reason message.
- Help text: 「在主機的管理頁「配對手機」，用相機掃 QR code 就會自動填好。」

**Onboarding:**
- Three cards with paging (FlatList, `pagingEnabled`):
  1. 「把說過的話，好好記下來。」
  2. 「逐字稿在你自己的主機上處理，不經過任何雲端。」
  3. 「連接你的主機」, with the buttons 掃描或輸入網址 and 先不用，直接錄音.
- It shows once, only when the app is not onboarded and not paired. Skipping it still allows recording.

**Native:**
- Add the Android `<intent-filter>` (VIEW, BROWSABLE, scheme `haoji`).
- iOS already has the scheme.
- iOS ATS: set `NSAllowsArbitraryLoads=true`, keep `NSAllowsLocalNetworking`, remove the IP exception list, and add a comment explaining why: a self-hosted server can be at any address.
- Android: change `network_security_config.xml` to `<base-config cleartextTrafficPermitted="true">`, with a comment.

Steps:
- [ ] Write the tests. A pair link prefills the URL and token. Success saves and navigates back. Failure shows the reason. Onboarding skip sets the flag and lands on Home. Onboarding is not shown when paired.
- [ ] Implement and commit.

### Task 5: Processing stages and offline gating

**Files:**
- Modify `screens/ProcessingScreen.tsx`, `screens/ReviewScreen.tsx` and the transcribe entry points.

**Behaviour:**
- A four-step row: 上傳 → 排隊 → 辨識 → 整理. It is derived by a pure `stageOf(job, sessionStatus): 0|1|2|3` in `lib/job.ts`.
- When unpaired, 生成逐字稿 becomes 「連接主機後就能生成逐字稿」, a secondary button that opens Pair.
- When offline, the button is disabled with 「主機沒有回應，錄音還在手機上。」.

Steps:
- [ ] Write the tests: `stageOf` for each status, the unpaired CTA, the offline disabled state. Then implement and commit.

### Task 6: motion and haptics foundation

**Files:**
- Create `lib/motion.ts`, `lib/haptics.ts` and `hooks/useReducedMotion.ts`.
- Extend `components/__tests__/designTokens.test.ts`.

**Interfaces:**
- `motion = {press: 120, content: 180, sheet: 240, easing}`.
- `duration(kind, reduced): number` returns 0 when `reduced` is true.
- `haptic(event: 'recordStart'|'recordStop'|'pause'|'tab'|'ready'|'delete')`. The mapping is `recordStart`/`pause`/`tab` → `impactLight`, `recordStop`/`ready` → `notificationSuccess`, and `delete` → `notificationWarning`. It catches its own errors and does nothing when the module is missing.

**Wiring:**
- Record start, stop and pause.
- The Results tab change.
- Transcript-ready (Processing done).
- Delete confirm.

Steps:
- [ ] Write the tests. Assert the mapping table. The guard test bans numeric `duration:` literals above 250 in screens and components, and bans `withSpring`.
- [ ] Implement. Install `react-native-haptic-feedback`, run `npm run pods`, and add a jest mock. Commit.

### Task 7: Results restructure

**Files:**
- Modify `screens/ResultsScreen.tsx`.
- Create `components/ResultsHeader.tsx`, `components/OverflowMenu.tsx` (a Sheet with rows) and `components/MiniPlayer.tsx`. The mini player is collapsed at 64 pt and expands to the current waveform card at 240 ms.
- Modify `screens/TranscriptTab.tsx`. The speaker avatar takes its palette colour even when unnamed. The 「點一下命名」 chip appears only on each speaker's first turn. The speakers chip becomes an avatar stack.

**Header:**
- Back, then the title on one line with ellipsis, then `…`.
- The overflow menu holds: 重新命名, 匯出錄音, 繼續錄音, 重新生成逐字稿, 刪除這場會議. 刪除 uses the danger colour.

**Tabs:** placed right under the header, with an animated sliding underline (180 ms).

Steps:
- [ ] Write the tests:
  - The overflow contains all 5 actions and each one routes or calls correctly.
  - The mini player shows play/pause and the time, and expands on tap.
  - Existing `ResultsScreen.tabstate`, `TranscriptTab.*` and `seekToGlobal` tests still pass. Update them where they assert the old positions of buttons, but keep their intent.
  - `header truncates long title` (`numberOfLines={1}`).
  - `Results offline keeps player`.
  - First-turn-only naming chip.
- [ ] Implement and commit.

### Task 8: Home polish and search

**Files:**
- Create `lib/search.ts`, `screens/SearchScreen.tsx` (or an inline search mode in Home), and `components/ImportSheet.tsx`.
- Modify `screens/HomeScreen.tsx` and `screens/RecordingsList.tsx`.

**Interfaces:**
- `searchSessions(sessions: SavedSession[], q: string, names?): SearchHit[]`, where `SearchHit = {sessionId, field: 'title'|'transcript'|'notes'|'speaker', snippet: string, matchStart: number, matchLen: number, segmentIndex?: number}`.
- Matching is NFKC-normalised and case-folded. Results rank title, then speaker, then notes, then transcript, and newest first within each rank. Each session returns at most 3 hits.

**Home:**
- The meta line carries status inline (· 已有逐字稿 / · 處理中 / · 還沒生成); the empty status rows go away.
- The bottom bar becomes 匯入 (opens ImportSheet: 音檔 / 影片), 記下來, and 設定.
- Recovered titles use zh-TW date format via `Intl` with `zh-TW`, e.g. `10月29日 下午4:31`.

**Search:** a debounce of 150 ms. The hit is highlighted in `primarySoft`. Tapping opens Results with `focusSegment`.

Steps:
- [ ] Write the tests: `search perf`, `search width-insensitive`, ranking, the snippet window (±20 characters), the empty state 「找不到「{q}」」, the import sheet options, and the zh-TW date formatter.
- [ ] Implement and commit.

### Task 9: Android parity

**Changes:**
- In `android/gradle.properties`, set `edgeToEdgeEnabled=true` and audit insets in BottomActionBar, Sheet, UndoSnackbar and the Results mini player using `useSafeAreaInsets`.
- In `styles.xml`, change the AppTheme parent to `Theme.AppCompat.Light.NoActionBar`.
- Add a `BackHandler` hook, `hooks/useAndroidBack.ts`. It closes an open sheet first. Record asks 「要結束這段錄音嗎？」 (buttons 繼續錄音 / 結束). Processing navigates Home.
- `components/Pressable` variants use `android_ripple={{color: colors.primarySoft, borderless: false}}` on Android and opacity on iOS, through a single `Touchable` wrapper in `components/Buttons.tsx`.
- AppText sets `includeFontPadding: false` on Android.

Steps:
- [ ] Write the tests, run under `Platform.OS='android'` via `jest.replaceProperty`: back closes the sheet before popping; Record back asks for confirmation; the ripple prop is present on Android and absent on iOS; AppText has no font padding on Android.
- [ ] Implement. Build with `npx react-native run-android` on the emulator, then capture screenshots into `app/qa/screenshots/android/`. Commit.

### Task 10: accessibility pass

**Changes:**
- Change `muted` from `#77746E` to `#6F6C66` in `lib/theme.ts` and in `design/keeplace-style/theme.ts`. Regenerate the console tokens.
- Speaker chip label: 「講者 1，還沒命名，點兩下命名」. Named speakers read 「{name}，點兩下改名」.
- Transcript turns get `accessibilityActions=[{name:'activate', label:'從這裡播放'}]`.
- Progress uses `accessibilityLiveRegion="polite"` and `accessibilityRole="progressbar"` with a value.
- Chrome text uses `maxFontSizeMultiplier` (1.3 for chrome, 1.6 for content).

Steps:
- [ ] Write the tests: the contrast function in `lib/__tests__/contrast.test.ts` asserts `muted` on `background` ≥ 4.5; the labels exist; the progress role is set.
- [ ] Implement and commit.

### Task 11: cross-platform E2E (Maestro) and screenshot sets

**Files:**
- `app/e2e/maestro/{pair.yaml, record-results.yaml, search.yaml}`
- `app/scripts/e2e-maestro.mjs`, which starts a stub backend from `app/e2e/stub-server.mjs` serving contract fixtures plus a canned transcript
- `app/e2e/README.md`

**Flows:**
1. Open `haoji://pair?url=http://<host>:7799&token=t` and expect 「已連上」.
2. Record for 3 s, stop, 生成逐字稿, then expect the transcript text.
3. Search a word and open the hit.

Steps:
- [ ] Run each flow locally on the iOS simulator and on an Android emulator. Record the result in `app/MANUAL-QA.md`. Commit.
