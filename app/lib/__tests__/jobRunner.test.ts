const mockGetSession = jest.fn();
const mockUploadPart = jest.fn();
const mockTranscribe = jest.fn();
const mockCreateSession = jest.fn();
jest.mock('../api', () => ({
  createSession: (...a: any[]) => mockCreateSession(...a),
  uploadPart: (...a: any[]) => mockUploadPart(...a),
  transcribe: (...a: any[]) => mockTranscribe(...a),
  getSession: (...a: any[]) => mockGetSession(...a),
}));

import { resumeAllJobs, ensureJob, isRunning, onJobChange } from '../jobRunner';
import { createMemoryStore, SavedSession } from '../store';
import { Job } from '../job';

const transcript = { speakers: ['S0'], segments: [{ start: 0, end: 1, speaker: 'S0', text: '嗨' }] };
const mk = (id: string, job?: Job): SavedSession =>
  ({ id, createdAt: 1, title: id, names: {}, unlocked: false, parts: [], backendId: 'b-' + id, job });

beforeEach(() => { jest.clearAllMocks(); });

test('resumeAllJobs picks up ONLY the jobs left in flight (the app-relaunch path)', async () => {
  mockGetSession.mockResolvedValue({ status: 'done', pct: 1, message: '完成', transcript });
  const store = createMemoryStore([
    mk('a', { stage: 'transcribing', uploaded: 0, pct: 0.5, message: '辨識中…', updatedAt: 0 }),
    mk('b', { stage: 'done', uploaded: 0, pct: 1, message: '完成', updatedAt: 0 }),
    mk('c'),                                     // never started — must be left alone
    mk('d', { stage: 'error', uploaded: 0, pct: 0, message: '', updatedAt: 0 }),
  ]);

  const n = await resumeAllJobs(store);
  expect(n).toBe(1);                             // only 'a' was still in flight

  await new Promise((r) => setTimeout(r, 20));   // let the resumed job settle
  expect((await store.get('a'))?.job?.stage).toBe('done');
  expect((await store.get('a'))?.transcript).toEqual(transcript);
  expect((await store.get('c'))?.job).toBeUndefined();
});

test('ensureJob never runs the same session twice concurrently', async () => {
  mockGetSession.mockResolvedValue({ status: 'done', pct: 1, message: '完成', transcript });
  const store = createMemoryStore([mk('x', { stage: 'transcribing', uploaded: 0, pct: 0, message: '', updatedAt: 0 })]);

  const p1 = ensureJob('x', store);
  const p2 = ensureJob('x', store);
  expect(p1).toBe(p2);                           // second call attaches to the running job
  await Promise.all([p1, p2]);
  expect(isRunning('x')).toBe(false);            // and the registry is cleaned up afterwards
});

test('onJobChange notifies listeners as the job progresses, and unsubscribes cleanly', async () => {
  mockGetSession.mockResolvedValue({ status: 'done', pct: 1, message: '完成', transcript });
  const store = createMemoryStore([mk('y', { stage: 'transcribing', uploaded: 0, pct: 0, message: '', updatedAt: 0 })]);
  const seen = jest.fn();
  const off = onJobChange(seen);
  await ensureJob('y', store);
  expect(seen).toHaveBeenCalled();
  off();
  const before = seen.mock.calls.length;
  await ensureJob('y', store);                   // already done → no further notifications to us
  expect(seen.mock.calls.length).toBe(before);
});
