import Config from 'react-native-config';
// Backend base URL, injected per build scheme via react-native-config (.env).
// Override by editing .env (see .env.example) — LAN vs Tailscale IP of the dev machine.
export const API_BASE: string = Config.API_BASE ?? 'http://127.0.0.1:8780';
