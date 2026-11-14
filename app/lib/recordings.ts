import RNFS from 'react-native-fs';
import type { SavedSession } from './store';
import * as audioMerge from './audioMerge';
import { AUDIO_EXTS } from './importMedia';
import { zhDateTime } from './dateFormat';

// RNFS wants bare POSIX paths; the rest of the app wants file:// URIs. Convert at the edges.
//
// A file:// URI percent-encodes anything non-ASCII, so a picked "趨勢面試 1.m4a" arrives as
// "%E8%B6%A8...%201.m4a". Stripping the scheme without DECODING left that literal string as the
// path, and the move failed with "the former doesn't exist" — i.e. every Chinese (or spaced, or
// emoji) filename was unimportable. Only decode when it really was a URI: a bare POSIX path is
// allowed to contain a literal '%'.
export const fsPath = (p: string): string => {
  if (!p.startsWith('file://')) return p;
  const stripped = p.slice('file://'.length);
  try { return decodeURIComponent(stripped); } catch { return stripped; }
};
const bare = fsPath;

// Parts live under Documents and are PERSISTED as RELATIVE paths ("haoji/<sid>/part-0.m4a").
// Never persist an absolute path: on iOS the app-container UUID inside an absolute path
// (/var/mobile/Containers/Data/Application/<UUID>/Documents/...) changes on every app update, so a
// stored absolute uri goes stale after installing a new build and the recording can no longer be
// played. Store relative; resolve against the CURRENT Documents dir at read time.
// `ext` is the part's file extension. Live recordings are now 'wav' (LinearPCM — a crash mid-record
// still leaves a readable file), while imports keep the historical 'm4a' name. Old recordings stored
// their own `part-N.m4a` path string, so they keep resolving regardless of this default.
export const relPart = (sid: string, i: number, ext = 'm4a') => `haoji/${sid}/part-${i}.${ext}`;
const sessionDir = (sid: string) => `${RNFS.DocumentDirectoryPath}/haoji/${sid}`;
export const partPath = (sid: string, i: number, ext = 'm4a') => `file://${RNFS.DocumentDirectoryPath}/${relPart(sid, i, ext)}`;

export async function ensureDir(sid: string) {
  await RNFS.mkdir(sessionDir(sid));
}

// Move a just-finished recording (or an imported file) out of its temp/cache location into the
// persistent per-session document dir so raw parts survive app restarts AND updates. Returns the
// RELATIVE path to persist in the store.
export async function moveToPart(sid: string, index: number, fromUri: string, ext = 'm4a'): Promise<string> {
  await ensureDir(sid);
  const destBare = bare(partPath(sid, index, ext));
  if (await RNFS.exists(destBare)) await RNFS.unlink(destBare);
  await RNFS.moveFile(bare(fromUri), destBare);
  return relPart(sid, index, ext);
}

// Turn a stored part uri (new relative, or a legacy absolute path saved before this change) into an
// absolute file:// uri anchored at the CURRENT Documents dir — this both loads new relative parts
// and recovers legacy recordings whose stored absolute path went stale after an app update.
export function resolvePartUri(stored: string): string {
  const b = bare(stored);
  const marker = '/Documents/';
  const at = b.indexOf(marker);
  const rel = at >= 0 ? b.slice(at + marker.length) : b.replace(/^\/+/, '');
  return `file://${RNFS.DocumentDirectoryPath}/${rel}`;
}

// Does a stored part's audio file still exist on disk? Used to warn the user when a recording can no
// longer be played (e.g. cleared by the OS) instead of silently showing a dead player.
export async function partExists(stored: string): Promise<boolean> {
  try {
    return await RNFS.exists(bare(resolvePartUri(stored)));
  } catch {
    return false;
  }
}

