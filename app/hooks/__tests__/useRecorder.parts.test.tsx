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
// Mirrors the real wrapper: calling it with no argument means the "interruption began" edge.
const mockInterrupt: { cb: null | ((e?: any) => void) } = { cb: null };
jest.mock('../../lib/audioInterruption', () => ({
  onAudioInterruption: (cb: (e: any) => void) => {
    mockInterrupt.cb = (e?: any) => cb(e ?? { type: 'began' });
    return () => { mockInterrupt.cb = null; };
  },
}));
// `onDisk` is what the session dir actually holds — the recorder now asks IT where the next part
// goes, because a call can suspend the app between writing a part and remembering that it did.
const onDisk: { files: string[] } = { files: [] };
jest.mock('../../lib/recordings', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  partPath: (s: string, i: number) => `file:///doc/haoji/${s}/part-${i}.m4a`,
  moveToPart: jest.fn((s: string, i: number, _src: string, ext = 'm4a') => {
    const uri = `haoji/${s}/part-${i}.${ext}`;
    if (!onDisk.files.includes(uri)) onDisk.files.push(uri);
    return Promise.resolve(uri);
  }),
  listPartsOnDisk: jest.fn(async () => [...onDisk.files]),
  nextPartIndex: jest.fn(async () => onDisk.files.length === 0 ? 0
    : Math.max(...onDisk.files.map((f) => Number(/part-(\d+)\./.exec(f)![1]))) + 1),
}));
import { useRecorder } from '../useRecorder';
import Sound from 'react-native-nitro-sound';
const S = Sound as unknown as Record<string, jest.Mock>;

beforeEach(() => {
  jest.clearAllMocks();
  onDisk.files = [];
  mockInterrupt.cb = null;
  S.startRecorder.mockResolvedValue('file:///tmp/rec.m4a');
  S.stopRecorder.mockResolvedValue('file:///tmp/rec.m4a');
  const { moveToPart } = require('../../lib/recordings');
  moveToPart.mockImplementation((s: string, i: number, _src: string, ext = 'm4a') => {
    const uri = `haoji/${s}/part-${i}.${ext}`;
    if (!onDisk.files.includes(uri)) onDisk.files.push(uri);
    return Promise.resolve(uri);
  });
});

test('start records with metering enabled', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  // startRecorder(path, audioSet, meteringEnabled=true)
  expect(S.startRecorder).toHaveBeenCalledWith(expect.stringContaining('rec-s-0'), expect.any(Object), true);
});

// The reported bug: a failed startRecorder must NOT leave the UI silently idle with no feedback.
test('startRecorder rejection surfaces an error and returns to idle (no silent hang)', async () => {
  // a real permission failure fails BOTH the PCM attempt and the AAC fallback
  S.startRecorder.mockRejectedValue(new Error('Recording permission denied. Please enable microphone access in Settings.'));
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  expect(result.current.state).toBe('idle');
  expect(result.current.error).toMatch(/麥克風權限/);
});

test('a generic startRecorder failure is reported, not swallowed', async () => {
  S.startRecorder.mockRejectedValue(new Error('Audio session setup failed: boom'));
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  expect(result.current.state).toBe('idle');
  expect(result.current.error).toMatch(/無法(開始|啟動)錄音|麥克風/);
});

