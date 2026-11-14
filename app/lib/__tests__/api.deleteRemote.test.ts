import * as api from '../api';
import * as server from '../server';
import * as config from '../config';

beforeEach(async () => { await server.forgetServer(); });
afterEach(() => jest.restoreAllMocks());

test('deleteRemote sends DELETE /api/sessions/{id} to the paired server with the Bearer token', async () => {
  await server.saveServer({ url: 'http://10.0.0.9:7780', token: 'tok', pairedAt: 1 });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) }) as any;
  await api.deleteRemote('srv-1');
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toBe('http://10.0.0.9:7780/api/sessions/srv-1');
  expect(init.method).toBe('DELETE');
  expect(init.headers.Authorization).toBe('Bearer tok');
});

test('deleteRemote is a silent no-op when unpaired', async () => {
  jest.replaceProperty(config, 'API_BASE', null);
  global.fetch = jest.fn() as any;
  await expect(api.deleteRemote('srv-1')).resolves.toBeUndefined();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('deleteRemote swallows network errors and non-ok answers', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('down')) as any;
  await expect(api.deleteRemote('srv-1')).resolves.toBeUndefined();
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }) as any;
  await expect(api.deleteRemote('srv-1')).resolves.toBeUndefined();
});
