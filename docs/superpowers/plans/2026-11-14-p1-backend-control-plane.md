# P1 Backend control plane: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-hosting control plane to the FastAPI backend: status, settings, Ollama management, jobs, admin auth, pairing, and a static console mount. The phone and the console both consume it.

**Architecture:**
- New code lives in focused modules beside the existing ones: `settings.py`, `status.py`, `ollama_admin.py`, `jobs.py`, `auth.py`, `errors.py`.
- Each module exposes an `APIRouter` that `app.py` includes.
- The existing `/api/sessions*` endpoints stay byte-for-byte compatible.
- Shared response shapes are pinned by JSON contract fixtures, which the console and app tests reuse.

**Tech stack:** FastAPI 0.135, requests, SQLite, pytest + TestClient. No new runtime dependencies (`qrcode` lives in the console, not here).

**Spec:** `docs/superpowers/specs/2026-11-14-open-source-platform-design.md` §5.1

## Global constraints

- `/health`, `/api/sessions*`, `/api/llm/models` (`ok`, `models`, `default` keys) and `/api/debug/jobs` keep their current shapes.
- Env var wins over a stored setting, and that field reports `locked: true`.
- New error shape: `{"error": {"code": str, "message": str, "hint": str}}`. Codes: `unauthorized`, `forbidden_origin`, `invalid_setting`, `setting_locked`, `ollama_unreachable`, `model_in_use`, `not_found`.
- No transcript text, titles or filenames ever appear in `/api/jobs` or `/api/status`.
- Admin token:
  - `HAOJI_ADMIN_TOKEN` env, else `DATA_DIR/admin_token`, generated with `secrets.token_urlsafe(24)` on first use and logged once at startup.
- Pairing token:
  - `HAOJI_PAIRING_TOKEN` env, else `DATA_DIR/pairing_token`.
  - Enforced on `/api/sessions*` only when `HAOJI_REQUIRE_TOKEN=1`.
- Status probes are cached for 5 s (`STATUS_TTL = 5.0`).
- Tests use `tmp_path` for `DATA_DIR`/`DB_PATH` and monkeypatch `requests`/`subprocess`. No network, no GPU.

## Review focus

1. **Ollama down or slow.** `/api/status` must still answer within ~3 s, with `ollama.ok=false` and a hint. Test: `test_status_ollama_down_is_fast_and_hinted`.
2. **`nvidia-smi` missing, or returning garbage** (Mac dev, CPU box). Expect `gpu.available=false`, never a 500. Test: `test_gpu_absent` and `test_gpu_garbage_output`.
3. **Corrupt or blank settings value** (e.g. `ollama_base_url = "ftp://x"` or `""`). PUT must reject it with `invalid_setting`; the getter falls back to the default. Test: `test_put_rejects_bad_url`.
4. **Admin token absent or wrong on a mutating route.** Expect 401, and a cross-origin POST is rejected even with a valid token (DNS rebinding). Test: `test_cross_origin_post_rejected`.
5. **A pull of a nonexistent model.** The SSE stream must end with `status:"error"` and not hang. Test: `test_pull_error_terminates_stream`.

---

### Task 1: errors + settings store

**Files:**
- Create: `backend/errors.py`
- Create: `backend/settings.py`
- Modify: `backend/llm.py` (replace `config.OLLAMA_BASE` / `config.LLM_MODEL` with `settings.ollama_base()` / `settings.llm_model()`)
- Modify: `backend/app.py:411,441` (same replacement)
- Test: `backend/tests/test_settings.py`

**Interfaces:**
- Produces:
  - `errors.api_error(code: str, message: str, hint: str = "", status: int = 400) -> JSONResponse`
  - `settings.init()`, which creates the table `settings(key TEXT PRIMARY KEY, value TEXT)` in `config.DB_PATH`
  - `settings.get(key) -> Any`
  - `settings.set(key, value) -> None` (raises `SettingError(code, message)`)
  - `settings.describe() -> dict[str, {"value", "locked", "default"}]`
  - `settings.ollama_base() -> str`
  - `settings.llm_model() -> str`
  - `SETTINGS = {"ollama_base_url": ("OLLAMA_BASE_URL", default, validator), "llm_model": ("LLM_MODEL", default, validator)}`

- [ ] **Step 1: Write failing tests:**
  - `test_default_when_unset`: `ollama_base() == "http://127.0.0.1:11434"`.
  - `test_stored_value_wins_over_default`
  - `test_env_wins_and_locks`: with env `LLM_MODEL=x`, `describe()["llm_model"] == {"value": "x", "locked": True, ...}` and `set("llm_model", "y")` raises a `SettingError` with code `setting_locked`.
  - `test_put_rejects_bad_url`: `ftp://x` and `""` raise `invalid_setting`.
  - `test_trailing_slash_normalized`: `http://h:11434/` → `http://h:11434`.
