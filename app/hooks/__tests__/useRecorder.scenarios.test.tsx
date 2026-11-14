/**
 * Audio must survive. These scenarios exist because each of them has, at some point, destroyed a
 * real recording: an interruption, a resume that failed, a take that was never finalised, a second
 * take opening the first one's file. They assert on where the AUDIO ends up — not on UI state, which
 * looked entirely correct while recordings were being deleted.
 */
import { renderHook, act } from '@testing-library/react-native';

// A fake filesystem good enough to catch the real failures: it tracks the session dir AND the cache,
// and models the one behaviour that did the damage — opening a path for recording truncates it.
const mockDisk = { parts: [] as string[], cache: new Map<string, number>() };

jest.mock('react-native-nitro-sound', () => ({
  __esModule: true,
  default: {
    startRecorder: jest.fn(),
    pauseRecorder: jest.fn().mockResolvedValue('paused'),
    resumeRecorder: jest.fn().mockResolvedValue('resumed'),
    stopRecorder: jest.fn(),
    addRecordBackListener: jest.fn(),
    removeRecordBackListener: jest.fn(),
  },
  AudioEncoderAndroidType: { AAC: 3 },
  OutputFormatAndroidType: { MPEG_4: 2 },
  AudioSourceAndroidType: { MIC: 1 },
}));
const interrupt: { cb: null | ((e?: any) => void) } = { cb: null };
jest.mock('../../lib/audioInterruption', () => ({
  onAudioInterruption: (cb: (e: any) => void) => {
    interrupt.cb = (e?: any) => cb(e ?? { type: 'began' });
    return () => { interrupt.cb = null; };
  },
}));
jest.mock('../../lib/recordings', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  partPath: (s: string, i: number) => `file:///doc/haoji/${s}/part-${i}.m4a`,
  moveToPart: jest.fn(async (sid: string, i: number, from: string, ext = 'm4a') => {
    const uri = `haoji/${sid}/part-${i}.${ext}`;
    // a move consumes the cache file, exactly like the real one
    mockDisk.cache.delete(from.replace('file://', ''));
    if (!mockDisk.parts.includes(uri)) mockDisk.parts.push(uri);
    return uri;
  }),
  listPartsOnDisk: jest.fn(async () => [...mockDisk.parts]),
  nextPartIndex: jest.fn(async () => mockDisk.parts.length === 0 ? 0
    : Math.max(...mockDisk.parts.map((p) => Number(/part-(\d+)\./.exec(p)![1]))) + 1),
}));

import { useRecorder } from '../useRecorder';
import Sound from 'react-native-nitro-sound';
const S = Sound as unknown as Record<string, jest.Mock>;

/** Recording into a path truncates whatever was there — the behaviour that ate the audio. */
const startsRecordingInto = (path: string) => { mockDisk.cache.set(path, 0); };

beforeEach(() => {
  jest.clearAllMocks();
  mockDisk.parts = [];
  mockDisk.cache = new Map();
  interrupt.cb = null;
  S.startRecorder.mockImplementation(async (path: string) => { startsRecordingInto(path); return path; });
  S.stopRecorder.mockImplementation(async () => {
    const last = [...mockDisk.cache.keys()].pop();
    if (last) mockDisk.cache.set(last, 5000);          // some audio got written
    return last ? `file://${last}` : '';
  });
  S.resumeRecorder.mockResolvedValue('resumed');
});

const uris = (r: any) => r.current.parts.map((p: any) => p.uri);

// ---------------------------------------------------------------------------------------------
test('plain take: one part, saved', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  await act(async () => { await result.current.stop(); });
  expect(uris(result)).toEqual(['haoji/s/part-0.wav']);
});

test('pause then resume stays ONE part (nothing split, nothing lost)', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  await act(async () => { await result.current.pause(); });
  await act(async () => { await result.current.resume(); });
  await act(async () => { await result.current.stop(); });
  expect(uris(result)).toEqual(['haoji/s/part-0.wav']);
});

test('call arrives → the audio so far is finalised before anything else happens', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  await act(async () => { interrupt.cb?.({ type: 'began' }); });
  expect(uris(result)).toEqual(['haoji/s/part-0.wav']);      // already safe on disk
  expect(result.current.state).toBe('paused');
});

