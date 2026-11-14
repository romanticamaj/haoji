// The console's only data access. Paths are absolute (/api/...) because the console is served by the same
// FastAPI process at /console. Auth: the httpOnly cookie set by /api/console/login, plus the same token from
// sessionStorage as a Bearer header (EventSource cannot send headers, so SSE relies on the cookie).

const TOKEN_KEY = 'haoji_admin_token';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hint: string;
  constructor(status: number, code: string, message: string, hint = '') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked: the cookie still carries the session */
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

/** The auth gate subscribes here; any 401 from any call flips the console to the login card. */
export function onUnauthorized(fn: Listener): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

async function toError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page */
  }
  const e = (body as { error?: { code?: string; message?: string; hint?: string } } | null)?.error;
  if (e && typeof e === 'object') {
    return new ApiError(res.status, e.code ?? 'error', e.message ?? res.statusText, e.hint ?? '');
  }
  // Older endpoints answer FastAPI's {detail}
  const detail = (body as { detail?: unknown } | null)?.detail;
  return new ApiError(res.status, `http_${res.status}`, typeof detail === 'string' ? detail : res.statusText || `HTTP ${res.status}`);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'network', '連不到主機');
  }

  if (!res.ok) {
    const err = await toError(res);
    if (res.status === 401 && path !== '/api/console/login') unauthorizedListeners.forEach((fn) => fn());
    throw err;
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  /** Subscribe to a JSON SSE stream. Returns a closer; callers close on a terminal message. */
  events<T = unknown>(path: string, onMsg: (msg: T) => void, onError?: () => void): () => void {
    const es = new EventSource(path);
    es.onmessage = (e: MessageEvent) => {
      try {
        onMsg(JSON.parse(e.data) as T);
      } catch {
        /* ignore keep-alives / malformed frames */
      }
    };
    if (onError) es.onerror = () => onError();
    return () => es.close();
  },
};

/** Trim whatever was pasted (logs add spaces/newlines), verify with the backend, then remember it. */
export async function login(raw: string): Promise<void> {
  const token = raw.trim();
  await request('POST', '/api/console/login', { token });
  setToken(token);
}
