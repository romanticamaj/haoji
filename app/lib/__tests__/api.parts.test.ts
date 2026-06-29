import * as api from '../api';
const ok = (b: any) => jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => b });
afterEach(() => jest.restoreAllMocks());

test('createSession posts empty and returns id', async () => {
  global.fetch = ok({ session_id: 'sid' });
  expect(await api.createSession()).toBe('sid');
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('/api/sessions');
});
test('uploadPart posts multipart to /parts and returns count', async () => {
  global.fetch = ok({ count: 2 });
  expect(await api.uploadPart('sid', { uri: 'f', name: 'p.m4a', mime: 'audio/mp4' })).toBe(2);
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toContain('/api/sessions/sid/parts'); expect(init.body).toBeInstanceOf(FormData);
});
test('transcribe posts to /transcribe', async () => {
  global.fetch = ok({ ok: true });
  await api.transcribe('sid');
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('/api/sessions/sid/transcribe');
});
