jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/doc',
  CachesDirectoryPath: '/cache',
  mkdir: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn().mockResolvedValue(false),
  moveFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  readDir: jest.fn().mockResolvedValue([]),
  stat: jest.fn(),
  read: jest.fn(),
  write: jest.fn().mockResolvedValue(undefined),
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

test('moveToPart with ext=wav writes and returns a .wav part path (live recordings)', async () => {
  const fs = require('react-native-fs');
  const out = await rec.moveToPart('abc', 0, 'file:///cache/rec-abc-0.wav', 'wav');
  expect(fs.moveFile).toHaveBeenCalledWith('/cache/rec-abc-0.wav', '/doc/haoji/abc/part-0.wav');
  expect(out).toBe('haoji/abc/part-0.wav');
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

test('scavengeTempParts recovers a .wav temp keeping its extension', async () => {
  const fs = require('react-native-fs');
  fs.readDir.mockImplementation((p: string) =>
    p === '/cache' ? Promise.resolve([file('rec-s2-1.wav', '/cache/rec-s2-1.wav', 300)]) : Promise.resolve([]));
  fs.exists.mockResolvedValue(false);
  await rec.scavengeTempParts();
  expect(fs.moveFile).toHaveBeenCalledWith('/cache/rec-s2-1.wav', '/doc/haoji/s2/part-1.wav');
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


// --- crash-truncated WAV repair -------------------------------------------------------------
// Build a REALISTIC header: fmt + LIST then data — mirrors an actual recording, where `data` starts
// at 70, not the textbook 44. A repair that assumed a fixed offset would corrupt the audio.
const wavHead = (dataSize: number, riffSize: number): Uint8Array => {
  const b = new Uint8Array(78);
  const put = (o: number, str: string) => { for (let i = 0; i < str.length; i++) b[o + i] = str.charCodeAt(i); };
  const u32 = (o: number, n: number) => { b[o] = n & 255; b[o + 1] = (n >> 8) & 255; b[o + 2] = (n >> 16) & 255; b[o + 3] = (n >>> 24) & 255; };
  put(0, 'RIFF'); u32(4, riffSize); put(8, 'WAVE');
  put(12, 'fmt '); u32(16, 16);       // fmt chunk: 8 + 16 = 24 bytes → next at 36
  put(36, 'LIST'); u32(40, 26);       // LIST chunk: 8 + 26 = 34 bytes → next at 70
  put(70, 'data'); u32(74, dataSize);
  return b;
};

test('findDataChunk walks the chunk chain (data at 70, not the textbook 44)', () => {
  expect(rec.findDataChunk(wavHead(160000, 160070))).toBe(70);
});

test('findDataChunk rejects a non-WAV and never loops on a broken chunk', () => {
  expect(rec.findDataChunk(new Uint8Array(16))).toBe(-1);        // no RIFF/WAVE
  const broken = wavHead(0, 0); broken[40] = 0; broken[41] = 0; broken[42] = 0; broken[43] = 0; // LIST size 0
  expect(rec.findDataChunk(broken)).toBe(-1);                     // bails instead of hanging
});

test('base64 helpers round-trip arbitrary bytes', () => {
  const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 77]);
  expect(Array.from(rec.b64ToBytes(rec.bytesToB64(bytes)))).toEqual(Array.from(bytes));
});

test('repairWavHeader rewrites BOTH zeroed lengths from the real file size', async () => {
  const fs = require('react-native-fs');
  const size = 40000;
  fs.stat.mockResolvedValue({ size });
  fs.read.mockResolvedValue(rec.bytesToB64(wavHead(0, 0)));  // crash: both lengths still 0
  fs.write.mockClear();

  expect(await rec.repairWavHeader('/doc/haoji/s/part-0.wav')).toBe(true);

  // RIFF size = fileSize - 8 written at offset 4; data size = fileSize - (70+8) written at 74
  const riff = fs.write.mock.calls.find((c: any[]) => c[2] === 4);
  const data = fs.write.mock.calls.find((c: any[]) => c[2] === 74);
  expect(Array.from(rec.b64ToBytes(riff[1]))).toEqual([...new Uint8Array([(size - 8) & 255, ((size - 8) >> 8) & 255, ((size - 8) >> 16) & 255, 0])]);
  expect(Array.from(rec.b64ToBytes(data[1]))).toEqual([...new Uint8Array([(size - 78) & 255, ((size - 78) >> 8) & 255, ((size - 78) >> 16) & 255, 0])]);
});

test('repairWavHeader leaves an already-valid file untouched', async () => {
  const fs = require('react-native-fs');
  const size = 40000;
  fs.stat.mockResolvedValue({ size });
  fs.read.mockResolvedValue(rec.bytesToB64(wavHead(size - 78, size - 8))); // clean stop
  fs.write.mockClear();
  expect(await rec.repairWavHeader('/doc/haoji/s/part-0.wav')).toBe(false);
  expect(fs.write).not.toHaveBeenCalled();
});

test('repairWavParts only touches .wav parts and counts the repairs', async () => {
  const fs = require('react-native-fs');
  fs.stat.mockResolvedValue({ size: 40000 });
  fs.read.mockResolvedValue(rec.bytesToB64(wavHead(0, 0)));
  fs.write.mockClear();
  const n = await rec.repairWavParts([
    { parts: [{ uri: 'haoji/a/part-0.wav' }, { uri: 'haoji/a/part-1.m4a' }] },  // m4a skipped
    { parts: [] },
    {},
  ]);
  expect(n).toBe(1);
});
