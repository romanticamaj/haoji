import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { colors, speakerPalette } from '../../../../app/lib/theme';
import { renderTokensCss } from '../../scripts/gen-tokens';

const css = readFileSync(resolve(__dirname, '../tokens.css'), 'utf8');

function declared(name: string): string | undefined {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{3,8})\\s*;`));
  return m?.[1];
}

describe('tokens.css is generated from app/lib/theme.ts', () => {
  it.each(Object.entries(colors))('--%s matches the app theme', (name, hex) => {
    expect(declared(name)?.toUpperCase()).toBe(hex.toUpperCase());
  });

  it.each(speakerPalette.map((hex, i) => [i, hex] as const))('--speaker-%i matches', (i, hex) => {
    expect(declared(`speaker-${i}`)?.toUpperCase()).toBe(hex.toUpperCase());
  });

  it('is exactly what `npm run tokens` would write (no hand edits)', () => {
    expect(css).toBe(renderTokensCss(colors, speakerPalette));
  });
});
