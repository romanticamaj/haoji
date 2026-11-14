import { stageOf, STAGES, runJob, Job, JobDeps } from '../job';
import { SavedSession } from '../store';
import { SessionStatus } from '../types';

const job = (over: Partial<Job>): Job => ({ stage: 'uploading', uploaded: 0, pct: 0, message: '', updatedAt: 0, ...over });

test('the four stages, in order', () => {
  expect(STAGES).toEqual(['上傳', '排隊', '辨識', '整理']);
});

describe('stageOf', () => {
  test.each<[string, Job | undefined, SessionStatus['status'] | undefined, number]>([
    ['no job yet', undefined, undefined, 0],
    ['uploading', job({ stage: 'uploading', pct: 0.5 }), undefined, 0],
    ['submitted, server not polled yet', job({ stage: 'transcribing' }), undefined, 1],
    ['submitted, server queued', job({ stage: 'transcribing' }), 'queued', 1],
    ['server running', job({ stage: 'transcribing' }), 'running', 2],
    ['server done', job({ stage: 'transcribing' }), 'done', 3],
    ['job done', job({ stage: 'done', pct: 1 }), undefined, 3],
    // Parts handed to the OS uploader: the server reports "queued" from creation until every part
    // has landed, so that still reads as uploading.
    ['background upload in flight', job({ stage: 'transcribing', waitingSince: 1 }), undefined, 0],
    ['background upload, server queued', job({ stage: 'transcribing', waitingSince: 1 }), 'queued', 0],
    ['background upload, server running', job({ stage: 'transcribing', waitingSince: 1 }), 'running', 2],
    ['error during upload', job({ stage: 'error' }), undefined, 0],
    ['error while recognising', job({ stage: 'error' }), 'running', 2],
  ])('%s → %i', (_name, j, st, expected) => {
    expect(stageOf(j, st)).toBe(expected);
  });

  test('falls back to the status the job recorded while polling', () => {
    expect(stageOf(job({ stage: 'transcribing', serverStatus: 'running' }))).toBe(2);
  });
});

test('runJob records the server status while polling (so the stage survives a relaunch)', async () => {
  const session: SavedSession = {
    id: 'l', createdAt: 1, title: 't', names: {}, unlocked: false,
    parts: [{ uri: 'haoji/l/part-0.wav', durationMs: 1 }],
  };
  let stored = session;
  const seen: (string | undefined)[] = [];
  const q: SessionStatus[] = [
    { status: 'queued', pct: 0, message: '排隊中…' },
    { status: 'running', pct: 0.4, message: '辨識中…' },
    { status: 'done', pct: 1, message: '完成', transcript: { segments: [], speakers: [] } },
  ];
  const deps: JobDeps = {
    createSession: async () => 'b',
    uploadPart: async () => 1,
    transcribe: async () => {},
    getSession: async () => q.shift()!,
    load: async () => stored,
    save: async (s) => { stored = s; seen.push(s.job?.serverStatus); },
    resolveUri: (u) => u,
    delay: async () => {},
    now: () => 1,
  };
  await runJob('l', deps);
  expect(seen).toContain('queued');
  expect(seen).toContain('running');
  expect(stored.job?.stage).toBe('done');
});
