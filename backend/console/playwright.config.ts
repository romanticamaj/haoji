import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Local smoke test against the REAL backend (python app.py) serving the built console at /console.
// Ollama and Breeze ASR are pointed at a dead port so the overview shows the setup checklist.
//   npm run build && npm run e2e          (HAOJI_PYTHON overrides the interpreter, e.g. ../.venv/bin/python)
const PORT = Number(process.env.E2E_PORT ?? 7781);
const DATA_DIR = mkdtempSync(join(tmpdir(), 'haoji-e2e-'));
const PY = process.env.HAOJI_PYTHON ?? 'python';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'console.spec.ts',
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 860 },
  },
  webServer: {
    command: `${PY} app.py`,
    cwd: '..',
    url: `http://127.0.0.1:${PORT}/health`,
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      WEB_PORT: String(PORT),
      DATA_DIR,
      HAOJI_ADMIN_TOKEN: 'test',
      OLLAMA_BASE_URL: 'http://127.0.0.1:9',
      ASR_BASE_URL: 'http://127.0.0.1:9',
    },
  },
});
