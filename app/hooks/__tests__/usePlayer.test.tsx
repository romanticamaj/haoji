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
    setPlaybackSpeed: jest.fn().mockResolvedValue('ok'),
    addPlayBackListener: jest.fn(),
    removePlayBackListener: jest.fn(),
  },
}));
import { usePlayer } from '../usePlayer';
import Sound from 'react-native-nitro-sound';
const S = Sound as unknown as Record<string, jest.Mock>;

beforeEach(() => { jest.clearAllMocks(); });

test('toggle plays the uri; a later seek forwards to the native player and updates position', async () => {
  const { result } = await renderHook(() => usePlayer());
  await act(async () => { await result.current.toggle('a.m4a'); });
  expect(S.startPlayer).toHaveBeenCalledWith('a.m4a');
  expect(result.current.isPlaying).toBe(true);
  expect(result.current.activeUri).toBe('a.m4a');
  await act(async () => { await result.current.seek('a.m4a', 5000); });
  expect(S.seekToPlayer).toHaveBeenCalledWith(5000);
  expect(result.current.positionMs).toBe(5000);
});

test('toggle twice on the same uri pauses', async () => {
  const { result } = await renderHook(() => usePlayer());
  await act(async () => { await result.current.toggle('a.m4a'); });
  await act(async () => { await result.current.toggle('a.m4a'); });
  expect(S.pausePlayer).toHaveBeenCalled();
  expect(result.current.isPlaying).toBe(false);
});

// Bug #1 / #3: seeking or skipping BEFORE play must move the on-screen playhead immediately (no
// snap-back) and take effect once playback starts — the old code no-op'd until startedRef was true.
test('seek before play commits the UI position and is applied on the next start', async () => {
  const { result } = await renderHook(() => usePlayer());
  await act(async () => { await result.current.seek('a.m4a', 3000); });
  expect(S.seekToPlayer).not.toHaveBeenCalled();   // no native player yet
  expect(result.current.positionMs).toBe(3000);    // …but the UI position is committed
  await act(async () => { await result.current.toggle('a.m4a'); });
  expect(S.startPlayer).toHaveBeenCalledWith('a.m4a');
  expect(S.seekToPlayer).toHaveBeenCalledWith(3000); // pending seek applied on start
});

test('seek clamps negatives to 0', async () => {
  const { result } = await renderHook(() => usePlayer());
  await act(async () => { await result.current.seek('a.m4a', -5000); });
  expect(result.current.positionMs).toBe(0);
});

// Bug #2: switching tracks/sessions must stop the previous one and reset — no carry-over.
test('switching to a different uri stops the previous track and resets state', async () => {
  const { result } = await renderHook(() => usePlayer());
  await act(async () => { await result.current.toggle('a.m4a'); });
  expect(result.current.activeUri).toBe('a.m4a');
  await act(async () => { await result.current.toggle('b.m4a'); });
  expect(S.stopPlayer).toHaveBeenCalled();
  expect(S.removePlayBackListener).toHaveBeenCalled();
  expect(S.startPlayer).toHaveBeenLastCalledWith('b.m4a');
  expect(result.current.activeUri).toBe('b.m4a');
});

test('reset stops playback and clears the active track', async () => {
  const { result } = await renderHook(() => usePlayer());
  await act(async () => { await result.current.toggle('a.m4a'); });
  await act(async () => { await result.current.reset(); });
  expect(S.stopPlayer).toHaveBeenCalled();
  expect(result.current.activeUri).toBeNull();
  expect(result.current.isPlaying).toBe(false);
  expect(result.current.positionMs).toBe(0);
});

test('setSpeed while playing applies immediately', async () => {
  const { result } = await renderHook(() => usePlayer());
  await act(async () => { await result.current.toggle('a.m4a'); });
  await act(async () => { await result.current.setSpeed('a.m4a', 2); });
  expect(S.setPlaybackSpeed).toHaveBeenCalledWith(2);
});