test('clearError resets the error', async () => {
  S.startRecorder.mockRejectedValue(new Error('permission denied'));
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
  // the RELATIVE path the real moveToPart returns, with the extension actually recorded
  expect(parts).toEqual([{ uri: 'haoji/s/part-0.wav', durationMs: expect.any(Number) }]);
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

// Recording is the product. If PCM/WAV is refused (the format not surviving the native bridge showed
// up as OSStatus 1718449215 'fmt?', which made recording impossible), we must still capture audio —
// even though an AAC take loses the crash-recoverability WAV gives us.
test('WAV is attempted first and the part is stored as .wav', async () => {
  const { moveToPart } = require('../../lib/recordings');
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  expect(S.startRecorder).toHaveBeenCalledTimes(1);
  expect(S.startRecorder.mock.calls[0][0]).toMatch(/rec-s-0\.wav$/);
  await act(async () => { await result.current.stop(); });
  expect(moveToPart).toHaveBeenCalledWith('s', 0, expect.anything(), 'wav');
});

test('falls back to AAC when WAV is refused, and stores the part as .m4a', async () => {
  const { moveToPart } = require('../../lib/recordings');
  S.startRecorder
    .mockRejectedValueOnce(new Error("The operation couldn't be completed. (OSStatus error 1718449215.)"))
    .mockResolvedValueOnce('file:///tmp/rec.m4a');

  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });

  expect(S.startRecorder).toHaveBeenCalledTimes(2);
  expect(S.startRecorder.mock.calls[0][0]).toMatch(/\.wav$/);   // tried PCM first
  expect(S.startRecorder.mock.calls[1][0]).toMatch(/\.m4a$/);   // then AAC
  expect(result.current.state).toBe('recording');               // recording actually happens
  expect(result.current.error).toBeNull();

  await act(async () => { await result.current.stop(); });
  // stored under the extension that ACTUALLY got written — otherwise nothing could read it back
  expect(moveToPart).toHaveBeenCalledWith('s', 0, expect.anything(), 'm4a');
});

test('a genuine failure (e.g. no mic permission) is still surfaced, not hidden by the fallback', async () => {
  S.startRecorder.mockRejectedValue(new Error('Recording permission denied'));
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  expect(S.startRecorder).toHaveBeenCalledTimes(2);   // both routes tried
  expect(result.current.state).toBe('idle');
  expect(result.current.error).toMatch(/麥克風/);
});


// iOS reports BOTH edges of an interruption. Acting only on the start left a recording paused after
// (say) a demo video finished — everything said afterwards was lost unless the user noticed.
test('interruption ending with shouldResume starts a fresh part automatically', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  await act(async () => { mockInterrupt.cb?.({ type: 'began' }); });
  expect(result.current.state).toBe('paused');
  expect(result.current.wasInterrupted).toBe(true);

  await act(async () => { mockInterrupt.cb?.({ type: 'ended', shouldResume: true }); });

  expect(result.current.state).toBe('recording');          // carried on by itself
  expect(result.current.wasInterrupted).toBe(false);       // prompt cleared
  expect(S.startRecorder).toHaveBeenCalledTimes(2);        // part 0, then a fresh part 1
});

test('interruption ending WITHOUT shouldResume leaves the manual 繼續 prompt', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  await act(async () => { mockInterrupt.cb?.({ type: 'began' }); });
  await act(async () => { mockInterrupt.cb?.({ type: 'ended', shouldResume: false }); });

  expect(result.current.state).toBe('paused');             // iOS said not to resume — respect it
  expect(result.current.wasInterrupted).toBe(true);
  expect(S.startRecorder).toHaveBeenCalledTimes(1);
});

test('an interruption ending when we were never interrupted is ignored', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  await act(async () => { mockInterrupt.cb?.({ type: 'ended', shouldResume: true }); });
  expect(result.current.state).toBe('recording');
  expect(S.startRecorder).toHaveBeenCalledTimes(1);        // no spurious extra part
});

// 繼續錄音: the meeting's existing parts arrive ASYNCHRONOUSLY (the screen loads them from storage),
// so they are not present on first render. Capturing only that first value made a continued take
// restart at part-0 and overwrite the original recording.
test('parts that arrive after the first render are still continued, not overwritten', async () => {
  const { moveToPart } = require('../../lib/recordings');
  const existing = [
    { uri: 'haoji/s/part-0.wav', durationMs: 1000 },
    { uri: 'haoji/s/part-1.wav', durationMs: 2000 },
  ];
  onDisk.files = existing.map((p) => p.uri);   // an appended meeting's parts are real files

  // first render knows nothing (still loading), like the real screen
  const { result, rerender } = await renderHook(
    ({ parts }: { parts: any[] }) => useRecorder('s', parts),
    { initialProps: { parts: [] as any[] } },
  );
  await act(async () => { rerender({ parts: existing }); });
  expect(result.current.parts).toHaveLength(2);      // adopted once they landed

  await act(async () => { await result.current.start(); });
  // the new take must be part-2 — NOT part-0, which would clobber the original audio
  expect(S.startRecorder.mock.calls[0][0]).toMatch(/rec-s-2\./);

  await act(async () => { await result.current.stop(); });
  expect(moveToPart).toHaveBeenCalledWith('s', 2, expect.anything(), expect.any(String));
  expect(result.current.parts).toHaveLength(3);      // two old + one new, in order
});

