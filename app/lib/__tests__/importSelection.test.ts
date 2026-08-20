import { buildCandidates, toggle, selected, canMerge, canImport, totalDurationMs, move } from '../importSelection';

const files = [
  { uri: 'file:///c/a.m4a', name: 'a.m4a' },
  { uri: 'file:///c/b.m4a', name: 'b.m4a' },
  { uri: 'file:///c/doc.pdf', name: 'doc.pdf' },
];
const probes = [
  { path: 'file:///c/a.m4a', ok: true, durationMs: 60000 },
  { path: 'file:///c/b.m4a', ok: true, durationMs: 30000 },
  { path: 'file:///c/doc.pdf', ok: false, durationMs: 0, reason: '沒有音訊' },
];

test('a file we know is unusable is never pre-selected, and says why', () => {
  const list = buildCandidates(files, probes);
  expect(list.map((c) => c.selected)).toEqual([true, true, false]);
  expect(list[2].reason).toBe('沒有音訊');
});

test('an unusable file cannot be selected at all', () => {
  let list = buildCandidates(files, probes);
  list = toggle(list, 'file:///c/doc.pdf');
  expect(list[2].selected).toBe(false);          // toggling it changes nothing
  list = toggle(list, 'file:///c/a.m4a');
  expect(list[0].selected).toBe(false);          // a usable one toggles normally
});

test('merging needs at least two usable selections; importing needs one', () => {
  let list = buildCandidates(files, probes);
  expect(canMerge(list)).toBe(true);
  expect(canImport(list)).toBe(true);

  list = toggle(list, 'file:///c/b.m4a');        // now only one selected
  expect(canMerge(list)).toBe(false);
  expect(canImport(list)).toBe(true);

  list = toggle(list, 'file:///c/a.m4a');        // none selected
  expect(canImport(list)).toBe(false);
});

test('selection and total duration cover only usable, selected files', () => {
  const list = buildCandidates(files, probes);
  expect(selected(list).map((c) => c.name)).toEqual(['a.m4a', 'b.m4a']);
  expect(totalDurationMs(list)).toBe(90000);
});

test('a file the probe said nothing about is assumed usable (no native module)', () => {
  const list = buildCandidates([files[0]], []);
  expect(list[0].ok).toBe(true);
  expect(list[0].selected).toBe(true);
});

// The list order IS the merge order, so it must be fixable: a pick can come back in the wrong
// sequence, and you only notice by listening.
test('move reorders a file and leaves everything else in place', () => {
  const list = buildCandidates(files, probes);
  const down = move(list, 'file:///c/a.m4a', 1);
  expect(down.map((c) => c.name)).toEqual(['b.m4a', 'a.m4a', 'doc.pdf']);
  const backUp = move(down, 'file:///c/a.m4a', -1);
  expect(backUp.map((c) => c.name)).toEqual(['a.m4a', 'b.m4a', 'doc.pdf']);
});

test('move off either end is a no-op (same list, not a broken one)', () => {
  const list = buildCandidates(files, probes);
  expect(move(list, 'file:///c/a.m4a', -1)).toBe(list);          // already first
  expect(move(list, 'file:///c/doc.pdf', 1)).toBe(list);         // already last
  expect(move(list, 'file:///c/nope.m4a', 1)).toBe(list);        // unknown file
});

test('moving preserves each file’s selection state', () => {
  let list = buildCandidates(files, probes);
  list = toggle(list, 'file:///c/a.m4a');       // deselect the first
  const moved = move(list, 'file:///c/a.m4a', 1);
  expect(moved.find((c) => c.name === 'a.m4a')!.selected).toBe(false);
  expect(moved.find((c) => c.name === 'b.m4a')!.selected).toBe(true);
});
