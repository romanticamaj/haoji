import { AppState } from 'react-native';
import { renderHook, act } from '@testing-library/react-native';

const mockNavListeners: Record<string, () => void> = {};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    addListener: (ev: string, cb: () => void) => { mockNavListeners[ev] = cb; return () => { delete mockNavListeners[ev]; }; },
  }),
}));

import { useServerStatus, POLL_MS } from '../useServerStatus';
import * as server from '../../lib/server';
import * as config from '../../lib/config';

const status = require('../../../backend/tests/fixtures/contracts/status.json');
const green = { ...status, ok: true, checks: status.checks.map((c: any) => ({ ...c, ok: true })), queue: { active: 0, queued: 0 } };
const okFetch = (body: any) => jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });

let appStateHandler: ((s: string) => void) | undefined;
beforeEach(async () => {
  await server.forgetServer();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: any) => {
    appStateHandler = h;
    return { remove: jest.fn() };
  }) as any);
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

const flush = async () => { await act(async () => { await Promise.resolve(); }); };

test('reports ready with latency from the paired server', async () => {
  await server.saveServer({ url: 'http://box:7780', token: 'tok', pairedAt: 1 });
  global.fetch = okFetch(green);
  const { result } = await renderHook(() => useServerStatus());
  await flush();
  expect(result.current.loading).toBe(false);
  expect(result.current.summary).toMatchObject({ tone: 'ready', label: '主機已連線' });
  expect(result.current.base).toBe('http://box:7780');
  expect(typeof result.current.latencyMs).toBe('number');
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toBe('http://box:7780/api/status');
  expect(init.headers.Authorization).toBe('Bearer tok');
});

test('unpaired: no request, tone unpaired', async () => {
  jest.replaceProperty(config, 'API_BASE', null);
  global.fetch = jest.fn();
  const { result } = await renderHook(() => useServerStatus());
  await flush();
  expect(result.current.summary.tone).toBe('unpaired');
  expect(result.current.loading).toBe(false);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('offline when the request fails', async () => {
  global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
  const { result } = await renderHook(() => useServerStatus());
  await flush();
  expect(result.current.summary).toMatchObject({ tone: 'offline', label: '連不到主機' });
});

test('offline when the answer is not a Haoji status', async () => {
  global.fetch = okFetch({ hello: 'world' });
  const { result } = await renderHook(() => useServerStatus());
  await flush();
  expect(result.current.summary.tone).toBe('offline');
});

test('polls every 15 s while active, pauses in the background, resumes on return', async () => {
  jest.useFakeTimers();
  global.fetch = okFetch(green);
  await renderHook(() => useServerStatus());
  await flush();
  const calls = () => (global.fetch as jest.Mock).mock.calls.length;
  expect(calls()).toBe(1);
  expect(POLL_MS).toBe(15000);

  await act(async () => { await jest.advanceTimersByTimeAsync(POLL_MS); });
  expect(calls()).toBe(2);

  await act(async () => { appStateHandler!('background'); });
  await act(async () => { await jest.advanceTimersByTimeAsync(POLL_MS * 4); });
  expect(calls()).toBe(2);          // nothing while backgrounded

  await act(async () => { appStateHandler!('active'); });
  await flush();
  expect(calls()).toBe(3);          // refreshes at once on return
  await act(async () => { await jest.advanceTimersByTimeAsync(POLL_MS); });
  expect(calls()).toBe(4);
});

test('refreshes on focus and stops polling on blur', async () => {
  jest.useFakeTimers();
  global.fetch = okFetch(green);
  await renderHook(() => useServerStatus());
  await flush();
  const calls = () => (global.fetch as jest.Mock).mock.calls.length;
  await act(async () => { mockNavListeners.blur(); });
  await act(async () => { await jest.advanceTimersByTimeAsync(POLL_MS * 3); });
  expect(calls()).toBe(1);
  await act(async () => { mockNavListeners.focus(); });
  await flush();
  expect(calls()).toBe(2);
});

test('re-pairing refreshes immediately', async () => {
  global.fetch = okFetch(green);
  const { result } = await renderHook(() => useServerStatus());
  await flush();
  await act(async () => { await server.saveServer({ url: 'http://other:1', pairedAt: 2 }); });
  await flush();
  expect(result.current.base).toBe('http://other:1');
  expect((global.fetch as jest.Mock).mock.calls.at(-1)[0]).toBe('http://other:1/api/status');
});
