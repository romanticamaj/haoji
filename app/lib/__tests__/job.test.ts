import { runJob, newJob, isActive, overallPct, Job, JobDeps } from '../job';
import { SavedSession } from '../store';
import { SessionStatus } from '../types';

const base: SavedSession = {
  id: 'local-1', createdAt: 1, title: 't', names: {}, unlocked: false,
  parts: [
    { uri: 'haoji/local-1/part-0.wav', durationMs: 1000 },
    { uri: 'haoji/local-1/part-1.wav', durationMs: 1000 },
    { uri: 'haoji/local-1/part-2.wav', durationMs: 1000 },
  ],
};

const transcript = { speakers: ['SPEAKER_00'], segments: [{ start: 0, end: 1, speaker: 'SPEAKER_00', text: '你好' }] };

function harness(seed: SavedSession, statuses: SessionStatus[]) {
  let stored: SavedSession = { ...seed };
  const uploads: number[] = [];
  const q = [...statuses];
  const deps: JobDeps = {
    createSession: jest.fn(async () => 'backend-1'),
    uploadPart: jest.fn(async (_id, _f, i) => { uploads.push(i); return i + 1; }),
    transcribe: jest.fn(async () => {}),
    getSession: jest.fn(async () => q.shift() ?? { status: 'done', pct: 1, message: '完成', transcript } as SessionStatus),
    load: async () => stored,
    save: async (s) => { stored = s; },
    resolveUri: (u) => `file:///doc/${u}`,
    delay: async () => {},
    now: () => 1000,
  };
  return { deps, uploads, get session() { return stored; } };
}

test('fresh job: creates the backend session, uploads every part, submits, polls to done', async () => {
  const h = harness(base, [
    { status: 'running', pct: 0.3, message: '辨識中…' },
    { status: 'done', pct: 1, message: '完成', transcript },
  ]);
  await runJob('local-1', h.deps);

  expect(h.deps.createSession).toHaveBeenCalledWith('local-1', 3); // idempotency key + expected part count
  expect(h.uploads).toEqual([0, 1, 2]);
  expect(h.deps.transcribe).toHaveBeenCalledWith('backend-1');
  expect(h.session.job?.stage).toBe('done');
  expect(h.session.transcript).toEqual(transcript);
  expect(h.session.backendId).toBe('backend-1');
});

test('resume mid-upload: re-uploads ONLY the parts that never made it', async () => {
  const seed = { ...base, backendId: 'backend-1', job: { ...newJob(0), uploaded: 2 } as Job };
  // the pre-flight status check must say "not started yet" so the upload continues
  const h = harness(seed, [{ status: 'queued', pct: 0, message: '排隊中…' },
                           { status: 'done', pct: 1, message: '完成', transcript }]);
  await runJob('local-1', h.deps);

  expect(h.uploads).toEqual([2]);                                  // parts 0 and 1 are NOT re-sent
  expect(h.deps.createSession).not.toHaveBeenCalled();             // existing backend session reused
  expect(h.session.job?.stage).toBe('done');
});

test('resume while the server is already transcribing: never uploads, just polls', async () => {
  const seed = {
    ...base, backendId: 'backend-1',
    job: { stage: 'transcribing', uploaded: 3, pct: 0.5, message: '辨識中…', updatedAt: 0 } as Job,
  };
  const h = harness(seed, [{ status: 'done', pct: 1, message: '完成', transcript }]);
  await runJob('local-1', h.deps);

  expect(h.uploads).toEqual([]);                                   // the whole point: no re-upload
  expect(h.deps.transcribe).not.toHaveBeenCalled();                // and no duplicate submission
  expect(h.session.transcript).toEqual(transcript);
});

test('a job killed mid-upload persists its progress after every part', async () => {
  const saves: number[] = [];
  const h = harness(base, [{ status: 'done', pct: 1, message: '完成', transcript }]);
  const orig = h.deps.save;
  h.deps.save = async (s) => { if (s.job) saves.push(s.job.uploaded); await orig(s); };
  await runJob('local-1', h.deps);
  // uploaded advances 0→1→2→3 and is written each time, so a kill resumes at the right part
  expect(saves).toEqual(expect.arrayContaining([1, 2, 3]));
});

test('server error is recorded on the job instead of throwing', async () => {
  const h = harness(base, [{ status: 'error', pct: 0, message: '辨識失敗', error: 'ASR down' }]);
  await runJob('local-1', h.deps);
  expect(h.session.job?.stage).toBe('error');
  expect(h.session.job?.error).toBe('ASR down');
});

test('a thrown upload error is captured, leaving the job resumable', async () => {
  const h = harness(base, []);
  (h.deps.uploadPart as jest.Mock).mockRejectedValueOnce(new Error('連線逾時'));
  await runJob('local-1', h.deps);
  expect(h.session.job?.stage).toBe('error');
  expect(h.session.job?.error).toBe('連線逾時');
});

test('an already-finished job is a no-op (no duplicate work on relaunch)', async () => {
  const seed = { ...base, job: { stage: 'done', uploaded: 3, pct: 1, message: '完成', updatedAt: 0 } as Job };
  const h = harness(seed, []);
  await runJob('local-1', h.deps);
  expect(h.deps.createSession).not.toHaveBeenCalled();
  expect(h.uploads).toEqual([]);
});

test('cancellation stops the loop without marking the job failed', async () => {
  const h = harness(base, []);
  h.deps.isCancelled = () => true;
  await runJob('local-1', h.deps);
  expect(h.uploads).toEqual([]);
  expect(h.session.job?.stage).not.toBe('error');
});

test('isActive / overallPct', () => {
  expect(isActive({ stage: 'uploading' } as Job)).toBe(true);
  expect(isActive({ stage: 'transcribing' } as Job)).toBe(true);
  expect(isActive({ stage: 'done' } as Job)).toBe(false);
  expect(isActive(undefined)).toBe(false);
  // upload occupies 0–40%, server work 40–100%, so the bar never goes backwards at the handover
  expect(overallPct({ stage: 'uploading', pct: 1 } as Job)).toBeCloseTo(0.4);
  expect(overallPct({ stage: 'transcribing', pct: 0 } as Job)).toBeCloseTo(0.4);
  expect(overallPct({ stage: 'done', pct: 1 } as Job)).toBe(1);
});
