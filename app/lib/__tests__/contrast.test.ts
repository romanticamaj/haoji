import { colors } from '../theme';

// WCAG 2.x relative luminance and contrast ratio, for #RRGGBB tokens.
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('contrast() matches known WCAG values', () => {
  expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
  expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1);
});

// Spec §5.3 G: secondary text (timestamps, tab labels, hints in the meta line) must pass AA body text.
test('muted on background is at least 4.5:1 (AA)', () => {
  expect(contrast(colors.muted, colors.background)).toBeGreaterThanOrEqual(4.5);
});

test('muted on surface is at least 4.5:1 (AA) — cards and sheets carry muted text too', () => {
  expect(contrast(colors.muted, colors.surface)).toBeGreaterThanOrEqual(4.5);
});

test('heading on background is at least 7:1 (AAA)', () => {
  expect(contrast(colors.heading, colors.background)).toBeGreaterThanOrEqual(7);
});