- [ ] **Step 2: Run** `cd backend && .venv/bin/python -m pytest tests/test_settings.py -q`. Expect FAIL with ImportError.
- [ ] **Step 3: Implement.** Read env at call time (`os.environ.get`), not at import time, so tests can monkeypatch.
- [ ] **Step 4: Run** the full suite: `.venv/bin/python -m pytest -q`. Expect everything to pass, including the old `test_config_env`, `test_llm` and `test_api_analyze`.
- [ ] **Step 5: Commit** `feat(backend): settings store with env-locked overrides`.

### Task 2: admin auth + origin guard + pairing

**Files:**
- Create: `backend/auth.py`
- Test: `backend/tests/test_auth.py`

**Interfaces:**
- Produces:
  - `auth.admin_token() -> str`
  - `auth.pairing_token() -> str`
  - `auth.rotate_pairing() -> str`
  - `auth.require_admin`: a FastAPI dependency. It accepts `Authorization: Bearer <admin>` or the cookie `haoji_admin=<admin>`. Otherwise it raises a 401 carrying the error shape.
  - `auth.origin_guard`: middleware. For non-GET requests that carry an `Origin` header whose host ≠ the `Host` header, it returns 403 `forbidden_origin`.
  - `auth.pairing_guard`: a dependency for `/api/sessions*`. It is a no-op unless `HAOJI_REQUIRE_TOKEN=1`.
  - `router` (prefix `/api`):
    - `POST /console/login {token}` sets the httpOnly cookie, SameSite=Strict.
    - `GET /pairing` (admin) returns `{token, urls: [str], qr_payload: "haoji://pair?url=<urlenc first url>&token=<tok>"}`. `urls` = `HAOJI_PUBLIC_URLS` (comma-separated) first, then `http://<ip>:<WEB_PORT>` for each non-loopback IPv4 from `asr._local_ips()`.
    - `POST /pairing/rotate` (admin) returns `{token}`.

- [ ] **Step 1: Write failing tests:**
  - `test_admin_token_persisted_and_stable`
  - `test_env_admin_token_wins`
  - `test_require_admin_401_without_token`
  - `test_require_admin_ok_with_bearer_and_cookie`
  - `test_cross_origin_post_rejected`
  - `test_same_origin_post_allowed`
  - `test_no_origin_header_allowed` (curl)
  - `test_pairing_payload_shape`: assert it starts with `haoji://pair?url=http` and contains `&token=`.
  - `test_rotate_changes_token`
  - `test_sessions_open_by_default_and_guarded_when_required`: with `HAOJI_REQUIRE_TOKEN=1`, `POST /api/sessions` without a bearer → 401; with the pairing bearer → 200.
- [ ] **Step 2: Run** them and confirm they fail.
- [ ] **Step 3: Implement.** Wire `origin_guard` and `router` into `app.py`. Add `dependencies=[Depends(auth.pairing_guard)]` to the session routes.
- [ ] **Step 4: Run** the full suite and confirm it passes.
- [ ] **Step 5: Commit** `feat(backend): admin token, origin guard and phone pairing`.

### Task 3: status aggregation (`GET /api/status`)

**Files:**
- Create: `backend/status.py`
- Create: `backend/tests/fixtures/contracts/status.json`
- Test: `backend/tests/test_status.py`

**Interfaces:**
- Consumes:
  - `settings.ollama_base()` and `settings.llm_model()`
  - `asr.detect_asr_base()`
  - `app` job registries via `jobs.queue_counts()` (Task 4). Until Task 4 lands, pass a callable in.
- Produces:
  - `status.gpu_info(run=subprocess.run) -> dict`, which parses `nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits`.
  - `status.collect(detail: bool) -> dict`
  - `router` with `GET /api/status`. `?detail=1` requires admin and adds `gpu`, `llm.base_url`, `asr.base_url` and each check's `message`.
- Public shape:
  ```json
  {
    "version": "1.0.0",
    "ok": true,
    "checks": [{"id": "...", "ok": true, "label": "...", "hint": "..."}],
    "queue": {"active": 0, "queued": 0},
    "llm": {"model": "...", "reachable": true},
    "pairing_required": false
  }
  ```
- Check ids, in this order: `data_writable`, `sqlite`, `ffmpeg`, `breeze_asr`, `ollama`, `llm_model`. `llm_model` is ok only when the selected model is in the tags list.
- `version` comes from `config.VERSION = "1.0.0"`.

