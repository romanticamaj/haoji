// UI-free helpers for rendering AI meeting notes as a styled document (screen 4). Kept pure and
// unit-tested so AnalysisTab stays a thin renderer.
import { SavedSession } from './store';
import { totalDurationMs, speakerCount, relativeDay } from './sessionList';

// The document meta line under the title, e.g. "42 分鐘 · 4 位參與者 · 今天 14:30".
// Unknown parts are omitted: 0-duration recordings drop the minutes chip; a not-yet-diarized
// session drops the speaker chip. `relativeDay` is always shown (createdAt always exists).
export function notesMetaLine(session: SavedSession, now: number): string {
  const parts: string[] = [];
  const minutes = Math.round(totalDurationMs(session) / 60000);
  if (minutes > 0) parts.push(`${minutes} 分鐘`);
  const speakers = speakerCount(session);
  if (speakers > 0) parts.push(`${speakers} 位參與者`);
  parts.push(relativeDay(session.createdAt, now));
  return parts.join(' · ');
}

// The AI notes usually open with an H1 title line ("# 會議記錄：<主題>"). We promote that to the
// meeting's own title and strip it from the rendered body so it isn't shown twice (and so the big
// unstyled H1 stops overlapping the header). Returns the topic with a leading 會議記錄／紀錄： dropped.
export function extractNotesTitle(notes: string): string | null {
  const m = /^\s*#\s+(.+?)\s*$/m.exec(notes ?? '');
  if (!m) return null;
  const t = m[1].replace(/^會議[記紀]錄\s*[:：]\s*/, '').trim();
  return t || null;
}

// Remove a leading H1 line (and the blank lines after it) from the notes for display.
export function stripLeadingH1(notes: string): string {
  return (notes ?? '').replace(/^\s*#\s+.+?(?:\r?\n)+/, '');
}

// Default meeting titles are timestamps (new Date().toLocaleString()). Only those get auto-replaced by
// the AI title — a title the user typed themselves is left alone.
export function looksLikeAutoTitle(title: string): boolean {
  if (!title) return true;
  return /\d/.test(title) && /[:：]/.test(title) && /[/\-年]/.test(title);
}

/**
 * May the AI's title replace the one this meeting is carrying?
 *
 * Yes while the title is still the timestamp default, and yes for a title the app itself derived
 * from earlier notes — re-analysing should refresh that. Never for a title someone typed.
 */
export function canAdoptAiTitle(session: SavedSession): boolean {
  if (session.titleSource === 'user') return false;
  return session.titleSource === 'ai' || looksLikeAutoTitle(session.title);
}

// Backfill the meeting title from the AI notes' H1 topic. Returns the SAME reference when nothing
// changes, so callers (Home list / Results open) can cheaply skip a store write. This retitles
// meetings generated before the feature existed, without regenerating.
export function promoteTitleFromNotes(session: SavedSession): SavedSession {
  if (!session.notes || !canAdoptAiTitle(session)) return session;
  const title = extractNotesTitle(session.notes);
  if (!title || title === session.title) return session;
  return { ...session, title, titleSource: 'ai' };
}

export type TaskItem = { done: boolean; text: string; owner?: string };

// Detect a GFM task-list item from the raw text of a list item, e.g. "[x] 整理數據 @宏" or
// "[ ] 彙整需求". markdown-it 10 has no task-list plugin, so the "[ ]"/"[x]" arrives as literal
// leading text. Returns null when the line isn't a task item so the caller can fall back to a
// normal bullet. An optional owner is parsed only when trivially marked with a trailing "@name"
// or "（name）/(name)" — otherwise left undefined (no guessing).
export function parseTaskItem(raw: string): TaskItem | null {
  const m = /^\s*\[([ xX])\]\s+(.*)$/.exec(raw);
  if (!m) return null;
  const done = m[1].toLowerCase() === 'x';
  let text = m[2].trim();
  let owner: string | undefined;

  // trailing "@name" (name = run of non-space chars)
  const at = /\s+@(\S+)\s*$/.exec(text);
  if (at) { owner = at[1]; text = text.slice(0, at.index).trim(); }
  else {
    // trailing "（name）" or "(name)"
    const paren = /[（(]\s*([^（()）]+?)\s*[)）]\s*$/.exec(text);
    if (paren) { owner = paren[1].trim(); text = text.slice(0, paren.index).trim(); }
  }
  return owner ? { done, text, owner } : { done, text };
}
