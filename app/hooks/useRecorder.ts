import { useRef, useState } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import RNFS from 'react-native-fs';
import Sound, {
  AudioSet,
  AudioEncoderAndroidType,
  OutputFormatAndroidType,
  AudioSourceAndroidType,
} from 'react-native-nitro-sound';
import type { AVLinearPCMBitDepthKeyIOSType } from 'react-native-nitro-sound';
import { moveToPart } from '../lib/recordings';
import { onAudioInterruption } from '../lib/audioInterruption';

export type Part = { uri: string; durationMs: number };
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
  if (/permission|denied|microphone|麥克風/i.test(raw)) return '沒有麥克風權限，請到「設定 > 好記」開啟麥克風後再試。';
  if (/session|another app|in use|hijack/i.test(raw)) return '無法啟動錄音（麥克風可能被其他 App／通話佔用）。請關閉後重試。';
  return raw ? `無法開始錄音：${raw}` : '無法開始錄音，請重試。';
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

export function useRecorder(sessionId: string): RecorderApi {
  const partsRef = useRef<Part[]>([]);
  const stateRef = useRef<RecorderState>('idle');
  const tmpPathRef = useRef<string | null>(null);
  const unsubRef = useRef<null | (() => void)>(null);
  const [state, setState] = useState<RecorderState>('idle');
  const [durationMs, setDurationMs] = useState(0);
  const [meteringLevel, setMeteringLevel] = useState(0);
  const [parts, setParts] = useState<Part[]>([]);
  const [wasInterrupted, setWasInterrupted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // C1: keep a ref in sync with state so the interruption handler always sees the current value
  const goto = (s: RecorderState) => { stateRef.current = s; setState(s); };

  async function beginPart() {
    const idx = partsRef.current.length;
    const tmp = `${RNFS.CachesDirectoryPath}/rec-${sessionId}-${idx}.wav`;
    tmpPathRef.current = tmp;
    // meteringEnabled (3rd arg) MUST be true or currentMetering is undefined and the waveform stays flat
    await Sound.startRecorder(tmp, AUDIO_SET, true);
    Sound.addRecordBackListener((e) => {
      setDurationMs(e.currentPosition ?? 0);
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
    const moved = await moveToPart(sessionId, partsRef.current.length, src, 'wav'); // persist out of cache
    const part = { uri: moved, durationMs };
    partsRef.current = [...partsRef.current, part]; setParts(partsRef.current);
    return part;
  }

  async function onInterrupted() { await finalize(); setWasInterrupted(true); setMeteringLevel(0); goto('paused'); }

  async function start() {
    setError(null);
    goto('starting'); // immediate feedback so a tap is never silently ignored
    try {
      if (Platform.OS === 'android') {
        const g = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (g !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('microphone permission denied');
      }
      partsRef.current = []; setParts([]); setWasInterrupted(false);
      unsubRef.current?.();
      // interrupted → finalize the current part; resume() then starts a fresh part
      unsubRef.current = onAudioInterruption(() => { if (stateRef.current === 'recording') void onInterrupted(); });
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
      setWasInterrupted(false); setError(null); goto('starting');
      try { await beginPart(); }
      catch (e) { setError(recorderErrorMessage(e)); goto('idle'); }
    } else { await Sound.resumeRecorder(); goto('recording'); } // manual → same part
  }
  async function stop() {
    goto('stopped'); await finalize(); setMeteringLevel(0);
    unsubRef.current?.(); unsubRef.current = null;
    return partsRef.current;
  }
  return { state, durationMs, meteringLevel, parts, wasInterrupted, error, start, pause, resume, stop, clearError: () => setError(null) };
}
