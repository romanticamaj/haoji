import { SavedSession } from './store';
import { SessionStatus } from './types';
import { pushNotesVersion } from './notesEdit';
import { extractNotesTitle, looksLikeAutoTitle } from './notesDoc';

// Durable AI-notes generation — the analysis counterpart of lib/job.ts.
//
// Generation runs on the backend (POST /analyze {background:true}) and the notes are written to the
// server session when it finishes, so a phone that is backgrounded or killed mid-generation collects
// the finished notes on its next run instead of losing them and paying for a second LLM run.
export type NotesJob = {
  stage: 'generating' | 'done' | 'error';
  message: string;
  error?: string;
  updatedAt: number;
};

export type NotesJobDeps = {
  analyzeInBackground(backendId: string, opts: { model?: string; names?: Record<string, string> }): Promise<void>;
  getSession(backendId: string): Promise<SessionStatus>;
  load(): Promise<SavedSession | null>;
  save(s: SavedSession): Promise<void>;
  delay(ms: number): Promise<void>;
  now?(): number;
  isCancelled?(): boolean;
};

export const isNotesActive = (j?: NotesJob) => j?.stage === 'generating';

// Generation on a local LLM is slow but not unbounded; give up rather than poll forever if the
// backend never reports a result (restarted mid-run, job lost, etc.).
export const POLL_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Run or RESUME notes generation for one session. Safe to call repeatedly: the backend dedups a
 * second submit for the same session, and a job already in flight is resumed by polling rather than
 * re-submitted.
 */
export async function runNotesJob(
  sessionId: string, opts: { model?: string }, d: NotesJobDeps,
): Promise<void> {
  const now = d.now ?? (() => Date.now());
  const cancelled = () => d.isCancelled?.() ?? false;

  const loaded = await d.load();
  if (!loaded) return;
  let s: SavedSession = loaded;
  const backendId = s.backendId ?? s.id;

  const patch = async (next: Partial<NotesJob>, extra?: Partial<SavedSession>) => {
    const notesJob: NotesJob = { ...(s.notesJob ?? { stage: 'generating', message: '' }), ...next, updatedAt: now() };
    const cur = (await d.load()) ?? s;
    s = { ...cur, ...extra, notesJob };
    await d.save(s);
  };

  // Remember the notes we had before submitting. A backend that predates background mode ignores the
  // flag, generates synchronously and stores the notes WITHOUT ever setting notes_status — polling for
  // notes_status alone would then hang forever. Treat "the stored notes changed" as success too, so a
  // new app against an older backend still completes instead of spinning.
  const notesBefore = s.notes;
  const startedAt = now();

  try {
    // Only submit when nothing is already running — otherwise just attach and poll.
    if (!isNotesActive(s.notesJob)) {
      await patch({ stage: 'generating', message: '生成會議記錄中…', error: undefined });
      await d.analyzeInBackground(backendId, { model: opts.model, names: s.names });
    }

    while (!cancelled()) {
      // Don't poll forever if the backend never reports anything (e.g. it was restarted mid-run).
      if (now() - startedAt > POLL_TIMEOUT_MS) {
        await patch({ stage: 'error', error: '生成逾時，請再試一次。' });
        return;
      }
      let st: SessionStatus | null = null;
      try { st = await d.getSession(backendId); } catch { await d.delay(2000); continue; }

      const finished = st.notes && (st.notes_status === 'done' || st.notes !== notesBefore);
      if (finished && st.notes) {
        const cur = (await d.load()) ?? s;
        // Archive any prior notes so a regenerate stays revertible from 版本紀錄, and promote the
        // AI's H1 to the meeting name while the title is still a default timestamp.
        const withNotes = pushNotesVersion(cur, st.notes, now());
        const aiTitle = extractNotesTitle(st.notes);
        const title = aiTitle && looksLikeAutoTitle(cur.title) ? aiTitle : cur.title;
        s = { ...withNotes, title, notesJob: { stage: 'done', message: '完成', updatedAt: now() } };
        await d.save(s);
        return;
      }
      if (st.notes_status === 'error') {
        await patch({ stage: 'error', error: st.notes_error || '生成失敗' });
        return;
      }
      await d.delay(2000);
    }
  } catch (e: any) {
    await patch({ stage: 'error', error: e?.message || '生成失敗' });
  }
}
