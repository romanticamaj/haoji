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
jest.mock('../audioMerge', () => ({
  available: true,
  concatWav: jest.fn().mockResolvedValue('/cache/rec-abc-0.wav'),
  concatToM4A: jest.fn().mockResolvedValue('/cache/rec-abc-0.m4a'),
}));
import * as rec from '../recordings';
import * as audioMerge from '../audioMerge';

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


// --- joining a finished recording's parts ------------------------------------------------------
// Parts exist only to protect audio DURING recording. Leaving them split afterwards showed one
// player per segment for what was really a single meeting.
describe('mergeSessionParts', () => {
  const twoParts = [
    { uri: 'haoji/abc/part-0.wav', durationMs: 1000 },
    { uri: 'haoji/abc/part-1.wav', durationMs: 2500 },
  ];

  beforeEach(() => {
    (audioMerge.concatWav as jest.Mock).mockClear();   // calls must not leak between tests
    (audioMerge.concatToM4A as jest.Mock).mockClear();
    (audioMerge.concatWav as jest.Mock).mockResolvedValue('/cache/merge-abc.tmp');
    const fs = require('react-native-fs');
    fs.stat.mockResolvedValue({ size: 50000 });
    fs.exists.mockResolvedValue(false);
    fs.unlink.mockResolvedValue(undefined);
    fs.moveFile.mockResolvedValue(undefined);
  });

  test('joins the parts into one, summing their durations', async () => {
    const out = await rec.mergeSessionParts('abc', twoParts);
    expect(audioMerge.concatWav).toHaveBeenCalledWith(
      ['/doc/haoji/abc/part-0.wav', '/doc/haoji/abc/part-1.wav'],
      '/cache/merge-abc.tmp',   // NOT a scavenger name: a half-written merge must never become a part
    );
    expect(out).toEqual([{ uri: 'haoji/abc/part-0.wav', durationMs: 3500 }]);
  });

  test('a single part is left alone (nothing to join)', async () => {
    expect(await rec.mergeSessionParts('abc', [twoParts[0]])).toBeNull();
    expect(audioMerge.concatWav).not.toHaveBeenCalled();
  });

  test('compressed / mixed formats go through the re-encoding path, not the byte copy', async () => {
    // Imports are usually m4a or mp3 and may not share a format, so a lossless byte copy is invalid.
    (audioMerge.concatToM4A as jest.Mock).mockResolvedValue('/cache/merge-abc.tmp');
    const mixed = [twoParts[0], { uri: 'haoji/abc/part-1.m4a', durationMs: 1500 }];
    const out = await rec.mergeSessionParts('abc', mixed);
    expect(audioMerge.concatWav).not.toHaveBeenCalled();
    expect(audioMerge.concatToM4A).toHaveBeenCalledWith(
      ['/doc/haoji/abc/part-0.wav', '/doc/haoji/abc/part-1.m4a'], '/cache/merge-abc.tmp');
    expect(out).toEqual([{ uri: 'haoji/abc/part-0.m4a', durationMs: 2500 }]);
  });

  test('a failed merge keeps the original parts and deletes nothing', async () => {
    const fs = require('react-native-fs');
    (audioMerge.concatWav as jest.Mock).mockRejectedValueOnce(new Error('format_mismatch'));
    fs.unlink.mockClear();
    expect(await rec.mergeSessionParts('abc', twoParts)).toBeNull();
    // only the temp file may be cleaned up — never the user's audio
    for (const call of fs.unlink.mock.calls) expect(call[0]).not.toMatch(/\/doc\/haoji\/abc\/part-/);
  });

  test('an empty merged file is treated as failure (never replaces real audio with nothing)', async () => {
    const fs = require('react-native-fs');
    fs.stat.mockResolvedValueOnce({ size: 0 });
    expect(await rec.mergeSessionParts('abc', twoParts)).toBeNull();
  });
});

// --- non-ASCII filenames --------------------------------------------------------------------
// A file:// URI percent-encodes anything non-ASCII, so a picked 「趨勢面試 1.m4a」 arrives encoded.
// Stripping the scheme without decoding made every Chinese/spaced/emoji filename unimportable.
test('fsPath decodes a percent-encoded file URI, and leaves plain paths alone', () => {
  expect(rec.fsPath('file:///doc/%E8%B6%A8%E5%8B%A2%E9%9D%A2%E8%A9%A6%201.m4a'))
    .toBe('/doc/趨勢面試 1.m4a');
  expect(rec.fsPath('file:///doc/plain.m4a')).toBe('/doc/plain.m4a');
  // a bare POSIX path may legitimately contain '%' — never mangle it
  expect(rec.fsPath('/doc/100%25 done.m4a')).toBe('/doc/100%25 done.m4a');
  // malformed encoding must not throw
  expect(rec.fsPath('file:///doc/bad%ZZ.m4a')).toBe('/doc/bad%ZZ.m4a');
});

test('moveToPart imports a Chinese filename (was: "the former doesn\'t exist")', async () => {
  const fs = require('react-native-fs');
  fs.exists.mockResolvedValue(false);
  fs.moveFile.mockClear();
  const out = await rec.moveToPart('abc', 0, 'file:///cache/%E8%B6%A8%E5%8B%A2%E9%9D%A2%E8%A9%A6%201.m4a');
  // the DECODED path is what the filesystem actually has
  expect(fs.moveFile).toHaveBeenCalledWith('/cache/趨勢面試 1.m4a', '/doc/haoji/abc/part-0.m4a');
  expect(out).toBe('haoji/abc/part-0.m4a');
});

