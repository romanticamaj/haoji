import { validateServer, summarize, MESSAGES, type PublicStatus } from '../serverStatus';

const status: PublicStatus = require('../../../backend/tests/fixtures/contracts/status.json');
const allGreen = (over: Partial<PublicStatus> = {}): PublicStatus => ({
  ...status,
  ok: true,
  checks: status.checks.map((c) => ({ ...c, ok: true, hint: '' })),
  queue: { active: 0, queued: 0 },
  ...over,
});

type R = { status: number; json?: any; text?: string };
const res = ({ status: code, json, text }: R) => ({
  ok: code >= 200 && code < 300,
  status: code,
  json: async () => { if (json === undefined) throw new SyntaxError('not json'); return json; },
  text: async () => text ?? (json !== undefined ? JSON.stringify(json) : ''),
});
/** A fake fetch routing by path suffix. */
const fakeFetch = (routes: Record<string, R | Error>) => jest.fn(async (url: string, _init?: any) => {
  const key = Object.keys(routes).find((k) => url.endsWith(k));
  const r = key ? routes[key] : { status: 404, json: { detail: 'Not Found' } };
  if (r instanceof Error) throw r;
  return res(r) as any;
});

describe('validateServer', () => {
  test('ok: a Haoji server answers /api/status', async () => {
    const f = fakeFetch({ '/api/status': { status: 200, json: status } });
    const r = await validateServer('http://box:7780', undefined, f);
    expect(r).toEqual({ ok: true, status });
    expect(f.mock.calls[0][0]).toBe('http://box:7780/api/status');
  });

  test('normalises a typed address before probing', async () => {
    const f = fakeFetch({ '/api/status': { status: 200, json: status } });
    await validateServer(' 100.64.0.5:7780/ ', undefined, f);
    expect(f.mock.calls[0][0]).toBe('http://100.64.0.5:7780/api/status');
  });

  test('sends the token as a Bearer header', async () => {
    const f = fakeFetch({ '/api/status': { status: 200, json: status } });
    await validateServer('http://box', 'tok', f);
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  test('unreachable: the request fails', async () => {
    const f = fakeFetch({ '/api/status': new TypeError('Network request failed') });
    expect(await validateServer('http://box', undefined, f)).toEqual({
      ok: false, reason: 'unreachable',
      message: '連不到這個網址，確認主機有開、手機和主機在同一個網路或 Tailscale 上。',
    });
  });

  test('unreachable: times out after 5 s', async () => {
    jest.useFakeTimers();
    try {
      const f = jest.fn((_u: string, init: any) => new Promise((_r, rej) => {
        init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })) as any;
      const p = validateServer('http://box', undefined, f);
      await jest.advanceTimersByTimeAsync(5000);
      expect((await p)).toMatchObject({ ok: false, reason: 'unreachable' });
    } finally {
      jest.useRealTimers();
    }
  });

  test('unreachable: an address that cannot be a server', async () => {
    const f = jest.fn();
    expect(await validateServer('ftp://box', undefined, f as any)).toMatchObject({ ok: false, reason: 'unreachable' });
    expect(f).not.toHaveBeenCalled();
  });

  test('validate not-haoji: some other web server on that port', async () => {
    const f = fakeFetch({ '/api/status': { status: 200, json: { hello: 'world' } } });
    expect(await validateServer('http://box', undefined, f)).toEqual({
      ok: false, reason: 'not_haoji', message: '這個網址不是好記主機。',
    });
  });

  test('validate not-haoji: HTML instead of JSON', async () => {
    const f = fakeFetch({ '/api/status': { status: 200, text: '<html>router</html>' } });
    expect(await validateServer('http://box', undefined, f)).toMatchObject({ reason: 'not_haoji' });
  });

  test('validate not-haoji: 404 and /health is not ours', async () => {
    const f = fakeFetch({ '/health': { status: 200, json: { status: 'ok', service: 'nginx' } } });
    expect(await validateServer('http://box', undefined, f)).toMatchObject({ reason: 'not_haoji' });
  });

  test('too_old: /api/status is 404 but /health answers haoji-backend', async () => {
    const f = fakeFetch({ '/health': { status: 200, json: { status: 'ok', service: 'haoji-backend' } } });
    expect(await validateServer('http://box', undefined, f)).toEqual({
      ok: false, reason: 'too_old', message: '主機版本太舊，請更新主機後再試。',
    });
  });

  test('unauthorized: the server requires a token and none was given', async () => {
    const f = fakeFetch({ '/api/status': { status: 200, json: { ...status, pairing_required: true } } });
    expect(await validateServer('http://box', undefined, f)).toEqual({
      ok: false, reason: 'unauthorized', message: '配對金鑰不對，請重新掃描主機上的 QR code。',
    });
  });

  test('unauthorized: the server rejects the token on a guarded route', async () => {
    const err = require('../../../backend/tests/fixtures/contracts/error.json');
    const f = fakeFetch({
      '/api/status': { status: 200, json: { ...status, pairing_required: true } },
      '/api/sessions/pair-check': { status: 401, json: err },
    });
    expect(await validateServer('http://box', 'wrong', f)).toMatchObject({ ok: false, reason: 'unauthorized' });
    expect(f.mock.calls[1][1].headers.Authorization).toBe('Bearer wrong');
  });

  test('a required token that the server accepts is ok', async () => {
    const f = fakeFetch({
      '/api/status': { status: 200, json: { ...status, pairing_required: true } },
      '/api/sessions/pair-check': { status: 404, json: { error: '查無此工作' } },
    });
    expect(await validateServer('http://box', 'right', f)).toMatchObject({ ok: true });
  });

  test('the four messages are exactly the plan copy', () => {
    expect(MESSAGES).toEqual({
      unreachable: '連不到這個網址，確認主機有開、手機和主機在同一個網路或 Tailscale 上。',
      not_haoji: '這個網址不是好記主機。',
      too_old: '主機版本太舊，請更新主機後再試。',
      unauthorized: '配對金鑰不對，請重新掃描主機上的 QR code。',
    });
  });
});

describe('summarize', () => {
  test('unpaired', () => {
    expect(summarize(null)).toMatchObject({ tone: 'unpaired', label: '還沒連接主機' });
  });

  test('offline on an error', () => {
    expect(summarize(null, new Error('x'))).toMatchObject({ tone: 'offline', label: '連不到主機' });
    expect(summarize(allGreen(), new Error('x'))).toMatchObject({ tone: 'offline' });
  });

  test('ready when ok and nothing is running', () => {
    const s = summarize(allGreen());
    expect(s).toMatchObject({ tone: 'ready', label: '主機已連線' });
    expect(s.detail).toEqual(['語音辨識：正常', '會議記錄：正常', '處理中 0 場，排隊中 0 場']);
  });

  test('busy when something is active or queued', () => {
    expect(summarize(allGreen({ queue: { active: 1, queued: 0 } }))).toMatchObject({ tone: 'busy', label: '主機忙碌中' });
    expect(summarize(allGreen({ queue: { active: 0, queued: 2 } })).detail).toContain('處理中 0 場，排隊中 2 場');
  });

  test('offline when speech recognition is down (transcripts cannot be made)', () => {
    const s = summarize(allGreen({
      ok: false, checks: allGreen().checks.map((c) => (c.id === 'breeze_asr' ? { ...c, ok: false } : c)),
    }));
    expect(s).toMatchObject({ tone: 'offline', label: '連不到主機' });
    expect(s.detail).toContain('語音辨識：還沒準備好');
  });

  test('only the notes model missing (contract fixture) does not block transcripts', () => {
    const s = summarize(status);   // ok:false because llm_model is missing; one job active
    expect(s.tone).toBe('busy');
    expect(s.detail).toContain('會議記錄：還沒準備好');
    expect(s.detail).toContain('語音辨識：正常');
  });

  test('the phone never says GPU, Ollama, model or 後端', () => {
    const all = [summarize(null), summarize(null, new Error()), summarize(status), summarize(allGreen())]
      .flatMap((s) => [s.label, ...s.detail]).join('\n');
    expect(all).not.toMatch(/GPU|Ollama|model|模型|後端|Breeze/i);
  });
});