const partIndex = (name: string) => Number(/part-(\d+)\./.exec(name)?.[1] ?? 0);
// EVERY extension a part can legitimately have. Imports keep their own (mp3, caf, …), so a list of
// just m4a|wav would make an imported part invisible to the scans below — and something that can't
// see a file will happily conclude the session doesn't have it.
const PART_FILE = new RegExp(`^part-\\d+\\.(${AUDIO_EXTS.join('|')})$`);

/** The parts that actually exist for a session, as stored (relative) uris, ordered by index. */
export async function listPartsOnDisk(sid: string): Promise<string[]> {
  try {
    const entries = await RNFS.readDir(sessionDir(sid));
    return entries
      .filter((f) => PART_FILE.test(f.name) && (f.size ?? 1) > 0)
      .sort((a, b) => partIndex(a.name) - partIndex(b.name))
      .map((f) => `haoji/${sid}/${f.name}`);
  } catch {
    return [];
  }
}

/**
 * The next free part index, decided by what is ON DISK rather than by what the recorder remembers.
 *
 * This is the difference between losing a recording and not. Finalising a part writes the file and
 * THEN updates the in-memory list; an incoming call suspends the app, and iOS can freeze us between
 * those two steps. The file is on disk, the bookkeeping never happened — so the next part reused
 * index 0 and moveToPart deleted the audio that was already there. Disk is the thing that survives
 * suspension, so disk decides.
 */
export async function nextPartIndex(sid: string): Promise<number> {
  const files = await listPartsOnDisk(sid);
  if (files.length === 0) return 0;
  return Math.max(...files.map((f) => partIndex(f))) + 1;
}

// A recording in progress writes to Caches as `rec-<sid>-<index>.m4a` and is moved into the per-
// session dir only when the part is finalized. A crash mid-recording (e.g. an incoming call) can
// leave that temp file behind. Fold any such leftovers into their session dir as part-<index>.m4a so
// the recovery scan below picks them up. Best-effort: a 0-byte temp is an aborted start — drop it.
export async function scavengeTempParts(): Promise<void> {
  let entries: RNFS.ReadDirItem[];
  try { entries = await RNFS.readDir(RNFS.CachesDirectoryPath); } catch { return; }
  for (const e of entries) {
    // Both shapes: the unique `rec__<sid>__<idx>__<ts>.<ext>` written now, and the older
    // `rec-<sid>-<idx>.<ext>` that may still be sitting in a cache from a previous version.
    const m = /^rec__(.+?)__(\d+)__[\d_]+\.(m4a|wav)$/.exec(e.name)
      ?? /^rec-(.+)-(\d+)\.(m4a|wav)$/.exec(e.name);
    if (!m) continue;
    try {
      if ((e.size ?? 0) <= 0) { await RNFS.unlink(e.path).catch(() => {}); continue; }
      // Never land on top of a part that already exists: the index embedded in a leftover temp is
      // only what was true when it was created. Disk decides, exactly as it does while recording.
      const sid = m[1];
      const wanted = Number(m[2]);
      const taken = await listPartsOnDisk(sid);
      const free = taken.some((u) => partIndex(u) === wanted) ? await nextPartIndex(sid) : wanted;
      await moveToPart(sid, free, e.path, m[3]);
    } catch { /* leave it for next time — best-effort */ }
  }
}