- [ ] **Step 1: Write failing tests:**
  - `test_status_all_green` (everything mocked healthy; matches the `status.json` key set)
  - `test_status_ollama_down_is_fast_and_hinted` (requests raises ConnectionError; elapsed < 3 s; the `ollama` check has a hint containing `OLLAMA_BASE_URL`)
  - `test_llm_model_missing_hint_pull`
  - `test_gpu_absent` (FileNotFoundError)
  - `test_gpu_garbage_output`
  - `test_gpu_parses_csv` ("NVIDIA RTX 4090, 5120, 24564, 37")
  - `test_detail_requires_admin`
  - `test_cached_within_ttl` (two calls → one probe)
- [ ] **Step 2:** Confirm they fail.
- [ ] **Step 3: Implement.** Probes use `timeout=2`, and a monotonic-clock cache keyed by `detail`.
- [ ] **Step 4:** Confirm they pass.
- [ ] **Step 5: Commit** `feat(backend): /api/status health checks, GPU and queue`.

### Task 4: jobs registry (`GET /api/jobs`)

**Files:**
- Create: `backend/jobs.py`
- Modify: `backend/app.py`. `_run_transcribe` and `_run_analyze` call `jobs.start(sid, kind)` and `jobs.finish(sid, kind, ok, error=None)`; `/api/debug/jobs` keeps its shape.
- Create: `backend/tests/fixtures/contracts/jobs.json`
- Test: `backend/tests/test_jobs.py`

**Interfaces:**
- Produces:
  - `jobs.start(sid, kind)`
  - `jobs.progress(sid, kind, pct, message)`
  - `jobs.finish(sid, kind, ok, error=None)`
  - `jobs.snapshot() -> {"active": [...], "recent": [...]}`
  - `jobs.queue_counts() -> {"active": int, "queued": int}`
  - Admin `router` with `GET /api/jobs`.
- Entry shape: `{id: sid[:6], kind, status: "queued"|"running"|"done"|"error", pct, message, started_at, finished_at, duration_s, error}`. `recent` is capped at 50, newest first. The registry is in memory and thread-safe (a Lock).
- [ ] **Step 1: Write failing tests:**
  - `test_lifecycle_moves_active_to_recent`
  - `test_recent_capped_50`
  - `test_no_titles_or_text_leak`: run a real `_run_transcribe` with ASR mocked, then assert the serialized snapshot contains neither the filename nor the segment text.
  - `test_jobs_requires_admin`
- [ ] **Step 2–4:** Run (fail), implement, run (pass).
- [ ] **Step 5: Commit** `feat(backend): jobs registry and /api/jobs`.

### Task 5: Ollama administration

**Files:**
- Create: `backend/ollama_admin.py`
- Create: `backend/tests/fixtures/contracts/models.json`
- Create: `backend/tests/fixtures/contracts/settings.json`
- Test: `backend/tests/test_ollama_admin.py`

**Interfaces:**
- Produces, all admin-guarded unless noted:
  - `GET /api/settings` → `settings.describe()`
  - `PUT /api/settings {key: value…}` → `describe()`, or `invalid_setting`/`setting_locked`
  - `POST /api/llm/test {base_url?}` → `{ok, version, models: [str]}`. When unreachable, it returns 200 with `{ok: false, error: {code: "ollama_unreachable", ...}}`.
  - `GET /api/models` → `{models: [{id, kind, name, state, size_bytes, managed_by, selected}]}`
    - ASR rows: `breeze-asr` (kind `asr`) and `pyannote` (kind `diarization`), with `managed_by: "breeze-asr"` and state `ready` if `detect_asr_base()`, else `unknown`.
    - LLM rows come from `/api/tags` sizes plus `/api/ps` (loaded → `state: "loaded"`).
  - `POST /api/llm/pull {name}` → 202 `{ok: true}`. It starts a thread that streams Ollama `/api/pull` (`stream: true`), updating `PULLS[name] = {status, completed, total, pct}`.
  - `GET /api/llm/pull/{name}/events` → `text/event-stream`. It emits `data: <json>\n\n` on every change (0.5 s poll) and ends after `status in ("success", "error")`.
  - `DELETE /api/llm/models/{name}` → Ollama `/api/delete`. Returns 409 `model_in_use` if `name == settings.llm_model()` and `jobs.queue_counts()["active"] > 0`.
- [ ] **Step 1: Write failing tests:**
  - `test_settings_get_put_roundtrip`
  - `test_put_locked_409`
  - `test_llm_test_ok`
  - `test_llm_test_unreachable`
  - `test_models_merges_asr_and_ollama` (loaded and selected flags)
  - `test_pull_progress_parses_stream` (fake iter_lines with digest/total/completed lines, then `{"status": "success"}`)
  - `test_pull_error_terminates_stream` (`{"error": "pull model manifest: file does not exist"}` → `status: "error"`, SSE closes)
  - `test_delete_in_use_409`
  - `test_delete_ok`
