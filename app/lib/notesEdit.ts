// Version history for the AI meeting notes. Whenever the notes change (manual edit, keyword replace,
// regenerate, or a revert), the PREVIOUS notes are pushed onto session.notesHistory so the user can
// see prior versions and revert — the 版本紀錄 in the notes editor. Kept pure + capped for testability.
import { SavedSession } from './store';

export const MAX_NOTES_HISTORY = 20;

// Return a session whose notes become `newNotes`, with the current notes archived (newest first).
// No-ops (identical text, or no existing notes to archive) don't grow the history.
export function pushNotesVersion(session: SavedSession, newNotes: string, at: number): SavedSession {
  const prev = session.notes;
  if (prev == null || prev === newNotes) {
    return { ...session, notes: newNotes };
  }
  const history = [{ notes: prev, at }, ...(session.notesHistory ?? [])].slice(0, MAX_NOTES_HISTORY);
  return { ...session, notes: newNotes, notesHistory: history };
}
