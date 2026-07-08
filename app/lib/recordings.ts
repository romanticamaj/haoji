import RNFS from 'react-native-fs';

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

// Permanently delete a session's audio files (its whole per-session dir).
export async function deleteSessionFiles(sid: string): Promise<void> {
  const dir = sessionDir(sid);
  try {
    if (await RNFS.exists(dir)) await RNFS.unlink(dir);
  } catch {
    // best-effort; the store entry is removed regardless
  }
}
