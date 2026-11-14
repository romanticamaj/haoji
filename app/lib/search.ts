// Search across every meeting on the phone: title, speaker names, notes and transcript.
//
// Pure and UI-free. Matching is NFKC-normalised and case-folded, so full-width ＡＢＣ finds abc and
// vice versa. Hits rank title → speaker → notes → transcript, newest meeting first within a rank,
// and a meeting contributes at most MAX_HITS_PER_SESSION hits. Each hit carries a ±SNIPPET_RADIUS
// character snippet of the ORIGINAL text with the match's position inside it, for highlighting.
//
// Speed: a 2-hour transcript is ~30k characters and the phone may hold hundreds of them. The
// normalised transcript is built once per transcript object (WeakMap cache) as one string, so each
// keystroke is a handful of indexOf calls rather than a walk over every segment.
import type { SavedSession } from './store';
import type { Transcript } from './types';

export type SearchField = 'title' | 'speaker' | 'notes' | 'transcript';
export type SearchHit = {
  sessionId: string;
  field: SearchField;
  snippet: string;
  /** Where the match sits inside `snippet` (not inside the original text). */
  matchStart: number;
  matchLen: number;
  /** For transcript and speaker hits: the segment Results should scroll to. */
  segmentIndex?: number;
};

export const SNIPPET_RADIUS = 20;
export const MAX_HITS_PER_SESSION = 3;
const RANK: Record<SearchField, number> = { title: 0, speaker: 1, notes: 2, transcript: 3 };
const ELLIPSIS = '…';
// Joins normalised segments; a query never contains it, so no match can straddle two turns.
const SEP = '\u0000';

const fold = (s: string) => s.normalize('NFKC').toLowerCase();

// Normalised text plus, when normalisation changed the length (ligatures, ㍿, İ…), a map from each
// normalised index back to the original index. Without a map the indices line up 1:1.
type Norm = { n: string; map?: number[] };

function normalize(text: string): Norm {
  const n = fold(text);
  if (n.length === text.length) return { n };
  // Slow path, only for the rare text whose length changes: fold code point by code point.
  let out = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) map.push(i);
    out += f;
    i += ch.length;
  }
  map.push(text.length);
  return { n: out, map };
}

const toOrig = (norm: Norm, idx: number) => (norm.map ? norm.map[idx] : idx);

/** The ±SNIPPET_RADIUS window around [start, end) of `text`, whitespace flattened to spaces. */
function snippetOf(text: string, start: number, end: number): Pick<SearchHit, 'snippet' | 'matchStart' | 'matchLen'> {
  const from = Math.max(0, start - SNIPPET_RADIUS);
  const to = Math.min(text.length, end + SNIPPET_RADIUS);
  const head = from > 0 ? ELLIPSIS : '';
  const tail = to < text.length ? ELLIPSIS : '';
  // One-for-one replacement keeps the match offsets valid.
  const body = text.slice(from, to).replace(/\s/g, ' ');
  return { snippet: head + body + tail, matchStart: head.length + (start - from), matchLen: end - start };
}

/** Every match of q in text, as original [start, end) ranges, up to `limit`. */
function findAll(text: string, q: string, limit: number): [number, number][] {
  const norm = normalize(text);
  const out: [number, number][] = [];
  let at = norm.n.indexOf(q);
  while (at >= 0 && out.length < limit) {
    out.push([toOrig(norm, at), toOrig(norm, at + q.length)]);
    at = norm.n.indexOf(q, at + q.length);
  }
  return out;
}

// --- transcript index (cached per transcript object) ---------------------------------------------
type TxIndex = { text: string; starts: number[]; segs: Norm[] };
const txCache = new WeakMap<Transcript, TxIndex>();

function indexTranscript(t: Transcript): TxIndex {
  const hit = txCache.get(t);
  if (hit) return hit;
  const segs = t.segments.map((s) => normalize(s.text ?? ''));
  const starts: number[] = [];
  let pos = 0;
  for (const s of segs) { starts.push(pos); pos += s.n.length + SEP.length; }
  const idx = { text: segs.map((s) => s.n).join(SEP), starts, segs };
  txCache.set(t, idx);
  return idx;
}

// Which segment a position in the joined string belongs to (binary search over segment starts).
function segmentAt(starts: number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/**
 * Search the meetings for `q`.
 * @param names optional speaker-name overrides keyed by session id (e.g. renames not saved yet);
 *              otherwise each session's own `names` are used.
 */
export function searchSessions(
  sessions: SavedSession[], q: string, names?: Record<string, Record<string, string>>,
): SearchHit[] {
  const query = fold(q ?? '').trim();
  if (!query) return [];

  const hits: (SearchHit & { createdAt: number; order: number })[] = [];
  for (const s of sessions) {
    const mine: SearchHit[] = [];
    const room = () => MAX_HITS_PER_SESSION - mine.length;
    const push = (h: SearchHit) => { if (room() > 0) mine.push(h); };

    // Title — one hit is enough.
    for (const [a, b] of findAll(s.title ?? '', query, 1)) {
      push({ sessionId: s.id, field: 'title', ...snippetOf(s.title, a, b) });
    }

    // Speaker names: the hit opens that speaker's first turn.
    const segments = s.transcript?.segments ?? [];
    const nameMap = names?.[s.id] ?? s.names ?? {};
    for (const [code, name] of Object.entries(nameMap)) {
      if (room() <= 0) break;
      if (!name) continue;
      const m = findAll(name, query, 1)[0];
      if (!m) continue;
      const first = segments.findIndex((g) => g.speaker === code);
      push({
        sessionId: s.id, field: 'speaker', ...snippetOf(name, m[0], m[1]),
        ...(first >= 0 ? { segmentIndex: first } : {}),
      });
    }

    if (room() > 0 && s.notes) {
      for (const [a, b] of findAll(s.notes, query, room())) {
        push({ sessionId: s.id, field: 'notes', ...snippetOf(s.notes, a, b) });
      }
    }

    if (room() > 0 && s.transcript && segments.length > 0) {
      const idx = indexTranscript(s.transcript);
      let at = idx.text.indexOf(query);
      while (at >= 0 && room() > 0) {
        const i = segmentAt(idx.starts, at);
        const local = at - idx.starts[i];
        const norm = idx.segs[i];
        const text = segments[i].text;
        push({
          sessionId: s.id, field: 'transcript', segmentIndex: i,
          ...snippetOf(text, toOrig(norm, local), toOrig(norm, local + query.length)),
        });
        at = idx.text.indexOf(query, at + query.length);
      }
    }

    for (const h of mine) hits.push({ ...h, createdAt: s.createdAt, order: hits.length });
  }

  hits.sort((x, y) => RANK[x.field] - RANK[y.field] || y.createdAt - x.createdAt || x.order - y.order);
  return hits.map(({ createdAt: _c, order: _o, ...h }) => h);
}
