import Config from 'react-native-config';
// Backend base URL, injected per build scheme via react-native-config (.env). The fallback is
// the Tailscale IP (not localhost) so a release/TestFlight build reaches the GPU-box backend
// even if .env isn't wired into the native build. Override locally by editing .env.
export const API_BASE: string = Config.API_BASE ?? 'http://100.106.118.45:7780';
