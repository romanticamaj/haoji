import { NativeModules, DeviceEventEmitter, Platform } from 'react-native';

// JS side of ios/Haoji/PushNotifications.swift.
//
// Transcription finishes on the server, usually with the app suspended, so "逐字稿完成" has to come
// from the backend as a push. The phone's only jobs are to get a device token to send along with the
// session, and to open the right meeting when a notification is tapped.
//
// Degrades to a no-op wherever the native module is missing (Android, older builds): transcription
// works exactly as before, just without the notification.
export type PushToken = { token: string; env: 'sandbox' | 'production' };

type Native = {
  register(): Promise<PushToken | null>;
  attach(): Promise<string | null>;
};

const native: Native | undefined =
  Platform.OS === 'ios' ? (NativeModules as any).PushNotifications : undefined;

export const available = !!native?.register;

/**
 * Ask for permission (the system prompt only shows the first time) and get the device token.
 * Resolves null if declined, unavailable, or registration failed — never rejects.
 */
export async function register(): Promise<PushToken | null> {
  if (!native) return null;
  try { return await native.register(); } catch { return null; }
}

/**
 * Call `cb` with the meeting id whenever a notification is tapped — including the tap that launched
 * the app before JS was running. Native holds taps until this attaches, then delivers them live
 * (never both, so a tap opens the meeting once).
 */
export function onOpen(cb: (sessionId: string) => void): () => void {
  const sub = DeviceEventEmitter.addListener('pushOpened', (e: { session?: string }) => {
    if (e?.session) cb(e.session);
  });
  native?.attach().then((id) => { if (id) cb(id); }).catch(() => {});
  return () => sub.remove();
}
