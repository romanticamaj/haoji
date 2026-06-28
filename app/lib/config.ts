// Backend base URL. Override per-device (LAN/Tailscale IP of the dev machine).
// e.g. set EXPO_PUBLIC_API_BASE in an .env / app config for a real phone.
export const API_BASE: string =
  process.env.EXPO_PUBLIC_API_BASE ?? 'http://127.0.0.1:8780';
