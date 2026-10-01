// The push token rides along with backend session creation — and must never hold up transcription.
const mockCreateSession = jest.fn();
jest.mock('../api', () => ({
  createSession: (...a: any[]) => mockCreateSession(...a),
  uploadPart: jest.fn(async () => 1),
  transcribe: jest.fn(async () => {}),
  getSession: jest.fn(async () => ({ status: 'done', pct: 1, message: '完成', transcript: { speakers: [], segments: [] } })),
  partPutUrl: jest.fn(),
}));
const mockRegister = jest.fn();
jest.mock('../push', () => ({ register: () => mockRegister() }));
jest.mock('../backgroundUpload', () => ({ available: false }));

import { ensureJob, PUSH_WAIT_MS } from '../jobRunner';
import { createMemoryStore, SavedSession } from '../store';

const fresh = (): SavedSession => ({
  id: 'local-1', createdAt: 1, title: '週會', names: {}, unlocked: false,
  parts: [{ uri: 'haoji/local-1/part-0.m4a', durationMs: 1000 }],
});

beforeEach(() => { jest.clearAllMocks(); mockCreateSession.mockResolvedValue('b-1'); });
afterEach(() => { jest.useRealTimers(); });

test('the device token and meeting title go to the backend with the new session', async () => {
  mockRegister.mockResolvedValue({ token: 'abcd', env: 'production' });
  await ensureJob('local-1', createMemoryStore([fresh()]));
  expect(mockCreateSession).toHaveBeenCalledWith('local-1', 1, { token: 'abcd', env: 'production', title: '週會' });
});

test('notifications declined: the session is created without a token', async () => {
  mockRegister.mockResolvedValue(null);
  await ensureJob('local-1', createMemoryStore([fresh()]));
  expect(mockCreateSession).toHaveBeenCalledWith('local-1', 1);
});

test('a token that is slow to arrive does not stall the job, and is attached once it does', async () => {
  jest.useFakeTimers();
  let deliver!: (t: any) => void;
  mockRegister.mockReturnValue(new Promise((r) => { deliver = r; }));
  const job = ensureJob('local-1', createMemoryStore([fresh()]));

  await jest.advanceTimersByTimeAsync(PUSH_WAIT_MS);
  expect(mockCreateSession).toHaveBeenCalledWith('local-1', 1);          // carried on without it
  jest.useRealTimers();
  await job;

  deliver({ token: 'late', env: 'sandbox' });
  await new Promise((r) => setTimeout(r, 0));
  expect(mockCreateSession).toHaveBeenLastCalledWith('local-1', 1, { token: 'late', env: 'sandbox', title: '週會' });
});
