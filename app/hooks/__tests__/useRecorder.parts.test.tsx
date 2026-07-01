import { renderHook, act } from '@testing-library/react-native';

// Singleton recorder mock — methods defined inline in the factory (an outer const would be
// read at require-time before it initializes). Assert via the imported Sound.
jest.mock('react-native-nitro-sound', () => ({
  __esModule: true,
  default: {
    startRecorder: jest.fn().mockResolvedValue('file:///tmp/rec.m4a'),
    pauseRecorder: jest.fn().mockResolvedValue('paused'),
    resumeRecorder: jest.fn().mockResolvedValue('resumed'),
    stopRecorder: jest.fn().mockResolvedValue('file:///tmp/rec.m4a'),
    addRecordBackListener: jest.fn(),
    removeRecordBackListener: jest.fn(),
  },
  AVEncoderAudioQualityIOSType: { high: 96 },
  AudioEncoderAndroidType: { AAC: 3 },
  OutputFormatAndroidType: { MPEG_4: 2 },
  AudioSourceAndroidType: { MIC: 1 },
}));
// Capture the interruption callback so a test can fire it (holder object avoids the TDZ hoist trap).
const mockInterrupt: { cb: null | (() => void) } = { cb: null };
jest.mock('../../lib/audioInterruption', () => ({
  onAudioInterruption: (cb: () => void) => { mockInterrupt.cb = cb; return () => { mockInterrupt.cb = null; }; },
}));
jest.mock('../../lib/recordings', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  partPath: (s: string, i: number) => `file:///doc/haoji/${s}/part-${i}.m4a`,
  moveToPart: jest.fn((s: string, i: number) => Promise.resolve(`file:///doc/haoji/${s}/part-${i}.m4a`)),
}));
import { useRecorder } from '../useRecorder';
import Sound from 'react-native-nitro-sound';
const S = Sound as unknown as Record<string, jest.Mock>;

beforeEach(() => {
  jest.clearAllMocks();
  mockInterrupt.cb = null;
  S.startRecorder.mockResolvedValue('file:///tmp/rec.m4a');
  S.stopRecorder.mockResolvedValue('file:///tmp/rec.m4a');
  const { moveToPart } = require('../../lib/recordings');
  moveToPart.mockImplementation((s: string, i: number) => Promise.resolve(`file:///doc/haoji/${s}/part-${i}.m4a`));
});

test('start records with metering enabled', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  // startRecorder(path, audioSet, meteringEnabled=true)
  expect(S.startRecorder).toHaveBeenCalledWith(expect.stringContaining('rec-s-0'), expect.any(Object), true);
});

// The reported bug: a failed startRecorder must NOT leave the UI silently idle with no feedback.
test('startRecorder rejection surfaces an error and returns to idle (no silent hang)', async () => {
  S.startRecorder.mockRejectedValueOnce(new Error('Recording permission denied. Please enable microphone access in Settings.'));
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  expect(result.current.state).toBe('idle');
  expect(result.current.error).toMatch(/麥克風權限/);
});

test('a generic startRecorder failure is reported, not swallowed', async () => {
  S.startRecorder.mockRejectedValueOnce(new Error('Audio session setup failed: boom'));
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  expect(result.current.state).toBe('idle');
  expect(result.current.error).toMatch(/無法(開始|啟動)錄音|麥克風/);
});

test('clearError resets the error', async () => {
  S.startRecorder.mockRejectedValueOnce(new Error('permission denied'));
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  expect(result.current.error).toBeTruthy();
  await act(async () => { result.current.clearError(); });
  expect(result.current.error).toBeNull();
});

test('stop finalizes a part and returns parts array', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  let parts: any;
  await act(async () => { parts = await result.current.stop(); });
  expect(parts).toEqual([{ uri: 'file:///doc/haoji/s/part-0.m4a', durationMs: expect.any(Number) }]);
});

// C1: interruption event finalizes the current part and flags wasInterrupted
test('interruption finalizes current part and sets wasInterrupted', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  await act(async () => { mockInterrupt.cb?.(); });
  expect(result.current.wasInterrupted).toBe(true);
  expect(result.current.parts).toHaveLength(1);
});

// resume after interruption starts a NEW part (not the same one)
test('resume after interruption begins a new part', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  await act(async () => { mockInterrupt.cb?.(); });
  await act(async () => { await result.current.resume(); });
  // startRecorder called twice: initial part-0 and the post-interruption part-1
  expect(S.startRecorder).toHaveBeenCalledTimes(2);
  expect(S.resumeRecorder).not.toHaveBeenCalled();
});

// I2: manual pause uses resumeRecorder (same part) and never sets wasInterrupted
test('manual pause then resume continues the same part', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  await act(async () => { await result.current.pause(); });
  await act(async () => { await result.current.resume(); });
  expect(result.current.wasInterrupted).toBe(false);
  expect(S.resumeRecorder).toHaveBeenCalled();
  expect(S.startRecorder).toHaveBeenCalledTimes(1); // still the original part
});

// interruption while paused (not recording) is ignored by the state guard
test('interruption while paused is ignored', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  await act(async () => { await result.current.pause(); });
  await act(async () => { mockInterrupt.cb?.(); });
  expect(result.current.wasInterrupted).toBe(false);
});
