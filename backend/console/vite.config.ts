/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served by FastAPI at /console (StaticFiles mount); hash routing keeps deep links server-agnostic.
export default defineConfig({
  base: '/console/',
  plugins: [react()],
  // A string tsconfigRaw stops Vite from resolving the nearest tsconfig per file. Without it, importing
  // ../../app/lib/theme.ts (token drift test) picks up app/tsconfig.json, which extends an RN package
  // that is not installed in the console build (Docker stage copies only theme.ts).
  esbuild: {
    tsconfigRaw: JSON.stringify({ compilerOptions: { jsx: 'react-jsx', target: 'ES2022', useDefineForClassFields: true } }),
  },
  server: {
    proxy: { '/api': 'http://localhost:7780' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
