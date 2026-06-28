# 好記 Haoji — App Screens + Recording (B2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The screens and recording flow of the Expo app on top of the B1 foundation: record/upload → processing → transcript + AI-notes results, with on-device persistence. Native audio is mocked in jest; visual + audio behaviour is verified manually in Expo Go.

**Architecture:** React Navigation (native-stack) with four screens under `app/screens/`, two native-wrapping hooks (`useRecorder`, `usePlayer`) under `app/hooks/`, consuming the B1 `lib/` modules (api, store, transcript, gating). Pure logic and component behaviour are unit-tested with @testing-library/react-native; `expo-av`, `expo-document-picker`, `expo-clipboard`, `expo-sharing` are mocked. IAP unlock is stubbed here (a dev "unlock" action sets `unlocked=true`); real RevenueCat purchase is Plan B3.

**Tech Stack:** Expo SDK 52, React Native, TypeScript, @react-navigation/native + native-stack, expo-av, expo-document-picker, expo-clipboard, expo-sharing, jest v29 + @testing-library/react-native.

## Global Constraints

- App at `D:\projects\haoji\app` (monorepo). Display name **好記 Haoji**. Run tests from `app/` with `npm test`. Keep `jest` at v29 (jest-expo@56 incompatible with jest 30); install new deps with `--legacy-peer-deps`.
- Visual language (from `design/moodboard/`): white background, **red accent** `#E5342B`, big circular record button, minimalist, large whitespace, iOS-native feel.
- Free preview = `splitNotesForPreview(notes).preview` (B1); locked part shown blurred/obscured until `unlocked`. The model dropdown is **hidden by default** (revealed via a small "進階" toggle).
- No accounts. Every result persists to the B1 `SessionStore` and is re-openable offline.
- Backend base URL from `lib/config.ts` `API_BASE`.
- B1 interfaces (consume, do not change): `api.createSession/getSession/analyze/getModels`; `store.createAsyncStorageStore/SavedSession/SessionStore`; `transcript.mmss/nameOf/mergedParagraphs`; `gating.splitNotesForPreview`; types `Segment/Transcript/SessionStatus`.

---

### Task 1: Navigation deps + app entry + Home (session list) screen

**Files:**
- Modify: `app/package.json` (deps), `app/App.tsx`
- Create: `app/navigation.tsx`, `app/screens/HomeScreen.tsx`, `app/lib/store-context.tsx`
- Test: `app/screens/__tests__/HomeScreen.test.tsx`

**Interfaces:**
- Produces:
  - `RootStackParamList = { Home: undefined; Record: undefined; Processing: { sessionId: string }; Results: { sessionId: string } }`
  - `useStore(): SessionStore` (React context providing a single `createAsyncStorageStore()` instance; overridable in tests)
  - `HomeScreen` renders the saved-session list (newest first) + a primary "＋ 新錄音" button navigating to `Record`.

- [ ] **Step 1: Install navigation + native module deps**

Run (from `app/`):
```bash
npm install --legacy-peer-deps @react-navigation/native @react-navigation/native-stack react-native-screens react-native-safe-area-context
npm install --legacy-peer-deps expo-av expo-document-picker expo-clipboard expo-sharing
```

- [ ] **Step 2: Write `app/lib/store-context.tsx`**

```tsx
import React, { createContext, useContext } from 'react';
import { SessionStore } from './store';
import { createAsyncStorageStore } from './store';

const StoreContext = createContext<SessionStore | null>(null);

export function StoreProvider({ store, children }: { store?: SessionStore; children: React.ReactNode }) {
  const value = React.useMemo(() => store ?? createAsyncStorageStore(), [store]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): SessionStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore must be used within StoreProvider');
  return s;
}
```

- [ ] **Step 3: Write `app/navigation.tsx`**

```tsx
import { createNativeStackNavigator } from '@react-navigation/native-stack';

export type RootStackParamList = {
  Home: undefined;
  Record: undefined;
  Processing: { sessionId: string };
  Results: { sessionId: string };
};

export const Stack = createNativeStackNavigator<RootStackParamList>();
```

- [ ] **Step 4: Write `app/screens/HomeScreen.tsx`**

```tsx
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useStore } from '../lib/store-context';
import { SavedSession } from '../lib/store';
import { RootStackParamList } from '../navigation';

export default function HomeScreen() {
  const store = useStore();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [items, setItems] = useState<SavedSession[]>([]);

  useFocusEffect(useCallback(() => { store.list().then(setItems); }, [store]));

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>好記</Text>
      {items.length === 0 ? (
        <Text style={styles.empty} accessibilityRole="text">還沒有錄音，點下面開始第一筆。</Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => nav.navigate('Results', { sessionId: item.id })}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowMeta}>{new Date(item.createdAt).toLocaleString()}</Text>
            </Pressable>
          )}
        />
      )}
      <Pressable style={styles.primary} onPress={() => nav.navigate('Record')} accessibilityRole="button">
        <Text style={styles.primaryText}>＋ 新錄音</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 20, paddingTop: 60 },
  h1: { fontSize: 28, fontWeight: '800', color: '#1c1c1e', marginBottom: 16 },
  empty: { color: '#8e8e93', fontSize: 15, marginTop: 40, textAlign: 'center' },
  row: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  rowTitle: { fontSize: 16, fontWeight: '600', color: '#1c1c1e' },
  rowMeta: { fontSize: 12, color: '#8e8e93', marginTop: 2 },
  primary: { backgroundColor: '#E5342B', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 12 },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
```

- [ ] **Step 5: Write `app/App.tsx`**

