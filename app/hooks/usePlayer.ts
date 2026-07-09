import { useRef, useState, useEffect } from 'react';
import Sound from 'react-native-nitro-sound';

// One player, one active track. `react-native-nitro-sound` is a SINGLETON native player, so having a
// usePlayer per row racing over it caused cross-track/cross-session state bleed. This hook owns the
// single player and exposes an `activeUri` — callers pass the uri they act on, and the hook makes it
// active (stopping any other) before playing/seeking. Position is committed state (survives pause and
// works before playback starts via a pending-seek), so the on-screen playhead always matches reality.
export type PlayerApi = {
  activeUri: string | null;
  positionMs: number;
  durationMs: number;
  isPlaying: boolean;
  toggle(uri: string): Promise<void>;
  seek(uri: string, ms: number): Promise<void>;
  setSpeed(uri: string, rate: number): Promise<void>;
  reset(): Promise<void>;
};

export function usePlayer(): PlayerApi {
  const uriRef = useRef<string | null>(null);
  const startedRef = useRef(false);      // a native player has been started for the active uri
  const playingRef = useRef(false);      // sync mirror of isPlaying for toggle() decisions
  const pendingSeekRef = useRef<number | null>(null); // seek target to apply on the next start
  const speedRef = useRef(1);
  const [activeUri, setActiveUri] = useState<string | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  function setPlaying(v: boolean) { playingRef.current = v; setIsPlaying(v); }

  async function stopNative() {
    if (startedRef.current) {
      try { await Sound.stopPlayer(); } catch { /* already stopped */ }
      Sound.removePlayBackListener();
    }
    startedRef.current = false;
  }

  // Full stop + clear. Used on unmount and when the session's parts change (no carry-over).
  async function reset() {
    await stopNative();
    uriRef.current = null; pendingSeekRef.current = null; speedRef.current = 1;
    setActiveUri(null); setPlaying(false); setPositionMs(0); setDurationMs(0);
  }

  // Make `uri` the active track, starting at 0. Stops whatever was playing. No-op if already active,
  // so seeking/toggling the current track doesn't reset its position.
  async function select(uri: string) {
    if (uriRef.current === uri) return;
    await stopNative();
    uriRef.current = uri; pendingSeekRef.current = null;
    setActiveUri(uri); setPlaying(false); setPositionMs(0); setDurationMs(0);
  }

  function attachListener() {
    Sound.addPlayBackListener((e: any) => {
      setPositionMs(e.currentPosition ?? 0);
      if (e.duration) setDurationMs(e.duration);
      if (e.duration && e.currentPosition >= e.duration) void onEnd();
    });
  }

  async function onEnd() {
    await stopNative();
    pendingSeekRef.current = 0;      // next play restarts from the top
    setPlaying(false); setPositionMs(0);
  }

  async function toggle(uri: string) {
    await select(uri);
    if (playingRef.current) { await Sound.pausePlayer(); setPlaying(false); return; }
    if (!startedRef.current) {
      await Sound.startPlayer(uri);
      startedRef.current = true;
      if (speedRef.current !== 1) await Sound.setPlaybackSpeed(speedRef.current);
      if (pendingSeekRef.current != null) { await Sound.seekToPlayer(pendingSeekRef.current); pendingSeekRef.current = null; }
      attachListener();
    } else {
      await Sound.resumePlayer();
    }
    setPlaying(true);
  }

  // Seek the given track. Updates the on-screen position IMMEDIATELY (even before playback has
  // started or while paused); if no native player is active yet the target is applied on next start.
  async function seek(uri: string, ms: number) {
    await select(uri);
    const clamped = Math.max(0, ms);
    setPositionMs(clamped);
    if (startedRef.current) await Sound.seekToPlayer(clamped);
    else pendingSeekRef.current = clamped;
  }

  async function setSpeed(uri: string, rate: number) {
    await select(uri);
    speedRef.current = rate;
    if (startedRef.current) await Sound.setPlaybackSpeed(rate); // takes effect immediately while playing
  }

  useEffect(() => () => { void reset(); }, []);
  return { activeUri, positionMs, durationMs, isPlaying, toggle, seek, setSpeed, reset };
}
