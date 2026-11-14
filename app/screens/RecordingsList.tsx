import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { AppText } from '../components/AppText';
import {
  Waveform,
  type IWaveformRef,
  type PlaybackSpeedType,
  FinishMode,
  PlayerState,
  useAudioPlayer,
} from '@simform_solutions/react-native-audio-waveform';
import Share from 'react-native-share';
import { resolvePartUri, partExists } from '../lib/recordings';
import { mmss } from '../lib/transcript';
import { colors, layout, radius, spacing, tabularNums } from '../lib/theme';
import { SKIP_BACK_MS, SKIP_FWD_MS, clamp, skipTo, nextSpeed, formatSpeed, locatePart } from '../lib/player';
import { IconPlay, IconPause, IconRewind, IconForward, IconAlert, IconShare } from '../components/icons';

type Part = { uri: string; durationMs: number };

// Imperative handle the transcript uses to jump the player: given a GLOBAL meeting time (ms), find the
// right part + offset and play from there. Exposed via forwardRef; see ResultsScreen wiring.
export type RecordingsHandle = {
  seekToGlobal(globalMs: number): void;
  /** Play/pause from outside (the Results mini player): pauses whatever plays, else plays the last-used part. */
  toggle(): void;
  /** Next playback speed, applied to every part. */
  cycleSpeed(): void;
};

/** What the docked mini player needs to draw itself. Position comes through onProgress. */
export type PlayerStatus = { playing: boolean; totalMs: number; speed: number };

// What each row registers with the list: stop (used when another row starts) + playFrom (seek to an
// offset within this part and start playing) + toggle (its own play/pause button). Richer than the raw
// waveform ref so outside callers drive the row through its own play logic (keeps `playing`/startedRef
// in sync — no state desync).
type RowHandle = { stop: () => void; playFrom: (offsetMs: number) => void; toggle: () => void };

// Export the raw recording out to another app (Files, AirDrop, Messages…). Each part is shared as a
// file:// url the OS share sheet can read; several parts of one meeting go out together.
export async function exportParts(parts: Part[]): Promise<void> {
  if (parts.length === 0) return;
  const urls = parts.map((p) => resolvePartUri(p.uri));
  const type = parts.every((p) => p.uri.endsWith('.wav')) ? 'audio/wav' : 'audio/m4a';
  try {
    await Share.open({ urls, type, failOnCancel: false });
  } catch { /* user dismissed the share sheet — not an error */ }
}

// The audio player is the native `react-native-audio-waveform` static Waveform: it extracts the REAL
// waveform from each part's file, renders it full-width, and owns play/pause + drag-to-scrub seeking
// with an accurate playhead (this replaced the hand-rolled nitro-sound player, whose fake bars never
// lined up and whose seek jumped back to the head). Each part is one Waveform instance keyed by its
// internal `PlayerFor${path}` key. We coordinate across rows so only one plays at a time.
const RecordingsList = forwardRef<RecordingsHandle, {
  parts: Part[];
  onProgress?: (globalMs: number) => void;
  onState?: (s: PlayerStatus) => void;
  /** The in-card 匯出錄音 link; Results turns it off because its `…` menu carries the action. */
  showExport?: boolean;
}>(
  function RecordingsList({ parts, onProgress, onState, showExport = true }, ref,
) {
  const rowRefs = useRef<Map<number, RowHandle>>(new Map());
  // Live-measured part durations (index → ms), reported by rows as they load/play. Seeds the
  // global→part mapping for tap-to-seek; falls back to the stored durationMs when a part hasn't
  // played yet. A ref (not state) so seekToGlobal reads the latest without re-rendering the list.
  const liveDur = useRef<Record<number, number>>({});
  const { stopAllPlayers } = useAudioPlayer();
  // One speed for the whole meeting: a mini player can't show three different ones.
  const [speed, setSpeed] = useState<PlaybackSpeedType>(1.0);
  // Which rows are playing, and the part the outside play button should resume.
  const playingRows = useRef<Set<number>>(new Set());
  const activeRow = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [durTick, setDurTick] = useState(0);   // bumps when a live duration lands → totalMs recomputes

  // Reset when the session's parts change (navigating to a different meeting) or on unmount, so no
  // audio keeps playing from another session. The signature keys on the actual part uris.
  const sig = parts.map((p) => p.uri).join('|');
  useEffect(() => {
    liveDur.current = {};
    playingRows.current.clear();
    activeRow.current = 0;
    return () => { void stopAllPlayers(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const register = (i: number, handle: RowHandle | null) => {
    if (handle) rowRefs.current.set(i, handle); else rowRefs.current.delete(i);
  };
  // Before a row starts playing, stop every OTHER row (keeps this row's own prepared position intact).
  const stopOthers = (keep: number) => {
    activeRow.current = keep;
    rowRefs.current.forEach((h, i) => { if (i !== keep) h.stop(); });
  };
  const reportPlaying = (i: number, on: boolean) => {
    if (on) { playingRows.current.add(i); activeRow.current = i; } else playingRows.current.delete(i);
    setPlaying(playingRows.current.size > 0);
  };
  const reportDuration = (i: number, ms: number) => {
    if (ms > 0 && liveDur.current[i] !== ms) { liveDur.current[i] = ms; setDurTick((t) => t + 1); }
  };

  const totalMs = parts.reduce((acc, p, i) => acc + (liveDur.current[i] || p.durationMs || 0), 0);
  useEffect(() => { onState?.({ playing, totalMs, speed }); }, [playing, totalMs, speed, durTick]); // eslint-disable-line react-hooks/exhaustive-deps
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
    toggle() {
      const [on] = Array.from(playingRows.current);
      rowRefs.current.get(on ?? activeRow.current)?.toggle();
    },
    cycleSpeed() { setSpeed((s) => nextSpeed(s) as PlaybackSpeedType); },
  }), [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const onExport = () => exportParts(parts);

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
          reportPlaying={reportPlaying}
          speed={speed}
          onCycleSpeed={() => setSpeed((s) => nextSpeed(s) as PlaybackSpeedType)}
        />
      ))}
      {showExport && <Pressable
        style={({ pressed }) => [styles.exportBtn, pressed && styles.pressedIcon]}
        onPress={onExport}
        accessibilityRole="button"
        accessibilityLabel="匯出錄音"
        hitSlop={8}
      >
        <IconShare size={16} color={colors.primaryDark} />
        <AppText variant="cardTitle" color="primaryDark">匯出錄音</AppText>
      </Pressable>}
    </View>
  );
});

