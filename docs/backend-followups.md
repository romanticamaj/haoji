# Backend — post-MVP follow-ups

From the final whole-branch review of `feat/backend-api` (2026-06-28). None are blockers for the local-dev MVP; address before moving the backend off the local host / to cloud.

## Do before cloud / public deploy
- **A4 — Upload size limit.** `create_session` streams with no cap; a large upload can fill disk. Add a max-size guard.
- **A5 — Tighten CORS.** Currently `allow_origins=["*"]` (safe now: no accounts/cookies). Restrict to the app origin once known.
- **A6 — Access control.** No authn; 12-hex session ids (48-bit) are guessable. Fine for local manager-hosted MVP; revisit for cloud.
- **A3 / M4 — Orphaned uploads on hard kill.** Media deletion is in the worker's `finally`; a hard process kill skips it. Add a startup sweep of `UPLOAD_DIR` for stale files and/or an executor shutdown hook.

## Cheap hardening (any time)
- **A1 — `analyze` empty/non-JSON body → 500.** Wrap `await req.json()` in try/except defaulting to `{}` (return clean 400).
- **A2 — OpenCC silent fallback.** `to_traditional` returns Simplified text on failure with no signal — violates the s2tw constraint silently. Log on fallback.
- **A7 — Loose Breeze detection.** `_is_breeze` accepts any `{"status":"ok"}` on `/health`; could latch onto an unrelated service on :8765. Tighten the check.
- **A8 — Error strings echoed to clients.** `analyze` / status return `str(e)`. Minor info disclosure; sanitize for non-local.
- **M1 — `update_session` column whitelist.** Column names are f-string-interpolated (keys internal-only, values parameterized — not injectable today). Add a whitelist as a footgun guard.
- **M2 — Remove dead `_safe_name()` in `app.py`.**
- **M3 — Remove unused `import io` in `test_api_upload.py`.**
- **M5 — Migrate `@app.on_event("startup")` → `lifespan`** (deprecated API; works on pinned fastapi 0.135.2).

## Latent
- **A9 — SQLite write contention.** Every ffmpeg progress line writes to the DB; shared file across 2 workers + request threads. Default busy-timeout makes locks unlikely at MVP scale; a latent throughput limit for cloud.

## v2-2 follow-ups (from final review, 2026-06-30 — non-blocking)
- **M1 (backend, Windows)**: `media.concat_to_wav` writes part paths with backslashes into the ffmpeg concat list; verify multi-part concat on the Windows host or normalize to forward slashes.
- **M2 (backend)**: after `_run_transcribe` deletes part files, the session's `parts` JSON still points at deleted paths — a re-`/transcribe` would fail at concat (no retry path today).
- **K1 (backend)**: `/api/sessions/{id}/parts` has no bad-ext/write-failure/404 tests (old single-file tests deleted); `add_part` leaves an orphan file on write failure. Add tests + cleanup.
- **K3 (app)**: there is no session-deletion UI yet; `haoji/<sid>/` part dirs grow unbounded. When delete is added, it must `deleteAsync(haoji/<sid>)` too.
- **M3 (app)**: part `durationMs` read from state can lag the final status tick (cosmetic — only the 段 N label).

## Backend uptime (recurring "後端又停掉了")
- **`run-forever.bat`** (new) auto-restarts `app.py` on exit + logs to `logs\backend.log`. Use it instead
  of `start.bat` (which runs once). Requires the console window to stay open / user logged in.
- **Durable upgrade — run as a Windows service (NSSM)** so it survives reboots + logoff and starts on
  boot: `choco install nssm` (or download), then
  `nssm install HaojiBackend "C:\path\to\python.exe" "C:\...\backend\app.py"`,
  set AppDirectory to the backend dir and `AppEnvironmentExtra PYTHONIOENCODING=utf-8`, then
  `nssm start HaojiBackend`. NSSM restarts the process automatically on crash. Do the same for the
  Breeze ASR (:8765) and confirm Ollama runs as a service, so a reboot brings the whole stack up.
- **Next crash → check `backend\logs\backend.log`** for the traceback; that tells us WHY it keeps
  stopping (vs. just papering over it with restarts).
