import { renderHook, act } from '@testing-library/react-native';
const mockRec = { prepareToRecordAsync: jest.fn().mockResolvedValue(undefined), startAsync: jest.fn().mockResolvedValue(undefined),
  pauseAsync: jest.fn().mockResolvedValue(undefined), stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
  setOnRecordingStatusUpdate: jest.fn(), getURI: jest.fn().mockReturnValue('file:///doc/haoji/s/part-0.m4a') };
jest.mock('expo-av', () => ({ Audio: { requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  setAudioModeAsync: jest.fn().mockResolvedValue(undefined), Recording: jest.fn().mockImplementation(() => mockRec),
  RecordingOptionsPresets: { HIGH_QUALITY: {} } } }));
jest.mock('../../lib/recordings', () => ({ ensureDir: jest.fn().mockResolvedValue(undefined),
  partPath: (s: string, i: number) => `file:///doc/haoji/${s}/part-${i}.m4a`,
  moveToPart: jest.fn((s: string, i: number) => Promise.resolve(`file:///doc/haoji/${s}/part-${i}.m4a`)) }));
import { useRecorder } from '../useRecorder';

beforeEach(() => {
  jest.clearAllMocks();
  // Re-establish return values that clearAllMocks wiped
  mockRec.prepareToRecordAsync.mockResolvedValue(undefined);
  mockRec.startAsync.mockResolvedValue(undefined);
  mockRec.pauseAsync.mockResolvedValue(undefined);
  mockRec.stopAndUnloadAsync.mockResolvedValue(undefined);
  mockRec.getURI.mockReturnValue('file:///doc/haoji/s/part-0.m4a');
  const { Audio } = require('expo-av');
  Audio.requestPermissionsAsync.mockResolvedValue({ granted: true });
  Audio.setAudioModeAsync.mockResolvedValue(undefined);
  const { ensureDir, moveToPart } = require('../../lib/recordings');
  ensureDir.mockResolvedValue(undefined);
  moveToPart.mockImplementation((s: string, i: number) => Promise.resolve(`file:///doc/haoji/${s}/part-${i}.m4a`));
});

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

// C1 fix: stateRef (not stale closure) makes interruption detection live
test('interruption fires onInterrupted when state is recording', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  // The callback was registered in beginPart; capture the most-recent registration
  const cb = mockRec.setOnRecordingStatusUpdate.mock.calls[0][0];
  await act(async () => { cb({ isRecording: false, isDoneRecording: false }); });
  expect(result.current.wasInterrupted).toBe(true);
  expect(result.current.parts).toHaveLength(1);
});

// I2 fix: pause() sets state BEFORE the expo-av call so the callback sees 'paused', not 'recording'
test('manual pause does not false-trigger interruption', async () => {
  const { result } = await renderHook(() => useRecorder('s'));
  await act(async () => { await result.current.start(); });
  const cb = mockRec.setOnRecordingStatusUpdate.mock.calls[0][0];
  // Pause first (sets stateRef to 'paused' synchronously before pauseAsync resolves)
  await act(async () => { await result.current.pause(); });
  // Now the hardware emits isRecording=false — must NOT be treated as interruption
  await act(async () => { cb({ isRecording: false, isDoneRecording: false }); });
  expect(result.current.wasInterrupted).toBe(false);
});
