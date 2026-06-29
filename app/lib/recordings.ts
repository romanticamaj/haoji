import * as FileSystem from 'expo-file-system/legacy';
const root = (sid: string) => `${FileSystem.documentDirectory}haoji/${sid}`;
export const partPath = (sid: string, i: number) => `${root(sid)}/part-${i}.m4a`;
export async function ensureDir(sid: string) {
  await FileSystem.makeDirectoryAsync(root(sid), { intermediates: true });
}

// Move a just-finished recording out of expo-av's temp/cache location into the
// persistent per-session document dir so raw parts survive app restarts.
export async function moveToPart(sid: string, index: number, fromUri: string): Promise<string> {
  await ensureDir(sid);
  const to = partPath(sid, index);
  try { await FileSystem.deleteAsync(to, { idempotent: true }); } catch {}
  await FileSystem.moveAsync({ from: fromUri, to });
  return to;
}
