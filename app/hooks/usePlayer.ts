import { useRef, useState, useEffect } from 'react';
import { Audio } from 'expo-av';

export type PlayerApi = { positionMs: number; isPlaying: boolean;
  load(uri: string): Promise<void>; seek(ms: number): Promise<void>;
  toggle(): Promise<void>; unload(): Promise<void>; };

export function usePlayer(): PlayerApi {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  async function load(uri: string) {
    await unload();
    const { sound } = await Audio.Sound.createAsync({ uri });
    sound.setOnPlaybackStatusUpdate((s: any) => {
      if (s?.isLoaded) { setPositionMs(s.positionMillis ?? 0); setIsPlaying(!!s.isPlaying); }
    });
    soundRef.current = sound;
  }
  async function seek(ms: number) { await soundRef.current?.setPositionAsync(ms); }
  async function toggle() {
    const s = soundRef.current; if (!s) return;
    if (isPlaying) { await s.pauseAsync(); setIsPlaying(false); }
    else { await s.playAsync(); setIsPlaying(true); }
  }
  async function unload() { await soundRef.current?.unloadAsync(); soundRef.current = null; setIsPlaying(false); setPositionMs(0); }
  useEffect(() => () => { void unload(); }, []);
  return { positionMs, isPlaying, load, seek, toggle, unload };
}
