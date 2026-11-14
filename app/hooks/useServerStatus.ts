import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as api from '../lib/api';
import { loadServer, serverBase, subscribe, NotPairedError, type ServerConfig } from '../lib/server';
import { summarize, type PublicStatus, type Summary } from '../lib/serverStatus';

export const POLL_MS = 15000;

export type ServerStatusState = {
  /** The paired server, if any (null also when the address comes from the build). */
  server: ServerConfig | null;
  /** The address actually in use: paired → build-time → null. */
  base: string | null;
  status: PublicStatus | null;
  error: unknown;
  latencyMs?: number;
  summary: Summary;
  /** True until the first answer — callers should not gate on a tone that isn't known yet. */
  loading: boolean;
  refresh(): Promise<void>;
};

/**
 * How the phone's server is doing. Polls on focus and every 15 s while the app is active; pauses in
 * the background and while the screen is not focused, and refreshes at once on re-pairing.
 */
export function useServerStatus(): ServerStatusState {
  const nav = useNavigation<any>();
  const navRef = useRef(nav);
  navRef.current = nav;
  const [state, setState] = useState<Omit<ServerStatusState, 'refresh'>>({
    server: null, base: null, status: null, error: undefined, summary: summarize(null), loading: true,
  });
  const alive = useRef(true);
  const seq = useRef(0);   // drop answers that arrive after a newer request started

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    const [server, base] = await Promise.all([loadServer(), serverBase()]);
    if (!base) {
      if (alive.current && mine === seq.current) {
        setState({ server, base, status: null, error: undefined, summary: summarize(null), loading: false });
      }
      return;
    }
    const t0 = Date.now();
    let status: PublicStatus | null = null;
    let error: unknown;
    try { status = await api.getStatus(); } catch (e) { error = e; }
    if (!alive.current || mine !== seq.current) return;
    if (error instanceof NotPairedError) {
      setState({ server, base: null, status: null, error: undefined, summary: summarize(null), loading: false });
      return;
    }
    setState({
      server, base, status, error,
      latencyMs: error ? undefined : Date.now() - t0,
      summary: summarize(status, error), loading: false,
    });
  }, []);

  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => { if (timer) clearInterval(timer); timer = undefined; };
    const start = () => {
      stop();
      void refresh();
      timer = setInterval(() => { void refresh(); }, POLL_MS);
    };

    // AppState.currentState is 'active' | 'background' | 'inactive' (or unknown on first launch).
    const cur = AppState.currentState;
    if (cur !== 'background' && cur !== 'inactive') start();
    else void refresh();   // still learn the state once, without polling

    const appSub = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
    const offFocus = navRef.current?.addListener?.('focus', start);
    const offBlur = navRef.current?.addListener?.('blur', stop);
    const offServer = subscribe(() => { void refresh(); });
    return () => {
      alive.current = false;
      stop();
      appSub?.remove?.();
      offFocus?.();
      offBlur?.();
      offServer();
    };
  }, [refresh]);

  return { ...state, refresh };
}
