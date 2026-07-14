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
