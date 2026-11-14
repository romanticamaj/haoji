// Renders each console page against the backend contract fixtures and saves PNGs to qa/screenshots/.
import { test, expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const FX = resolve(HERE, '../../tests/fixtures/contracts');
const fx = (name: string) => JSON.parse(readFileSync(resolve(FX, `${name}.json`), 'utf8'));
const OUT = resolve(HERE, '../qa/screenshots');

type Routes = Record<string, unknown | ((route: Route) => unknown)>;

function jobsNow() {
  // Fixture timestamps are fixed; shift them so relative times read naturally today.
  const j = fx('jobs');
  const now = Date.now() / 1000;
  const shift = (job: Record<string, number | null>, ago: number) => {
    const d = (job.finished_at ?? job.started_at ?? 0) - (job.started_at ?? 0);
    job.started_at = now - ago;
    if (job.finished_at != null) job.finished_at = job.started_at + d;
  };
  shift(j.active[0], 95);
  shift(j.recent[0], 60 * 14);
  shift(j.recent[1], 60 * 60 * 3);
  return j;
}

async function mock(page: Page, overrides: Routes = {}) {
  const routes: Routes = {
    'GET /api/status?detail=1': fx('status_detail'),
    'GET /api/models': fx('models'),
    'GET /api/settings': fx('settings'),
    'GET /api/jobs': jobsNow(),
    'GET /api/pairing': fx('pairing'),
    'POST /api/llm/test': fx('llm_test'),
    'POST /api/llm/pull': { ok: true },
    ...overrides,
  };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const key = `${req.method()} ${url.pathname}${url.search}`;
    const r = routes[key];
    if (typeof r === 'function') return r(route);
    if (r === undefined) return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'not found', hint: '' } } });
    return route.fulfill({ json: r });
  });
}

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

test('01 overview — all ready', async ({ page }) => {
  await mock(page);
  await page.goto('/console/#/');
  await expect(page.getByText('NVIDIA GeForce RTX 5070 Ti')).toBeVisible();
  await shot(page, '01-overview');
});

test('02 overview — setup checklist', async ({ page }) => {
  const s = fx('status_detail');
  s.ok = false;
  const ollama = s.checks.find((c: { id: string }) => c.id === 'ollama');
  ollama.ok = false;
  ollama.hint = '確認 ollama 容器有在執行：docker compose ps。';
  ollama.message = 'http://ollama:11434 沒有回應';
  const model = s.checks.find((c: { id: string }) => c.id === 'llm_model');
  model.ok = false;
  model.hint = '到「模型」頁下載 gemma4:e4b-it-qat，或改選已安裝的模型。';
  s.llm.reachable = false;
  s.queue = { active: 1, queued: 2 };
  await mock(page, { 'GET /api/status?detail=1': s });
  await page.goto('/console/#/');
  await expect(page.getByRole('region', { name: /還差幾步/ })).toBeVisible();
  await shot(page, '02-overview-setup');
});

test('03 overview — host unreachable', async ({ page }) => {
  await mock(page, { 'GET /api/status?detail=1': (route: Route) => route.abort('connectionrefused') });
  await page.goto('/console/#/');
  await expect(page.getByText('連不到主機')).toBeVisible();
  await shot(page, '03-overview-offline');
});

test('04 login', async ({ page }) => {
  await mock(page, {
    'GET /api/status?detail=1': (route: Route) =>
      route.fulfill({ status: 401, json: { error: { code: 'unauthorized', message: '需要管理金鑰', hint: '' } } }),
  });
  await page.goto('/console/#/');
  await expect(page.getByLabel('管理金鑰', { exact: true })).toBeVisible();
  await shot(page, '04-login');
});

test('05 models', async ({ page }) => {
  await mock(page);
  await page.goto('/console/#/models');
  await expect(page.getByText('qwen3:8b').first()).toBeVisible();
  await shot(page, '05-models');
});

test('06 models — pull in progress', async ({ page }) => {
  const events = fx('pull_events');
  await page.addInitScript((ev) => {
    // Keep the stream open at 50% so the progress state can be captured.
    class FakeES {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      constructor() {
        setTimeout(() => this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(ev) })), 50);
      }
      close() {}
    }
    (window as unknown as { EventSource: unknown }).EventSource = FakeES;
  }, events[1]);
  await mock(page);
  await page.goto('/console/#/models');
  await page.getByLabel('模型名稱').fill('qwen3:8b');
  await page.getByRole('button', { name: '下載' }).click();
  await expect(page.getByRole('progressbar', { name: /下載進度/ })).toHaveAttribute('aria-valuenow', '50');
  await shot(page, '06-models-pull');
});

test('07 ollama — locked by env', async ({ page }) => {
  await mock(page);
  await page.goto('/console/#/ollama');
  await expect(page.getByText('由環境變數設定')).toBeVisible();
  await page.getByRole('button', { name: '測試連線' }).click();
  await expect(page.getByText('連得上')).toBeVisible();
  await shot(page, '07-ollama');
});

test('08 jobs', async ({ page }) => {
  await mock(page);
  await page.goto('/console/#/jobs');
  await expect(page.getByText('a1b2c3')).toBeVisible();
  await page.getByRole('button', { name: /看原因/ }).click();
  await shot(page, '08-jobs');
});

test('09 pair', async ({ page }) => {
  await mock(page);
  await page.goto('/console/#/pair');
  await expect(page.locator('.qr svg')).toBeVisible();
  await shot(page, '09-pair');
});

test('10 settings', async ({ page }) => {
  await mock(page);
  await page.goto('/console/#/settings');
  await expect(page.getByText('7780')).toBeVisible();
  await shot(page, '10-settings');
});
