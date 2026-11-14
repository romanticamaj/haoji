import { normalizeUrl } from './server';

// What the phone knows about its server: is it a Haoji server, can we talk to it, and how is it doing.
// Shapes mirror backend/tests/fixtures/contracts/status.json (GET /api/status, public).

export type StatusCheck = { id: string; ok: boolean; label: string; hint: string };
export type PublicStatus = {
  version: string;
  ok: boolean;
  checks: StatusCheck[];
  queue: { active: number; queued: number };
  llm: { model: string; reachable: boolean };
  pairing_required: boolean;
};

export type FailReason = 'unreachable' | 'not_haoji' | 'too_old' | 'unauthorized';
export type ValidateResult =
  | { ok: true; status: PublicStatus }
  | { ok: false; reason: FailReason; message: string };

export const MESSAGES: Record<FailReason, string> = {
  unreachable: '連不到這個網址，確認主機有開、手機和主機在同一個網路或 Tailscale 上。',
  not_haoji: '這個網址不是好記主機。',
  too_old: '主機版本太舊，請更新主機後再試。',
  unauthorized: '配對金鑰不對，請重新掃描主機上的 QR code。',
};

export const VALIDATE_TIMEOUT_MS = 5000;

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

const fail = (reason: FailReason): ValidateResult => ({ ok: false, reason, message: MESSAGES[reason] });

async function timed(f: FetchLike, url: string, headers: Record<string, string>) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), VALIDATE_TIMEOUT_MS);
  try {
    return await f(url, { headers, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const jsonOrNull = async (r: { json(): Promise<any> }) => { try { return await r.json(); } catch { return null; } };

export function isPublicStatus(x: any): x is PublicStatus {
  return !!x && typeof x === 'object' && typeof x.version === 'string' && Array.isArray(x.checks);
}

/**
 * Check that `url` is a reachable Haoji server that accepts `token`. Used by the Pair screen before
 * anything is saved, so a typo never becomes the paired server.
 */
export async function validateServer(
  url: string, token?: string, fetchImpl: FetchLike = fetch as any,
): Promise<ValidateResult> {
  const base = normalizeUrl(url);
  if (!base) return fail('unreachable');
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  let res;
  try { res = await timed(fetchImpl, `${base}/api/status`, headers); } catch { return fail('unreachable'); }

  if (res.status === 401 || res.status === 403) return fail('unauthorized');
  if (res.status === 404) {
    // No /api/status: either a Haoji server from before the control plane, or something else entirely.
    try {
      const h = await timed(fetchImpl, `${base}/health`, {});
      const body = h.ok ? await jsonOrNull(h) : null;
      return fail(body?.service === 'haoji-backend' ? 'too_old' : 'not_haoji');
    } catch {
      return fail('not_haoji');
    }
  }
  if (res.status >= 500) return fail('unreachable');

  const body = res.ok ? await jsonOrNull(res) : null;
  if (!isPublicStatus(body)) return fail('not_haoji');

  if (body.pairing_required) {
    if (!token) return fail('unauthorized');
    // /api/status is public, so prove the token on a guarded route. The id does not exist: an accepted
    // token yields 404, a rejected one 401 (the guard runs before the handler).
    try {
      const probe = await timed(fetchImpl, `${base}/api/sessions/pair-check`, headers);
      if (probe.status === 401 || probe.status === 403) return fail('unauthorized');
    } catch {
      return fail('unreachable');
    }
  }
  return { ok: true, status: body };
}

export type Tone = 'ready' | 'busy' | 'offline' | 'unpaired';
export type Summary = { tone: Tone; label: string; detail: string[] };

export const TONE_LABEL: Record<Tone, string> = {
  ready: '主機已連線',
  busy: '主機忙碌中',
  offline: '連不到主機',
  unpaired: '還沒連接主機',
};

// Checks a transcript cannot be made without. The notes checks (ollama / llm_model) only affect
// 會議記錄, so a server still pulling its notes model can transcribe and is not "offline".
const TRANSCRIPT_CHECKS = ['data_writable', 'sqlite', 'ffmpeg', 'breeze_asr'];

/** Reduce a status (or the lack of one) to phone words. Never says GPU, Ollama, model or 後端. */
export function summarize(s: PublicStatus | null, err?: unknown): Summary {
  if (err) return { tone: 'offline', label: TONE_LABEL.offline, detail: ['確認主機有開、手機和主機在同一個網路或 Tailscale 上。'] };
  if (!s) return { tone: 'unpaired', label: TONE_LABEL.unpaired, detail: ['連接你的主機後，就能生成逐字稿。'] };

  const ok = (id: string) => s.checks.find((c) => c.id === id)?.ok !== false;
  const asr = ok('breeze_asr');
  const notes = ok('ollama') && ok('llm_model');
  const setup = ['data_writable', 'sqlite', 'ffmpeg'].every(ok);
  const active = s.queue?.active ?? 0;
  const queued = s.queue?.queued ?? 0;

  const detail = [
    `語音辨識：${asr ? '正常' : '還沒準備好'}`,
    `會議記錄：${notes ? '正常' : '還沒準備好'}`,
    `處理中 ${active} 場，排隊中 ${queued} 場`,
  ];
  if (!setup) detail.push('主機的設定需要處理，請到主機的管理頁查看。');

  const tone: Tone = !TRANSCRIPT_CHECKS.every(ok) ? 'offline' : active + queued > 0 ? 'busy' : 'ready';
  return { tone, label: TONE_LABEL[tone], detail };
}
