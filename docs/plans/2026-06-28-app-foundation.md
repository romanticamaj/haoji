# 好記 Haoji — App Foundation (B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pure, device-independent foundation of the Expo app — project scaffold, typed API client to the backend, on-device session store, and transcript/preview-gating logic — all unit-tested with jest, no native device required.

**Architecture:** Expo (managed) + TypeScript monorepo sibling to `backend/`, at `D:\projects\haoji\app`. This plan delivers only `lib/` modules + tests (no screens yet). Screens/recording = Plan B2; IAP = Plan B3. Keeping logic in pure modules means the UI later is thin and the hard parts are tested now.

**Tech Stack:** Expo SDK 52+, React Native, TypeScript, jest (jest-expo preset), @react-native-async-storage/async-storage.

## Global Constraints

- App lives at `D:\projects\haoji\app` (monorepo with `backend/`). Bundle/display name: **好記 Haoji**.
- Backend base URL is configurable via `lib/config.ts` `API_BASE`; default `http://127.0.0.1:8780` (overridden per-device to the dev machine's LAN/Tailscale IP — the phone must reach the backend).
- Backend API contract (already built, do not change):
  - `POST /api/sessions` multipart field `file` → `{ session_id: string }` (400 on bad ext)
  - `GET /api/sessions/{id}` → `{ status: 'queued'|'running'|'done'|'error', pct: number, message: string, transcript?: { segments: Seg[], speakers: string[], stats, duration }, error?: string }` where `Seg = { start:number, end:number, speaker:string, text:string }`
  - `POST /api/sessions/{id}/analyze` body `{ model?: string, names?: Record<string,string> }` → `{ notes: string, model: string }`
  - `GET /api/llm/models` → `{ ok: boolean, models: string[], default: string }`
- No user accounts anywhere. Results persist on-device only.
- Meeting notes are Markdown; the **AI 分析** tab is gated: free preview = the `## 會議摘要` section only; the rest is locked until unlocked (IAP in B3).

---

### Task 1: Expo + TypeScript scaffold with jest

**Files:**
- Create: `app/package.json`, `app/app.json`, `app/tsconfig.json`, `app/jest.config.js`, `app/babel.config.js`
- Create: `app/lib/config.ts`
- Test: `app/lib/__tests__/config.test.ts`

**Interfaces:**
- Produces: `lib/config.ts` exporting `API_BASE: string`.

- [ ] **Step 1: Scaffold the Expo app (non-interactive) and add jest deps**

Run (from `D:/projects/haoji`):
```bash
npx --yes create-expo-app@latest app --template blank-typescript
cd app
npm install --save-dev jest jest-expo @types/jest @testing-library/react-native @testing-library/jest-native
npm install @react-native-async-storage/async-storage
```

- [ ] **Step 2: Write `app/jest.config.js`**

```js
module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@react-navigation/.*|@react-native-async-storage/.*))',
  ],
  setupFilesAfterEnv: ['@testing-library/jest-native/extend-expect'],
};
```

- [ ] **Step 3: Add the test script to `app/package.json`**

In `"scripts"`, add: `"test": "jest"`.

- [ ] **Step 4: Write `app/lib/config.ts`**

```ts
// Backend base URL. Override per-device (LAN/Tailscale IP of the dev machine).
// e.g. set EXPO_PUBLIC_API_BASE in an .env / app config for a real phone.
export const API_BASE: string =
  process.env.EXPO_PUBLIC_API_BASE ?? 'http://127.0.0.1:8780';
```

- [ ] **Step 5: Write the failing test `app/lib/__tests__/config.test.ts`**

```ts
import { API_BASE } from '../config';

test('API_BASE is a non-empty http url', () => {
  expect(typeof API_BASE).toBe('string');
  expect(API_BASE).toMatch(/^https?:\/\//);
});
```

- [ ] **Step 6: Run the test**

Run (from `app/`): `npm test -- lib/__tests__/config.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/
git commit -m "feat(app): scaffold Expo TS app with jest + config"
```

---

### Task 2: Typed API client

**Files:**
- Create: `app/lib/types.ts`
- Create: `app/lib/api.ts`
- Test: `app/lib/__tests__/api.test.ts`

**Interfaces:**
- Produces (`lib/types.ts`):
  ```ts
  export type Segment = { start: number; end: number; speaker: string; text: string };
  export type Transcript = { segments: Segment[]; speakers: string[]; duration?: number };
  export type SessionStatus = {
    status: 'queued' | 'running' | 'done' | 'error';
    pct: number; message: string; transcript?: Transcript; error?: string;
  };
  ```
- Produces (`lib/api.ts`):
  - `createSession(file: { uri: string; name: string; mime: string }): Promise<string>` (returns session_id)
  - `getSession(id: string): Promise<SessionStatus>`
  - `analyze(id: string, opts: { model?: string; names?: Record<string,string> }): Promise<{ notes: string; model: string }>`
  - `getModels(): Promise<{ ok: boolean; models: string[]; default: string }>`

- [ ] **Step 1: Write `app/lib/types.ts`** (exact types from the Interfaces block above)

- [ ] **Step 2: Write the failing test `app/lib/__tests__/api.test.ts`**

```ts
import * as api from '../api';

const mockFetch = (body: any, ok = true, status = 200) =>
  jest.fn().mockResolvedValue({ ok, status, json: async () => body } as any);

afterEach(() => jest.restoreAllMocks());

test('createSession posts multipart and returns session_id', async () => {
  global.fetch = mockFetch({ session_id: 'abc123' });
  const id = await api.createSession({ uri: 'file:///a.m4a', name: 'a.m4a', mime: 'audio/mp4' });
  expect(id).toBe('abc123');
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toContain('/api/sessions');
  expect(init.method).toBe('POST');
  expect(init.body).toBeInstanceOf(FormData);
});

test('getSession returns parsed status', async () => {
  global.fetch = mockFetch({ status: 'done', pct: 1, message: 'ok', transcript: { segments: [], speakers: [] } });
  const s = await api.getSession('abc123');
  expect(s.status).toBe('done');
  expect(s.transcript?.speakers).toEqual([]);
});

test('analyze sends model + names and returns notes', async () => {
  global.fetch = mockFetch({ notes: '## 會議摘要\nhi', model: 'gemma4:e4b-it-qat' });
  const r = await api.analyze('abc123', { model: 'm', names: { SPEAKER_00: 'Gary' } });
  expect(r.notes).toContain('## 會議摘要');
  const [, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(JSON.parse(init.body)).toEqual({ model: 'm', names: { SPEAKER_00: 'Gary' } });
});

test('createSession throws on non-ok response', async () => {
  global.fetch = mockFetch({ error: '不支援的檔案格式' }, false, 400);
  await expect(api.createSession({ uri: 'f', name: 'a.txt', mime: 'text/plain' })).rejects.toThrow();
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- lib/__tests__/api.test.ts`
Expected: FAIL (no module `api`).

- [ ] **Step 4: Write `app/lib/api.ts`**

```ts
import { API_BASE } from './config';
import { SessionStatus } from './types';

async function asJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error || `HTTP ${res.status}`);
  return body;
}

export async function createSession(file: { uri: string; name: string; mime: string }): Promise<string> {
  const form = new FormData();
  // React Native FormData accepts { uri, name, type } file objects
  form.append('file', { uri: file.uri, name: file.name, type: file.mime } as any);
  const res = await fetch(`${API_BASE}/api/sessions`, { method: 'POST', body: form });
  const body = await asJson(res);
  return (body as any).session_id;
}

export async function getSession(id: string): Promise<SessionStatus> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}`);
  return (await asJson(res)) as SessionStatus;
}

