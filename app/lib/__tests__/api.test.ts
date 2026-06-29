import * as api from '../api';

const mockFetch = (body: any, ok = true, status = 200) =>
  jest.fn().mockResolvedValue({ ok, status, json: async () => body } as any);

afterEach(() => jest.restoreAllMocks());

test('createSession posts empty and returns session_id', async () => {
  global.fetch = mockFetch({ session_id: 'abc123' });
  const id = await api.createSession();
  expect(id).toBe('abc123');
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toContain('/api/sessions');
  expect(init.method).toBe('POST');
});

test('getSession returns parsed status', async () => {
  global.fetch = mockFetch({ status: 'done', pct: 1, message: 'ok', transcript: { segments: [], speakers: [] } });
  const s = await api.getSession('abc123');
  expect(s.status).toBe('done');
  expect(s.transcript?.speakers).toEqual([]);
});

test('analyze sends model + names and returns notes', async () => {
  global.fetch = mockFetch({ notes: '## 會議摘要\nhi', model: 'gemma4:e4b-it-qat' });
  const r = await api.analyze('abc123', { model: 'm', names: { SPEAKER_00: 'Gary' } });
  expect(r.notes).toContain('## 會議摘要');
  const [, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(JSON.parse(init.body)).toEqual({ model: 'm', names: { SPEAKER_00: 'Gary' } });
});

test('createSession throws on non-ok response', async () => {
  global.fetch = mockFetch({ error: '不支援的檔案格式' }, false, 400);
  await expect(api.createSession()).rejects.toThrow();
});

test('getModels returns models list and default', async () => {
  global.fetch = mockFetch({ ok: true, models: ['gemma4:e4b-it-qat'], default: 'gemma4:e4b-it-qat' });
  const result = await api.getModels();
  expect(result).toEqual({ ok: true, models: ['gemma4:e4b-it-qat'], default: 'gemma4:e4b-it-qat' });
  const [url] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toContain('/api/llm/models');
});
