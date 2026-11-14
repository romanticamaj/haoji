import { SavedSession } from './store';
import { SessionStatus, Transcript } from './types';

// A durable, RESUMABLE transcription job.
//
// The backend does all the heavy work server-side: `transcribe` only SUBMITS a job and returns, and
// the pipeline then runs to completion whether or not the phone is still listening. So the app never
// needs to "stay alive" to finish a transcription — it only needs to remember where it got to and be
// able to pick the thread back up. That is what this module is: the stage lives on the session in
// AsyncStorage, so a backgrounded / crashed / force-quit app resumes on next launch instead of
// silently losing the job.
//
// Resumption is safe because every backend call is idempotent:
//   createSession(clientId) → returns the SAME server session on retry
//   uploadPart(..., index)  → overwrites slot `index` rather than appending a duplicate
//   transcribe(id)          → guarded server-side against a second job for the same session
export type JobStage = 'uploading' | 'transcribing' | 'done' | 'error';

export type Job = {
  stage: JobStage;
  uploaded: number;        // parts confirmed uploaded — where a resumed upload restarts
  pct: number;             // 0..1 overall progress, for the list badge and the progress screen
  message: string;
  error?: string;
  updatedAt: number;
  // Set when the parts were handed to the OS background uploader: from then on we are waiting for the
  // transfers to land and the backend to auto-start. Used to give up if that never happens.
  waitingSince?: number;
};

// How long to wait for OS-driven uploads to land before calling it a failure. Generous: a long
// meeting over a slow link legitimately takes a while.
export const UPLOAD_WAIT_TIMEOUT_MS = 30 * 60 * 1000;

export type JobDeps = {
  createSession(clientId: string, expectedParts?: number): Promise<string>;
  uploadPart(backendId: string, file: { uri: string; name: string; mime: string }, index: number): Promise<number>;
  transcribe(backendId: string): Promise<void>;
  getSession(backendId: string): Promise<SessionStatus>;
  load(): Promise<SavedSession | null>;          // re-read the session (never trust a stale copy)
  save(s: SavedSession): Promise<void>;
  resolveUri(stored: string): string;
  delay(ms: number): Promise<void>;
  now?(): number;
  isCancelled?(): boolean;
  // Optional OS-driven upload. When available the parts are handed to iOS, which finishes them even
  // if the app is swiped away; the backend then starts transcription itself once they all arrive.
  bg?: {
    available: boolean;
    enqueue(url: string, fileUri: string, taskId: string): Promise<void>;
    pendingTasks(): Promise<string[]>;
    // May be async: the server is resolved at runtime (lib/server.ts), same base as every api call.
    partUrl(backendId: string, index: number): string | Promise<string>;
  };
};

export const isActive = (j?: Job) => j?.stage === 'uploading' || j?.stage === 'transcribing';

export const newJob = (at: number): Job =>
  ({ stage: 'uploading', uploaded: 0, pct: 0, message: '準備中…', updatedAt: at });

// Overall progress: uploading occupies the first 40%, server-side work the remaining 60%, so the bar
// never jumps backwards when the stage flips.
export const overallPct = (j: Job): number =>
  j.stage === 'done' ? 1 : j.stage === 'uploading' ? Math.min(0.4, j.pct * 0.4) : 0.4 + Math.min(1, j.pct) * 0.6;

const mimeFor = (uri: string) => (uri.endsWith('.wav') ? 'audio/wav' : 'audio/mp4');
const nameFor = (uri: string, i: number) => `part-${i}.${uri.endsWith('.wav') ? 'wav' : 'm4a'}`;

