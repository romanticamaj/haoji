import { createMemoryStore, SavedSession } from '../store';

const mk = (id: string, t: number): SavedSession =>
  ({ id, createdAt: t, title: id, names: {}, unlocked: false });

test('upsert + get round-trips', async () => {
  const s = createMemoryStore();
  await s.upsert(mk('a', 1));
  expect((await s.get('a'))?.id).toBe('a');
  expect(await s.get('missing')).toBeNull();
});

test('list returns newest first', async () => {
  const s = createMemoryStore();
  await s.upsert(mk('old', 1));
  await s.upsert(mk('new', 2));
  expect((await s.list()).map(x => x.id)).toEqual(['new', 'old']);
});

test('upsert replaces existing by id; remove deletes', async () => {
  const s = createMemoryStore([mk('a', 1)]);
  await s.upsert({ ...mk('a', 1), unlocked: true });
  expect((await s.get('a'))?.unlocked).toBe(true);
  await s.remove('a');
  expect(await s.get('a')).toBeNull();
});
