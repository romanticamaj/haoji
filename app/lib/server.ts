import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from './config';

// The server this phone talks to, chosen at RUNTIME (pairing) rather than baked into the build.
//
// Precedence: the paired server → the build-time `Config.API_BASE` (the owner's own builds) → null.
// null means "not paired": recording still works (local-first), only server actions are gated.
// api.ts resolves the base on EVERY call, so re-pairing takes effect without a reload.

export type ServerConfig = { url: string; token?: string; name?: string; pairedAt: number };

const KEY = 'haoji.server';

/** Thrown by api.ts when there is no server to talk to. */
export class NotPairedError extends Error {
  constructor() {
    super('還沒連接主機。');
    this.name = 'NotPairedError';
  }
}

// In-memory mirror of the stored value. `undefined` = not read yet, `null` = read, nothing stored.
let cached: ServerConfig | null | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => { try { l(); } catch { /* a bad listener must not break pairing */ } });

export async function loadServer(): Promise<ServerConfig | null> {
  if (cached !== undefined) return cached;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    cached = parsed && typeof parsed.url === 'string' ? (parsed as ServerConfig) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export async function saveServer(c: ServerConfig): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(c));
  cached = c;
  notify();
}

export async function forgetServer(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
  cached = null;
  notify();
}

export async function serverBase(): Promise<string | null> {
  return (await loadServer())?.url ?? API_BASE ?? null;
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = (await loadServer())?.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Listen for pairing changes (save / forget). Returns an unsubscribe function. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Turn what a person typed into a base URL: trim, default to http://, only http(s), no trailing
 * slash, port kept. Returns null for anything that can't be a Haoji server address.
 */
export function normalizeUrl(input: string): string | null {
  let s = (input ?? '').trim();
  if (!s) return null;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(s);
  // "100.1.2.3:7780" / "box:7780" look like scheme:… to the regex, so only treat it as a scheme when
  // followed by "//" or when it isn't host:port.
  const hasScheme = !!scheme && (s.slice(scheme[0].length).startsWith('//') || !/^\d+(\/|$)/.test(s.slice(scheme[0].length)));
  if (hasScheme) {
    const proto = scheme![1].toLowerCase();
    if (proto !== 'http' && proto !== 'https') return null;
    s = proto + s.slice(proto.length);
  } else {
    s = `http://${s}`;
  }
  const m = /^(https?):\/\/([^/?#\s]+)([^?#\s]*)$/.exec(s);
  if (!m) return null;
  const path = m[3].replace(/\/+$/, '');
  return `${m[1]}://${m[2]}${path}`;
}
