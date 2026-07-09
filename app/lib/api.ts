import { API_BASE } from './config';
import { SessionStatus } from './types';

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

export async function createSession(): Promise<string> {
  const res = await timedFetch(`${API_BASE}/api/sessions`, { method: 'POST' }, 20000);
  return ((await asJson(res)) as any).session_id;
}
export async function uploadPart(id: string, file: { uri: string; name: string; mime: string }): Promise<number> {
  const form = new FormData();
  form.append('file', { uri: file.uri, name: file.name, type: file.mime } as any);
  // Uploads carry the whole payload — an audio part, or a video picked from the library whose audio
  // the backend extracts. Videos can be hundreds of MB, so allow a long deadline over Tailscale/LAN.
  const res = await timedFetch(`${API_BASE}/api/sessions/${id}/parts`, { method: 'POST', body: form }, 600000);
  return ((await asJson(res)) as any).count;
}
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

export async function getModels(): Promise<{ ok: boolean; models: string[]; default: string }> {
  const res = await timedFetch(`${API_BASE}/api/llm/models`, {}, 20000);
  return (await asJson(res)) as { ok: boolean; models: string[]; default: string };
}
