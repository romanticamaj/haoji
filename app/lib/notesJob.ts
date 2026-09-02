import { SavedSession } from './store';
import { SessionStatus } from './types';
import { pushNotesVersion } from './notesEdit';
import { extractNotesTitle, canAdoptAiTitle } from './notesDoc';

// Durable AI-notes generation — the analysis counterpart of lib/job.ts.
//
// Generation runs on the backend (POST /analyze {background:true}) and the notes are written to the
// server session when it finishes, so a phone that is backgrounded or killed mid-generation collects
// the finished notes on its next run instead of losing them and paying for a second LLM run.
export type NotesJob = {
  // 'queued' = accepted by the server but waiting for a worker. Distinguishing it from 'generating'
  // matters: a queued job used to display as 生成中 with nothing happening, which reads as stuck.
  stage: 'queued' | 'generating' | 'done' | 'error';
  message: string;
  error?: string;
  updatedAt: number;
  // 0..1, mirrored from the backend (characters produced / expected). Drives the list badge.
  pct?: number;
};

export type NotesJobDeps = {
  createSession(clientId: string): Promise<string>;
  analyzeInBackground(
    backendId: string,
    opts: { model?: string; names?: Record<string, string>; transcript?: SavedSession['transcript']; clientId?: string },
  ): Promise<void>;
  getSession(backendId: string): Promise<SessionStatus>;
  load(): Promise<SavedSession | null>;
  save(s: SavedSession): Promise<void>;
  delay(ms: number): Promise<void>;
  now?(): number;
  isCancelled?(): boolean;
};

export const isNotesActive = (j?: NotesJob) => j?.stage === 'queued' || j?.stage === 'generating';

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

  // Whether a generation was ALREADY in flight when we started. Captured up front because the
  // backendId patch below writes a notesJob, which would otherwise make the check below think this
  // very call had already submitted — leaving the job polling forever without ever asking the
  // backend to generate anything.
  const wasAlreadyRunning = isNotesActive(s.notesJob);

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
    // Make sure a server session exists to hang the result on. createSession is idempotent on the
    // local id, so this reuses the existing one — and quietly recreates it if the backend lost it
    // (restarted, DB reset), which used to surface as "查無逐字稿" for a meeting the app could see.
    if (!s.backendId) {
      const created = await d.createSession(s.id);
      await patch({}, { backendId: created });
    }
    const backendId = s.backendId ?? s.id;

    // Only submit when nothing was already running — otherwise just attach and poll.
    if (!wasAlreadyRunning) {
      await patch({ stage: 'generating', message: '生成會議記錄中…', error: undefined });
      // Send OUR transcript: it carries the user's corrections, and it exists even when the server
      // copy doesn't. Without this the notes were generated from the uncorrected server-side text.
      await d.analyzeInBackground(backendId, {
        model: opts.model, names: s.names, transcript: s.transcript, clientId: s.id,
      });
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
        // Re-analysing refreshes a title the app derived last time, but never one the user typed.
        const aiTitle = extractNotesTitle(st.notes);
        const adopt = !!aiTitle && canAdoptAiTitle(cur);
        s = {
          ...withNotes,
          title: adopt ? aiTitle! : cur.title,
          titleSource: adopt ? 'ai' : cur.titleSource,
          notesJob: { stage: 'done', message: '完成', pct: 1, updatedAt: now() },
        };
        await d.save(s);
        return;
      }
      if (st.notes_status === 'error') {
        await patch({ stage: 'error', error: st.notes_error || '生成失敗' });
        return;
      }
      // Mirror the backend's stage + progress so the list badge and the tab both reflect reality:
      // waiting in line looks different from actually generating.
      const queued = st.notes_status === 'queued';
      await patch({
        stage: queued ? 'queued' : 'generating',
        pct: queued ? undefined : st.notes_pct,
        message: queued
          ? (st.notes_queue_position ? `排隊中…（第 ${st.notes_queue_position} 位）` : '排隊中…')
          : (st.notes_message || '生成會議記錄中…'),
      });
      await d.delay(2000);
    }
  } catch (e: any) {
    await patch({ stage: 'error', error: e?.message || '生成失敗' });
  }
}