// Rebuild draft sessions for recordings whose audio files exist on disk but have no store entry —
// e.g. the app crashed mid-recording before the session was ever saved. Returns the recovered draft
// sessions (parts reference the REAL on-disk filenames, robust to any index gap); the caller upserts
// them so the recording reappears in the list instead of being silently lost.
export async function recoverOrphanedRecordings(knownIds: Set<string>): Promise<SavedSession[]> {
  await scavengeTempParts(); // fold crash-time temp parts into their session dirs first
  const base = `${RNFS.DocumentDirectoryPath}/haoji`;
  let dirs: RNFS.ReadDirItem[];
  try {
    if (!(await RNFS.exists(base))) return [];
    dirs = await RNFS.readDir(base);
  } catch { return []; }

  const out: SavedSession[] = [];
  for (const d of dirs) {
    if (!d.isDirectory() || knownIds.has(d.name)) continue;
    let files: RNFS.ReadDirItem[];
    try { files = await RNFS.readDir(d.path); } catch { continue; }
    const partFiles = files
      .filter((f) => PART_FILE.test(f.name) && (f.size ?? 1) > 0)
      .sort((a, b) => partIndex(a.name) - partIndex(b.name));
    if (partFiles.length === 0) continue;
    const parts = partFiles.map((f) => ({ uri: `haoji/${d.name}/${f.name}`, durationMs: 0 }));
    // A recovered recording is by definition one that never stopped cleanly — repair any WAV
    // header so it actually plays instead of surfacing as '音檔無法播放'.
    for (const f of partFiles) if (f.name.endsWith('.wav')) await repairWavHeader(f.path);
    const at = partFiles[0].mtime instanceof Date ? partFiles[0].mtime.getTime() : Date.now();
    out.push({ id: d.name, createdAt: at, title: `已復原的錄音（${zhDateTime(at)}）`, names: {}, unlocked: false, parts });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Crash-truncated WAV repair
// ---------------------------------------------------------------------------
// A recording killed mid-capture (crash, force-quit, OOM) keeps all its audio bytes, but the RIFF
// header's two length fields are only filled in on a clean stop — so they stay 0. ffmpeg shrugs and
// reads to EOF, but iOS's AVAudioFile (which the waveform player and every AV API use) trusts the
// header, sees 0 frames, and reports the file as unplayable ("音檔無法播放"). Rewriting the two
// lengths from the real file size makes the recording play again; the audio itself is untouched.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let p = 0, buf = 0, bits = 0;
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | B64.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) { bits -= 8; out[p++] = (buf >> bits) & 0xff; }
  }
  return out.subarray(0, p);
}

export function bytesToB64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : B64[b2 & 63];
  }
  return out;
}

const u32le = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
const readU32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

// Locate the `data` chunk by WALKING the RIFF chunk chain — it is NOT at a fixed offset (a real
// recording carries fmt/LIST/etc. before it, so data can start at 70+ rather than the textbook 44).
// Returns the chunk's offset, or -1. Exported for unit tests.
export function findDataChunk(head: Uint8Array): number {
  if (head.length < 12 || tag(head, 0) !== 'RIFF' || tag(head, 8) !== 'WAVE') return -1;
  let off = 12;
  while (off + 8 <= head.length) {
    if (tag(head, off) === 'data') return off;
    const sz = readU32(head, off + 4);
    if (sz <= 0) return -1;            // a broken non-data chunk: stop (never loop forever)
    off += 8 + sz + (sz & 1);          // chunks are word-aligned
  }
  return -1;
}

// Repair one WAV in place. Returns true only if it actually rewrote the header.
/** Why the last repair attempt failed, for tests and for surfacing instead of failing silently. */
let lastRepairError: string | null = null;
export const lastWavRepairError = () => lastRepairError;

export async function repairWavHeader(storedOrPath: string): Promise<boolean> {
  lastRepairError = null;
  const path = bare(storedOrPath);
  try {
    const size = Number((await RNFS.stat(path)).size);
    if (!(size > 44)) return false;
    const head = b64ToBytes(await RNFS.read(path, 4096, 0, 'base64'));
    const dataOff = findDataChunk(head);
    if (dataOff < 0 || dataOff + 8 > size) return false;
    const realData = size - (dataOff + 8);
    const realRiff = size - 8;
    if (readU32(head, dataOff + 4) === realData && readU32(head, 4) === realRiff) return false; // already sane
    await RNFS.write(path, bytesToB64(u32le(realRiff)), 4, 'base64');
    await RNFS.write(path, bytesToB64(u32le(realData)), dataOff + 4, 'base64');
    return true;
  } catch (e) {
    // NEVER swallow this silently. A repair that cannot run is a recording that cannot be opened,
    // and the last failure was invisible for two weeks: RNFS.read() threw on every single call
    // (its native `length`/`position` were declared as pointers, which the New Architecture's
    // interop refuses) and this catch turned that into a quiet `false`.
    lastRepairError = e instanceof Error ? e.message : String(e);
    console.warn('[haoji] WAV header repair failed:', lastRepairError, path);
    return false;                      // best-effort; never block the app on a repair
  }
}

