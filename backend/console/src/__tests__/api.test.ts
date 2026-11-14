import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, getToken, login, onUnauthorized, setToken } from '../api';
import { FakeEventSource, fx, mockFetch } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  setToken(null);
});

describe('api client', () => {
  it('attaches the admin token as a Bearer header', async () => {
    const m = mockFetch({ 'GET /api/status?detail=1': { json: fx.statusDetail } });
    setToken('adm-123');
    const data = await api.get<typeof fx.statusDetail>('/api/status?detail=1');
    expect(data.gpu.name).toBe('NVIDIA GeForce RTX 5070 Ti');
    expect(m.calls[0].headers.get('Authorization')).toBe('Bearer adm-123');
  });

  it('sends no Authorization header without a token', async () => {
    const m = mockFetch({ 'GET /api/status': { json: fx.status } });
    await api.get('/api/status');
    expect(m.calls[0].headers.get('Authorization')).toBeNull();
  });

  it('keeps the token in sessionStorage', () => {
    setToken('abc');
    expect(sessionStorage.getItem('haoji_admin_token')).toBe('abc');
    expect(getToken()).toBe('abc');
    setToken(null);
    expect(getToken()).toBeNull();
  });

  it('surfaces 401 as ApiError.status === 401 and notifies the auth gate', async () => {
    mockFetch({ 'GET /api/jobs': { status: 401, json: { error: { code: 'unauthorized', message: '需要管理金鑰', hint: '' } } } });
    const seen = vi.fn();
    const off = onUnauthorized(seen);
    const err = (await api.get('/api/jobs').catch((e: unknown) => e)) as ApiError;
    off();
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.code).toBe('unauthorized');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('parses the uniform error shape (code, message, hint)', async () => {
    mockFetch({ 'PUT /api/settings': { status: 409, json: fx.error } });
    const err = (await api.put('/api/settings', { ollama_base_url: 'x' }).catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(409);
    expect(err.code).toBe('setting_locked');
    expect(err.message).toBe(fx.error.error.message);
    expect(err.hint).toBe(fx.error.error.hint);
  });

  it('sends JSON bodies for POST/PUT and supports DELETE', async () => {
    const m = mockFetch({
      'POST /api/llm/pull': { status: 202, json: { ok: true } },
      'DELETE /api/llm/models/qwen3%3A8b': { json: { ok: true } },
    });
    await api.post('/api/llm/pull', { name: 'qwen3:8b' });
    await api.del(`/api/llm/models/${encodeURIComponent('qwen3:8b')}`);
    expect(m.calls[0].body).toEqual({ name: 'qwen3:8b' });
    expect(m.calls[0].headers.get('Content-Type')).toBe('application/json');
    expect(m.calls[1].method).toBe('DELETE');
  });

  it('maps a network failure to ApiError status 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const err = (await api.get('/api/status').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.code).toBe('network');
  });

  it('login trims token, posts it, and stores it', async () => {
    const m = mockFetch({ 'POST /api/console/login': { json: { ok: true } } });
    await login('  \n adm-xyz \t\n');
    expect(m.calls[0].body).toEqual({ token: 'adm-xyz' });
    expect(getToken()).toBe('adm-xyz');
  });

  it('login does not store a rejected token', async () => {
    mockFetch({ 'POST /api/console/login': { status: 401, json: { error: { code: 'unauthorized', message: 'x', hint: '' } } } });
    await expect(login('bad')).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBeNull();
  });

  it('events() parses JSON messages and closes', () => {
    FakeEventSource.install();
    const got: unknown[] = [];
    const close = api.events('/api/llm/pull/qwen3%3A8b/events', (m) => got.push(m));
    const es = FakeEventSource.last();
    expect(es.url).toBe('/api/llm/pull/qwen3%3A8b/events');
    es.emit(fx.pullEvents[1]);
    expect(got).toEqual([fx.pullEvents[1]]);
    close();
    expect(es.closed).toBe(true);
  });
});
