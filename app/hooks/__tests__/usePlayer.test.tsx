import { renderHook, act } from '@testing-library/react-native';

// Define the singleton methods INSIDE the factory (referencing an outer const here would be
// read at require-time, before it initializes → undefined). Assert via the imported Sound.
jest.mock('react-native-nitro-sound', () => ({
  __esModule: true,
  default: {
    startPlayer: jest.fn().mockResolvedValue('ok'),
    pausePlayer: jest.fn().mockResolvedValue('ok'),
    resumePlayer: jest.fn().mockResolvedValue('ok'),
    stopPlayer: jest.fn().mockResolvedValue('ok'),
    seekToPlayer: jest.fn().mockResolvedValue('ok'),
    addPlayBackListener: jest.fn(),
    removePlayBackListener: jest.fn(),
  },
}));
import { usePlayer } from '../usePlayer';
import Sound from 'react-native-nitro-sound';
const S = Sound as unknown as Record<string, jest.Mock>;

beforeEach(() => { jest.clearAllMocks(); });

test('load then toggle plays; seek sets position', async () => {
  const { result } = await renderHook(() => usePlayer());
  await act(async () => { await result.current.load('file:///r.m4a'); });
  await act(async () => { await result.current.toggle(); });
  expect(S.startPlayer).toHaveBeenCalledWith('file:///r.m4a');
  await act(async () => { await result.current.seek(5000); });
  expect(S.seekToPlayer).toHaveBeenCalledWith(5000);
});

test('toggle twice pauses (start then pause)', async () => {
  const { result } = await renderHook(() => usePlayer());
  await act(async () => { await result.current.load('file:///r.m4a'); });
  await act(async () => { await result.current.toggle(); });
  await act(async () => { await result.current.toggle(); });
  expect(S.pausePlayer).toHaveBeenCalled();
});

test('seek without a loaded source is a no-op (no throw)', async () => {
  const { result } = await renderHook(() => usePlayer());
  await act(async () => { await result.current.seek(1000); });
  expect(S.seekToPlayer).not.toHaveBeenCalled();
});
