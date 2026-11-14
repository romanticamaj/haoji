# P0 Open-source hygiene and CI: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the repository safe and welcoming to publish: license, docs and templates, scrubbed identifiers, and CI that runs every test suite on each PR.

**Spec:** `docs/superpowers/specs/2026-11-14-open-source-platform-design.md` §5.4

## Global constraints

- MIT licence. Copyright is "2026 Haoji contributors".
- The tree may not contain any of the following, enforced by `scripts/check-public.sh` in CI:
  - the maintainer's private IPs
  - `gary.hsieh` paths
  - ASC `key_id`/`issuer_id` literals
  - `.p8` files
- CI never needs GPU, Apple signing or network models.

## Review focus

1. **A fork with no secrets.** CI must pass without any repository secrets. Test: CI runs on a PR from a branch with no secrets configured.
2. **Fastlane after the scrub.** It still works for the owner, reading `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH` and `APPLE_TEAM_ID` from the environment or from `ios/fastlane/.env` (gitignored). Test: `fastlane lanes` parses, and the owner's `.env` documents the values.
3. **The owner's build.** It must still reach the owner's server through `app/.env` (`API_BASE`), and the scrub must not break that. Test: `config.test.ts` covers env-set and env-missing.

### Task 1: scrub and guard

- [ ] `scripts/check-public.sh`: a `git grep` for the banned patterns that exits 1 on any hit. Run it first and confirm it FAILS on the current tree.
- [ ] Move the Fastfile/Appfile literals to `ENV.fetch("ASC_KEY_ID")` and the other variables, and add `ios/fastlane/.env.example`.
- [ ] Update `config.ts`, Info.plist and network config; this is P3 Task 1/4 if not done already.
- [ ] Replace the owner IPs with `<your-server>` in docs and CLAUDE.md.
- [ ] Run `scripts/check-public.sh` again and confirm it passes. Commit.

### Task 2: repository documents

- [ ] Root `LICENSE` (MIT). Delete `app/LICENSE`, which is the leftover Expo template.
- [ ] `README.md` in English and `README.zh-TW.md`. Order: pitch → screenshots → how it works → quick start → requirements → config table → build the app → contributing → license and third-party.
- [ ] `CONTRIBUTING.md` (TDD rule, how to run each suite), `SECURITY.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1, by reference).
- [ ] `.github/ISSUE_TEMPLATE/bug_report.yml`, `feature_request.yml`, `config.yml` (blank issues off; security goes to advisories), `.github/PULL_REQUEST_TEMPLATE.md`, `.github/dependabot.yml`.
- [ ] Commit.

### Task 3: CI

- [ ] `.github/workflows/ci.yml` with these jobs:
  - `backend`: Python 3.12, `pip install -r backend/requirements.txt`, `pytest -q`.
  - `app`: Node 22, `npm ci` with legacy-peer-deps, `npx jest --ci`, `npx tsc --noEmit`.
  - `console`: `npm ci`, `npm test`, `npm run build`.
  - `docker`: build `backend/Dockerfile` with the repo-root context, run it with `HAOJI_ADMIN_TOKEN=ci`, then `curl -sf localhost:7780/api/status`.
  - `public-check`: `scripts/check-public.sh`.
- [ ] Push and confirm the workflow is green on the PR. Commit.