```tsx
import 'react-native-gesture-handler';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from './navigation';
import { StoreProvider } from './lib/store-context';
import HomeScreen from './screens/HomeScreen';
import RecordScreen from './screens/RecordScreen';
import ProcessingScreen from './screens/ProcessingScreen';
import ResultsScreen from './screens/ResultsScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShadowVisible: false, headerTintColor: '#E5342B', title: '好記' }}>
            <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Record" component={RecordScreen} options={{ title: '錄音' }} />
            <Stack.Screen name="Processing" component={ProcessingScreen} options={{ title: '分析中', headerBackVisible: false }} />
            <Stack.Screen name="Results" component={ResultsScreen} options={{ title: '結果' }} />
          </Stack.Navigator>
        </NavigationContainer>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
```
(Stub `RecordScreen`, `ProcessingScreen`, `ResultsScreen` files are created in later tasks; to keep `App.tsx` compiling now, also create one-line placeholder default-export components for each — they will be overwritten. Placeholder example for `app/screens/RecordScreen.tsx`: `import {Text} from 'react-native'; export default function RecordScreen(){return <Text>Record</Text>;}` — same shape for Processing and Results.)

- [ ] **Step 6: Write the failing test `app/screens/__tests__/HomeScreen.test.tsx`**

```tsx
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import HomeScreen from '../HomeScreen';
import { StoreProvider } from '../../lib/store-context';
import { createMemoryStore, SavedSession } from '../../lib/store';

const mk = (id: string, t: number, title: string): SavedSession =>
  ({ id, createdAt: t, title, names: {}, unlocked: false });

const renderHome = (seed: SavedSession[] = []) => {
  const store = createMemoryStore(seed);
  const utils = render(
    <StoreProvider store={store}>
      <NavigationContainer>
        <HomeScreen />
      </NavigationContainer>
    </StoreProvider>,
  );
  return { store, ...utils };
};

test('shows empty state when no sessions', async () => {
  const { getByText } = renderHome([]);
  await waitFor(() => getByText(/還沒有錄音/));
});

test('lists saved sessions newest-first', async () => {
  const { getByText } = renderHome([mk('a', 1, '會議A'), mk('b', 2, '會議B')]);
  await waitFor(() => getByText('會議B'));
  getByText('會議A');
});

test('has a 新錄音 button', async () => {
  const { getByText } = renderHome([]);
  await waitFor(() => getByText('＋ 新錄音'));
});
```

- [ ] **Step 7: Run the tests**

Run: `npm test -- screens/__tests__/HomeScreen.test.tsx`
Expected: PASS (3 tests). If react-navigation needs a jest mock for `react-native-screens`/gesture-handler, add `app/jest.setup.js` with `jest.mock('react-native-screens', () => ({ enableScreens: () => {} }))` and reference it in `jest.config.js` `setupFiles`. (Only add if a test errors on a native screens import.)

- [ ] **Step 8: Commit**

```bash
git add app/
git commit -m "feat(app): navigation, store context, Home session-list screen"
```

---

### Task 2: `useRecorder` hook (expo-av wrapper)

**Files:**
- Create: `app/hooks/useRecorder.ts`
- Test: `app/hooks/__tests__/useRecorder.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';
  export type RecorderApi = {
    state: RecorderState; durationMs: number; meteringLevel: number; // 0..1
    start(): Promise<void>; pause(): Promise<void>; resume(): Promise<void>;
    stop(): Promise<{ uri: string; name: string; mime: string } | null>;
  };
  export function useRecorder(): RecorderApi;
  ```
- Uses `expo-av` `Audio.Recording` with metering enabled; maps `metering` dBFS (−160..0) to 0..1.

- [ ] **Step 1: Write the failing test `app/hooks/__tests__/useRecorder.test.tsx`**

```tsx
import { renderHook, act } from '@testing-library/react-native';

const recInstance = {
  prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
  startAsync: jest.fn().mockResolvedValue(undefined),
  pauseAsync: jest.fn().mockResolvedValue(undefined),
  stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
  setOnRecordingStatusUpdate: jest.fn(),
  getURI: jest.fn().mockReturnValue('file:///rec.m4a'),
};
jest.mock('expo-av', () => ({
  Audio: {
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    Recording: jest.fn().mockImplementation(() => recInstance),
    RecordingOptionsPresets: { HIGH_QUALITY: {} },
  },
}));

import { useRecorder } from '../useRecorder';

test('start → recording, stop returns a file descriptor', async () => {
  const { result } = renderHook(() => useRecorder());
  expect(result.current.state).toBe('idle');
  await act(async () => { await result.current.start(); });
  expect(result.current.state).toBe('recording');
  expect(recInstance.startAsync).toHaveBeenCalled();
  let file: any;
  await act(async () => { file = await result.current.stop(); });
  expect(file).toEqual({ uri: 'file:///rec.m4a', name: expect.stringMatching(/\.m4a$/), mime: 'audio/mp4' });
  expect(result.current.state).toBe('stopped');
});

test('pause then resume transitions state', async () => {
  const { result } = renderHook(() => useRecorder());
  await act(async () => { await result.current.start(); });
  await act(async () => { await result.current.pause(); });
  expect(result.current.state).toBe('paused');
  await act(async () => { await result.current.resume(); });
  expect(result.current.state).toBe('recording');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- hooks/__tests__/useRecorder.test.tsx`
Expected: FAIL (no hook).

- [ ] **Step 3: Write `app/hooks/useRecorder.ts`**