test('existing parts arriving mid-take never disturb what is being recorded', async () => {
  const { result, rerender } = await renderHook(
    ({ parts }: { parts: any[] }) => useRecorder('s', parts),
    { initialProps: { parts: [] as any[] } },
  );
  await act(async () => { await result.current.start(); });
  await act(async () => { rerender({ parts: [{ uri: 'haoji/s/part-9.wav', durationMs: 1 }] }); });
  expect(result.current.state).toBe('recording');    // still recording, unaffected
  expect(result.current.parts).toHaveLength(0);      // the in-flight take's own list is untouched
});

// THE data-loss case. A phone call suspends the app; iOS can freeze us between writing a part to
// disk and recording in memory that we wrote it. The file survives, the bookkeeping does not — and
// the next part used to reuse index 0, which moveToPart deletes before writing. Everything recorded
// before the call was gone. Disk is what survives suspension, so disk decides where the next part goes.
test('a part on disk that memory forgot is never overwritten by the next one', async () => {
  const { moveToPart } = require('../../lib/recordings');
  onDisk.files = ['haoji/s/part-0.wav'];          // written just before the app was suspended

  const { result } = await renderHook(() => useRecorder('s'));   // memory knows nothing about it
  await act(async () => { await result.current.start(); });

  // the new take must go to part-1; part-0 is somebody's meeting
  expect(S.startRecorder.mock.calls[0][0]).toMatch(/rec-s-1\./);
  await act(async () => { await result.current.stop(); });
  expect(moveToPart).toHaveBeenCalledWith('s', 1, expect.anything(), expect.any(String));

  // and the forgotten part is picked back up rather than left orphaned
  expect(result.current.parts.map((p) => p.uri)).toEqual(['haoji/s/part-0.wav', 'haoji/s/part-1.wav']);
});

test('interrupt → resume keeps both parts, in order', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  await act(async () => { mockInterrupt.cb?.({ type: 'began' }); });   // the call arrives
  expect(result.current.parts.map((p) => p.uri)).toEqual(['haoji/s/part-0.wav']);

  await act(async () => { await result.current.resume(); });           // 繼續
  await act(async () => { await result.current.stop(); });

  expect(result.current.parts.map((p) => p.uri))
    .toEqual(['haoji/s/part-0.wav', 'haoji/s/part-1.wav']);
});

// After a call, resuming the SAME part can fail — the audio session was taken away. It used to fail
// silently (native reported success regardless), leaving the app "recording" into nothing.
test('a failed manual resume closes the part and opens a new one instead of recording into nothing', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  await act(async () => { await result.current.pause(); });

  S.resumeRecorder.mockRejectedValueOnce(new Error('無法恢復錄音（錄音器拒絕繼續）'));
  await act(async () => { await result.current.resume(); });

  expect(result.current.state).toBe('recording');
  // what was captured before the pause is safe, and the new audio goes to its own part
  expect(result.current.parts.map((p) => p.uri)).toEqual(['haoji/s/part-0.wav']);
  expect(S.startRecorder).toHaveBeenCalledTimes(2);
  expect(S.startRecorder.mock.calls[1][0]).toMatch(/rec-s-1\./);
});

// The path that actually loses meetings: resume fails, the UI falls back to idle, and the record
// button becomes "start" — which resets the part list, so the next take reuses index 0.
test('a resume that cannot restart stays PAUSED, never idle', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  await act(async () => { mockInterrupt.cb?.({ type: 'began' }); });

  S.startRecorder.mockRejectedValue(new Error('Audio session setup failed: busy'));
  await act(async () => { await result.current.resume(); });

  expect(result.current.state).toBe('paused');        // not 'idle'
  expect(result.current.wasInterrupted).toBe(true);   // the 繼續 prompt stays put
  expect(result.current.parts.map((p) => p.uri)).toEqual(['haoji/s/part-0.wav']);   // still ours
});
