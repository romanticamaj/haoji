import { Segment } from './types';

export function mmss(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function nameOf(speaker: string, names: Record<string, string>): string {
  return names[speaker] || speaker;
}

export function mergedParagraphs(segments: Segment[]) {
  const out: { speaker: string; start: number; text: string }[] = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    if (last && last.speaker === s.speaker) last.text += s.text;
    else out.push({ speaker: s.speaker, start: s.start, text: s.text });
  }
  return out;
}
