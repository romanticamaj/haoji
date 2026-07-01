import { useRef, useState, useEffect } from 'react';
import Sound from 'react-native-nitro-sound';

export type PlayerApi = { positionMs: number; isPlaying: boolean;
  load(uri: string): Promise<void>; seek(ms: number): Promise<void>;
  toggle(): Promise<void>; unload(): Promise<void>; };

// react-native-nitro-sound is a singleton (one shared native player). We track our own
// "started" flag because startPlayer begins playback and resumePlayer continues a paused one.
export function usePlayer(): PlayerApi {
  const uriRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const [positionMs, setPositionMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  async function load(uri: string) {
    await unload();
    uriRef.current = uri;
  }
  async function seek(ms: number) {
    if (!startedRef.current) return; // no active player yet — no-op
    await Sound.seekToPlayer(ms);
  }
  async function toggle() {
    const uri = uriRef.current; if (!uri) return;
    if (isPlaying) { await Sound.pausePlayer(); setIsPlaying(false); return; }
    if (!startedRef.current) {
      await Sound.startPlayer(uri);
      startedRef.current = true;
      Sound.addPlayBackListener((e: any) => {
        setPositionMs(e.currentPosition ?? 0);
        if (e.duration && e.currentPosition >= e.duration) {
          // reached the end — reset so the next toggle replays from the start
          startedRef.current = false; setIsPlaying(false); setPositionMs(0);
        }
      });
    } else {
      await Sound.resumePlayer();
    }
    setIsPlaying(true);
  }
  async function unload() {
    if (startedRef.current) { await Sound.stopPlayer(); Sound.removePlayBackListener(); }
    startedRef.current = false; uriRef.current = null; setIsPlaying(false); setPositionMs(0);
  }
  useEffect(() => () => { void unload(); }, []);
  return { positionMs, isPlaying, load, seek, toggle, unload };
}
