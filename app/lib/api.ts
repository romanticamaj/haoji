import { API_BASE } from './config';
import { SessionStatus } from './types';

async function asJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error || `HTTP ${res.status}`);
  return body;
}

export async function createSession(file: { uri: string; name: string; mime: string }): Promise<string> {
  const form = new FormData();
  // React Native FormData accepts { uri, name, type } file objects
  form.append('file', { uri: file.uri, name: file.name, type: file.mime } as any);
  const res = await fetch(`${API_BASE}/api/sessions`, { method: 'POST', body: form });
  const body = await asJson(res);
  return (body as any).session_id;
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
