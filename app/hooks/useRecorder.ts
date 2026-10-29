import { useEffect, useRef, useState } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import RNFS from 'react-native-fs';
import Sound, {
  AudioSet,
  AudioEncoderAndroidType,
  OutputFormatAndroidType,
  AudioSourceAndroidType,
} from 'react-native-nitro-sound';
import type { AVLinearPCMBitDepthKeyIOSType } from 'react-native-nitro-sound';
import { moveToPart, nextPartIndex, listPartsOnDisk } from '../lib/recordings';
import { onAudioInterruption } from '../lib/audioInterruption';

export type Part = { uri: string; durationMs: number };
type PartExt = 'wav' | 'm4a';
export type RecorderState = 'idle' | 'starting' | 'recording' | 'paused' | 'stopped';
export type RecorderApi = {
  state: RecorderState; durationMs: number; meteringLevel: number; parts: Part[]; wasInterrupted: boolean;
  error: string | null;
  start(): Promise<void>; pause(): Promise<void>; resume(): Promise<void>; stop(): Promise<Part[]>;
  clearError(): void;
};
const dbToLevel = (db?: number) => (db == null ? 0 : (Math.max(-60, Math.min(0, db)) + 60) / 60);

// nitro-sound's native startRecorder rejects with English messages (permission denied, audio
// session failures). Map them to a user-facing zh-TW message so recording never fails silently.
export function recorderErrorMessage(e: unknown): string {
  const raw = (e && ((e as any).message || String(e))) || '';
  // Plain words only (GUIDELINE §5): what failed and what to do. The raw native message is logged for
  // debugging but never shown — it is English, technical and means nothing to the person recording.
  if (raw) console.warn('[recorder]', raw);
  if (/permission|denied|microphone|麥克風/i.test(raw)) return '沒有麥克風權限。到「設定」開啟麥克風後，就能開始錄音。';
  if (/session|another app|in use|hijack/i.test(raw)) return '麥克風正在被其他 App 或通話使用。結束後再按一次錄音。';
  return '沒辦法開始錄音，請再試一次。';
}

// LinearPCM (WAV) capture at 16 kHz mono. We record WAV — NOT AAC/m4a — on purpose: an AAC .m4a only
// gets its index (moov atom) written on a clean stop, so a crash mid-recording leaves an UNPLAYABLE,
// unrecoverable file. A WAV/PCM file is readable up to the exact byte the crash truncated it at, so a
// crashed recording is always recoverable (the launch recovery scan even repairs it). 16 kHz mono is
// exactly what the backend transcribes at, so nothing is lost and no transcode is needed.
//
// IMPORTANT: the NitroModules C++ interop corrupts numeric AudioSet fields between JS and Swift (a
// sample rate arrives as ~3.99e252), and getAudioSettings never maps the PCM-specific keys at all.
// So the native layer is the source of truth: patches/react-native-nitro-sound+0.2.15.patch clamps
// the sample rate AND forces sane 16-bit little-endian integer PCM when the format is LinearPCM. We
// still pass a valid dict here for the day the interop bug is fixed upstream.
const AUDIO_SET: AudioSet = {
  AVFormatIDKeyIOS: 'lpcm',
  AVNumberOfChannelsKeyIOS: 1,
  AVSampleRateKeyIOS: 16000,
  AVLinearPCMBitDepthKeyIOS: 16 as AVLinearPCMBitDepthKeyIOSType, // enum value is 16; cast avoids a runtime enum dep (mocks)
  AVLinearPCMIsBigEndianKeyIOS: false,
  AVLinearPCMIsFloatKeyIOS: false,
  // Android (not the current shipping target) can't write WAV via MediaRecorder — keep it on AAC.
  AudioSourceAndroid: AudioSourceAndroidType.MIC,
  OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
  AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
};

// Last-resort settings if PCM/WAV is refused by the device or the audio session. AAC loses the
// crash-safety WAV gives us (a killed .m4a has no index and can't be recovered), but being unable to
// record AT ALL is far worse — so we degrade rather than fail.
const AAC_FALLBACK_SET: AudioSet = {
  AVFormatIDKeyIOS: 'aac',
  AVNumberOfChannelsKeyIOS: 1,
  AVSampleRateKeyIOS: 44100,
  AudioSourceAndroid: AudioSourceAndroidType.MIC,
  OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
  AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
};

/**
 * `existingParts` lets a take be APPENDED to a meeting that already has audio: new parts continue the
 * numbering instead of overwriting part-0, so one meeting can be recorded across several sittings
 * (an interruption, or deliberately carrying on later) and still be transcribed as a single session.
 */
