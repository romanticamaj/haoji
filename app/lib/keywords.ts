// Keyword fix-up: ASR often mis-hears a term the SAME way every time (e.g. "cloud" → "Claude"), so a
// one-off inline edit is tedious. This lets the user define wrong→right pairs and replace ALL
// occurrences across the whole meeting at once — in the transcript segments AND the AI notes.
// Replacement is literal (no regex) and case-sensitive, so "Claude"→"cloud" won't touch "claudia".
import { SavedSession } from './store';
import { pushNotesVersion } from './notesEdit';

export type KeywordRule = { from: string; to: string };

// Replace every literal occurrence of each rule's `from` with its `to`. split/join = replace-all with
// no regex escaping surprises. Empty `from` rules are skipped.
export function applyRules(text: string, rules: KeywordRule[]): string {
  let out = text ?? '';
  for (const r of rules) {
    if (!r.from) continue;
    out = out.split(r.from).join(r.to);
  }
  return out;
}

// Count how many occurrences the active rules would replace across the session (transcript + notes),
// so the UI can confirm "取代了 N 處" instead of silently doing nothing.
export function countMatches(session: SavedSession, rules: KeywordRule[]): number {
  const active = rules.filter((r) => r.from.length > 0);
  if (active.length === 0) return 0;
  const texts: string[] = [];
  for (const s of session.transcript?.segments ?? []) texts.push(s.text);
  if (session.notes != null) texts.push(session.notes);
  let n = 0;
  for (const t of texts) for (const r of active) n += t.split(r.from).length - 1;
  return n;
}

// Apply the rules across the whole session. Transcript segments are rewritten in place; notes go
// through pushNotesVersion so a bad replace is revertible from 版本紀錄.
export function applyRulesToSession(session: SavedSession, rules: KeywordRule[], at: number): SavedSession {
  const active = rules.filter((r) => r.from.trim().length > 0);
  if (active.length === 0) return session;

  let next: SavedSession = { ...session };
  if (session.transcript) {
    next.transcript = {
      ...session.transcript,
      segments: session.transcript.segments.map((s) => ({ ...s, text: applyRules(s.text, active) })),
    };
  }
  if (session.notes != null) {
    const replaced = applyRules(session.notes, active);
    next = pushNotesVersion(next, replaced, at); // archives the pre-replace notes only if it changed
  }
  return next;
}
