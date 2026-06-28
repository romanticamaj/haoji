import { useRef, useState } from 'react';
import { Audio } from 'expo-av';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';
export type RecorderApi = {
  state: RecorderState; durationMs: number; meteringLevel: number;
  start(): Promise<void>; pause(): Promise<void>; resume(): Promise<void>;
  stop(): Promise<{ uri: string; name: string; mime: string } | null>;
};

const dbToLevel = (db?: number) => {
  if (db == null) return 0;
  const clamped = Math.max(-60, Math.min(0, db));
  return (clamped + 60) / 60;
};

export function useRecorder(): RecorderApi {
  const recRef = useRef<Audio.Recording | null>(null);
  const [state, setState] = useState<RecorderState>('idle');
  const [durationMs, setDurationMs] = useState(0);
  const [meteringLevel, setMeteringLevel] = useState(0);

  async function start() {
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) throw new Error('需要麥克風權限');
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true } as any);
    const rec = new Audio.Recording();
    const opts: any = { ...(Audio as any).RecordingOptionsPresets.HIGH_QUALITY, isMeteringEnabled: true };
    await rec.prepareToRecordAsync(opts);
    rec.setOnRecordingStatusUpdate((s: any) => {
      if (s?.isRecording) { setDurationMs(s.durationMillis ?? 0); setMeteringLevel(dbToLevel(s.metering)); }
    });
    await rec.startAsync();
    recRef.current = rec;
    setState('recording');
  }
  async function pause() { await recRef.current?.pauseAsync(); setState('paused'); }
  async function resume() { await recRef.current?.startAsync(); setState('recording'); }
  async function stop() {
    const rec = recRef.current;
    if (!rec) return null;
    await rec.stopAndUnloadAsync();
    const uri = rec.getURI() ?? '';
    recRef.current = null;
    setState('stopped'); setMeteringLevel(0);
    return uri ? { uri, name: `recording-${durationMs}.m4a`, mime: 'audio/mp4' } : null;
  }
  return { state, durationMs, meteringLevel, start, pause, resume, stop };
}
