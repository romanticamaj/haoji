import * as api from '../api';
const ok = (b: any) => jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => b });
afterEach(() => jest.restoreAllMocks());

test('createSession sends the client task-id (idempotency key) and returns id', async () => {
  global.fetch = ok({ session_id: 'sid' });
  expect(await api.createSession('local-42')).toBe('sid');
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toContain('/api/sessions');
  expect(JSON.parse(init.body)).toEqual({ client_id: 'local-42' });
});
test('uploadPart posts multipart to /parts with the index (idempotent) and returns count', async () => {
  global.fetch = ok({ count: 2 });
  expect(await api.uploadPart('sid', { uri: 'f', name: 'p.m4a', mime: 'audio/mp4' }, 1)).toBe(2);
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toContain('/api/sessions/sid/parts');
  expect(url).toContain('index=1');
  expect(init.body).toBeInstanceOf(FormData);
});
test('transcribe posts to /transcribe', async () => {
  global.fetch = ok({ ok: true });
  await api.transcribe('sid');
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('/api/sessions/sid/transcribe');
});
