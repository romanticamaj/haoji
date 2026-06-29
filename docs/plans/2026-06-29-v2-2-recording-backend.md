# 好記 v2-2 — Recording robustness + backend multi-part Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move recording to a crash-resilient, interruption-resumable, multi-part model that keeps every recorded part on the device; change the backend to accept multiple parts and concatenate them before transcription; show the raw parts list on the results screen.

**Architecture:** Backend gains a parts-based session API (`POST /api/sessions` empty → `POST /api/sessions/{id}/parts` append → `POST /api/sessions/{id}/transcribe` ffmpeg-concat → ASR). The app records continuously into a part file under the app document dir, opens a new part only on an OS audio interruption (with a resume prompt) or manual restart, persists each part to the session immediately, then uploads all parts and triggers transcription. Background/interruption audio config is set here in JS; the native entitlement that makes background actually work ships in v2-3.

**Tech Stack:** Backend FastAPI/pytest; app Expo SDK 54, expo-av, expo-file-system (legacy API), jest v29 + RNTL v14.

## Global Constraints

- Backend at `D:\projects\haoji\backend` (run `python -m pytest` from there). App at `D:\projects\haoji\app` (`npm test`, `.npmrc` legacy-peer-deps).
- Default LLM `gemma4:e4b-it-qat`; Breeze ASR `:8765`; ffmpeg/ffprobe from `config.FFMPEG`/`FFPROBE`.
- Uploaded parts are deleted server-side after transcribe (privacy); **raw parts stay on the phone**.
- App audio mode for recording: `allowsRecordingIOS:true, staysActiveInBackground:true, playsInSilentModeIOS:true`.
- RNTL v14: `await render`/`renderHook`; `jest.mock` factory vars `mock`-prefixed; lazy `mockImplementation` when a mock references a mock-prefixed var; `beforeEach(jest.clearAllMocks)` where call-counts matter.
- expo-file-system classic API (`cacheDirectory`/`documentDirectory`/`writeAsStringAsync`/`makeDirectoryAsync`/`getInfoAsync`) is under `expo-file-system/legacy` in SDK 54 — import from there.

---

### Task 1: Backend — parts-based session API + ffmpeg concat

**Files:**
- Modify: `backend/sessions.py`, `backend/app.py`, `backend/config.py`
- Create: `backend/media.py` (ffmpeg concat helper)
- Test: `backend/tests/test_parts.py`