test('call ends → recording carries on in a NEW part, keeping the first', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  await act(async () => { interrupt.cb?.({ type: 'began' }); });
  await act(async () => { interrupt.cb?.({ type: 'ended', shouldResume: true }); });
  await act(async () => { await result.current.stop(); });
  expect(uris(result)).toEqual(['haoji/s/part-0.wav', 'haoji/s/part-1.wav']);
});

test('manual 繼續 after a call keeps both parts', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  await act(async () => { interrupt.cb?.({ type: 'began' }); });
  await act(async () => { await result.current.resume(); });
  await act(async () => { await result.current.stop(); });
  expect(uris(result)).toEqual(['haoji/s/part-0.wav', 'haoji/s/part-1.wav']);
});

test('the call still holds the mic: resume fails, we stay paused and keep what we have', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  await act(async () => { interrupt.cb?.({ type: 'began' }); });

  // BOTH routes must fail — a single rejection is absorbed by the AAC fallback, which is correct.
  S.startRecorder.mockRejectedValue(new Error('session busy'));
  await act(async () => { await result.current.resume(); });

  expect(result.current.state).toBe('paused');           // never idle: idle re-arms "start"
  expect(result.current.wasInterrupted).toBe(true);
  expect(uris(result)).toEqual(['haoji/s/part-0.wav']);
});

test('after a failed resume, starting again does NOT overwrite the earlier part', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  await act(async () => { interrupt.cb?.({ type: 'began' }); });
  S.startRecorder.mockRejectedValue(new Error('session busy'));
  await act(async () => { await result.current.resume(); });

  S.startRecorder.mockImplementation(async (path: string) => { startsRecordingInto(path); return path; });
  await act(async () => { await result.current.start(); });      // the path that used to wipe
  await act(async () => { await result.current.stop(); });

  expect(uris(result)).toEqual(['haoji/s/part-0.wav', 'haoji/s/part-1.wav']);
});

test('an unfinalised take in the cache is never opened again by the next one', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  const firstTemp = S.startRecorder.mock.calls[0][0];
  mockDisk.cache.set(firstTemp.replace('file://', ''), 999);        // real audio, never finalised

  // the interruption was missed entirely, so nothing was saved; the user starts again
  await act(async () => { await result.current.start(); });
  const secondTemp = S.startRecorder.mock.calls[1][0];

  expect(secondTemp).not.toBe(firstTemp);                        // ← the collision that ate the audio
  expect(mockDisk.cache.get(firstTemp.replace('file://', ''))).toBe(999);   // still intact for recovery
});

test('stop after a missed interruption still saves whatever was captured', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  // no interruption event ever arrives — the recorder is dead but JS never heard about it
  S.stopRecorder.mockRejectedValueOnce(new Error('No recorder instance'));
  await act(async () => { await result.current.stop(); });
  expect(uris(result)).toEqual(['haoji/s/part-0.wav']);          // the temp is still promoted
});

test('appending to a meeting continues its numbering', async () => {
  mockDisk.parts = ['haoji/s/part-0.wav', 'haoji/s/part-1.wav'];
  const existing = mockDisk.parts.map((uri) => ({ uri, durationMs: 1000 }));
  const { result } = await renderHook(() => useRecorder('s', existing));
  await act(async () => { await result.current.start(); });
  await act(async () => { await result.current.stop(); });
  expect(uris(result)).toEqual(['haoji/s/part-0.wav', 'haoji/s/part-1.wav', 'haoji/s/part-2.wav']);
});

test('three interruptions in one meeting produce four ordered parts', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  for (let i = 0; i < 3; i++) {
    await act(async () => { interrupt.cb?.({ type: 'began' }); });
    await act(async () => { interrupt.cb?.({ type: 'ended', shouldResume: true }); });
  }
  await act(async () => { await result.current.stop(); });
  expect(uris(result)).toEqual([
    'haoji/s/part-0.wav', 'haoji/s/part-1.wav', 'haoji/s/part-2.wav', 'haoji/s/part-3.wav',
  ]);
});

test('a part already on disk that memory forgot is kept, not overwritten', async () => {
  mockDisk.parts = ['haoji/s/part-0.wav'];
  const { result } = await renderHook(() => useRecorder('s'));   // memory knows nothing
  await act(async () => { await result.current.start(); });
  await act(async () => { await result.current.stop(); });
  expect(uris(result)).toEqual(['haoji/s/part-0.wav', 'haoji/s/part-1.wav']);
});
