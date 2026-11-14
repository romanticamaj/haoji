import { useCallback, useEffect, useRef, useState } from 'react';

export type Poll<T> = {
  data: T | null;
  error: unknown;
  loading: boolean;
  refresh: () => Promise<void>;
};

/**
 * Poll `fn` every `ms`. The next call is scheduled only after the previous one settles, so a slow backend
 * never stacks requests. Errors are kept in `error` (quietly — the last good `data` stays on screen).
 */
export function usePoll<T>(fn: () => Promise<T>, ms = 3000): Poll<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const alive = useRef(true);

  const tick = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const run = (async () => {
      try {
        const v = await fnRef.current();
        if (!alive.current) return;
        setData(v);
        setError(null);
      } catch (e) {
        if (alive.current) setError(e);
      } finally {
        inFlight.current = null;
        if (alive.current) {
          setLoading(false);
          timer.current = setTimeout(() => void tick(), ms);
        }
      }
    })();
    inFlight.current = run;
    return run;
  }, [ms]);

  useEffect(() => {
    alive.current = true;
    void tick();
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [tick]);

  return { data, error, loading, refresh: tick };
}
