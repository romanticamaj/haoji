jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/doc',
  CachesDirectoryPath: '/cache',
  mkdir: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn().mockResolvedValue(false),
  moveFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  readDir: jest.fn().mockResolvedValue([]),
}));
import * as rec from '../recordings';

const dir = (name: string): any => ({ name, path: `/doc/haoji/${name}`, isDirectory: () => true, isFile: () => false });
const file = (name: string, path: string, size = 100, mtime = new Date(1_000)): any =>
  ({ name, path, size, mtime, isDirectory: () => false, isFile: () => true });

test('partPath builds a per-session absolute file:// URI', () => {
  expect(rec.partPath('abc', 0)).toBe('file:///doc/haoji/abc/part-0.m4a');
});

test('ensureDir creates the session dir (bare path)', async () => {
  const fs = require('react-native-fs');
  await rec.ensureDir('abc');
  expect(fs.mkdir).toHaveBeenCalledWith('/doc/haoji/abc');
});

test('moveToPart moves with bare paths and returns a RELATIVE path (no container prefix)', async () => {
  const fs = require('react-native-fs');
  const out = await rec.moveToPart('abc', 1, 'file:///tmp/rec.m4a');
  expect(fs.moveFile).toHaveBeenCalledWith('/tmp/rec.m4a', '/doc/haoji/abc/part-1.m4a');
  expect(out).toBe('haoji/abc/part-1.m4a');
});

test('resolvePartUri anchors a relative path to the current Documents dir', () => {
  expect(rec.resolvePartUri('haoji/abc/part-0.m4a')).toBe('file:///doc/haoji/abc/part-0.m4a');
});

test('resolvePartUri recovers a LEGACY absolute path from an old (stale) container', () => {
  const stale = 'file:///var/mobile/Containers/Data/Application/OLD-UUID/Documents/haoji/abc/part-0.m4a';
  expect(rec.resolvePartUri(stale)).toBe('file:///doc/haoji/abc/part-0.m4a');
});

test('resolvePartUri recovers a legacy imported file stored at the Documents root', () => {
  const stale = 'file:///var/mobile/Containers/Data/Application/OLD-UUID/Documents/upload-1.m4a';
  expect(rec.resolvePartUri(stale)).toBe('file:///doc/upload-1.m4a');
});

test('deleteSessionFiles unlinks the per-session dir when it exists', async () => {
  const fs = require('react-native-fs');
  fs.exists.mockResolvedValueOnce(true);
  await rec.deleteSessionFiles('abc');
  expect(fs.unlink).toHaveBeenCalledWith('/doc/haoji/abc');
});

test('scavengeTempParts folds a crash-time Caches temp part into its session dir', async () => {
  const fs = require('react-native-fs');
  fs.readDir.mockImplementation((p: string) =>
    p === '/cache' ? Promise.resolve([file('rec-sess9-0.m4a', '/cache/rec-sess9-0.m4a', 500)]) : Promise.resolve([]));
  fs.exists.mockResolvedValue(false); // dest doesn't exist yet
  await rec.scavengeTempParts();
  expect(fs.moveFile).toHaveBeenCalledWith('/cache/rec-sess9-0.m4a', '/doc/haoji/sess9/part-0.m4a');
});

test('recoverOrphanedRecordings rebuilds a draft for an on-disk session with no store entry', async () => {
  const fs = require('react-native-fs');
  fs.readDir.mockImplementation((p: string) => {
    if (p === '/cache') return Promise.resolve([]);
    if (p === '/doc/haoji') return Promise.resolve([dir('orphan1'), dir('known1')]);
    if (p === '/doc/haoji/orphan1') return Promise.resolve([
      file('part-1.m4a', '/doc/haoji/orphan1/part-1.m4a', 200, new Date(5_000)),
      file('part-0.m4a', '/doc/haoji/orphan1/part-0.m4a', 200, new Date(5_000)),
    ]);
    return Promise.resolve([]);
  });
  fs.exists.mockResolvedValue(true); // the haoji base dir exists

  const out = await rec.recoverOrphanedRecordings(new Set(['known1']));
  expect(out).toHaveLength(1);
  expect(out[0].id).toBe('orphan1');
  // parts reference the REAL filenames, sorted by index (robust to any gap)
  expect(out[0].parts).toEqual([
    { uri: 'haoji/orphan1/part-0.m4a', durationMs: 0 },
    { uri: 'haoji/orphan1/part-1.m4a', durationMs: 0 },
  ]);
  expect(out[0].createdAt).toBe(5_000);
});

test('recoverOrphanedRecordings skips a dir whose parts are all empty (0-byte)', async () => {
  const fs = require('react-native-fs');
  fs.readDir.mockImplementation((p: string) => {
    if (p === '/cache') return Promise.resolve([]);
    if (p === '/doc/haoji') return Promise.resolve([dir('empty1')]);
    if (p === '/doc/haoji/empty1') return Promise.resolve([file('part-0.m4a', '/doc/haoji/empty1/part-0.m4a', 0)]);
    return Promise.resolve([]);
  });
  fs.exists.mockResolvedValue(true);
  expect(await rec.recoverOrphanedRecordings(new Set())).toEqual([]);
});
