import RNFS from 'react-native-fs';

// RNFS wants bare POSIX paths; the rest of the app wants file:// URIs. Convert at the edges.
const bare = (p: string) => p.replace(/^file:\/\//, '');
const root = (sid: string) => `${RNFS.DocumentDirectoryPath}/haoji/${sid}`;

export const partPath = (sid: string, i: number) => `file://${root(sid)}/part-${i}.m4a`;

export async function ensureDir(sid: string) {
  await RNFS.mkdir(root(sid));
}

// Move a just-finished recording out of the recorder's temp/cache location into the
// persistent per-session document dir so raw parts survive app restarts. Returns a file:// URI.
export async function moveToPart(sid: string, index: number, fromUri: string): Promise<string> {
  await ensureDir(sid);
  const dest = partPath(sid, index); // file:// URI
  const destBare = bare(dest);
  if (await RNFS.exists(destBare)) {
    await RNFS.unlink(destBare);
  }
  await RNFS.moveFile(bare(fromUri), destBare);
  return dest;
}
