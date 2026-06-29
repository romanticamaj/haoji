import { useRef, useState } from 'react';
import { Audio } from 'expo-av';
import { ensureDir, moveToPart } from '../lib/recordings';

export type Part = { uri: string; durationMs: number };
export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';
export type RecorderApi = {
  state: RecorderState; durationMs: number; meteringLevel: number; parts: Part[]; wasInterrupted: boolean;
  start(): Promise<void>; pause(): Promise<void>; resume(): Promise<void>; stop(): Promise<Part[]>;
};
const dbToLevel = (db?: number) => (db == null ? 0 : (Math.max(-60, Math.min(0, db)) + 60) / 60);

export function useRecorder(sessionId: string): RecorderApi {
  const recRef = useRef<Audio.Recording | null>(null);
  const partsRef = useRef<Part[]>([]);
  const stateRef = useRef<RecorderState>('idle');
  const [state, setState] = useState<RecorderState>('idle');
  const [durationMs, setDurationMs] = useState(0);
  const [meteringLevel, setMeteringLevel] = useState(0);
  const [parts, setParts] = useState<Part[]>([]);
  const [wasInterrupted, setWasInterrupted] = useState(false);

  // C1 fix: keep a ref in sync with state so callbacks always see the current value
  const goto = (s: RecorderState) => { stateRef.current = s; setState(s); };

  async function beginPart() {
    await ensureDir(sessionId);
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, staysActiveInBackground: true, playsInSilentModeIOS: true } as any);
    const rec = new Audio.Recording();
    await rec.prepareToRecordAsync({ ...(Audio as any).RecordingOptionsPresets.HIGH_QUALITY, isMeteringEnabled: true });
    rec.setOnRecordingStatusUpdate((s: any) => {
      if (s?.isRecording) { setDurationMs(s.durationMillis ?? 0); setMeteringLevel(dbToLevel(s.metering)); }
      // C1+I2 fix: read stateRef (not stale `state` closure); I2 guard: only fire when still 'recording'
      else if (s && s.isDoneRecording !== true && stateRef.current === 'recording') { void onInterrupted(); }
    });
    await rec.startAsync();
    recRef.current = rec; goto('recording');
  }
  async function finalize(): Promise<Part | null> {
    const rec = recRef.current; if (!rec) return null;
    try { await rec.stopAndUnloadAsync(); } catch {}
    const tmp = rec.getURI() ?? ''; recRef.current = null;
    if (!tmp) return null;
    const uri = await moveToPart(sessionId, partsRef.current.length, tmp);  // persist out of temp cache
    const part = { uri, durationMs };
    partsRef.current = [...partsRef.current, part]; setParts(partsRef.current);
    return part;
  }
  async function onInterrupted() { await finalize(); setWasInterrupted(true); setMeteringLevel(0); goto('paused'); }

  async function start() {
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) throw new Error('需要麥克風權限');
    partsRef.current = []; setParts([]); setWasInterrupted(false);
    await beginPart();
  }
  // I2 fix: set state BEFORE awaiting expo-av so the status-update callback sees the new state
  async function pause() { goto('paused'); await recRef.current?.pauseAsync(); }
  async function resume() {
    if (wasInterrupted) { setWasInterrupted(false); await beginPart(); }   // interrupted → new part
    else { await recRef.current?.startAsync(); goto('recording'); }         // manual → same part
  }
  // I2 fix: goto('stopped') before finalize so callback won't misclassify the stop-emitted status
  async function stop() { goto('stopped'); await finalize(); setMeteringLevel(0); return partsRef.current; }
  return { state, durationMs, meteringLevel, parts, wasInterrupted, start, pause, resume, stop };
}
