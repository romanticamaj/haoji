import { renderHook, act } from '@testing-library/react-native';

const mockSound = {
  playAsync: jest.fn().mockResolvedValue(undefined),
  pauseAsync: jest.fn().mockResolvedValue(undefined),
  setPositionAsync: jest.fn().mockResolvedValue(undefined),
  unloadAsync: jest.fn().mockResolvedValue(undefined),
  setOnPlaybackStatusUpdate: jest.fn(),
};
jest.mock('expo-av', () => ({ Audio: { Sound: { createAsync: jest.fn().mockImplementation(() => Promise.resolve({ sound: mockSound })) } } }));
import { usePlayer } from '../usePlayer';

beforeEach(() => { jest.clearAllMocks(); });

test('load then toggle plays; seek sets position', async () => {
  const { result } = await renderHook(() => usePlayer());
  await act(async () => { await result.current.load('file:///r.m4a'); });
  await act(async () => { await result.current.toggle(); });
  expect(mockSound.playAsync).toHaveBeenCalled();
  await act(async () => { await result.current.seek(5000); });
  expect(mockSound.setPositionAsync).toHaveBeenCalledWith(5000);
});

test('seek without a loaded source is a no-op (no throw)', async () => {
  const { result } = await renderHook(() => usePlayer());
  await act(async () => { await result.current.seek(1000); });
  expect(mockSound.setPositionAsync).not.toHaveBeenCalled();
});
