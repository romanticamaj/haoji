import * as api from './api';
import { resolvePartUri } from './recordings';
import * as bgUpload from './backgroundUpload';
import { SessionStore } from './store';
import { runJob, isActive } from './job';
import { runNotesJob, isNotesActive } from './notesJob';

// Process-wide registry of in-flight transcription jobs.
//
// Screens do not own the work: a job keeps running after you navigate away, and — because every step
// is persisted (lib/job.ts) — it is picked back up on the next launch if the app is backgrounded,
// crashes, or is swiped away. `running` only prevents the SAME job being driven twice at once inside
// one app session; correctness across launches comes from the persisted stage, not from this map.
const running = new Map<string, Promise<void>>();
const cancelled = new Set<string>();
const listeners = new Set<() => void>();

/** Subscribe to "some job made progress" (screens re-read the store on the callback). */
export function onJobChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
const notify = () => { listeners.forEach((l) => { try { l(); } catch { /* a bad listener must not kill the job */ } }); };

export const isRunning = (sessionId: string) => running.has(sessionId);

/** Start the job for a session, or attach to the one already running. Safe to call repeatedly. */
export function ensureJob(sessionId: string, store: SessionStore): Promise<void> {
  const existing = running.get(sessionId);
  if (existing) return existing;

  const p = runJob(sessionId, {
    createSession: api.createSession,
    uploadPart: api.uploadPart,
    transcribe: api.transcribe,
    getSession: api.getSession,
    load: () => store.get(sessionId),
    save: async (s) => { await store.upsert(s); notify(); },
    resolveUri: resolvePartUri,
    delay: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    isCancelled: () => cancelled.has(sessionId),
    // When the OS uploader is available the transfers survive the app being swiped away.
    bg: {
      available: bgUpload.available,
      enqueue: bgUpload.enqueue,
      pendingTasks: bgUpload.pendingTasks,
      partUrl: api.partPutUrl,
    },
  }).finally(() => { running.delete(sessionId); cancelled.delete(sessionId); notify(); });

  running.set(sessionId, p);
  notify();
  return p;
}

/**
 * Restart a job from scratch (the 重試 / 重新生成 path).
 *
 * A job already in flight MUST be cancelled and awaited first: `ensureJob` attaches to the running
 * promise, so without this the "restart" would silently join the old run — which would then keep
 * writing its stale stage back over the cleared one.
 */
export async function restartJob(sessionId: string, store: SessionStore): Promise<void> {
  const inflight = running.get(sessionId);
  if (inflight) {
    cancelled.add(sessionId);
    await inflight.catch(() => {});
  }
  const s = await store.get(sessionId);
  if (s) await store.upsert({ ...s, backendId: undefined, job: undefined });
  return ensureJob(sessionId, store);
}

/**
 * Resume every job left in flight — call on app launch / when the list regains focus. A job that was
 * already submitted to the backend usually finishes while the app is closed, so this typically just
 * fetches the finished transcript. Returns how many jobs were resumed.
 */
export async function resumeAllJobs(store: SessionStore): Promise<number> {
  const list = await store.list();
  const active = list.filter((s) => isActive(s.job));
  for (const s of active) void ensureJob(s.id, store);
  // Notes generation is resumed the same way — the backend kept the result while we were away.
  const notes = list.filter((s) => isNotesActive(s.notesJob));
  for (const s of notes) void ensureNotesJob(s.id, store);
  return active.length + notes.length;
}


// --- AI notes generation ---------------------------------------------------------------------
// Same contract as the transcription job: keeps running when you leave the screen, and is resumed on
// the next launch because the backend holds the result (see lib/notesJob.ts).
const runningNotes = new Map<string, Promise<void>>();
const cancelledNotes = new Set<string>();

export const isNotesRunning = (sessionId: string) => runningNotes.has(sessionId);

export function ensureNotesJob(sessionId: string, store: SessionStore, opts: { model?: string } = {}): Promise<void> {
  const existing = runningNotes.get(sessionId);
  if (existing) return existing;

  const p = runNotesJob(sessionId, opts, {
    createSession: api.createSession,
    analyzeInBackground: api.analyzeInBackground,
    getSession: api.getSession,
    load: () => store.get(sessionId),
    save: async (s) => { await store.upsert(s); notify(); },
    delay: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    isCancelled: () => cancelledNotes.has(sessionId),
  }).finally(() => { runningNotes.delete(sessionId); cancelledNotes.delete(sessionId); notify(); });

  runningNotes.set(sessionId, p);
  notify();
  return p;
}

/** Regenerate from scratch: cancel + await anything in flight, clear the stage, then start again. */
export async function restartNotesJob(sessionId: string, store: SessionStore, opts: { model?: string } = {}): Promise<void> {
  const inflight = runningNotes.get(sessionId);
  if (inflight) {
    cancelledNotes.add(sessionId);
    await inflight.catch(() => {});
  }
  const s = await store.get(sessionId);
  if (s) await store.upsert({ ...s, notesJob: undefined });
  return ensureNotesJob(sessionId, store, opts);
}
