import * as api from './api';
import { resolvePartUri } from './recordings';
import { SessionStore } from './store';
import { runJob, isActive } from './job';

// Process-wide registry of in-flight transcription jobs.
//
// Screens do not own the work: a job keeps running after you navigate away, and — because every step
// is persisted (lib/job.ts) — it is picked back up on the next launch if the app is backgrounded,
// crashes, or is swiped away. `running` only prevents the SAME job being driven twice at once inside
// one app session; correctness across launches comes from the persisted stage, not from this map.
const running = new Map<string, Promise<void>>();
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
  }).finally(() => { running.delete(sessionId); notify(); });

  running.set(sessionId, p);
  notify();
  return p;
}

/** Restart a failed/finished job from scratch (the 重試 / 重新生成 path). */
export async function restartJob(sessionId: string, store: SessionStore): Promise<void> {
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
  return active.length;
}