// Run (or resume) the job for one session. Safe to call repeatedly — see the idempotency notes above.
// Persists after every meaningful step so a kill at any point resumes from that step.
export async function runJob(sessionId: string, d: JobDeps): Promise<void> {
  const now = d.now ?? (() => Date.now());
  const cancelled = () => d.isCancelled?.() ?? false;

  const loaded = await d.load();
  if (!loaded) return;
  let s: SavedSession = loaded;
  let job: Job = s.job ?? newJob(now());
  if (job.stage === 'done') return;

  const patch = async (next: Partial<Job>, extra?: Partial<SavedSession>) => {
    job = { ...job, ...next, updatedAt: now() };
    const cur = (await d.load()) ?? s;
    s = { ...cur, ...extra, job };
    await d.save(s);
  };

  try {
    // 1. Ensure a backend session. Idempotent on the local id, so a retry reuses the same one.
    let backendId = s.backendId;
    if (!backendId) {
      await patch({ message: '正在連線…' });
      // Declare the part count up front: once they have all landed the backend starts transcription
      // ITSELF, so the pipeline completes even if this app never gets to call /transcribe.
      backendId = await d.createSession(sessionId, (s.parts ?? []).length);
      await patch({}, { backendId });
    }
    if (cancelled()) return;

    // 2. If the server already has this job in flight (or finished), never re-upload — the parts are
    //    deleted server-side once transcription completes, so a blind re-upload would be both
    //    wasteful and confusing. Ask first, then jump straight to polling.
    if (job.stage === 'uploading' && job.uploaded > 0) {
      const st = await d.getSession(backendId).catch(() => null);
      if (st && st.status !== 'queued') await patch({ stage: 'transcribing', pct: st.pct ?? 0, message: st.message || '' });
    }

    // 3. Upload the remaining parts.
    if (job.stage === 'uploading') {
      const parts = s.parts ?? [];
      if (d.bg?.available && parts.length > 0) {
        // Hand the files to the OS: it keeps uploading with the app suspended or swiped away. We do
        // NOT call transcribe here — the backend starts it itself once every expected part lands,
        // which is what lets the whole pipeline finish without this app ever running again.
        const pending = await d.bg.pendingTasks();
        for (let i = job.uploaded; i < parts.length; i++) {
          if (cancelled()) return;
          const taskId = `${sessionId}:${i}`;
          if (pending.includes(taskId)) continue;   // already in the OS queue — never queue it twice
          await d.bg.enqueue(await d.bg.partUrl(backendId, i), d.resolveUri(parts[i].uri), taskId);
        }
        await patch({
          stage: 'transcribing', uploaded: parts.length, pct: 0,
          message: '正在傳送錄音…（可以離開 App）', waitingSince: now(),
        });
      } else {
        for (let i = job.uploaded; i < parts.length; i++) {
          if (cancelled()) return;
          await patch({ pct: parts.length ? i / parts.length : 0, message: `正在傳送錄音… ${i + 1}/${parts.length}` });
          await d.uploadPart(backendId, {
            uri: d.resolveUri(parts[i].uri), name: nameFor(parts[i].uri, i), mime: mimeFor(parts[i].uri),
          }, i);
          await patch({ uploaded: i + 1, pct: parts.length ? (i + 1) / parts.length : 1 });
        }
        if (cancelled()) return;
        await d.transcribe(backendId);
        // From here the backend finishes on its own — the app can die freely.
        await patch({ stage: 'transcribing', pct: 0, message: '正在整理逐字稿…' });
      }
    }

    // 4. Poll until the server is done. This is the only thing a resumed app has to do.
    while (job.stage === 'transcribing') {
      if (cancelled()) return;
      let st: SessionStatus | null = null;
      try { st = await d.getSession(backendId); } catch { await d.delay(1500); continue; }
      if (st.status === 'done') {
        await patch({ stage: 'done', pct: 1, message: '完成' }, { transcript: st.transcript as Transcript });
        return;
      }
      if (st.status === 'error') {
        await patch({ stage: 'error', error: st.error || st.message || '逐字稿沒有整理完成。' });
        return;
      }
      // Still 'queued' long after the parts were handed to the OS means the transfers never landed
      // (upload failed / backend unreachable). Fail loudly instead of polling forever.
      if (st.status === 'queued' && job.waitingSince && now() - job.waitingSince > UPLOAD_WAIT_TIMEOUT_MS) {
        await patch({ stage: 'error', error: '錄音沒有傳送完成，請再試一次。' });
        return;
      }
      await patch({ pct: st.pct ?? 0, message: st.message || '正在整理逐字稿…' });
      await d.delay(1500);
    }
  } catch (e: any) {
    await patch({ stage: 'error', error: e?.message || '整理沒有完成，請再試一次。' });
  }
}