// Memoised so the transcript's per-tick playhead updates (ResultsScreen re-renders) don't churn the
// native waveform tree — parts is memoised and onProgress/ref are stable, so this genuinely skips.
export default React.memo(RecordingsList);

function PlayerRow(
  { index, storedUri, storedMs, multi, register, stopOthers, reportDuration, reportProgress, reportPlaying, speed, onCycleSpeed }:
  {
    index: number; storedUri: string; storedMs: number; multi: boolean;
    register: (i: number, handle: RowHandle | null) => void;
    stopOthers: (keep: number) => void;
    reportDuration: (i: number, ms: number) => void;
    reportProgress: (i: number, cur: number) => void;
    reportPlaying: (i: number, on: boolean) => void;
    speed: PlaybackSpeedType;
    onCycleSpeed: () => void;
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
      toggle: () => { void toggleRef.current(); },
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

  // The handle is registered once per mount, so it reaches the CURRENT toggle through a ref rather
  // than a stale closure over `playing`.
  const toggleRef = useRef(onTogglePlay);
  toggleRef.current = onTogglePlay;
  // Tell the list (and through it the mini player) whenever this row starts or stops.
  useEffect(() => { reportPlaying(index, playing); }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => reportPlaying(index, false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const onSkip = async (delta: number) => {
    const target = skipTo(progressMs, delta, total);
    setProgressMs(target); // optimistic — the native seek confirms via onCurrentProgressChange
    try { await seekToPlayer({ playerKey, progress: target }); } catch { /* not prepared yet */ }
  };

  // The audio can't be played — either the file is gone (cleared by the OS) or it's present but
  // unreadable (bad codec / truncated). Show a clear iconed notice instead of a blank waveform.
  if (exists === false || failed) {
    const gone = exists === false;
    // An .m4a that won't open is either a pre-WAV recording killed mid-capture (its moov index was
    // never written, so nothing can read it) or an import we couldn't extract audio from. Those need
    // different things from the user, and we can't tell them apart from here — so say what is
    // actually known instead of asserting the wrong one. New recordings are WAV and self-repair.
    const legacyBroken = !gone && storedUri.endsWith('.m4a');
    return (
      <View style={[styles.card, styles.missingCard]}>
        {multi && <AppText variant="cardTitle" color="heading" style={styles.segLabel}>段 {index + 1}</AppText>}
        <View style={styles.missingRow}>
          <IconAlert size={22} color={colors.danger} />
          <View style={styles.missingTextWrap}>
            <AppText variant="cardTitle" color="heading" style={styles.segLabel}>{gone ? '音檔不存在' : '音檔無法播放'}</AppText>
            <AppText variant="small" color="muted">
              {gone
                ? '這段錄音的檔案已經不在手機上，可能被系統清掉了。'
                : legacyBroken
                  ? '這個檔案沒辦法在手機上播放。可能是錄音中斷時留下的舊格式檔案（無法修復），也可能是匯入的影片取不出聲音；後者還是可以生成逐字稿。'
                  : '這段錄音的格式可能不支援，或檔案已經損壞。'}
            </AppText>
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
          <AppText variant="cardTitle" color="heading" style={styles.segLabel}>段 {index + 1}</AppText>
          <AppText variant="small" color="muted" style={[styles.segDur, tabularNums]}>{storedMs > 0 ? mmss(storedMs / 1000) : '--:--'}</AppText>
        </View>
      )}

      {/* Real waveform, full-width, drag anywhere to scrub. sage = played, outline = unplayed. */}
      {exists === true && (
        <Waveform
          mode="static"
          ref={ref}
          path={path}
          candleSpace={2}
          candleWidth={3}
          candleHeightScale={5}
          waveColor={colors.outline}
          scrubColor={colors.primary}
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
        <AppText variant="small" color="muted" style={tabularNums}>{mmss(posClamped / 1000)}</AppText>
        <AppText variant="small" color="muted" style={tabularNums}>{totalKnown ? mmss(total / 1000) : '--:--'}</AppText>
      </View>

      {/* transport — play centered, ⏪15/⏩30 flanking, speed pinned to the left (no empty balancer) */}
      <View style={styles.transport}>
        <Pressable
          onPress={onCycleSpeed}
          style={({ pressed }) => [styles.speedBtn, pressed && styles.pressedRow]}
          accessibilityRole="button"
          accessibilityLabel={`播放速度 ${formatSpeed(speed)}`}
        >
          <AppText variant="cardTitle" color="heading" style={tabularNums}>{formatSpeed(speed)}</AppText>
        </Pressable>

        <View style={styles.cluster}>
          <Pressable
            onPress={() => onSkip(-SKIP_BACK_MS)}
            style={({ pressed }) => [styles.skip, pressed && styles.pressedIcon]}
            accessibilityRole="button"
            accessibilityLabel="倒退 15 秒"
          >
            <IconRewind size={36} color={colors.muted} />
            <View style={styles.skipNumWrap} pointerEvents="none"><AppText variant="small" color="muted" style={[styles.skipNum, tabularNums]}>15</AppText></View>
          </Pressable>

          <Pressable
            testID={`play-${index}`}
            onPress={onTogglePlay}
            style={({ pressed }) => [styles.play, pressed && styles.pressedFill]}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? '暫停' : '播放'}
          >
            {isPlaying ? <IconPause size={24} color={colors.onPrimary} /> : <IconPlay size={24} color={colors.onPrimary} />}
          </Pressable>

          <Pressable
            onPress={() => onSkip(SKIP_FWD_MS)}
            style={({ pressed }) => [styles.skip, pressed && styles.pressedIcon]}
            accessibilityRole="button"
            accessibilityLabel="快進 30 秒"
          >
            <IconForward size={36} color={colors.muted} />
            <View style={styles.skipNumWrap} pointerEvents="none"><AppText variant="small" color="muted" style={[styles.skipNum, tabularNums]}>30</AppText></View>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: layout.screenPaddingH, paddingTop: spacing.sm, paddingBottom: spacing.xs, backgroundColor: colors.background },
  exportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, alignSelf: 'center',
    minHeight: layout.minTouchTarget, paddingHorizontal: spacing.lg,
  },
  // Player card: surface + 1px outline, no shadow (GUIDELINE §7.1 Player).
  card: {
    backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: spacing.xl, paddingTop: spacing.md,
    paddingBottom: spacing.lg, marginBottom: spacing.sm, borderWidth: layout.border, borderColor: colors.outline,
  },
  segHead: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  segLabel: { fontWeight: '600' },
  segDur: { marginLeft: 'auto' },

  missingCard: { paddingVertical: spacing.lg },
  missingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs },
  missingTextWrap: { flex: 1, gap: 2 },

  wave: { height: 64, marginTop: spacing.md, marginBottom: spacing.xs, width: '100%' },

  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },

  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.md, minHeight: 56, position: 'relative' },
  // Speed is a chip (36 high, radius 18, surface + outline).
  speedBtn: {
    position: 'absolute', left: 0, top: 10, height: layout.chipHeight, minWidth: 52, paddingHorizontal: spacing.md,
    borderRadius: radius.chip, backgroundColor: colors.surface, borderWidth: layout.border, borderColor: colors.outline,
    alignItems: 'center', justifyContent: 'center',
  },
  cluster: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  skip: { width: layout.minTouchTarget + 8, height: layout.minTouchTarget + 8, alignItems: 'center', justifyContent: 'center' },
  skipNumWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  skipNum: { fontSize: 10, lineHeight: 12, fontWeight: '600' },
  // No drop shadow: a tinted shadow rasterised as a solid black block during native screen transitions.
  play: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },

  pressedFill: { opacity: 0.8 },
  pressedRow: { opacity: 0.7 },
  pressedIcon: { opacity: 0.6 },
});
