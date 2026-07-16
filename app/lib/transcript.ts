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