export async function analyze(
  id: string,
  opts: { model?: string; names?: Record<string, string> },
): Promise<{ notes: string; model: string }> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  return (await asJson(res)) as { notes: string; model: string };
}

export async function getModels(): Promise<{ ok: boolean; models: string[]; default: string }> {
  const res = await fetch(`${API_BASE}/api/llm/models`);
  return (await asJson(res)) as { ok: boolean; models: string[]; default: string };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- lib/__tests__/api.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add app/lib/types.ts app/lib/api.ts app/lib/__tests__/api.test.ts
git commit -m "feat(app): typed backend API client"
```

---

### Task 3: On-device session store

**Files:**
- Create: `app/lib/store.ts`
- Test: `app/lib/__tests__/store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SavedSession = {
    id: string; createdAt: number; title: string;
    transcript?: Transcript; names: Record<string,string>;
    notes?: string; unlocked: boolean;
  };
  export interface SessionStore {
    list(): Promise<SavedSession[]>;          // newest first
    get(id: string): Promise<SavedSession | null>;
    upsert(s: SavedSession): Promise<void>;
    remove(id: string): Promise<void>;
  }
  export function createAsyncStorageStore(): SessionStore;   // production (AsyncStorage)
  export function createMemoryStore(seed?: SavedSession[]): SessionStore; // tests
  ```
- Rationale: AsyncStorage (a single JSON index keyed `haoji.sessions`) is sufficient for a small on-device session list and trivially testable via the in-memory fake. (SQLite is overkill for MVP; revisit if the list grows large.)

- [ ] **Step 1: Write the failing test `app/lib/__tests__/store.test.ts`**

```ts
import { createMemoryStore, SavedSession } from '../store';

const mk = (id: string, t: number): SavedSession =>
  ({ id, createdAt: t, title: id, names: {}, unlocked: false });

test('upsert + get round-trips', async () => {
  const s = createMemoryStore();
  await s.upsert(mk('a', 1));
  expect((await s.get('a'))?.id).toBe('a');
  expect(await s.get('missing')).toBeNull();
});

test('list returns newest first', async () => {
  const s = createMemoryStore();
  await s.upsert(mk('old', 1));
  await s.upsert(mk('new', 2));
  expect((await s.list()).map(x => x.id)).toEqual(['new', 'old']);
});

test('upsert replaces existing by id; remove deletes', async () => {
  const s = createMemoryStore([mk('a', 1)]);
  await s.upsert({ ...mk('a', 1), unlocked: true });
  expect((await s.get('a'))?.unlocked).toBe(true);
  await s.remove('a');
  expect(await s.get('a')).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- lib/__tests__/store.test.ts`
Expected: FAIL (no module `store`).

- [ ] **Step 3: Write `app/lib/store.ts`**

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Transcript } from './types';

export type SavedSession = {
  id: string; createdAt: number; title: string;
  transcript?: Transcript; names: Record<string, string>;
  notes?: string; unlocked: boolean;
};

export interface SessionStore {
  list(): Promise<SavedSession[]>;
  get(id: string): Promise<SavedSession | null>;
  upsert(s: SavedSession): Promise<void>;
  remove(id: string): Promise<void>;
}

const KEY = 'haoji.sessions';
const sortNewest = (a: SavedSession[]) => [...a].sort((x, y) => y.createdAt - x.createdAt);

function fromMap(map: Record<string, SavedSession>): SessionStore {
  const save = async (m: Record<string, SavedSession>, persist?: (s: string) => Promise<void>) => {
    if (persist) await persist(JSON.stringify(m));
  };
  return {
    async list() { return sortNewest(Object.values(map)); },
    async get(id) { return map[id] ?? null; },
    async upsert(s) { map[s.id] = s; await save(map); },
    async remove(id) { delete map[id]; await save(map); },
  };
}

export function createMemoryStore(seed: SavedSession[] = []): SessionStore {
  const map: Record<string, SavedSession> = {};
  for (const s of seed) map[s.id] = s;
  return fromMap(map);
}

export function createAsyncStorageStore(): SessionStore {
  const read = async (): Promise<Record<string, SavedSession>> => {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  };
  const write = (m: Record<string, SavedSession>) => AsyncStorage.setItem(KEY, JSON.stringify(m));
  return {
    async list() { return sortNewest(Object.values(await read())); },
    async get(id) { return (await read())[id] ?? null; },
    async upsert(s) { const m = await read(); m[s.id] = s; await write(m); },
    async remove(id) { const m = await read(); delete m[id]; await write(m); },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/__tests__/store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/store.ts app/lib/__tests__/store.test.ts
git commit -m "feat(app): on-device session store (AsyncStorage + in-memory fake)"
```

---

### Task 4: Transcript display + preview-gating logic

**Files:**
- Create: `app/lib/transcript.ts`
- Create: `app/lib/gating.ts`
- Test: `app/lib/__tests__/transcript.test.ts`
- Test: `app/lib/__tests__/gating.test.ts`

**Interfaces:**
- Produces (`lib/transcript.ts`):
  - `mmss(t: number): string` → `"mm:ss"`
  - `nameOf(speaker: string, names: Record<string,string>): string`
  - `mergedParagraphs(segments: Segment[]): { speaker:string; start:number; text:string }[]` (merge consecutive same-speaker)
- Produces (`lib/gating.ts`):
  - `splitNotesForPreview(notesMarkdown: string): { preview: string; locked: string }` — `preview` = everything up to and including the `## 會議摘要` section (its heading + body until the next `## ` heading); `locked` = the remainder. If no `## 會議摘要` heading, preview = first 3 non-empty lines, rest locked.

- [ ] **Step 1: Write the failing test `app/lib/__tests__/transcript.test.ts`**

```ts
import { mmss, nameOf, mergedParagraphs } from '../transcript';

test('mmss formats seconds', () => {
  expect(mmss(0)).toBe('00:00');
  expect(mmss(75)).toBe('01:15');
});

test('nameOf falls back to the raw speaker label', () => {
  expect(nameOf('SPEAKER_00', { SPEAKER_00: 'Gary' })).toBe('Gary');
  expect(nameOf('SPEAKER_01', {})).toBe('SPEAKER_01');
});

test('mergedParagraphs merges consecutive same-speaker segments', () => {
  const segs = [
    { start: 0, end: 2, speaker: 'A', text: '你好' },
    { start: 2, end: 4, speaker: 'A', text: '今天開會' },
    { start: 4, end: 6, speaker: 'B', text: '好' },
  ];
  const p = mergedParagraphs(segs);
  expect(p.length).toBe(2);
  expect(p[0]).toMatchObject({ speaker: 'A', start: 0, text: '你好今天開會' });
  expect(p[1]).toMatchObject({ speaker: 'B', text: '好' });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- lib/__tests__/transcript.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `app/lib/transcript.ts`**

```ts
import { Segment } from './types';

export function mmss(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function nameOf(speaker: string, names: Record<string, string>): string {
  return names[speaker] || speaker;
}

export function mergedParagraphs(segments: Segment[]) {
  const out: { speaker: string; start: number; text: string }[] = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    if (last && last.speaker === s.speaker) last.text += s.text;
    else out.push({ speaker: s.speaker, start: s.start, text: s.text });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- lib/__tests__/transcript.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test `app/lib/__tests__/gating.test.ts`**

```ts
import { splitNotesForPreview } from '../gating';

const notes = `## 會議摘要
這是摘要第一行。
這是摘要第二行。

## 討論重點
- 重點一
- 重點二

## 決策
- 決策一`;

test('preview keeps only the 會議摘要 section; rest is locked', () => {
  const { preview, locked } = splitNotesForPreview(notes);
  expect(preview).toContain('## 會議摘要');
  expect(preview).toContain('摘要第二行');
  expect(preview).not.toContain('討論重點');
  expect(locked).toContain('## 討論重點');
  expect(locked).toContain('## 決策');
});

test('no 會議摘要 heading → preview is first 3 non-empty lines', () => {
  const plain = 'a\n\nb\nc\nd\ne';
  const { preview, locked } = splitNotesForPreview(plain);
  expect(preview.split('\n').filter(Boolean)).toEqual(['a', 'b', 'c']);
  expect(locked).toContain('d');
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test -- lib/__tests__/gating.test.ts`
Expected: FAIL.

- [ ] **Step 7: Write `app/lib/gating.ts`**

```ts
// Free preview = the 會議摘要 section only; everything else is locked behind IAP.
export function splitNotesForPreview(notes: string): { preview: string; locked: string } {
  const lines = notes.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => /^##\s*會議摘要/.test(l.trim()));
  if (startIdx === -1) {
    // Fallback: first 3 non-empty lines are the preview.
    const preview: string[] = [];
    let i = 0;
    for (; i < lines.length && preview.length < 3; i++) {
      if (lines[i].trim()) preview.push(lines[i]);
    }
    return { preview: preview.join('\n'), locked: lines.slice(i).join('\n').trim() };
  }
  // Find the next "## " heading after the summary section.
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim())) { endIdx = i; break; }
  }
  return {
    preview: lines.slice(startIdx, endIdx).join('\n').trim(),
    locked: lines.slice(endIdx).join('\n').trim(),
  };
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npm test -- lib/__tests__/gating.test.ts`
Expected: PASS.

- [ ] **Step 9: Run the FULL app suite and commit**

Run: `npm test`
Expected: all suites PASS.
```bash
git add app/lib/transcript.ts app/lib/gating.ts app/lib/__tests__/transcript.test.ts app/lib/__tests__/gating.test.ts
git commit -m "feat(app): transcript display helpers + preview-gating logic"
```

---

## Self-Review

- **Spec coverage (foundation slice):** API client covers upload/status/analyze/models (spec architecture); store covers on-device persistence + unlock flag (spec "結果存手機", no accounts); transcript helpers + gating cover the 逐字稿 display merge and the preview→unlock boundary (spec "預覽+解鎖完整"). Recording, screens, IAP, copy/export are intentionally B2/B3.
- **Placeholder scan:** none — every step has full code.
- **Type consistency:** `Segment`/`Transcript`/`SessionStatus` defined in Task 2 `types.ts` and consumed by Tasks 3 (`SavedSession.transcript`) and 4 (`mergedParagraphs(segments)`); `SessionStore`/`SavedSession` signatures match across store impls; `splitNotesForPreview` return shape `{preview, locked}` is the contract B2's results screen consumes.
- **Decision logged:** AsyncStorage-JSON store instead of SQLite for MVP simplicity + testability (spec named SQLite as an implementation detail; revisit at scale).

## Roadmap — remaining app plans

**Plan B2 — Screens + Recording** (needs Expo Go / simulator for manual native verification):
- expo-router navigation; Record screen (big red record button + live level meter via `expo-av` recording status, pause/resume/stop); upload entry (`expo-document-picker`); Processing screen (calls `createSession` → polls `getSession`); Results screen (Tab 逐字稿/AI 分析, segment list + mini player seek via `expo-av`, speaker rename writing to `store`, model dropdown hidden by default fed by `getModels`, AI 分析 preview via `splitNotesForPreview` + locked overlay, copy/export via `expo-clipboard` / `expo-sharing`). Component tests with @testing-library/react-native; manual device checklist for audio.

**Plan B3 — IAP + wiring** (needs RevenueCat account + App Store/Play sandbox):
- `react-native-purchases` (RevenueCat) with anonymous app user id; consumable "unlock this analysis"; on purchase success set `SavedSession.unlocked = true` and reveal locked notes; restore handling; price display. Mock `react-native-purchases` in unit tests; manual sandbox purchase verification.
