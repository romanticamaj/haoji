import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Issue #32: the setup checklist's icons are an alert, not a highlight. Peach (accent) is kept for
// rare emphasis; the checklist uses a muted CircleAlert on primarySoft.
const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');
const rule = (sel: string) => {
  const m = css.match(new RegExp(`(^|\\n)${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
  return m ? m[2] : '';
};

describe('checklist icon colours', () => {
  it('uses muted on primarySoft, never accent', () => {
    const r = rule('.check-icon');
    expect(r).toMatch(/background:\s*var\(--primarySoft\)/);
    expect(r).toMatch(/color:\s*var\(--muted\)/);
    expect(r).not.toMatch(/accent/);
  });
});
