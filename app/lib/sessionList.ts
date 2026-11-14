// UI-free helpers for the meeting-list (home) screen. Kept pure and unit-tested so HomeScreen can
// stay a thin map from grouped sessions to cards. All time math takes `now` as a parameter so the
// relative-day / grouping logic is deterministic in tests.
import { SavedSession } from './store';
import { mmss, nameOf, speakersByFirstAppearance } from './transcript';
import { isActive } from './job';
import { isNotesActive } from './notesJob';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEKDAY_ZH = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'] as const;

// Local midnight (start of the calendar day) for a timestamp.
function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const hhmm = (ts: number): string => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Whole calendar days between two timestamps (today = 0, yesterday = 1, ...), by day boundary
// rather than raw 24h difference so "昨天 23:59 → 今天 00:01" reads as yesterday.
function daysAgo(createdAt: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(createdAt)) / MS_PER_DAY);
}

// "今天 14:30" / "昨天 09:12" / "週二 16:20" (same ISO week, 2–6 days ago) / "M/D" (older).
export function relativeDay(createdAt: number, now: number): string {
  const diff = daysAgo(createdAt, now);
  if (diff <= 0) return `今天 ${hhmm(createdAt)}`;
  if (diff === 1) return `昨天 ${hhmm(createdAt)}`;
  if (diff < 7) return `${WEEKDAY_ZH[new Date(createdAt).getDay()]} ${hhmm(createdAt)}`;
  const d = new Date(createdAt);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export type SessionGroupKey = '今天' | '本週' | '更早';
export type SessionGroup = { key: SessionGroupKey; items: SavedSession[] };

// Bucket sessions into 今天 / 本週 / 更早. Assumes `sessions` is already newest-first (store.list()
// sorts that way); order is preserved within each group. Empty groups are dropped.
export function groupSessions(sessions: SavedSession[], now: number): SessionGroup[] {
  const groups: Record<SessionGroupKey, SavedSession[]> = { 今天: [], 本週: [], 更早: [] };
  for (const s of sessions) {
    const diff = daysAgo(s.createdAt, now);
    if (diff <= 0) groups['今天'].push(s);
    else if (diff < 7) groups['本週'].push(s);
    else groups['更早'].push(s);
  }
  return (['今天', '本週', '更早'] as SessionGroupKey[])
    .map((key) => ({ key, items: groups[key] }))
    .filter((g) => g.items.length > 0);
}

// Sum of all part durations, in ms. Uploaded parts can carry durationMs: 0, so this may be 0.
export function totalDurationMs(session: SavedSession): number {
  return session.parts.reduce((sum, p) => sum + (p.durationMs || 0), 0);
}

// Formatted total duration ("mm:ss"), or null when the sum is 0 (caller omits the chip).
export function durationLabel(session: SavedSession): string | null {
  const ms = totalDurationMs(session);
  return ms > 0 ? mmss(ms / 1000) : null;
}

// Number of diarized speakers, or 0 when there's no transcript yet.
export function speakerCount(session: SavedSession): number {
  return session.transcript?.speakers.length ?? 0;
}

export function hasTranscript(session: SavedSession): boolean {
  return (session.transcript?.segments.length ?? 0) > 0;
}

export function hasNotes(session: SavedSession): boolean {
  return !!session.notes && session.notes.trim().length > 0;
}

// The one status word a Home card carries at the end of its meta line (· 已有逐字稿 / · 處理中 /
// · 還沒生成). It replaced the row of separate icon+text statuses under each card.
export function inlineStatus(session: SavedSession): string {
  if (isActive(session.job) || isNotesActive(session.notesJob)) return '處理中';
  if (hasTranscript(session)) return '已有逐字稿';
  if (session.job?.stage === 'error') return '整理沒有完成';
  return '還沒生成';
}

/** How many faces an avatar stack shows before it says +N (Home cards and the Results toolbar). */
export const STACK_MAX = 3;

export type AvatarSpec = { initials: string[]; colorIndex: number[]; overflow: number };

/** One face: the first char of the speaker's real name, or their 1-based speaker number when unnamed. */
export function avatarInitial(speaker: string, index: number, names: Record<string, string>): string {
  const named = !!names[speaker] && names[speaker].trim().length > 0;
  // nameOf returns the raw speaker code when unnamed; show the number instead of a code.
  return named ? [...nameOf(speaker, names).trim()][0] : String(index + 1);
}

// Up to STACK_MAX faces in first-appearance order, plus an overflow count. `colorIndex` is each face's
// speaker index, so its colour matches the transcript. No transcript → no avatars.
export function avatarSpec(session: SavedSession, max = STACK_MAX): AvatarSpec {
  const ordered = speakersByFirstAppearance(session.transcript?.segments ?? [], session.transcript?.speakers ?? []);
  const shown = ordered.slice(0, max);
  return {
    initials: shown.map((o) => avatarInitial(o.speaker, o.index, session.names)),
    colorIndex: shown.map((o) => o.index),
    overflow: Math.max(0, ordered.length - shown.length),
  };
}
