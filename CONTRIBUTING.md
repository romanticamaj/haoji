# Contributing to 好記 Haoji

Thanks for helping. Haoji has three parts in one repo, each with its own test suite:

| Part | Where | Run the tests |
|---|---|---|
| Mobile app (React Native 0.81, bare — **no Expo**) | `app/` | `npm ci && npx tsc --noEmit && npx jest` |
| Backend API (FastAPI) | `backend/` | `pip install -r requirements.txt && python -m pytest -q` |
| Control console (Vite + React) | `backend/console/` | `npm ci && npx vitest run && npm run build` |

CI runs all three, a Docker build with a smoke test, and `scripts/check-public.sh` on every PR.

## The rules

1. **Test first.** Write the failing test, watch it fail, then make it pass. Every bug fix comes with
   the test that would have caught it.
2. **Contracts are shared.** API response shapes live in `backend/tests/fixtures/contracts/*.json`.
   The backend tests assert them; the console and app tests use them as mocks. Change a shape there
   first, then make all three surfaces pass.
3. **Design tokens are shared.** The app's `app/lib/theme.ts` is the source; the console's
   `src/tokens.css` is generated from it (`npm run tokens`). Neither surface may use raw hex colours or
   shadows (guard tests enforce it). The visual and copy rules are in `design/keeplace-style/GUIDELINE.md`.
4. **Local-first.** Recording must never depend on the server. The phone is the source of truth for
   meetings; the server only processes and forgets.
5. **Recording changes need the simulator e2e** (`npm run e2e:recording`, iOS) as well as jest — see
   `app/scripts/README-sim.md`. A UI can look fine on top of a deleted recording.

## Running locally

- **App:** `cd app && npm ci && npm run pods && npm run ios` (or `npm run android`). Pair it with your
  server from the app's 設定 screen or by scanning the QR code in the console.
- **Backend without a GPU:** `cd backend && python app.py` serves the API and console on `:7780`.
  ASR/Ollama checks will show as not ready, which is fine for UI work.
- **Console dev server:** `cd backend/console && npm run dev` (proxies `/api` to `:7780`).

## Pull requests

Keep them focused, describe what you tested, and include screenshots for UI changes (iOS and Android
for the app). Conventional commit subjects (`feat(app): …`, `fix(backend): …`) are appreciated.
