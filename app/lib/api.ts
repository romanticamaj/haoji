import { API_BASE } from './config';
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
    if (e?.name === 'AbortError') throw new Error('連線逾時，請確認後端是否正常、手機是否連上 Tailscale。');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function asJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error || `HTTP ${res.status}`);
  return body;
}

// clientId is an idempotency/task key (the local session id). Passing it lets the backend return the
// SAME server session if the pipeline is (re)tried, so a duplicated upload can't spawn extra sessions.
export async function createSession(clientId?: string, expectedParts?: number): Promise<string> {
  // expectedParts tells the backend how many parts to wait for: once they have all arrived it starts
  // transcription ITSELF, so an upload finished by the OS with the app closed still gets processed.
  const res = await timedFetch(`${API_BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(clientId ? { client_id: clientId } : {}),
      ...(expectedParts ? { expected_parts: expectedParts } : {}),
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
  const res = await timedFetch(`${API_BASE}/api/sessions/${id}/parts?index=${index}`, { method: 'POST', body: form }, 600000);
  return ((await asJson(res)) as any).count;
}
// URL for the raw-body part upload used by the iOS background session (it can only send a file, not
// a multipart form). Same idempotency as the multipart route: index N overwrites slot N.
export const partPutUrl = (backendId: string, index: number) =>
  `${API_BASE}/api/sessions/${backendId}/parts/${index}`;

export async function transcribe(id: string): Promise<void> {
  // Only submits the background job; returns fast.
  await asJson(await timedFetch(`${API_BASE}/api/sessions/${id}/transcribe`, { method: 'POST' }, 20000));
}

export async function getSession(id: string): Promise<SessionStatus> {
  const res = await timedFetch(`${API_BASE}/api/sessions/${id}`, {}, 20000);
  return (await asJson(res)) as SessionStatus;
}

export async function analyze(
  id: string,
  opts: { model?: string; names?: Record<string, string> },
): Promise<{ notes: string; model: string }> {
  const res = await timedFetch(`${API_BASE}/api/sessions/${id}/analyze`, {
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
  await asJson(await timedFetch(`${API_BASE}/api/sessions/${id}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // client_id links a server row recreated on demand back to this local session.
    body: JSON.stringify({
      model: opts.model, names: opts.names, transcript: opts.transcript,
      client_id: opts.clientId, background: true,
    }),
  }, 20000));
}

export async function getModels(): Promise<{ ok: boolean; models: string[]; default: string }> {
  const res = await timedFetch(`${API_BASE}/api/llm/models`, {}, 20000);
  return (await asJson(res)) as { ok: boolean; models: string[]; default: string };
}