// --- where the next part goes ------------------------------------------------------------------
// A call suspends the app, and iOS can freeze us between writing a part and recording that we wrote
// it. Disk survives that; memory does not — so disk decides where the next part goes.
describe('nextPartIndex / listPartsOnDisk', () => {
  const withDir = (files: any[]) => {
    const fs = require('react-native-fs');
    fs.readDir.mockImplementation((p: string) =>
      p === '/doc/haoji/abc' ? Promise.resolve(files) : Promise.resolve([]));
  };

  test('an empty session starts at 0', async () => {
    withDir([]);
    expect(await rec.nextPartIndex('abc')).toBe(0);
  });

  test('a part already on disk means the next one is 1 — NOT 0, which would overwrite it', async () => {
    withDir([file('part-0.wav', '/doc/haoji/abc/part-0.wav', 44100)]);
    expect(await rec.nextPartIndex('abc')).toBe(1);
  });

  test('a gap never causes a reused index', async () => {
    withDir([
      file('part-0.wav', '/doc/haoji/abc/part-0.wav', 100),
      file('part-2.wav', '/doc/haoji/abc/part-2.wav', 100),
    ]);
    expect(await rec.nextPartIndex('abc')).toBe(3);
  });

  test('zero-byte and non-part files are ignored', async () => {
    withDir([
      file('part-0.wav', '/doc/haoji/abc/part-0.wav', 0),        // aborted start
      file('notes.txt', '/doc/haoji/abc/notes.txt', 100),
    ]);
    expect(await rec.nextPartIndex('abc')).toBe(0);
    expect(await rec.listPartsOnDisk('abc')).toEqual([]);
  });

  test('listPartsOnDisk returns stored uris in index order', async () => {
    withDir([
      file('part-10.wav', '/doc/haoji/abc/part-10.wav', 100),
      file('part-2.wav', '/doc/haoji/abc/part-2.wav', 100),
    ]);
    expect(await rec.listPartsOnDisk('abc')).toEqual([
      'haoji/abc/part-2.wav', 'haoji/abc/part-10.wav',           // 10 sorts after 2, not before
    ]);
  });

  test('an unreadable session dir is treated as empty, never as an error', async () => {
    const fs = require('react-native-fs');
    fs.readDir.mockRejectedValue(new Error('nope'));
    expect(await rec.nextPartIndex('abc')).toBe(0);
  });
});

test('an imported part keeps its own extension and is still seen as a part', async () => {
  const fs = require('react-native-fs');
  fs.readDir.mockImplementation((p: string) =>
    p === '/doc/haoji/abc' ? Promise.resolve([
      file('part-0.mp3', '/doc/haoji/abc/part-0.mp3', 900),   // an import, not a recording
    ]) : Promise.resolve([]));
  // A part list that only knew about wav/m4a would report 0 here and let the next take overwrite it
  expect(await rec.listPartsOnDisk('abc')).toEqual(['haoji/abc/part-0.mp3']);
  expect(await rec.nextPartIndex('abc')).toBe(1);
});

test('scavengeTempParts never lands on top of an existing part', async () => {
  const fs = require('react-native-fs');
  fs.readDir.mockImplementation((p: string) => {
    if (p === '/cache') return Promise.resolve([file('rec-s5-0.wav', '/cache/rec-s5-0.wav', 500)]);
    // index 0 is already taken by a real recording
    if (p === '/doc/haoji/s5') return Promise.resolve([file('part-0.wav', '/doc/haoji/s5/part-0.wav', 800)]);
    return Promise.resolve([]);
  });
  fs.moveFile.mockClear();
  await rec.scavengeTempParts();
  // the leftover's embedded index was only true when it was written — it must not clobber part-0
  expect(fs.moveFile).toHaveBeenCalledWith('/cache/rec-s5-0.wav', '/doc/haoji/s5/part-1.wav');
});

test('a merge writes the joined file before deleting any source', async () => {
  const fs = require('react-native-fs');
  const order: string[] = [];
  fs.readDir.mockImplementation((p: string) =>
    p === '/doc/haoji/abc' ? Promise.resolve([
      file('part-0.wav', '/doc/haoji/abc/part-0.wav', 100),
      file('part-1.wav', '/doc/haoji/abc/part-1.wav', 100),
    ]) : Promise.resolve([]));
  fs.stat.mockResolvedValue({ size: 50000 });
  fs.exists.mockResolvedValue(false);
  fs.moveFile.mockImplementation((from: string) => { order.push(`move:${from}`); return Promise.resolve(); });
  fs.unlink.mockImplementation((p: string) => { order.push(`unlink:${p}`); return Promise.resolve(); });
  (audioMerge.concatWav as jest.Mock).mockClear().mockResolvedValue('/cache/merge-abc.tmp');

  await rec.mergeSessionParts('abc', [
    { uri: 'haoji/abc/part-0.wav', durationMs: 1000 },
    { uri: 'haoji/abc/part-1.wav', durationMs: 1000 },
  ]);

  // the merge temp is invisible to the launch scavenger, so a crash mid-merge can't overwrite a part
  expect(audioMerge.concatWav).toHaveBeenCalledWith(expect.anything(), '/cache/merge-abc.tmp');
  // and the joined audio is in place BEFORE anything is deleted — the other order loses the meeting
  const firstMove = order.findIndex((o) => o.startsWith('move:'));
  const firstUnlinkOfSource = order.findIndex((o) => o.startsWith('unlink:/doc/haoji/abc/part-'));
  expect(firstMove).toBeGreaterThanOrEqual(0);
  expect(firstMove).toBeLessThan(firstUnlinkOfSource);
});
