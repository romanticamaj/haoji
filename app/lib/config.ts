import Config from 'react-native-config';
// Build-time default server, injected per build scheme via react-native-config (.env). There is no
// hardcoded fallback: a build without API_BASE starts unpaired and the person connects to their own
// server at runtime (lib/server.ts). A paired server always wins over this default.
export const API_BASE: string | null = Config.API_BASE || null;
