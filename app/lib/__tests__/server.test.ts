import AsyncStorage from '@react-native-async-storage/async-storage';
import * as server from '../server';
import * as api from '../api';
import * as config from '../config';

afterEach(() => jest.restoreAllMocks());

const ok = (b: any) => jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => b });

beforeEach(async () => {
  await server.forgetServer();
  await AsyncStorage.clear();
});

describe('normalizeUrl', () => {
  test.each([
    ['100.1.2.3:7780', 'http://100.1.2.3:7780'],
    [' https://h/ ', 'https://h'],
    ['http://box.tail1234.ts.net:7780/', 'http://box.tail1234.ts.net:7780'],
    ['HTTPS://Host:443', 'https://Host:443'],
    ['ftp://x', null],
    ['javascript:alert(1)', null],
    ['', null],
    ['   ', null],
    ['http://', null],
  ])('%p → %p', (input, out) => {
    expect(server.normalizeUrl(input)).toBe(out);
  });
});

describe('serverBase precedence', () => {
  test('paired URL wins over the build-time default', async () => {
    // jest-setup gives Config.API_BASE = http://127.0.0.1:7780
    expect(await server.serverBase()).toBe('http://127.0.0.1:7780');
    await server.saveServer({ url: 'http://10.0.0.9:7780', token: 't', pairedAt: 1 });
    expect(await server.serverBase()).toBe('http://10.0.0.9:7780');
  });

  test('forgetting falls back to the build-time default', async () => {
    await server.saveServer({ url: 'http://10.0.0.9:7780', pairedAt: 1 });
    await server.forgetServer();
    expect(await server.serverBase()).toBe('http://127.0.0.1:7780');
  });

  test('no paired URL and no build-time default → null (unpaired)', async () => {
    jest.replaceProperty(config, 'API_BASE', null);
    expect(await server.serverBase()).toBeNull();
  });

  test('the paired server survives a restart (persisted)', async () => {
    await server.saveServer({ url: 'http://10.0.0.9:7780', token: 'tok', name: 'box', pairedAt: 5 });
    await jest.isolateModulesAsync(async () => {
      const s = require('../server');
      expect(await s.loadServer()).toEqual({ url: 'http://10.0.0.9:7780', token: 'tok', name: 'box', pairedAt: 5 });
    });
  });
});

describe('authHeaders', () => {
  test('empty without a token', async () => {
    expect(await server.authHeaders()).toEqual({});
  });
  test('Bearer when paired with a token', async () => {
    await server.saveServer({ url: 'http://h', token: 'abc', pairedAt: 1 });
    expect(await server.authHeaders()).toEqual({ Authorization: 'Bearer abc' });
  });
});

test('subscribe is notified on save and forget, and can unsubscribe', async () => {
  const fn = jest.fn();
  const off = server.subscribe(fn);
  await server.saveServer({ url: 'http://h', pairedAt: 1 });
  await server.forgetServer();
  expect(fn).toHaveBeenCalledTimes(2);
  off();
  await server.saveServer({ url: 'http://h', pairedAt: 1 });
  expect(fn).toHaveBeenCalledTimes(2);
});

describe('api uses the runtime server per call', () => {
  afterEach(() => jest.restoreAllMocks());

  test('createSession goes to the paired server with a Bearer header', async () => {
    await server.saveServer({ url: 'http://10.0.0.9:7780', token: 'pTk', pairedAt: 1 });
    global.fetch = ok({ session_id: 'sid' });
    await api.createSession('local-1');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://10.0.0.9:7780/api/sessions');
    expect(init.headers.Authorization).toBe('Bearer pTk');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  test('re-pairing switches the base without a reload', async () => {
    global.fetch = ok({ ok: true });
    await server.saveServer({ url: 'http://a:1', pairedAt: 1 });
    await api.transcribe('s');
    await server.saveServer({ url: 'http://b:2', pairedAt: 2 });
    await api.transcribe('s');
    const urls = (global.fetch as jest.Mock).mock.calls.map((c) => c[0]);
    expect(urls).toEqual(['http://a:1/api/sessions/s/transcribe', 'http://b:2/api/sessions/s/transcribe']);
  });

  test('no Authorization header when paired without a token', async () => {
    await server.saveServer({ url: 'http://a:1', pairedAt: 1 });
    global.fetch = ok({ count: 1 });
    await api.uploadPart('sid', { uri: 'f', name: 'p.wav', mime: 'audio/wav' }, 0);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers?.Authorization).toBeUndefined();
  });

  test('partPutUrl uses the same base as the other calls', async () => {
    await server.saveServer({ url: 'http://a:1', pairedAt: 1 });
    expect(await api.partPutUrl('sid', 3)).toBe('http://a:1/api/sessions/sid/parts/3');
  });

  test('api.* rejects with NotPairedError when unpaired, without touching the network', async () => {
    jest.replaceProperty(config, 'API_BASE', null);
    global.fetch = jest.fn();
    await expect(api.createSession('x')).rejects.toBeInstanceOf(server.NotPairedError);
    await expect(api.getSession('x')).rejects.toBeInstanceOf(server.NotPairedError);
    await expect(api.getModels()).rejects.toBeInstanceOf(server.NotPairedError);
    await expect(api.partPutUrl('x', 0)).rejects.toBeInstanceOf(server.NotPairedError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('the structured error shape surfaces its message', async () => {
    const body = require('../../../backend/tests/fixtures/contracts/error.json');
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 409, json: async () => body });
    await expect(api.transcribe('s')).rejects.toThrow(body.error.message);
  });
});