```ts
import { useRef, useState } from 'react';
import { Audio } from 'expo-av';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';
export type RecorderApi = {
  state: RecorderState; durationMs: number; meteringLevel: number;
  start(): Promise<void>; pause(): Promise<void>; resume(): Promise<void>;
  stop(): Promise<{ uri: string; name: string; mime: string } | null>;
};

const dbToLevel = (db?: number) => {
  if (db == null) return 0;
  const clamped = Math.max(-60, Math.min(0, db));
  return (clamped + 60) / 60;
};

export function useRecorder(): RecorderApi {
  const recRef = useRef<Audio.Recording | null>(null);
  const [state, setState] = useState<RecorderState>('idle');
  const [durationMs, setDurationMs] = useState(0);
  const [meteringLevel, setMeteringLevel] = useState(0);

  async function start() {
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) throw new Error('需要麥克風權限');
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true } as any);
    const rec = new Audio.Recording();
    const opts: any = { ...(Audio as any).RecordingOptionsPresets.HIGH_QUALITY, isMeteringEnabled: true };
    await rec.prepareToRecordAsync(opts);
    rec.setOnRecordingStatusUpdate((s: any) => {
      if (s?.isRecording) { setDurationMs(s.durationMillis ?? 0); setMeteringLevel(dbToLevel(s.metering)); }
    });
    await rec.startAsync();
    recRef.current = rec;
    setState('recording');
  }
  async function pause() { await recRef.current?.pauseAsync(); setState('paused'); }
  async function resume() { await recRef.current?.startAsync(); setState('recording'); }
  async function stop() {
    const rec = recRef.current;
    if (!rec) return null;
    await rec.stopAndUnloadAsync();
    const uri = rec.getURI() ?? '';
    recRef.current = null;
    setState('stopped'); setMeteringLevel(0);
    return uri ? { uri, name: `recording-${durationMs}.m4a`, mime: 'audio/mp4' } : null;
  }
  return { state, durationMs, meteringLevel, start, pause, resume, stop };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- hooks/__tests__/useRecorder.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/hooks/useRecorder.ts app/hooks/__tests__/useRecorder.test.tsx
git commit -m "feat(app): useRecorder hook over expo-av"
```

---

### Task 3: Record screen (big red button, level, pause/resume, upload)

**Files:**
- Create: `app/screens/RecordScreen.tsx` (overwrites the Task 1 placeholder)
- Test: `app/screens/__tests__/RecordScreen.test.tsx`

**Interfaces:**
- Consumes: `useRecorder`, `api.createSession`, `expo-document-picker`.
- Produces: on stop or upload, calls `createSession(file)` then `navigation.replace('Processing', { sessionId })`.

- [ ] **Step 1: Write the failing test `app/screens/__tests__/RecordScreen.test.tsx`**

```tsx
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const recApi = { state: 'idle', durationMs: 0, meteringLevel: 0,
  start: jest.fn(), pause: jest.fn(), resume: jest.fn(),
  stop: jest.fn().mockResolvedValue({ uri: 'file:///r.m4a', name: 'r.m4a', mime: 'audio/mp4' }) };
jest.mock('../../hooks/useRecorder', () => ({ useRecorder: () => recApi }));
jest.mock('../../lib/api', () => ({ createSession: jest.fn().mockResolvedValue('sess123') }));
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///u.m4a', name: 'u.m4a', mimeType: 'audio/mp4' }] }),
}));
const replace = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ replace }) }));

import RecordScreen from '../RecordScreen';
import * as api from '../../lib/api';

beforeEach(() => { jest.clearAllMocks(); recApi.state = 'idle'; });

test('tapping the record button starts recording', () => {
  const { getByLabelText } = render(<RecordScreen />);
  fireEvent.press(getByLabelText('開始錄音'));
  expect(recApi.start).toHaveBeenCalled();
});

test('uploading a file creates a session and navigates to Processing', async () => {
  const { getByText } = render(<RecordScreen />);
  fireEvent.press(getByText('上傳音檔 / 影片'));
  await waitFor(() => expect(api.createSession).toHaveBeenCalledWith({ uri: 'file:///u.m4a', name: 'u.m4a', mime: 'audio/mp4' }));
  expect(replace).toHaveBeenCalledWith('Processing', { sessionId: 'sess123' });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- screens/__tests__/RecordScreen.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write `app/screens/RecordScreen.tsx`**

```tsx
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { useRecorder } from '../hooks/useRecorder';
import { createSession } from '../lib/api';
import { mmss } from '../lib/transcript';

