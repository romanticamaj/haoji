import { Segment } from './types';

export function mmss(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function nameOf(speaker: string, names: Record<string, string>): string {
  return names[speaker] || speaker;
}

// A merged paragraph carries the segment index RANGE it was built from (startIdx..endIdx, inclusive)
// so an inline edit can write the correction back to the right slice of `segments` (see applyTurnEdit).
export type Turn = { speaker: string; start: number; text: string; startIdx: number; endIdx: number };

export function mergedParagraphs(segments: Segment[]): Turn[] {
  const out: Turn[] = [];
  segments.forEach((s, i) => {
    const last = out[out.length - 1];
    if (last && last.speaker === s.speaker) { last.text += s.text; last.endIdx = i; }
    else out.push({ speaker: s.speaker, start: s.start, text: s.text, startIdx: i, endIdx: i });
  });
  return out;
}

// Plain-text rendering of the transcript for copy/share: one paragraph per turn as
// `[mm:ss] Name\ntext`, blank line between turns. Speaker codes are resolved through `names`.
export function transcriptPlainText(segments: Segment[], names: Record<string, string>): string {
  return mergedParagraphs(segments)
    .map((t) => `[${mmss(t.start)}] ${nameOf(t.speaker, names)}\n${t.text}`)
    .join('\n\n');
}

// Index of the paragraph being spoken at global time `ms`: the last one whose start is at or before
// ms. Returns -1 before playback (ms<=0) or if nothing matches. Drives follow-along highlighting.
// `startsSec` are the paragraph start times in SECONDS (turn.start), assumed non-decreasing.
export function activeParagraph(startsSec: number[], ms: number): number {
  if (!(ms > 0)) return -1;
  let idx = -1;
  for (let i = 0; i < startsSec.length; i++) {
    if (startsSec[i] * 1000 <= ms) idx = i; else break;
  }
  return idx;
}

// Apply an inline transcript edit: replace the segments a paragraph covers [startIdx..endIdx] with ONE
// corrected segment, keeping the paragraph's start (so tap-to-seek still lands right), end, and speaker.
// Collapsing the range is intentional — the display re-merges anyway and the notes LLM only sees the
// speaker-labelled text, so intra-paragraph segment boundaries carry no user-visible meaning.
export function applyTurnEdit(
  segments: Segment[], startIdx: number, endIdx: number, newText: string,
): Segment[] {
  const first = segments[startIdx];
  const last = segments[endIdx];
  if (!first || !last) return segments;
  const merged: Segment = { start: first.start, end: last.end, speaker: first.speaker, text: newText };
  return [...segments.slice(0, startIdx), merged, ...segments.slice(endIdx + 1)];
}

// Speakers in the order they first speak — the order the avatar stacks on Home and Results use, so
// the first face is whoever opened the meeting. `index` is the speaker's position in `speakers`
// (its colour and 「講者 N」 number, as in the transcript turns); a speaker missing from the list takes
// 0, the same fallback the turns use. Listed speakers who never speak follow, in list order.
export type OrderedSpeaker = { speaker: string; index: number };

export function speakersByFirstAppearance(segments: Segment[], speakers: string[] = []): OrderedSpeaker[] {
  const out: OrderedSpeaker[] = [];
  const seen = new Set<string>();
  const add = (sp: string) => {
    if (seen.has(sp)) return;
    seen.add(sp);
    const i = speakers.indexOf(sp);
    out.push({ speaker: sp, index: i >= 0 ? i : 0 });
  };
  segments.forEach((s) => add(s.speaker));
  speakers.forEach(add);
  return out;
}

// Who is in this meeting, and how much did each of them say.
//
// Ordered by speaking time, most first: with a dozen auto-detected speakers a transcript-order list
// is unusable for finding anyone, whereas the people who actually carried the meeting are the ones
// worth naming and they float to the top. `turns` is how many separate times they spoke, `ms` the
// total they held the floor.
export type SpeakerStat = { speaker: string; ms: number; turns: number; index: number };

export function speakerStats(segments: Segment[], speakers: string[] = []): SpeakerStat[] {
  const order = new Map<string, number>();
  speakers.forEach((s, i) => order.set(s, i));

  const acc = new Map<string, { ms: number; turns: number }>();
  let prev: string | null = null;
  for (const s of segments) {
    const cur = acc.get(s.speaker) ?? { ms: 0, turns: 0 };
    // A "turn" is a run of consecutive segments by the same speaker — the same grouping the
    // transcript renders as one paragraph, so the count matches what the reader sees.
    if (s.speaker !== prev) cur.turns += 1;
    cur.ms += Math.max(0, (s.end - s.start)) * 1000;
    acc.set(s.speaker, cur);
    prev = s.speaker;
  }
  // A speaker the backend listed but who never actually says anything still belongs in the list —
  // otherwise it looks like the app lost them.
  for (const sp of speakers) if (!acc.has(sp)) acc.set(sp, { ms: 0, turns: 0 });

  return [...acc.entries()]
    .map(([speaker, v]) => ({
      speaker, ms: v.ms, turns: v.turns,
      index: order.has(speaker) ? order.get(speaker)! : 0,
    }))
    .sort((a, b) => b.ms - a.ms || a.index - b.index || a.speaker.localeCompare(b.speaker));
}
