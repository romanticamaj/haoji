import AsyncStorage from '@react-native-async-storage/async-storage';
import { Transcript } from './types';

export type SavedSession = {
  id: string; createdAt: number; title: string;
  transcript?: Transcript; names: Record<string, string>;
  notes?: string; unlocked: boolean;
  // Previous versions of `notes`, newest first, pushed each time the user edits/reverts/regenerates.
  // Powers the notes editor's 版本紀錄 (revert). Capped when written (see lib/notesEdit).
  notesHistory?: { notes: string; at: number }[];
  parts: { uri: string; durationMs: number }[];
  // Backend draft-session id, created lazily in ProcessingScreen at upload time. `id` is a
  // local, device-generated id so recording never depends on backend reachability; `backendId`
  // is what the transcribe/analyze endpoints key on.
  backendId?: string;
};

export interface SessionStore {
  list(): Promise<SavedSession[]>;
  get(id: string): Promise<SavedSession | null>;
  upsert(s: SavedSession): Promise<void>;
  remove(id: string): Promise<void>;
}

const KEY = 'haoji.sessions';
const sortNewest = (a: SavedSession[]) => [...a].sort((x, y) => y.createdAt - x.createdAt);

function fromMap(map: Record<string, SavedSession>): SessionStore {
  return {
    async list() { return sortNewest(Object.values(map)); },
    async get(id) { return map[id] ?? null; },
    async upsert(s) { map[s.id] = s; },
    async remove(id) { delete map[id]; },
  };
}

export function createMemoryStore(seed: SavedSession[] = []): SessionStore {
  const map: Record<string, SavedSession> = {};
  for (const s of seed) map[s.id] = s;
  return fromMap(map);
}

export function createAsyncStorageStore(): SessionStore {
  const read = async (): Promise<Record<string, SavedSession>> => {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  };
  const write = (m: Record<string, SavedSession>) => AsyncStorage.setItem(KEY, JSON.stringify(m));
  return {
    async list() { return sortNewest(Object.values(await read())); },
    async get(id) { return (await read())[id] ?? null; },
    async upsert(s) { const m = await read(); m[s.id] = s; await write(m); },
    async remove(id) { const m = await read(); delete m[id]; await write(m); },
  };
}
