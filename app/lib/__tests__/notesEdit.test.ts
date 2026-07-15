import { pushNotesVersion, MAX_NOTES_HISTORY } from '../notesEdit';
import { SavedSession } from '../store';

const base: SavedSession = { id: 's', createdAt: 1, title: 't', unlocked: false, names: {}, parts: [], notes: 'v1' };

test('archives the previous notes newest-first when notes change', () => {
  const out = pushNotesVersion(base, 'v2', 1000);
  expect(out.notes).toBe('v2');
  expect(out.notesHistory).toEqual([{ notes: 'v1', at: 1000 }]);
});

test('does not archive when the text is unchanged', () => {
  const out = pushNotesVersion(base, 'v1', 1000);
  expect(out.notesHistory).toBeUndefined();
});

test('does not archive when there were no notes to begin with', () => {
  const s = { ...base, notes: undefined };
  const out = pushNotesVersion(s, 'first', 1000);
  expect(out.notes).toBe('first');
  expect(out.notesHistory).toBeUndefined();
});

test('caps history length', () => {
  let s = base;
  for (let i = 2; i < MAX_NOTES_HISTORY + 8; i++) s = pushNotesVersion(s, `v${i}`, i);
  expect(s.notesHistory!.length).toBe(MAX_NOTES_HISTORY);
  expect(s.notesHistory![0].notes).toBe(`v${MAX_NOTES_HISTORY + 6}`); // newest archived first
});
