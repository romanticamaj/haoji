import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import {
  Waveform,
  type IWaveformRef,
  type PlaybackSpeedType,
  FinishMode,
  PlayerState,
  useAudioPlayer,
} from '@simform_solutions/react-native-audio-waveform';
import { resolvePartUri, partExists } from '../lib/recordings';
import { mmss } from '../lib/transcript';
import { colors, radius, tabularNums } from '../lib/theme';
import { SKIP_BACK_MS, SKIP_FWD_MS, clamp, skipTo, nextSpeed, formatSpeed, locatePart } from '../lib/player';
import { IconPlay, IconPause, IconRewind, IconForward, IconAlert } from '../components/icons';

type Part = { uri: string; durationMs: number };

// Imperative handle the transcript uses to jump the player: given a GLOBAL meeting time (ms), find the
// right part + offset and play from there. Exposed via forwardRef; see ResultsScreen wiring.
export type RecordingsHandle = { seekToGlobal(globalMs: number): void };

// What each row registers with the list: stop (used when another row starts) + playFrom (seek to an
// offset within this part and start playing). Richer than the raw waveform ref so a transcript tap can
// drive the row through its own play logic (keeps `playing`/startedRef in sync — no state desync).
type RowHandle = { stop: () => void; playFrom: (offsetMs: number) => void };

