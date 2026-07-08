jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/doc',
  mkdir: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn().mockResolvedValue(false),
  moveFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));
import * as rec from '../recordings';

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
