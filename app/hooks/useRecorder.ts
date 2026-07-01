import { useRef, useState } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import RNFS from 'react-native-fs';
import Sound, {
  AudioSet,
  AVEncoderAudioQualityIOSType,
  AudioEncoderAndroidType,
  OutputFormatAndroidType,
  AudioSourceAndroidType,
} from 'react-native-nitro-sound';
import { moveToPart } from '../lib/recordings';
import { onAudioInterruption } from '../lib/audioInterruption';

export type Part = { uri: string; durationMs: number };
export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';
export type RecorderApi = {
  state: RecorderState; durationMs: number; meteringLevel: number; parts: Part[]; wasInterrupted: boolean;
  start(): Promise<void>; pause(): Promise<void>; resume(): Promise<void>; stop(): Promise<Part[]>;
};
const dbToLevel = (db?: number) => (db == null ? 0 : (Math.max(-60, Math.min(0, db)) + 60) / 60);

const AUDIO_SET: AudioSet = {
  AVFormatIDKeyIOS: 'aac',
  AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.high,
  AVNumberOfChannelsKeyIOS: 1,
  AVSampleRateKeyIOS: 44100,
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

  // C1: keep a ref in sync with state so the interruption handler always sees the current value
  const goto = (s: RecorderState) => { stateRef.current = s; setState(s); };

  async function beginPart() {
    const idx = partsRef.current.length;
    const tmp = `${RNFS.CachesDirectoryPath}/rec-${sessionId}-${idx}.m4a`;
    tmpPathRef.current = tmp;
    // meteringEnabled MUST be true or currentMetering is undefined and the waveform stays flat
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
    const moved = await moveToPart(sessionId, partsRef.current.length, src); // persist out of cache
    const part = { uri: moved, durationMs };
    partsRef.current = [...partsRef.current, part]; setParts(partsRef.current);
    return part;
  }

  async function onInterrupted() { await finalize(); setWasInterrupted(true); setMeteringLevel(0); goto('paused'); }

  async function start() {
    if (Platform.OS === 'android') {
      const g = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (g !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('需要麥克風權限');
    }
    partsRef.current = []; setParts([]); setWasInterrupted(false);
    unsubRef.current?.();
    // interrupted → finalize the current part; resume() then starts a fresh part
    unsubRef.current = onAudioInterruption(() => { if (stateRef.current === 'recording') void onInterrupted(); });
    await beginPart();
  }

  async function pause() { goto('paused'); await Sound.pauseRecorder(); }
  async function resume() {
    if (wasInterrupted) { setWasInterrupted(false); await beginPart(); }   // interrupted → new part
    else { await Sound.resumeRecorder(); goto('recording'); }              // manual → same part
  }
  async function stop() {
    goto('stopped'); await finalize(); setMeteringLevel(0);
    unsubRef.current?.(); unsubRef.current = null;
    return partsRef.current;
  }
  return { state, durationMs, meteringLevel, parts, wasInterrupted, start, pause, resume, stop };
}
