jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///doc/', makeDirectoryAsync: jest.fn().mockResolvedValue(undefined) }));
import * as rec from '../recordings';
test('partPath builds a per-session path', () => {
  expect(rec.partPath('abc', 0)).toBe('file:///doc/haoji/abc/part-0.m4a');
});
test('ensureDir creates the session dir', async () => {
  const fs = require('expo-file-system/legacy');
  await rec.ensureDir('abc');
  expect(fs.makeDirectoryAsync).toHaveBeenCalledWith('file:///doc/haoji/abc', { intermediates: true });
});
