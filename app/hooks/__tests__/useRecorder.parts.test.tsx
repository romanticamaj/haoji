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