export default function RecordScreen() {
  const rec = useRecorder();
  const nav = useNavigation<any>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(file: { uri: string; name: string; mime: string }) {
    setBusy(true); setErr(null);
    try {
      const id = await createSession(file);
      nav.replace('Processing', { sessionId: id });
    } catch (e: any) { setErr(e?.message || '上傳失敗'); setBusy(false); }
  }
  async function onStop() { const f = await rec.stop(); if (f) await submit(f); }
  async function onUpload() {
    const res = await DocumentPicker.getDocumentAsync({ type: ['audio/*', 'video/*'], copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await submit({ uri: a.uri, name: a.name, mime: a.mimeType || 'application/octet-stream' });
  }

  const isRec = rec.state === 'recording';
  const isPaused = rec.state === 'paused';
  const scale = 1 + Math.min(0.25, rec.meteringLevel * 0.25);

  if (busy) return <View style={styles.center}><ActivityIndicator color="#E5342B" size="large" /><Text style={styles.hint}>上傳中…</Text></View>;

  return (
    <View style={styles.container}>
      <Text style={styles.time}>{mmss(Math.floor(rec.durationMs / 1000))}</Text>
      <View style={styles.recordWrap}>
        <View style={[styles.ring, { transform: [{ scale }], opacity: isRec ? 0.35 : 0 }]} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isRec ? '停止錄音' : '開始錄音'}
          style={[styles.recordBtn, (isRec || isPaused) && styles.recordBtnActive]}
          onPress={isRec || isPaused ? onStop : rec.start}
        >
          <View style={isRec ? styles.squareIcon : styles.circleIcon} />
        </Pressable>
      </View>
      {(isRec || isPaused) && (
        <Pressable style={styles.secondary} onPress={isPaused ? rec.resume : rec.pause} accessibilityRole="button">
          <Text style={styles.secondaryText}>{isPaused ? '繼續' : '暫停'}</Text>
        </Pressable>
      )}
      {rec.state === 'idle' && (
        <Pressable style={styles.uploadBtn} onPress={onUpload} accessibilityRole="button">
          <Text style={styles.uploadText}>上傳音檔 / 影片</Text>
        </Pressable>
      )}
      {err && <Text style={styles.err}>{err}</Text>}
    </View>
  );
}

const RED = '#E5342B';
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  hint: { color: '#8e8e93', marginTop: 12 },
  time: { fontSize: 44, fontWeight: '300', color: '#1c1c1e', fontVariant: ['tabular-nums'], marginBottom: 40 },
  recordWrap: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 200, height: 200, borderRadius: 100, backgroundColor: RED },
  recordBtn: { width: 120, height: 120, borderRadius: 60, backgroundColor: RED, alignItems: 'center', justifyContent: 'center' },
  recordBtnActive: { backgroundColor: '#fff', borderWidth: 4, borderColor: RED },
  circleIcon: { width: 0, height: 0 },
  squareIcon: { width: 34, height: 34, borderRadius: 6, backgroundColor: RED },
  secondary: { marginTop: 36, paddingVertical: 10, paddingHorizontal: 28, borderRadius: 22, backgroundColor: '#f2f2f7' },
  secondaryText: { color: '#1c1c1e', fontSize: 16, fontWeight: '600' },
  uploadBtn: { marginTop: 48, paddingVertical: 12, paddingHorizontal: 24 },
  uploadText: { color: RED, fontSize: 16, fontWeight: '600' },
  err: { color: RED, marginTop: 20 },
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- screens/__tests__/RecordScreen.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/screens/RecordScreen.tsx app/screens/__tests__/RecordScreen.test.tsx
git commit -m "feat(app): Record screen — big red button, pause/resume, upload"
```

---

### Task 4: Processing screen (upload poll → persist → Results)

**Files:**
- Create: `app/screens/ProcessingScreen.tsx` (overwrites placeholder)
- Test: `app/screens/__tests__/ProcessingScreen.test.tsx`

**Interfaces:**
- Consumes: `api.getSession`, `useStore`, route param `sessionId`.
- Produces: polls `getSession` every 1.5s; on `done`, upserts a `SavedSession` (transcript, default title from timestamp) then `navigation.replace('Results', { sessionId })`; on `error`, shows the message + a back action.

- [ ] **Step 1: Write the failing test `app/screens/__tests__/ProcessingScreen.test.tsx`**

```tsx
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const getSession = jest.fn();
jest.mock('../../lib/api', () => ({ getSession: (...a: any[]) => getSession(...a) }));
const replace = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ replace }),
  useRoute: () => ({ params: { sessionId: 'sess123' } }),
}));
import { StoreProvider } from '../../lib/store-context';
import { createMemoryStore } from '../../lib/store';
import ProcessingScreen from '../ProcessingScreen';

beforeEach(() => { jest.clearAllMocks(); });

test('polls until done, saves session, navigates to Results', async () => {
  getSession
    .mockResolvedValueOnce({ status: 'running', pct: 0.5, message: '辨識中…' })
    .mockResolvedValueOnce({ status: 'done', pct: 1, message: '完成',
      transcript: { segments: [{ start: 0, end: 1, speaker: 'SPEAKER_00', text: '你好' }], speakers: ['SPEAKER_00'] } });
  const store = createMemoryStore();
  render(<StoreProvider store={store}><ProcessingScreen /></StoreProvider>);
  await waitFor(() => expect(replace).toHaveBeenCalledWith('Results', { sessionId: 'sess123' }), { timeout: 8000 });
  const saved = await store.get('sess123');
  expect(saved?.transcript?.speakers).toEqual(['SPEAKER_00']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- screens/__tests__/ProcessingScreen.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write `app/screens/ProcessingScreen.tsx`**

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { getSession } from '../lib/api';
import { useStore } from '../lib/store-context';

export default function ProcessingScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const store = useStore();
  const sessionId: string = route.params.sessionId;
  const [message, setMessage] = useState('準備中…');
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    (async () => {
      while (!cancelled.current) {
        let s; try { s = await getSession(sessionId); } catch { await delay(1500); continue; }
        setMessage(s.message || s.status);
        if (s.status === 'done') {
          const existing = await store.get(sessionId);
          await store.upsert({
            id: sessionId, createdAt: existing?.createdAt ?? Date.now(),
            title: existing?.title ?? new Date().toLocaleString(),
            transcript: s.transcript, names: existing?.names ?? {},
            notes: existing?.notes, unlocked: existing?.unlocked ?? false,
          });
          nav.replace('Results', { sessionId });
          return;
        }
        if (s.status === 'error') { setError(s.error || s.message || '辨識失敗'); return; }
        await delay(1500);
      }
    })();
    return () => { cancelled.current = true; };
  }, [sessionId]);

  if (error) return (
    <View style={styles.center}>
      <Text style={styles.err}>{error}</Text>
      <Pressable style={styles.back} onPress={() => nav.navigate('Home')}><Text style={styles.backText}>返回</Text></Pressable>
    </View>
  );
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color="#E5342B" />
      <Text style={styles.msg}>{message}</Text>
    </View>
  );
}
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', padding: 24 },
  msg: { marginTop: 16, color: '#8e8e93', fontSize: 15 },
  err: { color: '#E5342B', fontSize: 16, textAlign: 'center' },
  back: { marginTop: 24, paddingVertical: 10, paddingHorizontal: 24, borderRadius: 20, backgroundColor: '#f2f2f7' },
  backText: { color: '#1c1c1e', fontWeight: '600' },
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- screens/__tests__/ProcessingScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/screens/ProcessingScreen.tsx app/screens/__tests__/ProcessingScreen.test.tsx
git commit -m "feat(app): Processing screen — poll, persist, route to Results"
```

---

### Task 5: `usePlayer` hook (expo-av playback + seek)

**Files:**
- Create: `app/hooks/usePlayer.ts`
- Test: `app/hooks/__tests__/usePlayer.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type PlayerApi = { positionMs: number; isPlaying: boolean;
    load(uri: string): Promise<void>; seek(ms: number): Promise<void>;
    toggle(): Promise<void>; unload(): Promise<void>; };
  export function usePlayer(): PlayerApi;
  ```
- Note: the MVP backend deletes the uploaded media after transcription, so remote playback is not available; this hook is used only when a local recording URI is retained on-device. If no playable URI, `seek`/`toggle` are safe no-ops. (Wire actual local-file retention in B-later; here the hook must simply not crash without a source.)

- [ ] **Step 1: Write the failing test `app/hooks/__tests__/usePlayer.test.tsx`**

```tsx
import { renderHook, act } from '@testing-library/react-native';
const sound = {
  playAsync: jest.fn().mockResolvedValue(undefined),
  pauseAsync: jest.fn().mockResolvedValue(undefined),
  setPositionAsync: jest.fn().mockResolvedValue(undefined),
  unloadAsync: jest.fn().mockResolvedValue(undefined),
  setOnPlaybackStatusUpdate: jest.fn(),
};
jest.mock('expo-av', () => ({ Audio: { Sound: { createAsync: jest.fn().mockResolvedValue({ sound }) } } }));
import { usePlayer } from '../usePlayer';