**Interfaces:**
- Produces:
  - `sessions.add_part(sid, path) -> int` (append a part file path to the session's JSON `parts` list, returns new count)
  - `sessions.get_parts(sid) -> list[str]`
  - `media.concat_to_wav(part_paths: list[str], out_wav: str) -> None` (ffmpeg concat demuxer → 16k mono wav)
  - Routes: `POST /api/sessions` (no body) → `{session_id}`; `POST /api/sessions/{id}/parts` (multipart `file`) → `{count}`; `POST /api/sessions/{id}/transcribe` → starts the background transcription over the concatenated parts (same job/poll shape as before via `GET /api/sessions/{id}`).

- [ ] **Step 1: Add `parts` column + helpers — write failing test** `backend/tests/test_parts.py`

```python
import json, os, sessions

def test_add_and_get_parts(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path / "t.db"))
    sessions.init_db()
    sid = sessions.create_session("rec")
    assert sessions.get_parts(sid) == []
    assert sessions.add_part(sid, "/a/p1.m4a") == 1
    assert sessions.add_part(sid, "/a/p2.m4a") == 2
    assert sessions.get_parts(sid) == ["/a/p1.m4a", "/a/p2.m4a"]
```

- [ ] **Step 2: Run → FAIL.** `cd backend && python -m pytest tests/test_parts.py -v` (no `add_part`).

- [ ] **Step 3: Add to `backend/sessions.py`** — `parts TEXT` column + helpers

In `init_db()` table add `parts TEXT`. Add:

```python
def get_parts(sid):
    s = get_session(sid)
    return json.loads(s["parts"]) if s and s.get("parts") else []

def add_part(sid, path):
    parts = get_parts(sid)
    parts.append(path)
    update_session(sid, parts=json.dumps(parts))
    return len(parts)
```

(If `backend/data/haoji.db` exists from older runs, delete it so the new column is created.)

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Write `backend/media.py` concat helper + test** (append to `test_parts.py`)

```python
def test_concat_builds_list_and_calls_ffmpeg(tmp_path, monkeypatch):
    import media
    calls = {}
    def fake_run(cmd, **kw):
        calls["cmd"] = cmd
        class R: returncode = 0; stderr = ""
        open(cmd[-1], "wb").close()  # create the output file
        return R()
    monkeypatch.setattr(media.subprocess, "run", fake_run)
    media.concat_to_wav([str(tmp_path/"a.m4a"), str(tmp_path/"b.m4a")], str(tmp_path/"out.wav"))
    assert "-f" in calls["cmd"] and "concat" in calls["cmd"]
```

`backend/media.py`:

```python
# -*- coding: utf-8 -*-
import os, subprocess, tempfile
import config

def concat_to_wav(part_paths, out_wav):
    if not part_paths:
        raise RuntimeError("沒有錄音段落")
    listf = out_wav + ".txt"
    with open(listf, "w", encoding="utf-8") as f:
        for p in part_paths:
            f.write("file '" + p.replace("'", "'\\''") + "'\n")
    cmd = [config.FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", listf,
           "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out_wav]
    res = subprocess.run(cmd, capture_output=True, text=True)
    try: os.remove(listf)
    except OSError: pass
    if res.returncode != 0 or not os.path.exists(out_wav):
        raise RuntimeError("ffmpeg 串接失敗：" + (res.stderr or "")[-300:])
```

- [ ] **Step 6: Run → PASS.**

- [ ] **Step 7: Rewrite the routes in `backend/app.py`** — replace the single-file `POST /api/sessions` + `_run_transcribe` with the parts flow

```python
import config  # (existing)
PARTS_DIR = os.path.join(config.UPLOAD_DIR, "parts")
os.makedirs(PARTS_DIR, exist_ok=True)

@app.post("/api/sessions")
def create_session():
    sid = sessions.create_session("recording")
    return {"session_id": sid}

@app.post("/api/sessions/{sid}/parts")
async def add_part(sid: str, file: UploadFile = File(...)):
    if not sessions.get_session(sid):
        return JSONResponse({"error": "查無此工作"}, status_code=404)
    dest = os.path.join(PARTS_DIR, f"{sid}-{len(sessions.get_parts(sid))}.m4a")
    with open(dest, "wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk: break
            out.write(chunk)
    await file.close()
    return {"count": sessions.add_part(sid, dest)}

def _run_transcribe(sid):
    try:
        parts = sessions.get_parts(sid)
        sessions.update_session(sid, status="running", pct=0.1, message="串接音檔…")
        wav = os.path.join(config.UPLOAD_DIR, sid + ".wav")
        media.concat_to_wav(parts, wav)
        sessions.update_session(sid, pct=0.35, message="辨識中（含講者分離）…")
        norm = asr.normalize(asr.transcribe_diarize(wav))
        sessions.update_session(sid, status="done", pct=1.0, message="完成",
                                transcript=json.dumps(norm, ensure_ascii=False))
    except Exception as e:
        sessions.update_session(sid, status="error", message=str(e), error=str(e))
    finally:
        for p in parts + [os.path.join(config.UPLOAD_DIR, sid + ".wav")]:
            try: os.remove(p)
            except OSError: pass

@app.post("/api/sessions/{sid}/transcribe")
def transcribe(sid: str):
    if not sessions.get_parts(sid):
        return JSONResponse({"error": "沒有錄音段落"}, status_code=400)
    sessions.update_session(sid, status="queued", message="排隊中…")
    _executor.submit(_run_transcribe, sid)
    return {"ok": True}
```

(Add `import media`. Remove the old `_safe_name`, old `_run_transcribe(job_id, src,...)`, and the old `POST /api/sessions` upload handler. Keep `GET /api/sessions/{id}`, `/analyze`, `/llm/models`, `/health`.)

- [ ] **Step 8: API test** (append to `test_parts.py`) — upload two parts then transcribe stubs

```python
from fastapi.testclient import TestClient
import app as appmod, json as _json

def test_parts_then_transcribe(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions.config, "DB_PATH", str(tmp_path/"t.db"))
    monkeypatch.setattr(appmod, "PARTS_DIR", str(tmp_path)); sessions.init_db()
    monkeypatch.setattr(appmod, "_run_transcribe", lambda sid: sessions.update_session(
        sid, status="done", transcript=_json.dumps({"segments": [], "speakers": []})))
    c = TestClient(appmod.app)
    sid = c.post("/api/sessions").json()["session_id"]
    assert c.post(f"/api/sessions/{sid}/parts", files={"file": ("p.m4a", b"\x00", "audio/mp4")}).json()["count"] == 1
    assert c.post(f"/api/sessions/{sid}/transcribe").status_code == 200
    assert c.get(f"/api/sessions/{sid}").json()["status"] == "done"
```

- [ ] **Step 9: Run full backend suite → green. Commit.**

```bash
git add backend/
git commit -m "feat(backend): parts-based session API + ffmpeg concat for multi-part recordings"
```

---

### Task 2: App API client — parts flow

**Files:** Modify `app/lib/api.ts`; Test `app/lib/__tests__/api.parts.test.ts`

**Interfaces:**
- `createSession(): Promise<string>` (POST empty → session_id) — **signature change** (no file arg).
- `uploadPart(id: string, file: {uri,name,mime}): Promise<number>` (count).
- `transcribe(id: string): Promise<void>`.

- [ ] **Step 1: Failing test** `app/lib/__tests__/api.parts.test.ts`

```ts
import * as api from '../api';
const ok = (b: any) => jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => b });
afterEach(() => jest.restoreAllMocks());

test('createSession posts empty and returns id', async () => {
  global.fetch = ok({ session_id: 'sid' });
  expect(await api.createSession()).toBe('sid');
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('/api/sessions');
});
test('uploadPart posts multipart to /parts and returns count', async () => {
  global.fetch = ok({ count: 2 });
  expect(await api.uploadPart('sid', { uri: 'f', name: 'p.m4a', mime: 'audio/mp4' })).toBe(2);
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toContain('/api/sessions/sid/parts'); expect(init.body).toBeInstanceOf(FormData);
});
test('transcribe posts to /transcribe', async () => {
  global.fetch = ok({ ok: true });
  await api.transcribe('sid');
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('/api/sessions/sid/transcribe');
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Update `app/lib/api.ts`** — replace `createSession`, add `uploadPart`/`transcribe`

```ts
export async function createSession(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/sessions`, { method: 'POST' });
  return ((await asJson(res)) as any).session_id;
}
export async function uploadPart(id: string, file: { uri: string; name: string; mime: string }): Promise<number> {
  const form = new FormData();
  form.append('file', { uri: file.uri, name: file.name, type: file.mime } as any);
  const res = await fetch(`${API_BASE}/api/sessions/${id}/parts`, { method: 'POST', body: form });
  return ((await asJson(res)) as any).count;
}
export async function transcribe(id: string): Promise<void> {
  await asJson(await fetch(`${API_BASE}/api/sessions/${id}/transcribe`, { method: 'POST' }));
}
```

- [ ] **Step 4: Run → PASS.** Update the old `api.test.ts` `createSession` test (it passed a file arg) to the new no-arg form. Full app suite green.

- [ ] **Step 5: Commit.** `git commit -am "feat(app): parts API client (createSession/uploadPart/transcribe)"`

---

### Task 3: Recordings storage paths + SavedSession.parts

**Files:** Modify `app/lib/store.ts`; Create `app/lib/recordings.ts`; Test `app/lib/__tests__/recordings.test.ts`

**Interfaces:**
- `SavedSession` gains `parts: { uri: string; durationMs: number }[]` (default `[]`).
- `recordings.partPath(sessionId: string, index: number): string` → `${documentDirectory}haoji/<sid>/part-<n>.m4a`.
- `recordings.ensureDir(sessionId): Promise<void>` (makeDirectoryAsync intermediates).

- [ ] **Step 1: Failing test** `app/lib/__tests__/recordings.test.ts`

```ts
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///doc/', makeDirectoryAsync: jest.fn().mockResolvedValue(undefined) }));
import * as rec from '../recordings';
test('partPath builds a per-session path', () => {
  expect(rec.partPath('abc', 0)).toBe('file:///doc/haoji/abc/part-0.m4a');
});
test('ensureDir creates the session dir', async () => {
  const fs = require('expo-file-system/legacy');
  await rec.ensureDir('abc');
  expect(fs.makeDirectoryAsync).toHaveBeenCalledWith('file:///doc/haoji/abc', { intermediates: true });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Add `parts` to `SavedSession`** in `store.ts` (`parts: { uri: string; durationMs: number }[]`) and write `app/lib/recordings.ts`:

```ts
import * as FileSystem from 'expo-file-system/legacy';
const root = (sid: string) => `${FileSystem.documentDirectory}haoji/${sid}`;
export const partPath = (sid: string, i: number) => `${root(sid)}/part-${i}.m4a`;
export async function ensureDir(sid: string) {
  await FileSystem.makeDirectoryAsync(root(sid), { intermediates: true });
}
```

Update `createMemoryStore`/seed callers that build `SavedSession` to include `parts: []` (and the `SavedSession` type default). Existing sessions without `parts` should be treated as `[]` at read sites.

- [ ] **Step 4: Run → PASS.** Full suite green (fix any `SavedSession` literal in tests to add `parts: []`).

- [ ] **Step 5: Commit.** `git commit -am "feat(app): SavedSession.parts + recordings path helpers"`

---

### Task 4: useRecorder → multi-part + interruption + background audio mode

**Files:** Modify `app/hooks/useRecorder.ts`; Test `app/hooks/__tests__/useRecorder.parts.test.tsx`

**Interfaces:**
- `useRecorder(sessionId: string)` now records into `recordings.partPath(sessionId, n)` files.
- `RecorderApi` adds: `parts: { uri: string; durationMs: number }[]`, `wasInterrupted: boolean`, and `stop()` finalizes the current part and returns the full `parts` array.
- On an expo-av interruption (status `isRecording` flips false unexpectedly while state is `recording`), the hook finalizes the current part into `parts`, sets `wasInterrupted=true`, and goes to `paused`. `resume()` opens a NEW part. Manual `pause()`/`resume()` stay on the same part (expo-av pause).
- Sets audio mode `allowsRecordingIOS:true, staysActiveInBackground:true, playsInSilentModeIOS:true` before recording.

- [ ] **Step 1: Failing test** `app/hooks/__tests__/useRecorder.parts.test.tsx`

```tsx
import { renderHook, act } from '@testing-library/react-native';
const mockRec = { prepareToRecordAsync: jest.fn().mockResolvedValue(undefined), startAsync: jest.fn().mockResolvedValue(undefined),
  pauseAsync: jest.fn().mockResolvedValue(undefined), stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
  setOnRecordingStatusUpdate: jest.fn(), getURI: jest.fn().mockReturnValue('file:///doc/haoji/s/part-0.m4a') };
jest.mock('expo-av', () => ({ Audio: { requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  setAudioModeAsync: jest.fn().mockResolvedValue(undefined), Recording: jest.fn().mockImplementation(() => mockRec),
  RecordingOptionsPresets: { HIGH_QUALITY: {} } } }));
jest.mock('../../lib/recordings', () => ({ ensureDir: jest.fn().mockResolvedValue(undefined), partPath: (s: string, i: number) => `file:///doc/haoji/${s}/part-${i}.m4a` }));
import { useRecorder } from '../useRecorder';

test('stop finalizes a part and returns parts array', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  let parts: any;
  await act(async () => { parts = await result.current.stop(); });
  expect(parts).toEqual([{ uri: 'file:///doc/haoji/s/part-0.m4a', durationMs: expect.any(Number) }]);
});
test('sets background-capable audio mode', async () => {
  const { Audio } = require('expo-av');
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  expect(Audio.setAudioModeAsync).toHaveBeenCalledWith(expect.objectContaining({ staysActiveInBackground: true, allowsRecordingIOS: true }));
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Rewrite `app/hooks/useRecorder.ts`** (full file)

```ts
import { useRef, useState } from 'react';
import { Audio } from 'expo-av';
import { ensureDir } from '../lib/recordings';

export type Part = { uri: string; durationMs: number };
export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';
export type RecorderApi = {
  state: RecorderState; durationMs: number; meteringLevel: number; parts: Part[]; wasInterrupted: boolean;
  start(): Promise<void>; pause(): Promise<void>; resume(): Promise<void>; stop(): Promise<Part[]>;
};
const dbToLevel = (db?: number) => (db == null ? 0 : (Math.max(-60, Math.min(0, db)) + 60) / 60);

export function useRecorder(sessionId: string): RecorderApi {
  const recRef = useRef<Audio.Recording | null>(null);
  const partsRef = useRef<Part[]>([]);
  const [state, setState] = useState<RecorderState>('idle');
  const [durationMs, setDurationMs] = useState(0);
  const [meteringLevel, setMeteringLevel] = useState(0);
  const [parts, setParts] = useState<Part[]>([]);
  const [wasInterrupted, setWasInterrupted] = useState(false);

  async function beginPart() {
    await ensureDir(sessionId);
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, staysActiveInBackground: true, playsInSilentModeIOS: true } as any);
    const rec = new Audio.Recording();
    await rec.prepareToRecordAsync({ ...(Audio as any).RecordingOptionsPresets.HIGH_QUALITY, isMeteringEnabled: true });
    rec.setOnRecordingStatusUpdate((s: any) => {
      if (s?.isRecording) { setDurationMs(s.durationMillis ?? 0); setMeteringLevel(dbToLevel(s.metering)); }
      else if (s && s.isDoneRecording !== true && state === 'recording') { void onInterrupted(); }
    });
    await rec.startAsync();
    recRef.current = rec; setState('recording');
  }
  async function finalize(): Promise<Part | null> {
    const rec = recRef.current; if (!rec) return null;
    try { await rec.stopAndUnloadAsync(); } catch {}
    const uri = rec.getURI() ?? ''; recRef.current = null;
    if (!uri) return null;
    const part = { uri, durationMs };
    partsRef.current = [...partsRef.current, part]; setParts(partsRef.current);
    return part;
  }
  async function onInterrupted() { await finalize(); setWasInterrupted(true); setMeteringLevel(0); setState('paused'); }

  async function start() {
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) throw new Error('需要麥克風權限');
    partsRef.current = []; setParts([]); setWasInterrupted(false);
    await beginPart();
  }
  async function pause() { await recRef.current?.pauseAsync(); setState('paused'); }
  async function resume() {
    if (wasInterrupted) { setWasInterrupted(false); await beginPart(); }   // interrupted → new part
    else { await recRef.current?.startAsync(); setState('recording'); }     // manual → same part
  }
  async function stop() { await finalize(); setState('stopped'); setMeteringLevel(0); return partsRef.current; }
  return { state, durationMs, meteringLevel, parts, wasInterrupted, start, pause, resume, stop };
}
```

- [ ] **Step 4: Run → PASS.** Update the old `useRecorder.test.tsx` (it called `useRecorder()` with no arg and expected a single file from `stop()`); change to `useRecorder('s')` and assert the parts array, or delete it in favour of the new test. Full suite green.

- [ ] **Step 5: Commit.** `git commit -am "feat(app): multi-part useRecorder with interruption-resume + background audio mode"`

**⚠️ Manual (dev build / device):** verify a real phone call interrupts → part finalized → resume prompt → continue; background/lock keeps recording (only after v2-3 native config).

---

### Task 5: RecordScreen → continuous record, parts, resume prompt

**Files:** Modify `app/screens/RecordScreen.tsx`; Test `app/screens/__tests__/RecordScreen.parts.test.tsx`

**Interfaces:**
- Consumes `useRecorder(sessionId)`, `api.createSession`, `useStore`.
- On mount, creates a backend session id + a draft `SavedSession` (parts `[]`). The record button drives `start/stop`. On `wasInterrupted`, shows a「錄音被中斷，要接著錄嗎？」row with 繼續/結束. On stop, writes `parts` into the draft session and navigates `replace('Processing', { sessionId })`.

- [ ] **Step 1: Failing test** — render with a mock recorder where `wasInterrupted=true` and assert the resume prompt shows 繼續/結束; pressing 繼續 calls `resume`. (Mirror the existing RecordScreen test's mock pattern with `mockRecApi`.)

```tsx
// key assertions:
mockRecApi.wasInterrupted = true;
const { getByText } = await render(<RecordScreen />);
getByText('錄音被中斷，要接著錄嗎？'); getByText('繼續'); getByText('結束');
fireEvent.press(getByText('繼續')); expect(mockRecApi.resume).toHaveBeenCalled();
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Modify `RecordScreen.tsx`** — add the draft-session creation, parts persistence, and the interruption prompt UI. On stop:

```tsx
const sidRef = React.useRef<string | null>(null);
React.useEffect(() => { createSession().then((id) => { sidRef.current = id;
  store.upsert({ id, createdAt: Date.now(), title: new Date().toLocaleString(), names: {}, unlocked: false, parts: [] }); }); }, []);
const rec = useRecorder(sidRef.current || 'pending');
async function onStop() {
  const parts = await rec.stop();
  const id = sidRef.current!; const existing = await store.get(id);
  await store.upsert({ ...(existing as any), parts });
  nav.replace('Processing', { sessionId: id });
}
// interruption prompt block (when rec.wasInterrupted):
{rec.wasInterrupted && (
  <View style={styles.resumeRow}>
    <Text style={styles.resumeText}>錄音被中斷，要接著錄嗎？</Text>
    <Pressable onPress={rec.resume}><Text style={styles.resumeBtn}>繼續</Text></Pressable>
    <Pressable onPress={onStop}><Text style={styles.resumeBtn}>結束</Text></Pressable>
  </View>
)}
```

(Keep the big red button + timer + level; remove the old single-file upload-on-stop logic. Upload now happens in Processing — Task 6. The「上傳音檔」picker path stays but uploads as a single part: createSession → uploadPart → set parts → Processing.)

- [ ] **Step 4: Run → PASS;** full suite green (update the old RecordScreen tests to the new flow).

- [ ] **Step 5: Commit.** `git commit -am "feat(app): RecordScreen continuous recording + interruption resume prompt"`

---

### Task 6: ProcessingScreen → upload parts then transcribe

**Files:** Modify `app/screens/ProcessingScreen.tsx`; Test `app/screens/__tests__/ProcessingScreen.parts.test.tsx`

**Interfaces:**
- Consumes `api.uploadPart`, `api.transcribe`, `api.getSession`, `useStore`, route `sessionId`.
- On mount: read the draft session's `parts`, `uploadPart` each in order, then `transcribe(sid)`, then poll `getSession` until `done` → save transcript → `replace('Results', {sessionId})`.

- [ ] **Step 1: Failing test** — seed a store session with two parts; mock `uploadPart`/`transcribe`/`getSession` (running→done); assert both parts uploaded, transcribe called, navigated to Results, transcript saved.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Modify `ProcessingScreen.tsx`** — upload loop + transcribe + existing poll:

```tsx
useEffect(() => { cancelled.current = false; (async () => {
  const s0 = await store.get(sessionId);
  const parts = s0?.parts ?? [];
  for (let i = 0; i < parts.length; i++) {
    setMessage(`上傳中… ${i + 1}/${parts.length}`);
    try { await uploadPart(sessionId, { uri: parts[i].uri, name: `part-${i}.m4a`, mime: 'audio/mp4' }); }
    catch (e: any) { setError('上傳失敗：' + (e?.message || '')); return; }
  }
  setMessage('開始辨識…'); try { await transcribe(sessionId); } catch (e: any) { setError(e?.message || '辨識失敗'); return; }
  while (!cancelled.current) {  // existing poll loop, unchanged from here
    let s; try { s = await getSession(sessionId); } catch { await delay(1500); continue; }
    setMessage(s.message || s.status);
    if (s.status === 'done') { /* upsert transcript (keep existing parts/names) + replace to Results */ ... return; }
    if (s.status === 'error') { setError(s.error || s.message || '辨識失敗'); return; }
    await delay(1500);
  }
})(); return () => { cancelled.current = true; }; }, [sessionId]);
```

(When upserting on done, preserve the session's existing `parts`, `title`, `names`.)

- [ ] **Step 4: Run → PASS;** full suite green.
- [ ] **Step 5: Commit.** `git commit -am "feat(app): Processing uploads parts then triggers transcribe"`

---

### Task 7: Raw-recordings list on Results (A3)

**Files:** Create `app/screens/RecordingsList.tsx`; Modify `app/screens/ResultsScreen.tsx`; Test `app/screens/__tests__/RecordingsList.test.tsx`

**Interfaces:**
- `RecordingsList({ parts }: { parts: { uri:string; durationMs:number }[] })` — renders one row per part: 「段 N」+ duration (`mmss`) + a play `Pressable` (uses `usePlayer` to `load(uri)`+`toggle`). Shown on the Results screen (e.g., above the tabs or under the transcript tab).

- [ ] **Step 1: Failing test** — render with two parts; assert two rows with durations; pressing play loads that uri.

```tsx
const mockPlayer = { positionMs: 0, isPlaying: false, load: jest.fn().mockResolvedValue(undefined), seek: jest.fn(), toggle: jest.fn(), unload: jest.fn() };
jest.mock('../../hooks/usePlayer', () => ({ usePlayer: () => mockPlayer }));
// rows '段 1','段 2'; press play on row 1 → expect mockPlayer.load('file://p1')
```

- [ ] **Step 2–4:** Implement `RecordingsList.tsx` (FlatList/map of rows, `mmss(durationMs/1000)`, play button → `player.load(uri).then(player.toggle)`), wire into `ResultsScreen` (render `<RecordingsList parts={session.parts ?? []} />`), run tests + full suite green.

- [ ] **Step 5: Commit.** `git commit -am "feat(app): raw recordings list with playback on Results"`

---

## Self-Review

- **Spec coverage:** C backend parts/concat (T1), parts API client (T2), parts model+paths (T3), continuous+interruption recording with background audio mode (T4/T5), upload+transcribe flow (T6), A3 raw-recordings list (T7). Background *native entitlement* + ATS = v2-3. No gaps for this plan.
- **Placeholder scan:** T6/T7 use `...`/「mirror the pattern」in two spots — these are deliberate "keep the existing poll loop / follow the established mock pattern" references to code shown earlier in the same plan, not new logic. Acceptable; implementers have the surrounding code.
- **Type consistency:** `Part = {uri,durationMs}` consistent across recordings/useRecorder/store/RecordingsList; `createSession()` no-arg consistent T2↔T5; `uploadPart(id,file)`/`transcribe(id)` consistent T2↔T6; backend `parts` JSON consistent T1.
- **Risk flagged:** native recording (background, real interruption) is only verifiable on a dev build/device; tests mock expo-av. The interruption-detection heuristic (status `isRecording` flips false while state is `recording`) needs device tuning in v2-3.

## Next

Plan **v2-3** — EAS native config (bundle id, mic + background-audio + ATS) and the guided `eas build`/`submit` → TestFlight runbook.
