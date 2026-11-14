import { NativeModules, Platform } from 'react-native';

// JS side of ios/Haoji/AudioExtract.swift — pulls the audio track out of an imported video so it can
// be played back on the device. Optional: where the native module is unavailable the caller stores
// the original file instead, which still transcribes (the backend re-encodes) but won't preview.
type Native = { extractAudio(srcPath: string, destPath: string): Promise<string> };

const native: Native | undefined =
  Platform.OS === 'ios' ? (NativeModules as any).AudioExtract : undefined;

export const available = !!native?.extractAudio;

/** Extract src's audio track into destPath (.m4a). Rejects when there is no audio track. */
export async function extractAudio(srcUri: string, destUri: string): Promise<void> {
  if (!native) throw new Error('audio extraction unavailable');
  await native.extractAudio(srcUri, destUri);
}
