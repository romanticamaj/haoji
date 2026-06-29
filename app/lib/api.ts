import { API_BASE } from './config';
import { SessionStatus } from './types';

async function asJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error || `HTTP ${res.status}`);
  return body;
}

export async function createSession(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/sessions`, { method: 'POST' });
  return ((await asJson(res)) as any).session_id;
}
export async function uploadPart(id: string, file: { uri: string; name: string; mime: string }): Promise<number> {
  const form = new FormData();
  form.append('file', { uri: file.uri, name: file.name, type: file.mime } as any);
  const res = await fetch(`${API_BASE}/api/sessions/${id}/parts`, { method: 'POST', body: form });
  return ((await asJson(res)) as any).count;
}
export async function transcribe(id: string): Promise<void> {
  await asJson(await fetch(`${API_BASE}/api/sessions/${id}/transcribe`, { method: 'POST' }));
}

export async function getSession(id: string): Promise<SessionStatus> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}`);
  return (await asJson(res)) as SessionStatus;
}

export async function analyze(
  id: string,
  opts: { model?: string; names?: Record<string, string> },
): Promise<{ notes: string; model: string }> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  return (await asJson(res)) as { notes: string; model: string };
}

export async function getModels(): Promise<{ ok: boolean; models: string[]; default: string }> {
  const res = await fetch(`${API_BASE}/api/llm/models`);
  return (await asJson(res)) as { ok: boolean; models: string[]; default: string };
}
