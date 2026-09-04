const mockRead = jest.fn();
const mockWrite = jest.fn();
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/doc', CachesDirectoryPath: '/cache',
  stat: async () => ({ size: 52417708 }),
  read: (...a: any[]) => mockRead(...a),
  write: (...a: any[]) => mockWrite(...a),
}));

import { repairWavHeader, lastWavRepairError } from '../recordings';

beforeEach(() => { jest.clearAllMocks(); jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { (console.warn as jest.Mock).mockRestore?.(); });

/**
 * The failure this exists for: RNFS.read() threw on EVERY call in the shipping app — its native
 * `length`/`position` were declared as pointers, which the New Architecture's TurboModule interop
 * refuses ("Objective C type NSInteger is unsupported"). repairWavHeader caught it and returned a
 * quiet `false`, so the repair looked like it ran for two weeks while never once fixing a file.
 * A recording that cannot be opened is not something to fail silently about.
 */
test('a read that throws is reported, not swallowed', async () => {
  mockRead.mockRejectedValue(new Error(
    'RNFSManager.read(): Error while converting JavaScript argument 1 to Objective C type NSInteger.'));

  expect(await repairWavHeader('/doc/haoji/s/part-0.wav')).toBe(false);
  expect(lastWavRepairError()).toMatch(/NSInteger/);
  expect(console.warn).toHaveBeenCalledWith(
    expect.stringContaining('repair failed'), expect.stringContaining('NSInteger'), expect.any(String));
});

test('a write that throws is reported too', async () => {
  // A real crashed header: RIFF/data lengths never backfilled, data chunk at 4088.
  const head = Buffer.alloc(4096);
  head.write('RIFF', 0); head.writeUInt32LE(0x0ff8, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16);
  head.write('FLLR', 36); head.writeUInt32LE(4044, 40);
  head.write('data', 4088); head.writeUInt32LE(0, 4092);
  mockRead.mockResolvedValue(head.toString('base64'));
  mockWrite.mockRejectedValue(new Error('ENOENT: error writing file'));

  expect(await repairWavHeader('/doc/haoji/s/part-0.wav')).toBe(false);
  expect(lastWavRepairError()).toMatch(/ENOENT/);
});

test('a successful repair clears the error and writes both lengths', async () => {
  const head = Buffer.alloc(4096);
  head.write('RIFF', 0); head.writeUInt32LE(0x0ff8, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16);
  head.write('FLLR', 36); head.writeUInt32LE(4044, 40);
  head.write('data', 4088); head.writeUInt32LE(0, 4092);
  mockRead.mockResolvedValue(head.toString('base64'));
  mockWrite.mockResolvedValue(undefined);

  expect(await repairWavHeader('/doc/haoji/s/part-0.wav')).toBe(true);
  expect(lastWavRepairError()).toBeNull();
  expect(mockWrite).toHaveBeenCalledTimes(2);
  expect(mockWrite.mock.calls[0][2]).toBe(4);       // RIFF size at offset 4
  expect(mockWrite.mock.calls[1][2]).toBe(4092);    // data size right after the chunk id
});

// iOS returns base64 with a line feed every 76 chars (NSDataBase64EncodingEndLineWithLineFeed).
test('line-wrapped base64 from iOS still decodes', async () => {
  const head = Buffer.alloc(4096);
  head.write('RIFF', 0); head.writeUInt32LE(0x0ff8, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16);
  head.write('FLLR', 36); head.writeUInt32LE(4044, 40);
  head.write('data', 4088); head.writeUInt32LE(0, 4092);
  mockRead.mockResolvedValue(head.toString('base64').replace(/(.{76})/g, '$1\n'));
  mockWrite.mockResolvedValue(undefined);

  expect(await repairWavHeader('/doc/haoji/s/part-0.wav')).toBe(true);
});
