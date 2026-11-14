// Jest runs in Node, but this RN project ships no Node type declarations — type just what we use.
declare const __dirname: string;
const fs: { readdirSync(p: string): string[]; readFileSync(p: string, enc: 'utf8'): string } = require('fs');
const path: { join(...p: string[]): string; relative(from: string, to: string): string } = require('path');

// GUIDELINE §2 / spec step 6: colours come from lib/theme.ts tokens only. A hex or rgba literal in a
// screen or component is how the old palette crept back in, so keep the UI code free of them.
const ROOT = path.join(__dirname, '..', '..');
const UI_DIRS = ['screens', 'components'];

function uiFiles(): string[] {
  return UI_DIRS.flatMap((d) =>
    fs.readdirSync(path.join(ROOT, d))
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => path.join(ROOT, d, f)),
  ).concat(path.join(ROOT, 'App.tsx'));
}

test('no hex / rgba colour literals in screens or components', () => {
  const offenders = uiFiles().flatMap((f) =>
    fs.readFileSync(f, 'utf8').split('\n')
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => !line.trim().startsWith('//') && /['"`]#[0-9a-fA-F]{3,8}['"`]|rgba?\(/.test(line))
      .map(({ i }) => `${path.relative(ROOT, f)}:${i + 1}`));
  expect(offenders).toEqual([]);
});

test('no drop shadows: KEEPLACE surfaces use a 1px outline instead', () => {
  const offenders = uiFiles().filter((f) => /shadowColor|shadowOpacity|cardShadow|elevation:/.test(fs.readFileSync(f, 'utf8')));
  expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
});

// Motion (spec §5.3 E, lib/motion.ts): one ease-out curve, durations of 120/180/240 ms. A spring or a
// long hand-written duration is how the UI starts to feel sluggish or bouncy again.
test('no springs in screens or components', () => {
  const offenders = uiFiles().filter((f) => /withSpring\s*\(/.test(fs.readFileSync(f, 'utf8')));
  expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
});

test('no numeric duration literal above 250 ms in screens or components', () => {
  const offenders = uiFiles().flatMap((f) =>
    fs.readFileSync(f, 'utf8').split('\n')
      .map((line, i) => ({ line, i, m: /\bduration\s*:\s*(\d+)/.exec(line) }))
      .filter(({ line, m }) => !line.trim().startsWith('//') && !!m && Number(m[1]) > 250)
      .map(({ i }) => `${path.relative(ROOT, f)}:${i + 1}`));
  expect(offenders).toEqual([]);
});
