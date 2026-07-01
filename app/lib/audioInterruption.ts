import { DeviceEventEmitter } from 'react-native';

// Fires when iOS interrupts the audio session (incoming call, Siri, etc.). The native
// AudioInterruption RCTEventEmitter (ios/Haoji/AudioInterruption.swift) sends the event
// via RCTDeviceEventEmitter, which the New-Architecture interop layer preserves — so we
// listen with DeviceEventEmitter and never touch NativeModules (which would be undefined).
// No-op on Android / in jest (the native event simply never fires).
export function onAudioInterruption(cb: () => void): () => void {
  const sub = DeviceEventEmitter.addListener('audioInterruption', cb);
  return () => sub.remove();
}
