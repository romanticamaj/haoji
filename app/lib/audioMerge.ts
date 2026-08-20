import { NativeModules, Platform } from 'react-native';

// JS side of ios/Haoji/AudioMerge.swift — joins a meeting's WAV parts into one file, losslessly.
// Optional: without the native module the parts simply stay as they are.
type Native = {
  concatWav(paths: string[], destPath: string): Promise<string>;
  concatToM4A(paths: string[], destPath: string): Promise<string>;
};

const native: Native | undefined =
  Platform.OS === 'ios' ? (NativeModules as any).AudioMerge : undefined;

export const available = !!native?.concatWav;

/** Lossless byte concat. Rejects unless every input is a WAV with an identical format. */
export async function concatWav(paths: string[], destPath: string): Promise<void> {
  if (!native) throw new Error('audio merge unavailable');
  await native.concatWav(paths, destPath);
}

/**
 * Concatenate anything the system can decode into one .m4a. Used for IMPORTED files, which are
 * usually compressed and may not share a format, so the lossless path cannot apply. Re-encodes.
 */
export async function concatToM4A(paths: string[], destPath: string): Promise<void> {
  if (!native) throw new Error('audio merge unavailable');
  await native.concatToM4A(paths, destPath);
}