test('load then toggle plays; seek sets position', async () => {
  const { result } = renderHook(() => usePlayer());
  await act(async () => { await result.current.load('file:///r.m4a'); });
  await act(async () => { await result.current.toggle(); });
  expect(sound.playAsync).toHaveBeenCalled();
  await act(async () => { await result.current.seek(5000); });
  expect(sound.setPositionAsync).toHaveBeenCalledWith(5000);
});

test('seek without a loaded source is a no-op (no throw)', async () => {
  const { result } = renderHook(() => usePlayer());
  await act(async () => { await result.current.seek(1000); });
  expect(sound.setPositionAsync).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- hooks/__tests__/usePlayer.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write `app/hooks/usePlayer.ts`**

```ts
import { useRef, useState, useEffect } from 'react';
import { Audio } from 'expo-av';

export type PlayerApi = { positionMs: number; isPlaying: boolean;
  load(uri: string): Promise<void>; seek(ms: number): Promise<void>;
  toggle(): Promise<void>; unload(): Promise<void>; };

export function usePlayer(): PlayerApi {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  async function load(uri: string) {
    await unload();
    const { sound } = await Audio.Sound.createAsync({ uri });
    sound.setOnPlaybackStatusUpdate((s: any) => {
      if (s?.isLoaded) { setPositionMs(s.positionMillis ?? 0); setIsPlaying(!!s.isPlaying); }
    });
    soundRef.current = sound;
  }
  async function seek(ms: number) { await soundRef.current?.setPositionAsync(ms); }
  async function toggle() {
    const s = soundRef.current; if (!s) return;
    if (isPlaying) { await s.pauseAsync(); setIsPlaying(false); }
    else { await s.playAsync(); setIsPlaying(true); }
  }
  async function unload() { await soundRef.current?.unloadAsync(); soundRef.current = null; setIsPlaying(false); setPositionMs(0); }
  useEffect(() => () => { void unload(); }, []);
  return { positionMs, isPlaying, load, seek, toggle, unload };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- hooks/__tests__/usePlayer.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/hooks/usePlayer.ts app/hooks/__tests__/usePlayer.test.tsx
git commit -m "feat(app): usePlayer hook over expo-av Sound"
```

---

### Task 6: Results screen — 逐字稿 tab (segments, speaker rename) + tab shell

**Files:**
- Create: `app/screens/ResultsScreen.tsx` (overwrites placeholder)
- Create: `app/screens/TranscriptTab.tsx`
- Test: `app/screens/__tests__/TranscriptTab.test.tsx`

**Interfaces:**
- Consumes: `useStore`, route `sessionId`, `transcript.mmss/nameOf/mergedParagraphs`.
- Produces:
  - `ResultsScreen` loads the `SavedSession`, holds the two-tab state (`'transcript' | 'analysis'`), passes the session + an `onUpdate(updated: SavedSession)` (persists via store) to each tab.
  - `TranscriptTab` props `{ session: SavedSession; onUpdate(s: SavedSession): void }` — renders merged paragraphs with editable speaker names (editing a name updates `session.names[speaker]` and calls `onUpdate`).

- [ ] **Step 1: Write the failing test `app/screens/__tests__/TranscriptTab.test.tsx`**

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import TranscriptTab from '../TranscriptTab';
import { SavedSession } from '../../lib/store';

const session: SavedSession = {
  id: 's', createdAt: 1, title: 't', unlocked: false, names: {},
  transcript: { speakers: ['SPEAKER_00', 'SPEAKER_01'], segments: [
    { start: 0, end: 2, speaker: 'SPEAKER_00', text: '你好' },
    { start: 2, end: 4, speaker: 'SPEAKER_00', text: '今天開會' },
    { start: 4, end: 6, speaker: 'SPEAKER_01', text: '好' },
  ] },
};

test('renders merged paragraphs with timestamps', () => {
  const { getByText } = render(<TranscriptTab session={session} onUpdate={() => {}} />);
  getByText('你好今天開會');
  getByText('00:00');
});

test('editing a speaker name calls onUpdate with names mapping', () => {
  const onUpdate = jest.fn();
  const { getAllByPlaceholderText } = render(<TranscriptTab session={session} onUpdate={onUpdate} />);
  fireEvent.changeText(getAllByPlaceholderText('講者名稱')[0], 'Gary');
  expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ names: expect.objectContaining({ SPEAKER_00: 'Gary' }) }));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- screens/__tests__/TranscriptTab.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write `app/screens/TranscriptTab.tsx`**

```tsx
import React from 'react';
import { ScrollView, View, Text, TextInput, StyleSheet } from 'react-native';
import { SavedSession } from '../lib/store';
import { mmss, nameOf, mergedParagraphs } from '../lib/transcript';

export default function TranscriptTab({ session, onUpdate }: { session: SavedSession; onUpdate(s: SavedSession): void }) {
  const segs = session.transcript?.segments ?? [];
  const speakers = session.transcript?.speakers ?? [];
  const setName = (sp: string, name: string) =>
    onUpdate({ ...session, names: { ...session.names, [sp]: name } });

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.speakerRow}>
        {speakers.map((sp) => (
          <TextInput key={sp} style={styles.nameInput} placeholder="講者名稱"
            defaultValue={session.names[sp] ?? ''} onChangeText={(t) => setName(sp, t)} />
        ))}
      </View>
      {mergedParagraphs(segs).map((p, i) => (
        <View key={i} style={styles.para}>
          <Text style={styles.ts}>{mmss(p.start)}</Text>
          <View style={styles.body}>
            <Text style={styles.who}>{nameOf(p.speaker, session.names)}</Text>
            <Text style={styles.txt}>{p.text}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 16 },
  speakerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 12 },
  nameInput: { borderWidth: 1, borderColor: '#e5e5ea', borderRadius: 16, paddingVertical: 5, paddingHorizontal: 12, minWidth: 96, fontSize: 13 },
  para: { flexDirection: 'row', gap: 10, paddingVertical: 8 },
  ts: { width: 44, color: '#8e8e93', fontSize: 12, fontVariant: ['tabular-nums'], paddingTop: 2 },
  body: { flex: 1 },
  who: { fontSize: 12, fontWeight: '700', color: '#E5342B', marginBottom: 1 },
  txt: { fontSize: 15, color: '#1c1c1e', lineHeight: 22 },
});
```

- [ ] **Step 4: Write `app/screens/ResultsScreen.tsx`**

```tsx
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { useStore } from '../lib/store-context';
import { SavedSession } from '../lib/store';
import TranscriptTab from './TranscriptTab';
import AnalysisTab from './AnalysisTab';

export default function ResultsScreen() {
  const route = useRoute<any>();
  const store = useStore();
  const id: string = route.params.sessionId;
  const [session, setSession] = useState<SavedSession | null>(null);
  const [tab, setTab] = useState<'transcript' | 'analysis'>('transcript');

  useFocusEffect(useCallback(() => { store.get(id).then(setSession); }, [id, store]));

  const update = async (s: SavedSession) => { setSession(s); await store.upsert(s); };

  if (!session) return <View style={styles.center}><ActivityIndicator color="#E5342B" /></View>;
  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {(['transcript', 'analysis'] as const).map((t) => (
          <Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t === 'transcript' ? '逐字稿' : 'AI 分析'}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'transcript'
        ? <TranscriptTab session={session} onUpdate={update} />
        : <AnalysisTab session={session} onUpdate={update} />}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  tab: { flex: 1, paddingVertical: 13, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#E5342B' },
  tabText: { fontSize: 15, color: '#8e8e93', fontWeight: '600' },
  tabTextActive: { color: '#E5342B' },
});
```
(Create a one-line placeholder `app/screens/AnalysisTab.tsx` now so this compiles: `import {Text} from 'react-native'; export default function AnalysisTab(_:{session:any;onUpdate:any}){return <Text>AI</Text>;}` — Task 7 overwrites it.)

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- screens/__tests__/TranscriptTab.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add app/screens/ResultsScreen.tsx app/screens/TranscriptTab.tsx app/screens/AnalysisTab.tsx app/screens/__tests__/TranscriptTab.test.tsx
git commit -m "feat(app): Results shell (tabs) + 逐字稿 tab with speaker rename"
```

---

### Task 7: AI 分析 tab — generate, preview/locked, model dropdown, copy/export

**Files:**
- Create: `app/screens/AnalysisTab.tsx` (overwrites placeholder)
- Test: `app/screens/__tests__/AnalysisTab.test.tsx`

**Interfaces:**
- Consumes: `api.analyze`, `api.getModels`, `gating.splitNotesForPreview`, `transcript` names, `expo-clipboard`, `expo-sharing`.
- Produces: a "生成會議記錄" action that calls `analyze(id, { model, names })`, saves `notes` via `onUpdate`; renders `splitNotesForPreview(notes)` — `preview` always visible, `locked` shown blurred behind an "🔒 解鎖完整內容" button. The unlock button calls a prop `onUnlock()` (stubbed to set `unlocked=true` for now; B3 wires RevenueCat). Model dropdown hidden behind a small "進階" toggle, populated from `getModels()`. When `unlocked`, the full notes + 複製 / 匯出 actions show.

- [ ] **Step 1: Write the failing test `app/screens/__tests__/AnalysisTab.test.tsx`**

```tsx
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const analyze = jest.fn().mockResolvedValue({ notes: '## 會議摘要\n摘要內容\n\n## 討論重點\n- 機密重點', model: 'gemma4:e4b-it-qat' });
jest.mock('../../lib/api', () => ({ analyze: (...a: any[]) => analyze(...a), getModels: jest.fn().mockResolvedValue({ ok: true, models: ['gemma4:e4b-it-qat'], default: 'gemma4:e4b-it-qat' }) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn().mockResolvedValue(false), shareAsync: jest.fn() }));
import AnalysisTab from '../AnalysisTab';
import { SavedSession } from '../../lib/store';

const base: SavedSession = { id: 's', createdAt: 1, title: 't', unlocked: false, names: { SPEAKER_00: 'Gary' },
  transcript: { speakers: ['SPEAKER_00'], segments: [{ start: 0, end: 1, speaker: 'SPEAKER_00', text: '嗨' }] } };

beforeEach(() => jest.clearAllMocks());

test('generating notes calls analyze with names and saves via onUpdate', async () => {
  const onUpdate = jest.fn();
  const { getByText } = render(<AnalysisTab session={base} onUpdate={onUpdate} onUnlock={() => {}} />);
  fireEvent.press(getByText('生成會議記錄'));
  await waitFor(() => expect(analyze).toHaveBeenCalledWith('s', { model: undefined, names: { SPEAKER_00: 'Gary' } }));
  expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ notes: expect.stringContaining('會議摘要') }));
});

