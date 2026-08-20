import { NativeModules, Platform } from 'react-native';

// JS side of ios/Haoji/AudioMerge.swift — joins a meeting's WAV parts into one file, losslessly.
// Optional: without the native module the parts simply stay as they are.
export type ProbeResult = {
  path: string;
  ok: boolean;
  durationMs: number;
  reason?: string;   // why it can't be used, when ok is false
};

type Native = {
  probe(paths: string[]): Promise<ProbeResult[]>;
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

/**
 * Ask the system what each file actually is. Decodes rather than trusting the extension — a picked
 * ".m4a" may be a renamed document, a video with no audio, or empty. Without the native module every
 * file is reported as usable, which matches the old behaviour of just trying.
 */
export async function probe(paths: string[]): Promise<ProbeResult[]> {
  if (!native) return paths.map((path) => ({ path, ok: true, durationMs: 0 }));
  try { return await native.probe(paths); }
  catch { return paths.map((path) => ({ path, ok: true, durationMs: 0 })); }
}
