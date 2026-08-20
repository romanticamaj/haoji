import { NativeModules, Platform } from 'react-native';

// JS side of ios/Haoji/AudioMerge.swift — joins a meeting's WAV parts into one file, losslessly.
// Optional: without the native module the parts simply stay as they are.
type Native = { concatWav(paths: string[], destPath: string): Promise<string> };

const native: Native | undefined =
  Platform.OS === 'ios' ? (NativeModules as any).AudioMerge : undefined;

export const available = !!native?.concatWav;

/** Rejects unless every input is a WAV with an identical format — the caller then keeps the parts. */
export async function concatWav(paths: string[], destPath: string): Promise<void> {
  if (!native) throw new Error('audio merge unavailable');
  await native.concatWav(paths, destPath);
}
