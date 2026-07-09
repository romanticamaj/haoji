import { useRef, useState, useEffect } from 'react';
import Sound from 'react-native-nitro-sound';

export type PlayerApi = { positionMs: number; durationMs: number; isPlaying: boolean;
  load(uri: string): Promise<void>; seek(ms: number): Promise<void>;
  toggle(): Promise<void>; setSpeed(rate: number): Promise<void>; unload(): Promise<void>; };

// react-native-nitro-sound is a singleton (one shared native player). We track our own
// "started" flag because startPlayer begins playback and resumePlayer continues a paused one.
export function usePlayer(): PlayerApi {
  const uriRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const speedRef = useRef(1);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  async function load(uri: string) {
    await unload();
    uriRef.current = uri;
  }
  async function seek(ms: number) {
    if (!startedRef.current) return; // no active player yet — no-op
    await Sound.seekToPlayer(ms);
    setPositionMs(ms);
  }
  async function setSpeed(rate: number) {
    speedRef.current = rate;
    // setPlaybackSpeed only takes effect on an active player; applied on start below otherwise.
    if (startedRef.current) await Sound.setPlaybackSpeed(rate);
  }
  async function toggle() {
    const uri = uriRef.current; if (!uri) return;
    if (isPlaying) { await Sound.pausePlayer(); setIsPlaying(false); return; }
    if (!startedRef.current) {
      await Sound.startPlayer(uri);
      startedRef.current = true;
      if (speedRef.current !== 1) await Sound.setPlaybackSpeed(speedRef.current);
      Sound.addPlayBackListener((e: any) => {
        setPositionMs(e.currentPosition ?? 0);
        if (e.duration) setDurationMs(e.duration);
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
    startedRef.current = false; uriRef.current = null;
    setIsPlaying(false); setPositionMs(0); setDurationMs(0);
  }
  useEffect(() => () => { void unload(); }, []);
  return { positionMs, durationMs, isPlaying, load, seek, toggle, setSpeed, unload };
}
