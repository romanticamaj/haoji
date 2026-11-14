import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePoll } from '../usePoll';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('usePoll', () => {
  it('never overlaps: a slow call holds back the next poll', async () => {
    const pending: ReturnType<typeof deferred<number>>[] = [];
    const fn = vi.fn(() => {
      const d = deferred<number>();
      pending.push(d);
      return d.promise;
    });
    const { result } = renderHook(() => usePoll(fn, 3000));
    expect(fn).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fn).toHaveBeenCalledTimes(1); // still in flight → no second call

    await act(async () => {
      pending[0].resolve(7);
    });
    expect(result.current.data).toBe(7);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fn).toHaveBeenCalledTimes(2); // next poll scheduled 3 s after settle
  });

  it('keeps the last data and reports the error quietly', async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      n += 1;
      if (n === 2) throw new Error('down');
      return n;
    });
    const { result } = renderHook(() => usePoll(fn, 3000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data).toBe(1);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe(3);
  });

  it('refresh() polls now without doubling up', async () => {
    const fn = vi.fn(async () => 1);
    const { result } = renderHook(() => usePoll(fn, 3000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await result.current.refresh();
    });
    expect(fn).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999);
    });
    expect(fn).toHaveBeenCalledTimes(2); // timer restarted from the refresh
  });

  it('stops polling on unmount', async () => {
    const fn = vi.fn(async () => 1);
    const { unmount } = renderHook(() => usePoll(fn, 3000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
