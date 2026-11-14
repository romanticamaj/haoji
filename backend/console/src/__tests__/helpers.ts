// Test helpers: a route-table fetch mock fed by the backend contract fixtures, and a fake EventSource.
import { vi } from 'vitest';

import statusFx from '../../../tests/fixtures/contracts/status.json';
import statusDetailFx from '../../../tests/fixtures/contracts/status_detail.json';
import modelsFx from '../../../tests/fixtures/contracts/models.json';
import settingsFx from '../../../tests/fixtures/contracts/settings.json';
import jobsFx from '../../../tests/fixtures/contracts/jobs.json';
import pairingFx from '../../../tests/fixtures/contracts/pairing.json';
import llmTestFx from '../../../tests/fixtures/contracts/llm_test.json';
import pullEventsFx from '../../../tests/fixtures/contracts/pull_events.json';
import errorFx from '../../../tests/fixtures/contracts/error.json';

export const fx = {
  status: statusFx,
  statusDetail: statusDetailFx,
  models: modelsFx,
  settings: settingsFx,
  jobs: jobsFx,
  pairing: pairingFx,
  llmTest: llmTestFx,
  pullEvents: pullEventsFx,
  error: errorFx,
};

/** Deep copy so a test can mutate a fixture without leaking into the next. */
export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export type Req = { method: string; url: string; body: unknown; headers: Headers };
type Reply = { status?: number; json?: unknown } | Response;
type Route = Reply | ((req: Req) => Reply | Promise<Reply>);

/** Routes keyed by "METHOD /path?query". Unmatched requests answer 404 with the error shape. */
export function mockFetch(routes: Record<string, Route>) {
  const calls: Req[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const req: Req = { method, url, body, headers: new Headers(init.headers) };
    calls.push(req);
    const route = routes[`${method} ${url}`];
    if (route === undefined) return json(404, { error: { code: 'not_found', message: 'not found', hint: '' } });
    const reply = typeof route === 'function' ? await route(req) : route;
    if (reply instanceof Response) return reply;
    return json(reply.status ?? 200, reply.json ?? {});
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls, called: (key: string) => calls.filter((c) => `${c.method} ${c.url}` === key) };
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  emit(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
  fail() {
    this.onerror?.(new Event('error'));
  }
  close() {
    this.closed = true;
  }
  static install() {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  }
  static last() {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1];
  }
}
