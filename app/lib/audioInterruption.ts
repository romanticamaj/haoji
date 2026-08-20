import { DeviceEventEmitter } from 'react-native';

// Fires when iOS interrupts the audio session (incoming call, Siri, etc.). The native
// AudioInterruption RCTEventEmitter (ios/Haoji/AudioInterruption.swift) sends the event
// via RCTDeviceEventEmitter, which the New-Architecture interop layer preserves — so we
// listen with DeviceEventEmitter and never touch NativeModules (which would be undefined).
// No-op on Android / in jest (the native event simply never fires).
export type InterruptionEvent =
  | { type: 'began' }
  | { type: 'ended'; shouldResume: boolean };

export function onAudioInterruption(cb: (e: InterruptionEvent) => void): () => void {
  // Older native builds sent an empty body for the (only) began event; treat that as 'began' so a
  // JS-only update can never lose interruption handling entirely.
  const sub = DeviceEventEmitter.addListener('audioInterruption', (e: any) =>
    cb(e && e.type ? e : { type: 'began' }));
  return () => sub.remove();
}
