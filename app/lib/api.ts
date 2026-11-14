import { serverBase, authHeaders, NotPairedError } from './server';
import { isPublicStatus, VALIDATE_TIMEOUT_MS, type PublicStatus } from './serverStatus';
import { SessionStatus, Transcript } from './types';

// RN's fetch has no default timeout, so a stalled backend (or a half-open Tailscale connection)
// leaves a request hanging forever — that's why uploading a file could sit on "上傳中…" with no
// way out. Abort each request after a generous, per-endpoint deadline and surface a clear error.
async function timedFetch(url: string, opts: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') // Plain words, but keep the one hint that actually helps: the phone reaches the box over Tailscale.
    throw new Error('連不到整理用的電腦。確認網路（Tailscale）有連上後，再試一次。');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// The server is picked at runtime (lib/server.ts), so resolve it on EVERY call: re-pairing then takes
// effect immediately. Unpaired → NotPairedError, before anything touches the network.
async function base(): Promise<string> {
  const b = await serverBase();
  if (!b) throw new NotPairedError();
  return b;
}

// Every call carries the pairing token (when there is one) as a Bearer header.
async function call(path: string, opts: RequestInit, ms: number): Promise<Response> {
  const url = `${await base()}${path}`;
  const headers = { ...((opts.headers as Record<string, string>) ?? {}), ...(await authHeaders()) };
  return timedFetch(url, { ...opts, headers }, ms);
}

async function asJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Legacy routes answer {error: "text"}; the control plane answers {error: {code, message, hint}}.
    const err = (body as any).error;
    const msg = typeof err === 'string' ? err : err?.message;
    throw new Error(msg || `整理用的電腦沒有回應（${res.status}），請再試一次。`);
  }
  return body;
}

// clientId is an idempotency/task key (the local session id). Passing it lets the backend return the
// SAME server session if the pipeline is (re)tried, so a duplicated upload can't spawn extra sessions.
export async function createSession(
  clientId?: string, expectedParts?: number,
  // Where to push "逐字稿完成": the job ends server-side, usually with this app suspended.
  push?: { token: string; env: string; title?: string },
): Promise<string> {
  // expectedParts tells the backend how many parts to wait for: once they have all arrived it starts
  // transcription ITSELF, so an upload finished by the OS with the app closed still gets processed.
  const res = await call(`/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(clientId ? { client_id: clientId } : {}),
      ...(expectedParts ? { expected_parts: expectedParts } : {}),
      ...(push ? { push_token: push.token, push_env: push.env, push_title: push.title ?? '' } : {}),
    }),
  }, 20000);
  return ((await asJson(res)) as any).session_id;
}
export async function uploadPart(
  id: string, file: { uri: string; name: string; mime: string }, index: number,
): Promise<number> {
  const form = new FormData();
  form.append('file', { uri: file.uri, name: file.name, type: file.mime } as any);
  // The index makes the upload idempotent: re-sending part i overwrites slot i server-side instead
  // of appending a duplicate. Long deadline — a video part can be hundreds of MB over Tailscale/LAN.
  const res = await call(`/api/sessions/${id}/parts?index=${index}`, { method: 'POST', body: form }, 600000);
  return ((await asJson(res)) as any).count;
}
// URL for the raw-body part upload used by the iOS background session (it can only send a file, not
// a multipart form). Same idempotency as the multipart route: index N overwrites slot N.
// Async because the base is resolved per call, exactly like the fetch-based routes.
export const partPutUrl = async (backendId: string, index: number): Promise<string> =>
  `${await base()}/api/sessions/${backendId}/parts/${index}`;

export async function transcribe(id: string): Promise<void> {
  // Only submits the background job; returns fast.
  await asJson(await call(`/api/sessions/${id}/transcribe`, { method: 'POST' }, 20000));
}

export async function getSession(id: string): Promise<SessionStatus> {
  const res = await call(`/api/sessions/${id}`, {}, 20000);
  return (await asJson(res)) as SessionStatus;
}

export async function analyze(
  id: string,
  opts: { model?: string; names?: Record<string, string> },
): Promise<{ notes: string; model: string }> {
  const res = await call(`/api/sessions/${id}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  }, 300000); // local LLM generation can be slow
  return (await asJson(res)) as { notes: string; model: string };
}

// Queue notes generation and return at once. The backend stores the notes when it finishes, so the
// result survives the app being backgrounded or killed — poll getSession() for notes_status/notes.
export async function analyzeInBackground(
  id: string,
  opts: { model?: string; names?: Record<string, string>; transcript?: Transcript; clientId?: string },
): Promise<void> {
  await asJson(await call(`/api/sessions/${id}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // client_id links a server row recreated on demand back to this local session.
    body: JSON.stringify({
      model: opts.model, names: opts.names, transcript: opts.transcript,
      client_id: opts.clientId, background: true,
    }),
  }, 20000));
}

/** GET /api/status (public). Throws if the answer isn't a Haoji status; NotPairedError when unpaired. */
export async function getStatus(): Promise<PublicStatus> {
  const body = await asJson(await call('/api/status', {}, VALIDATE_TIMEOUT_MS));
  if (!isPublicStatus(body)) throw new Error('這個網址不是好記主機。');
  return body;
}

export async function getModels(): Promise<{ ok: boolean; models: string[]; default: string }> {
  const res = await call(`/api/llm/models`, {}, 20000);
  return (await asJson(res)) as { ok: boolean; models: string[]; default: string };
}