test('locked: shows preview, hides the locked detail behind unlock', () => {
  const s = { ...base, notes: '## 會議摘要\n摘要內容\n\n## 討論重點\n- 機密重點', unlocked: false };
  const { getByText, queryByText } = render(<AnalysisTab session={s} onUpdate={() => {}} onUnlock={() => {}} />);
  getByText(/摘要內容/);
  expect(queryByText(/機密重點/)).toBeNull();
  getByText('🔒 解鎖完整內容');
});

test('unlocked: shows full notes + 複製', () => {
  const s = { ...base, notes: '## 會議摘要\n摘要內容\n\n## 討論重點\n- 機密重點', unlocked: true };
  const { getByText } = render(<AnalysisTab session={s} onUpdate={() => {}} onUnlock={() => {}} />);
  getByText(/機密重點/);
  getByText('複製');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- screens/__tests__/AnalysisTab.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write `app/screens/AnalysisTab.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { analyze, getModels } from '../lib/api';
import { splitNotesForPreview } from '../lib/gating';
import { SavedSession } from '../lib/store';

export default function AnalysisTab({ session, onUpdate, onUnlock }:
  { session: SavedSession; onUpdate(s: SavedSession): void; onUnlock(): void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showAdv, setShowAdv] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string | undefined>(undefined);

  useEffect(() => { if (showAdv && models.length === 0) getModels().then((r) => setModels(r.models)).catch(() => {}); }, [showAdv]);

  async function generate() {
    setBusy(true); setErr(null);
    try {
      const r = await analyze(session.id, { model, names: session.names });
      onUpdate({ ...session, notes: r.notes });
    } catch (e: any) { setErr(e?.message || '生成失敗'); }
    setBusy(false);
  }
  async function copy() { await Clipboard.setStringAsync(session.notes ?? ''); }
  async function exportMd() {
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync('data:text/markdown,' + encodeURIComponent(session.notes ?? ''));
  }

  if (!session.notes) {
    return (
      <View style={styles.center}>
        {busy ? <><ActivityIndicator color="#E5342B" /><Text style={styles.hint}>本機 LLM 生成中…</Text></>
          : <>
              <Text style={styles.hint}>把逐字稿整理成會議記錄（摘要 / 重點 / 決議 / 待辦）。</Text>
              <Pressable style={styles.primary} onPress={generate}><Text style={styles.primaryText}>生成會議記錄</Text></Pressable>
              <Pressable onPress={() => setShowAdv((v) => !v)}><Text style={styles.adv}>進階</Text></Pressable>
              {showAdv && <Text style={styles.advList}>{models.map((m) => (m === model || (!model && models[0] === m) ? `● ${m}` : `○ ${m}`)).join('   ')}</Text>}
              {err && <Text style={styles.err}>{err}</Text>}
            </>}
      </View>
    );
  }

  const { preview, locked } = splitNotesForPreview(session.notes);
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 48 }}>
      <Text style={styles.md}>{preview}</Text>
      {session.unlocked ? (
        <>
          <Text style={styles.md}>{locked}</Text>
          <View style={styles.actions}>
            <Pressable style={styles.ghost} onPress={copy}><Text style={styles.ghostText}>複製</Text></Pressable>
            <Pressable style={styles.ghost} onPress={exportMd}><Text style={styles.ghostText}>匯出</Text></Pressable>
          </View>
        </>
      ) : (
        <View style={styles.lockWrap}>
          <Text style={[styles.md, styles.blurred]} numberOfLines={6}>{locked}</Text>
          <View style={styles.lockOverlay}>
            <Pressable style={styles.primary} onPress={onUnlock}><Text style={styles.primaryText}>🔒 解鎖完整內容</Text></Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}
const RED = '#E5342B';
const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 18, paddingTop: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', padding: 24 },
  hint: { color: '#8e8e93', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  md: { fontSize: 15, lineHeight: 24, color: '#1c1c1e' },
  primary: { backgroundColor: RED, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 28, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  adv: { color: '#8e8e93', marginTop: 16, fontSize: 13 },
  advList: { color: '#1c1c1e', marginTop: 8, fontSize: 13 },
  err: { color: RED, marginTop: 14 },
  lockWrap: { marginTop: 8 },
  blurred: { opacity: 0.25 },
  lockOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  ghost: { paddingVertical: 10, paddingHorizontal: 22, borderRadius: 20, backgroundColor: '#f2f2f7' },
  ghostText: { color: '#1c1c1e', fontWeight: '600' },
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- screens/__tests__/AnalysisTab.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the FULL suite, then commit**

Run: `npm test`
Expected: all PASS.
```bash
git add app/screens/AnalysisTab.tsx app/screens/__tests__/AnalysisTab.test.tsx
git commit -m "feat(app): AI 分析 tab — generate, preview/unlock gating, copy/export"
```

---

### Task 8: Wire dev unlock + manual device verification checklist

**Files:**
- Modify: `app/screens/ResultsScreen.tsx` (pass `onUnlock`)
- Create: `app/MANUAL-QA.md`
- Test: `app/screens/__tests__/ResultsScreen.unlock.test.tsx`

**Interfaces:**
- Produces: `ResultsScreen` passes `onUnlock={() => update({ ...session, unlocked: true })}` to `AnalysisTab` (dev stub; B3 replaces with a RevenueCat purchase). A manual QA doc lists what to verify in Expo Go (native bits jest can't cover).

- [ ] **Step 1: Write the failing test `app/screens/__tests__/ResultsScreen.unlock.test.tsx`**

```tsx
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { sessionId: 's' } }),
  useFocusEffect: (cb: any) => { const React = require('react'); React.useEffect(cb, []); },
}));
jest.mock('../../lib/api', () => ({ analyze: jest.fn(), getModels: jest.fn().mockResolvedValue({ ok: true, models: [], default: '' }) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn().mockResolvedValue(false), shareAsync: jest.fn() }));
import ResultsScreen from '../ResultsScreen';
import { StoreProvider } from '../../lib/store-context';
import { createMemoryStore, SavedSession } from '../../lib/store';

