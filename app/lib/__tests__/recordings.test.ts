jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/doc',
  mkdir: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn().mockResolvedValue(false),
  moveFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));
import * as rec from '../recordings';

test('partPath builds a per-session file:// URI', () => {
  expect(rec.partPath('abc', 0)).toBe('file:///doc/haoji/abc/part-0.m4a');
});

test('ensureDir creates the session dir (bare path)', async () => {
  const fs = require('react-native-fs');
  await rec.ensureDir('abc');
  expect(fs.mkdir).toHaveBeenCalledWith('/doc/haoji/abc');
});

test('moveToPart moves with bare paths and returns a file:// URI', async () => {
  const fs = require('react-native-fs');
  const out = await rec.moveToPart('abc', 1, 'file:///tmp/rec.m4a');
  expect(fs.moveFile).toHaveBeenCalledWith('/tmp/rec.m4a', '/doc/haoji/abc/part-1.m4a');
  expect(out).toBe('file:///doc/haoji/abc/part-1.m4a');
});
