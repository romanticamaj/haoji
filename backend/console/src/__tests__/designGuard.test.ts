import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : walk(p);
    return /\.(tsx?|css)$/.test(name) ? [p] : [];
  });
}

const files = walk(SRC).filter((p) => !p.endsWith('tokens.css'));

describe('design guard', () => {
  it('scans some source files', () => {
    expect(files.length).toBeGreaterThan(2);
  });

  it('has no hex colour literals outside tokens.css', () => {
    const hits = files.flatMap((p) =>
      readFileSync(p, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => /#[0-9a-fA-F]{3,8}\b/.test(line))
        .map(({ i, line }) => `${relative(SRC, p)}:${i + 1}: ${line.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  it('has no box-shadow (KEEPLACE separates surfaces with 1px outlines)', () => {
    const hits = files.filter((p) => /box-shadow|boxShadow/.test(readFileSync(p, 'utf8')));
    expect(hits.map((p) => relative(SRC, p))).toEqual([]);
  });
});
