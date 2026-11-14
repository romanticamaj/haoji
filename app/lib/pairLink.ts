import { normalizeUrl } from './server';

// The pairing link a Haoji server shows as a QR code: haoji://pair?url=<urlencoded>&token=<tok>.
// Parsed by hand rather than with URL/URLSearchParams, whose RN polyfills are incomplete.

export const PAIR_LINK_ERROR = '這不是好記主機的配對連結。';

export type PairLink = { url: string; token?: string };

function decode(v: string): string | null {
  try { return decodeURIComponent(v.replace(/\+/g, ' ')); } catch { return null; }
}

export function parsePairLink(link: string): PairLink | { error: string } {
  const fail = { error: PAIR_LINK_ERROR };
  const m = /^haoji:\/\/pair\/?\?(.*)$/i.exec((link ?? '').trim());
  if (!m) return fail;

  const params: Record<string, string> = {};
  for (const pair of m[1].split('&')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const value = decode(pair.slice(eq + 1));
    if (value === null) return fail;
    params[pair.slice(0, eq)] = value;
  }

  // Only plain http(s) addresses: `javascript:`, `file:` etc. never reach the address field.
  const raw = params.url ?? '';
  if (!/^https?:\/\//i.test(raw.trim())) return fail;
  const url = normalizeUrl(raw);
  if (!url) return fail;

  const token = params.token?.trim();
  return token ? { url, token } : { url };
}
