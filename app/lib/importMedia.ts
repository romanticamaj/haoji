// Helpers for bringing an outside file (Files app / Photos) into a session.
//
// Imports used to be stored as `part-N.m4a` no matter what they actually were, so a picked .mov kept
// its video bytes under an audio name. The backend didn't care (ffmpeg probes content), but the
// on-device player reads by file type and simply failed — an imported video looked broken even
// though its transcript came out fine.

/** Extensions we keep as-is: the on-device player can open all of these directly. */
export const AUDIO_EXTS = ['m4a', 'mp3', 'wav', 'aac', 'caf', 'aiff', 'aif', 'mp4a'];
/** Containers that hold a video track — the audio has to be extracted before it can be played. */
const VIDEO_EXTS = ['mov', 'mp4', 'm4v', 'avi', 'mkv', '3gp', 'webm', 'mpg', 'mpeg'];

/** Lower-cased extension of a uri/filename, ignoring any query string. Empty when there is none. */
export function extOf(uriOrName: string): string {
  const clean = uriOrName.split('?')[0].split('#')[0];
  const base = clean.slice(clean.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

export const isVideo = (uriOrName: string) => VIDEO_EXTS.includes(extOf(uriOrName));
export const isAudio = (uriOrName: string) => AUDIO_EXTS.includes(extOf(uriOrName));

/**
 * Extension to store an import under. Known audio keeps its own (so the player can open it); video
 * becomes m4a because we extract its audio track; anything unrecognised falls back to m4a, which is
 * what the whole app assumed before.
 */
export function storageExtFor(uriOrName: string): string {
  const e = extOf(uriOrName);
  if (AUDIO_EXTS.includes(e)) return e;
  return 'm4a';
}