- [ ] **Step 2–4:** Run (fail), implement, run (pass).
- [ ] **Step 5: Commit** `feat(backend): Ollama connection, model list, pull with progress, delete`.

### Task 6: console static mount + Docker multi-stage + compose/env docs

**Files:**
- Modify: `backend/app.py`. If `config.CONSOLE_DIR` (env `HAOJI_CONSOLE_DIR`, default `ROOT/console/dist`) exists, mount `StaticFiles(html=True)` at `/console`, and make `GET /` redirect to `/console/`.
- Modify: `backend/Dockerfile`. Add stage 1 `node:22-slim`, which copies `app/lib/theme.ts` and `backend/console`, then runs `npm ci && npm run build`. Stage 2 is the current image with `COPY --from=console /src/backend/console/dist /app/console/dist`. The build context becomes the repo root, so update `docker-compose.yml` to `build: {context: ../.., dockerfile: backend/Dockerfile}`.
- Modify: `backend/config.py`. Delete the `_WINGET` personal path; use `_find(name, name)`.
- Modify: `backend/deploy/.env.example`. Add `HAOJI_ADMIN_TOKEN`, `HAOJI_PUBLIC_URLS`, `HAOJI_REQUIRE_TOKEN`.
- Test: `backend/tests/test_console_mount.py`

- [ ] **Step 1: Write failing tests:**
  - `test_console_served_when_dist_exists` (tmp dist with index.html; reload the app module with the env set)
  - `test_root_redirects_to_console`
  - `test_api_unaffected`
- [ ] **Step 2–4:** Run (fail), implement, run (pass).
- [ ] **Step 5: Commit** `feat(backend): serve the control console at /console`.

### Task 7: close the leak chain from `docs/system-design-note.md` §4

**Files:**
- Modify: `backend/app.py`
  - `/api/debug/jobs` is admin-only.
  - CORS is narrowed: `allow_origins` = `HAOJI_CORS_ORIGINS` (comma-separated, default empty). The phone app needs no CORS, and the console is same-origin.
  - New endpoint `DELETE /api/sessions/{sid}`, guarded by the pairing guard.
- Modify: `backend/sessions.py`
  - New `purge_expired(now, ttl_s)`: blanks `transcript` and `notes` on rows older than the TTL.
  - New `delete_session(sid)`.
- Modify: `backend/config.py`: `RETENTION_HOURS = int(env HAOJI_RETENTION_HOURS or 24)`.
- Test: `backend/tests/test_retention.py`

**Interfaces:**
- A background sweep runs at startup, then every 15 min on a daemon thread. It calls `sessions.purge_expired(time.time(), RETENTION_HOURS*3600)`.
- Retention can be set to 0. That means the transcript is cleared as soon as the client has fetched a `done` status once; a column `fetched_at` records that fetch.

- [ ] **Tests:**
  - `test_debug_jobs_requires_admin`
  - `test_cors_not_wildcard`: preflight from `https://evil.example` → no `access-control-allow-origin`.
  - `test_delete_session`
  - `test_purge_expired_blanks_text_keeps_row`
  - `test_retention_zero_purges_after_fetch`
- [ ] Run them (they should fail), implement, then run them again (they should pass).
- [ ] Commit `fix(backend): lock debug jobs, narrow CORS, server-side retention and delete`.

### Task 8: OpenAI-compatible LLM provider (the design note's "cloud API" profile)

**Files:**
- Modify: `backend/llm.py`. Add `OpenAICompatProvider`, which POSTs to `{base}/v1/chat/completions` with an optional Bearer key, applies the same prompt, and runs the same `<think>` strip and s2tw conversion.
- Modify: `backend/settings.py`. New keys:
  - `llm_provider` (`ollama` | `openai`, env `LLM_PROVIDER`)
  - `openai_base_url` (env `OPENAI_BASE_URL`)
  - `openai_api_key` (env `OPENAI_API_KEY`; **write-only**: `describe()` returns `{"configured": bool}`, never the value)
- Test: `backend/tests/test_llm_openai.py`

- [ ] **Tests:**
  - `test_provider_switch_by_setting`
  - `test_openai_payload_and_auth_header`
  - `test_api_key_never_returned`
  - `test_think_block_stripped`
- [ ] Run them (they should fail), implement, then run them again (they should pass).
- [ ] Commit.

## Self-review notes

- Spec §5.1 is covered as follows:
  - status → T3
  - settings → T1/T5
  - llm → T5
  - models → T5
  - jobs → T4
  - errors → T1
  - security → T2
  - static mount → T6
- `errors.api_error` is used by T2–T5.
- `jobs.queue_counts` is consumed by T3 and T5.
