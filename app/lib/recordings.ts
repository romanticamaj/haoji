import * as FileSystem from 'expo-file-system/legacy';
const root = (sid: string) => `${FileSystem.documentDirectory}haoji/${sid}`;
export const partPath = (sid: string, i: number) => `${root(sid)}/part-${i}.m4a`;
export async function ensureDir(sid: string) {
  await FileSystem.makeDirectoryAsync(root(sid), { intermediates: true });
}
