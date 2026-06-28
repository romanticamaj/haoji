import { renderHook, act } from '@testing-library/react-native';

const mockRecInstance = {
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
    Recording: jest.fn().mockImplementation(() => mockRecInstance),
    RecordingOptionsPresets: { HIGH_QUALITY: {} },
  },
}));

import { useRecorder } from '../useRecorder';

test('start → recording, stop returns a file descriptor', async () => {
  const { result } = await renderHook(() => useRecorder());
  expect(result.current.state).toBe('idle');
  await act(async () => { await result.current.start(); });
  expect(result.current.state).toBe('recording');
  expect(mockRecInstance.startAsync).toHaveBeenCalled();
  let file: any;
  await act(async () => { file = await result.current.stop(); });
  expect(file).toEqual({ uri: 'file:///rec.m4a', name: expect.stringMatching(/\.m4a$/), mime: 'audio/mp4' });
  expect(result.current.state).toBe('stopped');
});

test('pause then resume transitions state', async () => {
  const { result } = await renderHook(() => useRecorder());
  await act(async () => { await result.current.start(); });
  await act(async () => { await result.current.pause(); });
  expect(result.current.state).toBe('paused');
  await act(async () => { await result.current.resume(); });
  expect(result.current.state).toBe('recording');
});