const s: SavedSession = { id: 's', createdAt: 1, title: 't', unlocked: false, names: {},
  notes: '## 會議摘要\n摘要\n\n## 討論重點\n- 機密', transcript: { speakers: [], segments: [] } };

test('tapping unlock reveals the locked detail', async () => {
  const store = createMemoryStore([s]);
  const { getByText, findByText, queryByText } = render(
    <StoreProvider store={store}><ResultsScreen /></StoreProvider>);
  fireEvent.press(await findByText('AI 分析'));
  expect(queryByText(/機密/)).toBeNull();
  fireEvent.press(getByText('🔒 解鎖完整內容'));
  await waitFor(() => getByText(/機密/));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- screens/__tests__/ResultsScreen.unlock.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Modify `app/screens/ResultsScreen.tsx`** — pass `onUnlock` to `AnalysisTab`

Change the analysis branch to:
```tsx
: <AnalysisTab session={session} onUpdate={update} onUnlock={() => update({ ...session, unlocked: true })} />}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- screens/__tests__/ResultsScreen.unlock.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write `app/MANUAL-QA.md`**

```markdown
# 好記 App — Manual QA (Expo Go)

Jest covers logic + component behaviour with native modules mocked. Verify these on a real device / simulator (`npx expo start`, open in Expo Go). Set `EXPO_PUBLIC_API_BASE` to the dev machine's LAN/Tailscale IP:8780 so the phone reaches the backend.

- [ ] Mic permission prompt appears on first record.
- [ ] Big red button records; timer counts up; button shows stop (square) while recording.
- [ ] Pause then 繼續 resumes; level/animation responds to voice.
- [ ] Stop → uploads → Processing shows progress → Results opens.
- [ ] Upload 音檔/影片 picker works; same flow to Results.
- [ ] 逐字稿 tab: paragraphs grouped by speaker; renaming a speaker updates all their lines and persists (re-open from Home).
- [ ] AI 分析 tab: 生成會議記錄 returns notes in Traditional Chinese; preview (摘要) visible, rest blurred + 解鎖 button.
- [ ] Tap 解鎖 → full notes show; 複製 copies; 匯出 opens share sheet.
- [ ] Kill + reopen app → session still listed on Home and fully readable offline.
```

- [ ] **Step 6: Run the FULL suite and commit**

Run: `npm test`
Expected: all PASS.
```bash
git add app/screens/ResultsScreen.tsx app/MANUAL-QA.md app/screens/__tests__/ResultsScreen.unlock.test.tsx
git commit -m "feat(app): dev unlock wiring + manual QA checklist"
```

---

## Self-Review

- **Spec coverage:** record (big red button, pause/resume, timer) T3; upload T3; processing/poll + persist T4; transcript display + speaker rename T6; AI notes generate + preview/unlock gating + model dropdown hidden + copy/export T7; on-device persistence + offline re-open T1/T4/T6; dev unlock stub T8 (real IAP = B3). Mini-player hook T5 is built but only wired when local recording URIs are retained (backend deletes server media) — noted as a known limitation for B-later.
- **Placeholder scan:** none — every step has full code. The one-line screen placeholders in T1/T6 are explicit, named, and overwritten by later tasks (not TBDs).
- **Type consistency:** `SavedSession`/`SessionStore` from B1 used unchanged; `RootStackParamList` route params (`sessionId`) consistent across navigate/replace/useRoute; tab components share the `{ session, onUpdate }` contract, AnalysisTab adds `onUnlock`; `createSession` file shape `{uri,name,mime}` matches `useRecorder.stop()` and the document-picker mapping.
- **Known limitation logged:** server deletes media post-transcription, so transcript tap-to-play needs retained local recording URIs; `usePlayer` exists but is not wired into TranscriptTab in B2 (avoids a broken seek against absent media). Wire when local-retention is added.

## Roadmap — remaining

**Plan B3 — IAP (RevenueCat):** replace the T8 dev `onUnlock` stub with a real consumable purchase (`react-native-purchases`, anonymous app user id); on success set `unlocked=true` + persist; restore-purchases; price display from the offering. Mock `react-native-purchases` in unit tests; manual sandbox purchase on device.
