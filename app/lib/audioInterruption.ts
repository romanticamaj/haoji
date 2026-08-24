import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

// Fires when iOS interrupts the audio session (incoming call, Siri, etc.). The native
// AudioInterruption RCTEventEmitter (ios/Haoji/AudioInterruption.swift) sends the event
// via RCTDeviceEventEmitter, which the New-Architecture interop layer preserves — so we
// listen with DeviceEventEmitter rather than NativeEventEmitter(NativeModules.X), which is
// undefined under the New Architecture.
// No-op on Android / in jest (the native event simply never fires).
export type InterruptionEvent =
  | { type: 'began' }
  | { type: 'ended'; shouldResume: boolean };

// React Native builds native modules lazily, on first use from JS. Listening with
// DeviceEventEmitter never touches the module, so it was never built, its init() never ran, and
// nothing observed the system interruption — a phone call mid-recording did not reach the app at
// all. This no-op call is what brings the module (and its observer) into existence.
function ensureNativeObserver() {
  if (Platform.OS !== 'ios') return;
  try { NativeModules.AudioInterruption?.prepare?.(); } catch { /* older build without prepare() */ }
}

export function onAudioInterruption(cb: (e: InterruptionEvent) => void): () => void {
  ensureNativeObserver();
  // Older native builds sent an empty body for the (only) began event; treat that as 'began' so a
  // JS-only update can never lose interruption handling entirely.
  const sub = DeviceEventEmitter.addListener('audioInterruption', (e: any) =>
    cb(e && e.type ? e : { type: 'began' }));
  return () => sub.remove();
}
