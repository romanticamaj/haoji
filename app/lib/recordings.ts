import RNFS from 'react-native-fs';
import type { SavedSession } from './store';

// RNFS wants bare POSIX paths; the rest of the app wants file:// URIs. Convert at the edges.
const bare = (p: string) => p.replace(/^file:\/\//, '');

// Parts live under Documents and are PERSISTED as RELATIVE paths ("haoji/<sid>/part-0.m4a").
// Never persist an absolute path: on iOS the app-container UUID inside an absolute path
// (/var/mobile/Containers/Data/Application/<UUID>/Documents/...) changes on every app update, so a
// stored absolute uri goes stale after installing a new build and the recording can no longer be
// played. Store relative; resolve against the CURRENT Documents dir at read time.
export const relPart = (sid: string, i: number) => `haoji/${sid}/part-${i}.m4a`;
const sessionDir = (sid: string) => `${RNFS.DocumentDirectoryPath}/haoji/${sid}`;
export const partPath = (sid: string, i: number) => `file://${RNFS.DocumentDirectoryPath}/${relPart(sid, i)}`;

export async function ensureDir(sid: string) {
  await RNFS.mkdir(sessionDir(sid));
}

// Move a just-finished recording (or an imported file) out of its temp/cache location into the
// persistent per-session document dir so raw parts survive app restarts AND updates. Returns the
// RELATIVE path to persist in the store.
export async function moveToPart(sid: string, index: number, fromUri: string): Promise<string> {
  await ensureDir(sid);
  const destBare = bare(partPath(sid, index));
  if (await RNFS.exists(destBare)) await RNFS.unlink(destBare);
  await RNFS.moveFile(bare(fromUri), destBare);
  return relPart(sid, index);
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

const partIndex = (name: string) => Number(/part-(\d+)\.m4a$/.exec(name)?.[1] ?? 0);

// A recording in progress writes to Caches as `rec-<sid>-<index>.m4a` and is moved into the per-
// session dir only when the part is finalized. A crash mid-recording (e.g. an incoming call) can
// leave that temp file behind. Fold any such leftovers into their session dir as part-<index>.m4a so
// the recovery scan below picks them up. Best-effort: a 0-byte temp is an aborted start — drop it.
export async function scavengeTempParts(): Promise<void> {
  let entries: RNFS.ReadDirItem[];
  try { entries = await RNFS.readDir(RNFS.CachesDirectoryPath); } catch { return; }
  for (const e of entries) {
    const m = /^rec-(.+)-(\d+)\.m4a$/.exec(e.name);
    if (!m) continue;
    try {
      if ((e.size ?? 0) <= 0) { await RNFS.unlink(e.path).catch(() => {}); continue; }
      await moveToPart(m[1], Number(m[2]), e.path);
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
      .filter((f) => /^part-\d+\.m4a$/.test(f.name) && (f.size ?? 1) > 0)
      .sort((a, b) => partIndex(a.name) - partIndex(b.name));
    if (partFiles.length === 0) continue;
    const parts = partFiles.map((f) => ({ uri: `haoji/${d.name}/${f.name}`, durationMs: 0 }));
    const at = partFiles[0].mtime instanceof Date ? partFiles[0].mtime.getTime() : Date.now();
    out.push({ id: d.name, createdAt: at, title: `已復原的錄音（${new Date(at).toLocaleString()}）`, names: {}, unlocked: false, parts });
  }
  return out;
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
