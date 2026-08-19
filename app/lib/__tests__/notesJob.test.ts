import { runNotesJob, isNotesActive, NotesJob, NotesJobDeps, POLL_TIMEOUT_MS } from '../notesJob';
import { SavedSession } from '../store';
import { SessionStatus } from '../types';

const base: SavedSession = {
  id: 'local-1', createdAt: 1, title: '7/15/2026, 12:07:52 AM', names: { SPEAKER_00: 'Gary' },
  unlocked: false, parts: [], backendId: 'backend-1',
};

function harness(seed: SavedSession, statuses: SessionStatus[], nowFn?: () => number) {
  let stored: SavedSession = { ...seed };
  const q = [...statuses];
  const deps: NotesJobDeps = {
    createSession: jest.fn(async () => 'backend-new'),
    analyzeInBackground: jest.fn(async () => {}),
    getSession: jest.fn(async () => q.shift() ?? ({ status: 'done', pct: 1, message: '' } as SessionStatus)),
    load: async () => stored,
    save: async (s) => { stored = s; },
    delay: async () => {},
    now: nowFn ?? (() => 1000),
  };
  return { deps, get session() { return stored; } };
}

const doneWith = (notes: string): SessionStatus =>
  ({ status: 'done', pct: 1, message: '完成', notes_status: 'done', notes });

test('queues generation on the backend and stores the notes when they land', async () => {
  const h = harness(base, [
    { status: 'done', pct: 1, message: '', notes_status: 'running' },
    doneWith('## 會議摘要\n內容'),
  ]);
  await runNotesJob('local-1', {}, h.deps);

  expect(h.deps.analyzeInBackground).toHaveBeenCalledWith('backend-1',
    // clientId lets the server link a row it recreates on demand back to this local session
    expect.objectContaining({ model: undefined, names: { SPEAKER_00: 'Gary' }, clientId: 'local-1' }));
  expect(h.session.notes).toContain('會議摘要');
  expect(h.session.notesJob?.stage).toBe('done');
});

test('resuming an in-flight generation polls WITHOUT submitting a second LLM run', async () => {
  const seed = { ...base, notesJob: { stage: 'generating', message: '', updatedAt: 0 } as NotesJob };
  const h = harness(seed, [doneWith('## 會議摘要\n內容')]);
  await runNotesJob('local-1', {}, h.deps);

  expect(h.deps.analyzeInBackground).not.toHaveBeenCalled();   // the expensive part is never repeated
  expect(h.session.notes).toContain('會議摘要');
});

test('promotes the AI title only while the meeting name is still a timestamp default', async () => {
  const h1 = harness(base, [doneWith('# 會議記錄：AI 導入探討會\n\n## 會議摘要\n內容')]);
  await runNotesJob('local-1', {}, h1.deps);
  expect(h1.session.title).toBe('AI 導入探討會');

  const named = { ...base, title: '客戶月會' };
  const h2 = harness(named, [doneWith('# 會議記錄：AI 導入探討會\n\n## 會議摘要\n內容')]);
  await runNotesJob('local-1', {}, h2.deps);
  expect(h2.session.title).toBe('客戶月會');                    // a user-typed name is never overwritten
});

test('a regenerate archives the previous notes so 版本紀錄 can revert', async () => {
  const withOld = { ...base, notes: '## 舊版\n舊內容' };
  const h = harness(withOld, [doneWith('## 會議摘要\n新內容')]);
  await runNotesJob('local-1', {}, h.deps);
  expect(h.session.notes).toContain('新內容');
  expect(h.session.notesHistory?.[0].notes).toContain('舊內容');
});

test('backend error is recorded on the job', async () => {
  const h = harness(base, [{ status: 'done', pct: 1, message: '', notes_status: 'error', notes_error: 'LLM 沒開' }]);
  await runNotesJob('local-1', {}, h.deps);
  expect(h.session.notesJob?.stage).toBe('error');
  expect(h.session.notesJob?.error).toBe('LLM 沒開');
});

test('OLDER backend (no notes_status): changed notes still count as finished, never hangs', async () => {
  // A backend without background mode generates synchronously and stores the notes but never sets
  // notes_status — polling for that alone would spin forever.
  const h = harness({ ...base, notes: '## 舊版' },
    [{ status: 'done', pct: 1, message: '完成', notes: '## 會議摘要\n新的' }]);
  await runNotesJob('local-1', {}, h.deps);
  expect(h.session.notesJob?.stage).toBe('done');
  expect(h.session.notes).toContain('新的');
});

test('gives up instead of polling forever when the backend never reports a result', async () => {
  let t = 0;
  const h = harness(base, [], () => (t += POLL_TIMEOUT_MS));   // every check is "much later"
  await runNotesJob('local-1', {}, h.deps);
  expect(h.session.notesJob?.stage).toBe('error');
  expect(h.session.notesJob?.error).toMatch(/逾時/);
});

test('isNotesActive', () => {
  expect(isNotesActive({ stage: 'generating' } as NotesJob)).toBe(true);
  expect(isNotesActive({ stage: 'done' } as NotesJob)).toBe(false);
  expect(isNotesActive(undefined)).toBe(false);
});


test('sends OUR transcript so the notes reflect the user\'s corrections', async () => {
  const corrected = { speakers: ['SPEAKER_00'], segments: [{ start: 0, end: 2, speaker: 'SPEAKER_00', text: '改過的字' }] };
  const h = harness({ ...base, transcript: corrected }, [doneWith('## 會議摘要\n內容')]);
  await runNotesJob('local-1', {}, h.deps);
  expect(h.deps.analyzeInBackground).toHaveBeenCalledWith('backend-1',
    expect.objectContaining({ transcript: corrected, names: { SPEAKER_00: 'Gary' } }));
});

test('recreates the backend session when there is none (was "查無逐字稿")', async () => {
  const { backendId, ...noBackend } = base;               // e.g. a recovered recording
  const h = harness(noBackend as SavedSession, [doneWith('## 會議摘要\n內容')]);
  await runNotesJob('local-1', {}, h.deps);
  expect(h.deps.createSession).toHaveBeenCalledWith('local-1');   // idempotent on the local id
  expect(h.session.backendId).toBe('backend-new');
  expect(h.deps.analyzeInBackground).toHaveBeenCalledWith('backend-new', expect.anything());
  expect(h.session.notes).toContain('會議摘要');
});

test('an existing backend session is reused, not recreated', async () => {
  const h = harness(base, [doneWith('## 會議摘要\n內容')]);
  await runNotesJob('local-1', {}, h.deps);
  expect(h.deps.createSession).not.toHaveBeenCalled();
});

test('mirrors the backend progress so the list badge can move while generating', async () => {
  const h = harness(base, [
    { status: 'done', pct: 1, message: '', notes_status: 'running', notes_pct: 0.2, notes_message: '生成中…（已寫 100 字）' },
    { status: 'done', pct: 1, message: '', notes_status: 'running', notes_pct: 0.7, notes_message: '生成中…（已寫 400 字）' },
    doneWith('## 會議摘要\n內容'),
  ]);
  const seen: (number | undefined)[] = [];
  const origSave = h.deps.save;
  h.deps.save = async (s) => { seen.push(s.notesJob?.pct); await origSave(s); };

  await runNotesJob('local-1', {}, h.deps);

  expect(seen).toEqual(expect.arrayContaining([0.2, 0.7]));   // progress reached the session
  expect(h.session.notesJob?.pct).toBe(1);                     // and finishes at 100%
  expect(h.session.notesJob?.stage).toBe('done');
});