// Repair every .wav part across the given sessions. Runs for sessions ALREADY in the store too —
// with incremental persistence a crashed recording is usually already saved, so it would never pass
// through the orphan scan. Returns how many files were repaired.
export async function repairWavParts(sessions: { parts?: { uri: string }[] }[]): Promise<number> {
  let n = 0;
  for (const s of sessions) {
    for (const p of s.parts ?? []) {
      if (!p.uri.endsWith('.wav')) continue;
      if (await repairWavHeader(resolvePartUri(p.uri))) n++;
    }
  }
  return n;
}

/**
 * Join a finished recording's parts into ONE file.
 *
 * Parts only exist so that an interruption or crash mid-recording can't cost the audio captured so
 * far. Once recording has stopped there is no reason to keep them apart, and leaving them split
 * showed one player per segment for what was really a single meeting. Every downstream feature
 * (player, upload, export, transcript seeking) already handles the single-part case, so merging is
 * what makes all of them simple rather than requiring each to understand segments.
 *
 * Recordings are all identically-formatted PCM, so they are joined by copying bytes: lossless and
 * fast. Imports are usually compressed and may not even share a format, so those go through a
 * re-encoding concat instead — worth it, because the alternative is one player per imported file for
 * what the user picked as a single meeting.
 *
 * Returns the replacement parts array, or null when nothing was merged (fewer than two parts, no
 * native module, or the merge failed) — in which case the caller keeps exactly what it had.
 */
export async function mergeSessionParts(
  sid: string, parts: { uri: string; durationMs: number }[],
): Promise<{ uri: string; durationMs: number }[] | null> {
  if (!audioMerge.available || parts.length < 2) return null;
  const allWav = parts.every((p) => p.uri.endsWith('.wav'));
  const ext = allWav ? 'wav' : 'm4a';

  // NOT named `rec-<sid>-N`: the launch scavenger claims those, and a half-written merge picked up
  // that way would be moved straight over a good part. This name is invisible to it, so a crash
  // mid-merge leaves nothing but a scrap in the cache.
  const tmp = `${RNFS.CachesDirectoryPath}/merge-${sid}.tmp`;
  const srcs = parts.map((p) => bare(resolvePartUri(p.uri)));
  try {
    if (allWav) await audioMerge.concatWav(srcs, tmp);   // recordings: lossless byte copy
    else await audioMerge.concatToM4A(srcs, tmp);        // imports: re-encode, any input format
    const st = await RNFS.stat(tmp);
    if (!(Number(st.size) > 44)) throw new Error('merged file is empty');
  } catch {
    try { await RNFS.unlink(tmp); } catch {}
    return null;                                                   // keep the parts exactly as they were
  }

  // Move the merged file into a FRESH index first, and only then delete the sources. Deleting first
  // means a failure in between destroys the meeting; this way the worst case is the originals and
  // the merge both existing for a moment, which is visible and recoverable rather than fatal.
  const rel = await moveToPart(sid, await nextPartIndex(sid), tmp, ext);
  for (const p of parts) { try { await RNFS.unlink(bare(resolvePartUri(p.uri))); } catch {} }
  const durationMs = parts.reduce((a, p) => a + (p.durationMs || 0), 0);
  return [{ uri: rel, durationMs }];
}

// Permanently delete a session's audio files (its whole per-session dir).
export async function deleteSessionFiles(sid: string): Promise<void> {
  const dir = sessionDir(sid);
  try {
    if (await RNFS.exists(dir)) await RNFS.unlink(dir);
  } catch {
    // best-effort; the store entry is removed regardless
  }
}
