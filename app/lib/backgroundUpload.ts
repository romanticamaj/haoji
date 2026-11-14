import { NativeModules, DeviceEventEmitter, Platform } from 'react-native';

// JS side of ios/Haoji/BackgroundUpload.swift.
//
// A normal fetch() upload dies when the app is suspended or swiped away. This hands the file to an
// NSURLSession *background* session instead: the OS performs the transfer itself and finishes it with
// the app closed. Combined with the backend starting transcription once all expected parts have
// landed, a user can hit 生成逐字稿 and walk away without the job stalling.
//
// Everything here degrades gracefully: if the native module is missing (Android, an older build, a
// simulator quirk) `available` is false and callers fall back to the ordinary foreground upload.
type Native = {
  enqueue(url: string, filePath: string, taskId: string): Promise<string>;
  // Same, plus extra request headers (the pairing token). Absent on builds older than pairing.
  enqueueWithHeaders?(url: string, filePath: string, taskId: string, headers: Record<string, string>): Promise<string>;
  pendingTasks(): Promise<string[]>;
};

const native: Native | undefined =
  Platform.OS === 'ios' ? (NativeModules as any).BackgroundUpload : undefined;

export const available = !!native?.enqueue;

export type UploadEvent =
  | { taskId: string; state: 'progress'; pct: number }
  | { taskId: string; state: 'done'; status: number }
  | { taskId: string; state: 'error'; error: string; status?: number };

/** taskId encodes which part of which session a transfer belongs to. */
export const taskIdFor = (sessionId: string, index: number) => `${sessionId}:${index}`;
export const parseTaskId = (taskId: string): { sessionId: string; index: number } | null => {
  const at = taskId.lastIndexOf(':');
  if (at <= 0) return null;
  const index = Number(taskId.slice(at + 1));
  if (!Number.isFinite(index)) return null;
  return { sessionId: taskId.slice(0, at), index };
};

/** Hand one part to the OS. Resolves as soon as it is queued — NOT when the upload finishes. */
export async function enqueue(
  url: string, fileUri: string, taskId: string, headers?: Record<string, string>,
): Promise<void> {
  if (!native) throw new Error('background upload unavailable');
  // The URL comes from the same runtime server as every api call (api.partPutUrl); the pairing token
  // rides along as a header, since the OS performs this request without any JS in the loop.
  if (headers && Object.keys(headers).length > 0 && native.enqueueWithHeaders) {
    await native.enqueueWithHeaders(url, fileUri, taskId, headers);
    return;
  }
  await native.enqueue(url, fileUri, taskId);
}

/** taskIds the OS is still carrying, so we never queue the same part twice. */
export async function pendingTasks(): Promise<string[]> {
  if (!native) return [];
  try { return await native.pendingTasks(); } catch { return []; }
}

/**
 * Subscribe to transfer events. Uses DeviceEventEmitter (not NativeEventEmitter): the native side is
 * an RCTEventEmitter and this is the New-Architecture-safe path, same as lib/audioInterruption.ts.
 */
export function onUploadEvent(cb: (e: UploadEvent) => void): () => void {
  const sub = DeviceEventEmitter.addListener('backgroundUploadEvent', cb);
  return () => sub.remove();
}
