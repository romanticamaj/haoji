import { expect, test } from '@playwright/test';

const PAGES: [string, RegExp][] = [
  ['#/', /總覽/],
  ['#/models', /模型/],
  ['#/ollama', /連線/],
  ['#/jobs', /工作/],
  ['#/pair', /配對手機/],
  ['#/settings', /設定/],
];

test('log in, see the ollama hint, visit every page without console errors', async ({ page }) => {
  const errors: string[] = [];

  await page.goto('/console/');
  // Unauthenticated: the console asks for the admin token (the 401 that triggers this is expected).
  const token = page.getByLabel('管理金鑰', { exact: true });
  await expect(token).toBeVisible();

  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await token.fill('  test\n');
  await page.getByRole('button', { name: '登入' }).click();

  // Ollama is unreachable → the setup checklist names it.
  const checklist = page.getByRole('region', { name: /還差幾步/ });
  await expect(checklist).toBeVisible();
  await expect(checklist.getByText('Ollama', { exact: true })).toBeVisible();

  const nav = page.getByRole('navigation', { name: '主選單' });
  for (const [hash, title] of PAGES) {
    await nav.locator(`a[href="${hash}"]`).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(nav.locator(`a[href="${hash}"]`)).toHaveAttribute('aria-current', 'page');
  }

  expect(errors).toEqual([]);
});