// The audio player is the native `react-native-audio-waveform` static Waveform: it extracts the REAL
// waveform from each part's file, renders it full-width, and owns play/pause + drag-to-scrub seeking
// with an accurate playhead (this replaced the hand-rolled nitro-sound player, whose fake bars never
// lined up and whose seek jumped back to the head). Each part is one Waveform instance keyed by its
// internal `PlayerFor${path}` key. We coordinate across rows so only one plays at a time.
const RecordingsList = forwardRef<RecordingsHandle, { parts: Part[]; onProgress?: (globalMs: number) => void }>(
  function RecordingsList({ parts, onProgress }, ref,
) {
  const rowRefs = useRef<Map<number, RowHandle>>(new Map());
  // Live-measured part durations (index → ms), reported by rows as they load/play. Seeds the
  // global→part mapping for tap-to-seek; falls back to the stored durationMs when a part hasn't
  // played yet. A ref (not state) so seekToGlobal reads the latest without re-rendering the list.
  const liveDur = useRef<Record<number, number>>({});
  const { stopAllPlayers } = useAudioPlayer();

  // Reset when the session's parts change (navigating to a different meeting) or on unmount, so no
  // audio keeps playing from another session. The signature keys on the actual part uris.
  const sig = parts.map((p) => p.uri).join('|');
  useEffect(() => {
    liveDur.current = {};
    return () => { void stopAllPlayers(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const register = (i: number, handle: RowHandle | null) => {
    if (handle) rowRefs.current.set(i, handle); else rowRefs.current.delete(i);
  };
  // Before a row starts playing, stop every OTHER row (keeps this row's own prepared position intact).
  const stopOthers = (keep: number) => {
    rowRefs.current.forEach((h, i) => { if (i !== keep) h.stop(); });
  };
  const reportDuration = (i: number, ms: number) => { if (ms > 0) liveDur.current[i] = ms; };
  // Cumulative start (ms) of a part in the whole-meeting timeline = sum of earlier parts' durations.
  const partStart = (i: number) => {
    let acc = 0;
    for (let k = 0; k < i; k++) acc += liveDur.current[k] || parts[k].durationMs || 0;
    return acc;
  };
  // A playing row's local progress → global playhead (for the transcript's follow-along highlight).
  const reportProgress = (i: number, cur: number) => { onProgress?.(partStart(i) + cur); };

  // Transcript tap → jump here. Translate the global meeting time to (part, offset) and drive that row.
  useImperativeHandle(ref, () => ({
    seekToGlobal(globalMs: number) {
      const durations = parts.map((p, i) => liveDur.current[i] || p.durationMs || 0);
      const { part, offsetMs } = locatePart(globalMs, durations);
      rowRefs.current.get(part)?.playFrom(offsetMs);
    },
  }), [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  if (parts.length === 0) return null;
  return (
    <View style={styles.container}>
      {parts.map((part, i) => (
        <PlayerRow
          key={part.uri}
          index={i}
          storedUri={part.uri}
          storedMs={part.durationMs}
          multi={parts.length > 1}
          register={register}
          stopOthers={stopOthers}
          reportDuration={reportDuration}
          reportProgress={reportProgress}
        />
      ))}
    </View>
  );
});

// Memoised so the transcript's per-tick playhead updates (ResultsScreen re-renders) don't churn the
// native waveform tree — parts is memoised and onProgress/ref are stable, so this genuinely skips.
export default React.memo(RecordingsList);

function PlayerRow(
  { index, storedUri, storedMs, multi, register, stopOthers, reportDuration, reportProgress }:
  {
    index: number; storedUri: string; storedMs: number; multi: boolean;
    register: (i: number, handle: RowHandle | null) => void;
    stopOthers: (keep: number) => void;
    reportDuration: (i: number, ms: number) => void;
    reportProgress: (i: number, cur: number) => void;
  },
) {
  const ref = useRef<IWaveformRef>(null);
  const { seekToPlayer } = useAudioPlayer();
  // The library wants a bare filesystem path (its iOS side does URL(string:) and fails on a file://
  // prefix). resolvePartUri anchors the stored RELATIVE path at the current Documents dir.
  const path = resolvePartUri(storedUri).replace(/^file:\/\//, '');
  const playerKey = `PlayerFor${path}`;

  // `playing` drives the play/pause icon and is set OPTIMISTICALLY on tap (the library's
  // onPlayerStateChange can lag or not fire for ref-driven start), then reconciled from the callback.
  // startedRef decides resume-vs-start so a pause→play continues instead of restarting from 0.
  const [playing, setPlaying] = useState(false);
  const startedRef = useRef(false);
  const [progressMs, setProgressMs] = useState(0);
  const [durationMs, setDurationMs] = useState(storedMs);
  const [speed, setSpeed] = useState<PlaybackSpeedType>(1.0);
  // The file is present but the library couldn't extract/play it (bad codec, 0 bytes, truncated) →
  // the Waveform onError fires. We surface a hint instead of leaving a blank waveform area.
  const [failed, setFailed] = useState(false);

  // Verify the audio file still exists (the OS can clear it). While unknown we hold off rendering the
  // Waveform (extraction would error on a missing path); if it's gone we show a clear notice.
  const [exists, setExists] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    partExists(storedUri).then((ok) => { if (alive) setExists(ok); });
    return () => { alive = false; };
  }, [storedUri]);

  // Register this row's control handle with the list: stop() when another row starts, and playFrom()
  // when a transcript tap jumps here. Re-registers once the waveform mounts (exists === true) so
  // playFrom's ref.current points at a live player. playFrom goes through this row's own state
  // (startedRef/playing) so a later tap on the play button resumes/pauses correctly (no desync).
  useEffect(() => {
    const handle: RowHandle = {
      stop: () => { setPlaying(false); void ref.current?.stopPlayer(); },
      playFrom: async (offsetMs: number) => {
        stopOthers(index);
        const target = Math.max(0, Math.round(offsetMs));
        startedRef.current = true;
        setProgressMs(target);
        setPlaying(true);
        await ref.current?.startPlayer({ finishMode: FinishMode.stop });
        try { await seekToPlayer({ playerKey, progress: target }); } catch { /* not prepared yet */ }
      },
    };
    register(index, handle);
    return () => register(index, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, exists]);

  const isPlaying = playing;
  const total = durationMs > 0 ? durationMs : storedMs;
  const totalKnown = total > 0;

  const onTogglePlay = async () => {
    if (playing) { setPlaying(false); await ref.current?.pausePlayer(); return; }
    stopOthers(index);
    setPlaying(true);
    if (startedRef.current) await ref.current?.resumePlayer();
    else { startedRef.current = true; await ref.current?.startPlayer({ finishMode: FinishMode.stop }); }
  };

  const onSkip = async (delta: number) => {
    const target = skipTo(progressMs, delta, total);
    setProgressMs(target); // optimistic — the native seek confirms via onCurrentProgressChange
    try { await seekToPlayer({ playerKey, progress: target }); } catch { /* not prepared yet */ }
  };

  const onCycleSpeed = () => setSpeed((s) => nextSpeed(s) as PlaybackSpeedType);

  // The audio can't be played — either the file is gone (cleared by the OS) or it's present but
  // unreadable (bad codec / truncated). Show a clear iconed notice instead of a blank waveform.
  if (exists === false || failed) {
    const gone = exists === false;
    return (
      <View style={[styles.card, styles.missingCard]}>
        {multi && <Text style={styles.segLabel}>段 {index + 1}</Text>}
        <View style={styles.missingRow}>
          <IconAlert size={22} color={colors.brand} strokeWidth={1.9} />
          <View style={styles.missingTextWrap}>
            <Text style={styles.missingTitle}>{gone ? '音檔不存在' : '音檔無法播放'}</Text>
            <Text style={styles.missingHint}>
              {gone ? '這段錄音已無法播放，檔案可能已被系統清除。' : '這段錄音的格式可能不支援，或檔案已損毀。'}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  const posClamped = clamp(progressMs, 0, totalKnown ? total : progressMs);

  return (
    <View style={styles.card}>
      {multi && (
        <View style={styles.segHead}>
          <Text style={styles.segLabel}>段 {index + 1}</Text>
          <Text style={[styles.segDur, tabularNums]}>{storedMs > 0 ? mmss(storedMs / 1000) : '--:--'}</Text>
        </View>
      )}

      {/* Real waveform, full-width, drag anywhere to scrub. brand = played, neutral = unplayed. */}
      {exists === true && (
        <Waveform
          mode="static"
          ref={ref}
          path={path}
          candleSpace={2}
          candleWidth={3}
          candleHeightScale={5}
          waveColor={colors.neutralSoft}
          scrubColor={colors.brand}
          playbackSpeed={speed}
          containerStyle={styles.wave}
          onPlayerStateChange={(s: PlayerState) => {
            if (s === PlayerState.stopped) { startedRef.current = false; setPlaying(false); }
            else if (s === PlayerState.playing) setPlaying(true);
            else if (s === PlayerState.paused) setPlaying(false);
          }}
          onCurrentProgressChange={(cur: number, dur: number) => {
            setProgressMs(cur);
            reportProgress(index, cur);
            if (dur > 0) { setDurationMs(dur); reportDuration(index, dur); }
            // Reached the end (FinishMode.stop resets the native player to 0) → reflect it in the UI.
            if (dur > 0 && cur >= dur) { startedRef.current = false; setPlaying(false); }
          }}
          onError={() => setFailed(true)}
        />
      )}

      {/* live timecode */}
      <View style={styles.times}>
        <Text style={[styles.timeText, tabularNums]}>{mmss(posClamped / 1000)}</Text>
        <Text style={[styles.timeText, tabularNums]}>{totalKnown ? mmss(total / 1000) : '--:--'}</Text>
      </View>

      {/* transport — play centered, ⏪15/⏩30 flanking, speed pinned to the left (no empty balancer) */}
      <View style={styles.transport}>
        <Pressable onPress={onCycleSpeed} style={styles.speedBtn} accessibilityLabel={`播放速度 ${formatSpeed(speed)}`}>
          <Text style={[styles.speedText, tabularNums]}>{formatSpeed(speed)}</Text>
        </Pressable>

        <View style={styles.cluster}>
          <Pressable onPress={() => onSkip(-SKIP_BACK_MS)} style={styles.skip} accessibilityLabel="倒退 15 秒">
            <IconRewind size={38} color={colors.ink} strokeWidth={1.7} />
            <View style={styles.skipNumWrap} pointerEvents="none"><Text style={[styles.skipNum, tabularNums]}>15</Text></View>
          </Pressable>

          <Pressable
            testID={`play-${index}`}
            onPress={onTogglePlay}
            style={styles.play}
            accessibilityLabel={isPlaying ? '暫停' : '播放'}
          >
            {isPlaying ? <IconPause size={26} color="#fff" /> : <IconPlay size={26} color="#fff" />}
          </Pressable>

          <Pressable onPress={() => onSkip(SKIP_FWD_MS)} style={styles.skip} accessibilityLabel="快進 30 秒">
            <IconForward size={38} color={colors.ink} strokeWidth={1.7} />
            <View style={styles.skipNumWrap} pointerEvents="none"><Text style={[styles.skipNum, tabularNums]}>30</Text></View>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, backgroundColor: colors.paper },
  card: {
    backgroundColor: colors.card, borderRadius: radius.card, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16,
    marginBottom: 10,
  },
  segHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  segLabel: { fontSize: 13, fontWeight: '700', color: colors.ink },
  segDur: { fontSize: 12.5, color: colors.ink3, marginLeft: 'auto' },

  missingCard: { paddingVertical: 16 },
  missingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  missingTextWrap: { flex: 1 },
  missingTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  missingHint: { fontSize: 12.5, color: colors.ink3, marginTop: 2, lineHeight: 17 },

  wave: { height: 64, marginTop: 12, marginBottom: 6, width: '100%' },

  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  timeText: { fontSize: 12.5, color: colors.ink2, fontWeight: '500' },

  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 16, minHeight: 66, position: 'relative' },
  speedBtn: { position: 'absolute', left: 0, top: 16, width: 46, height: 34, borderRadius: 9, backgroundColor: colors.chipBg, alignItems: 'center', justifyContent: 'center' },
  speedText: { fontSize: 13, fontWeight: '700', color: colors.ink2 },
  cluster: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  skip: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  skipNumWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  skipNum: { fontSize: 11, fontWeight: '700', color: colors.ink },
  play: {
    width: 66, height: 66, borderRadius: 33, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center',
    // No colored drop shadow: on iOS a tinted shadow rasterizes as a solid black block for a few
    // frames during the native screen transition (the "按鈕變黑" flash). The brand fill reads fine
    // without it.
  },
});