const NO_PARTS: Part[] = [];   // stable identity: a `= []` default would be a fresh array on every render

// Monotonic, so two takes in the same millisecond still get different files. A wall clock alone is
// not a uniqueness guarantee — and this name existing twice is what destroys audio.
let tmpSeq = 0;

export function useRecorder(sessionId: string, existingParts: Part[] = NO_PARTS): RecorderApi {
  const partsRef = useRef<Part[]>(existingParts);
  const stateRef = useRef<RecorderState>('idle');
  // The parts the meeting already had. NOT just useRef(existingParts): in append mode the caller
  // loads them asynchronously, so the first render sees an empty list — capturing only that is what
  // made a continued take restart at part-0 and overwrite the original recording.
  const existingPartsRef = useRef<Part[]>(existingParts);
  // Keyed on CONTENT, not array identity: a caller that rebuilds the array each render would otherwise
  // retrigger this forever (setParts → re-render → new array → effect …).
  const existingSig = existingParts.map((p) => p.uri).join('|');
  useEffect(() => {
    // Only meaningful before a take starts; never disturb parts captured during this session.
    if (stateRef.current !== 'idle') return;
    existingPartsRef.current = existingParts;
    partsRef.current = existingParts;
    setParts(existingParts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingSig]);
  const tmpPathRef = useRef<string | null>(null);
  // Which container the CURRENT part is actually being written as — normally 'wav', 'm4a' if the
  // fallback kicked in. finalize() must persist it under the right extension or nothing can read it.
  const extRef = useRef<PartExt>('wav');
  const unsubRef = useRef<null | (() => void)>(null);
  const [state, setState] = useState<RecorderState>('idle');
  const [durationMs, setDurationMs] = useState(0);
  // The interruption handler is registered once, so the `finalize` it captures would read the
  // durationMs of that first render — every interrupted part was being stored with a duration of 0.
  const durationRef = useRef(0);
  const [meteringLevel, setMeteringLevel] = useState(0);
  const [parts, setParts] = useState<Part[]>([]);
  const [wasInterrupted, setWasInterrupted] = useState(false);
  // C1 again: the interruption handler is a long-lived closure, so it must read a ref, not state.
  const interruptedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // C1: keep a ref in sync with state so the interruption handler always sees the current value
  const goto = (s: RecorderState) => { stateRef.current = s; setState(s); };

  async function beginPart() {
    // Ask the DISK where we are, not memory: a call can suspend the app between writing a part and
    // recording that we wrote it, and reusing an index overwrites audio that is already there.
    const idx = await nextPartIndex(sessionId);
    // meteringEnabled (3rd arg) MUST be true or currentMetering is undefined and the waveform stays flat
    const attempt = async (ext: PartExt, set: AudioSet) => {
      // Unique per attempt. Reusing `rec-<sid>-<idx>` meant a take that never got finalised (an
      // interruption we failed to hear) sat in the cache under exactly the name the NEXT take would
      // open — and startRecorder truncates what it opens. That is what destroyed the audio recorded
      // before a call, before anything had a chance to recover it.
      const tmp = `${RNFS.CachesDirectoryPath}/rec__${sessionId}__${idx}__${Date.now()}_${++tmpSeq}.${ext}`;
      tmpPathRef.current = tmp;
      extRef.current = ext;
      await Sound.startRecorder(tmp, set, true);
    };
    try {
      await attempt('wav', AUDIO_SET);
    } catch (e) {
      // PCM/WAV refused (e.g. the format never reached the native layer, or this route can't do it).
      // Recording must not be impossible, so fall back to AAC — crash-safety is lost for this take,
      // but a take that happens beats a take that doesn't.
      await attempt('m4a', AAC_FALLBACK_SET);
    }
    Sound.addRecordBackListener((e) => {
      durationRef.current = e.currentPosition ?? 0;
      setDurationMs(durationRef.current);
      setMeteringLevel(dbToLevel(e.currentMetering));
    });
    goto('recording');
  }

  async function finalize(): Promise<Part | null> {
    if (!tmpPathRef.current) return null;
    let uri: string;
    try { uri = await Sound.stopRecorder(); } catch { uri = tmpPathRef.current; }
    Sound.removeRecordBackListener();
    const src = uri || tmpPathRef.current;
    tmpPathRef.current = null;
    const moved = await moveToPart(sessionId, await nextPartIndex(sessionId), src, extRef.current);
    const part = { uri: moved, durationMs: durationRef.current };
    partsRef.current = [...partsRef.current, part]; setParts(partsRef.current);
    // Re-read the session's files: a part whose bookkeeping was lost to a suspension is still on
    // disk, and this is what puts it back into the recording instead of leaving it orphaned.
    await reconcileWithDisk();
    return partsRef.current[partsRef.current.length - 1] ?? part;
  }

  /**
   * Fold what is on disk into the in-memory list. A UNION, never a replacement: anything we already
   * know about stays, so a part this scan cannot see (an import under some other extension, a file
   * momentarily missing) is never quietly dropped from the recording.
   */
  async function reconcileWithDisk() {
    const onDisk = await listPartsOnDisk(sessionId);
    if (onDisk.length === 0) return;
    const known = new Map(partsRef.current.map((p) => [p.uri, p.durationMs]));
    for (const uri of onDisk) if (!known.has(uri)) known.set(uri, 0);
    const idx = (u: string) => Number(/part-(\d+)\./.exec(u)?.[1] ?? 0);
    partsRef.current = [...known.entries()]
      .map(([uri, durationMs]) => ({ uri, durationMs }))
      .sort((a, b) => idx(a.uri) - idx(b.uri));
    setParts(partsRef.current);
  }

  async function onInterrupted() {
    await finalize();
    interruptedRef.current = true; setWasInterrupted(true);
    setMeteringLevel(0); goto('paused');
  }

  // The interruption is over and iOS says it is safe to carry on (the call ended, the demo video
  // stopped). Start a fresh part automatically — waiting for the user to notice and tap 繼續 is how
  // the rest of a meeting used to get lost.
  async function onInterruptionEnded() {
    if (!interruptedRef.current || stateRef.current !== 'paused') return;
    interruptedRef.current = false; setWasInterrupted(false);
    goto('starting');
    try { await beginPart(); }
    catch (e) {
      // Could not restart (mic taken by something else) — leave the manual 繼續 prompt in place.
      interruptedRef.current = true; setWasInterrupted(true);
      setError(recorderErrorMessage(e)); goto('paused');
    }
  }

  async function start() {
    setError(null);
    goto('starting'); // immediate feedback so a tap is never silently ignored
    try {
      if (Platform.OS === 'android') {
        const g = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (g !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('microphone permission denied');
      }
      // Keep what the meeting already has — start() only resets the state of THIS take. Then fold in
      // whatever is on disk: if a previous take's bookkeeping was lost (a failed resume, a kill),
      // this is what stops the next part reusing an index and deleting audio that is already there.
      partsRef.current = existingPartsRef.current; setParts(existingPartsRef.current);
      await reconcileWithDisk();
      setWasInterrupted(false); interruptedRef.current = false;
      unsubRef.current?.();
      // interrupted → finalize the current part; resume() then starts a fresh part
      unsubRef.current = onAudioInterruption((e) => {
        if (e.type === 'began') { if (stateRef.current === 'recording') void onInterrupted(); }
        else if (e.shouldResume) void onInterruptionEnded();
      });
      await beginPart(); // → goto('recording') on success; throws (rejects) on permission/session failure
    } catch (e) {
      unsubRef.current?.(); unsubRef.current = null;
      setError(recorderErrorMessage(e));
      goto('idle');
    }
  }

  async function pause() { goto('paused'); await Sound.pauseRecorder(); }
  async function resume() {
    if (wasInterrupted) {
      // interrupted → new part; surface a failure instead of hanging on the "繼續" prompt
      setWasInterrupted(false); interruptedRef.current = false; setError(null); goto('starting');
      try { await beginPart(); }
      catch (e) {
        // Stay PAUSED, not idle. Dropping to idle turns the record button back into "start", and
        // start() resets the part list — which is how a meeting recorded before the call got
        // overwritten. Paused keeps the 繼續 prompt and keeps the parts we already have.
        setError(recorderErrorMessage(e));
        interruptedRef.current = true; setWasInterrupted(true); goto('paused');
      }
      return;
    }
    // Manual pause → same part. resumeRecorder can fail silently after the audio session was taken
    // (a call), leaving us "recording" into nothing; if it does, close this part and open a new one
    // rather than pretending it worked.
    try {
      await Sound.resumeRecorder();
      goto('recording');
    } catch (e) {
      try {
        await finalize();
        await beginPart();
      } catch (e2) {
        setError(recorderErrorMessage(e2));
        interruptedRef.current = true; setWasInterrupted(true); goto('paused');
      }
    }
  }
  async function stop() {
    goto('stopped'); await finalize(); await reconcileWithDisk(); setMeteringLevel(0);
    unsubRef.current?.(); unsubRef.current = null;
    return partsRef.current;
  }
  return { state, durationMs, meteringLevel, parts, wasInterrupted, error, start, pause, resume, stop, clearError: () => setError(null) };
}
