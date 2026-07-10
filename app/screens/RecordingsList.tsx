import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, PanResponder, LayoutChangeEvent, GestureResponderEvent } from 'react-native';
import { usePlayer, PlayerApi } from '../hooks/usePlayer';
import { resolvePartUri, partExists } from '../lib/recordings';
import { mmss } from '../lib/transcript';
import { colors, radius, tabularNums } from '../lib/theme';
import {
  SKIP_BACK_MS, SKIP_FWD_MS, waveformBars, barIsPlayed, xToRatio, ratioToMs, skipTo, nextSpeed, formatSpeed,
} from '../lib/player';

type Part = { uri: string; durationMs: number };

const WAVE_BARS = 48;
const BARS = waveformBars(WAVE_BARS);

export default function RecordingsList({ parts }: { parts: Part[] }) {
  // ONE player for the whole list (nitro-sound is a singleton). Rows share it and act on their own
  // uri; the player tracks which uri is active so only one row ever shows a live position.
  const player = usePlayer();

  // Reset when the session's parts change (navigating to a different meeting) so no position/waveform/
  // playing-state carries over from another session. The signature keys on the actual part uris.
  const sig = parts.map((p) => p.uri).join('|');
  useEffect(() => {
    void player.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  if (parts.length === 0) return null;
  return (
    <View style={styles.container}>
      {parts.map((part, i) => (
        <PlayerRow key={part.uri} index={i} storedMs={part.durationMs} storedUri={part.uri} uri={resolvePartUri(part.uri)} multi={parts.length > 1} player={player} />
      ))}
    </View>
  );
}

function PlayerRow(
  { index, uri, storedUri, storedMs, multi, player }:
  { index: number; uri: string; storedUri: string; storedMs: number; multi: boolean; player: PlayerApi },
) {
  const active = player.activeUri === uri;
  // Verify the audio file still exists (it can be cleared by the OS). While unknown we assume it's
  // there; if it's gone we show a clear notice instead of a dead player. null = checking.
  const [exists, setExists] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    partExists(storedUri).then((ok) => { if (alive) setExists(ok); });
    return () => { alive = false; };
  }, [storedUri]);
  const [speed, setSpeed] = useState(1);
  const [dragMs, setDragMs] = useState<number | null>(null);
  const widthRef = useRef(0);
  const dragRef = useRef<number | null>(null);
  const playerRef = useRef(player);
  playerRef.current = player;

  // Prefer the live duration reported by playback; fall back to the stored part duration. Uploaded
  // parts may have durationMs: 0, so total is only known once playback starts → render "--:--".
  const liveDuration = active && player.durationMs > 0 ? player.durationMs : storedMs;
  const totalMs = liveDuration;
  const totalKnown = totalMs > 0;
  const basePos = active ? player.positionMs : 0;
  const positionMs = dragMs ?? basePos;               // dragMs overrides while scrubbing
  const ratio = totalKnown ? Math.min(1, positionMs / totalMs) : 0;
  const isPlaying = active && player.isPlaying;

  const onTogglePlay = () => { void playerRef.current.toggle(uri); };
  const onSkip = (delta: number) => {
    const from = player.activeUri === uri ? player.positionMs : 0;
    void playerRef.current.seek(uri, skipTo(from, delta, totalMs));
  };
  const onCycleSpeed = () => {
    const next = nextSpeed(speed);
    setSpeed(next);
    void playerRef.current.setSpeed(uri, next);
  };

  // Tap AND drag to seek (core RN PanResponder — no gesture-handler). Drag updates the visible
  // playhead live via dragMs; the actual audio seek is committed once on RELEASE so it stays in sync
  // and never snaps back. A tap is a grant+release at the same x, so it seeks to that point too.
  const commitDrag = () => {
    const ms = dragRef.current;
    dragRef.current = null;
    setDragMs(null);
    if (ms != null) void playerRef.current.seek(uri, ms);
  };
  const pan = useMemo(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => totalKnown,
      onMoveShouldSetPanResponder: () => totalKnown,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        const ms = ratioToMs(xToRatio(e.nativeEvent.locationX, widthRef.current), totalMs);
        dragRef.current = ms; setDragMs(ms);
      },
      onPanResponderMove: (e: GestureResponderEvent) => {
        const ms = ratioToMs(xToRatio(e.nativeEvent.locationX, widthRef.current), totalMs);
        dragRef.current = ms; setDragMs(ms);
      },
      onPanResponderRelease: commitDrag,
      onPanResponderTerminate: commitDrag,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [totalKnown, totalMs, uri],
  );

  const onWaveLayout = (e: LayoutChangeEvent) => { widthRef.current = e.nativeEvent.layout.width; };

  // The audio file is gone (e.g. cleared by the OS) — tell the user instead of showing a dead player.
  if (exists === false) {
    return (
      <View style={[styles.card, styles.missingCard]}>
        {multi && <Text style={styles.segLabel}>段 {index + 1}</Text>}
        <View style={styles.missingRow}>
          <Text style={styles.missingIcon}>⚠️</Text>
          <View style={styles.missingTextWrap}>
            <Text style={styles.missingTitle}>音檔不存在</Text>
            <Text style={styles.missingHint}>這段錄音已無法播放，檔案可能已被系統清除。</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {multi && (
        <View style={styles.segHead}>
          <Text style={styles.segLabel}>段 {index + 1}</Text>
          <Text style={[styles.segDur, tabularNums]}>{storedMs > 0 ? mmss(storedMs / 1000) : '--:--'}</Text>
        </View>
      )}

      {/* waveform progress bar */}
      <View style={styles.wave} onLayout={onWaveLayout} {...pan.panHandlers} accessibilityLabel="播放進度，可點擊或拖曳跳轉">
        {BARS.map((h, i) => {
          const on = barIsPlayed(i, WAVE_BARS, ratio);
          return <View key={i} style={[styles.wbar, { height: `${h}%`, backgroundColor: on ? colors.brand : '#D6D6DD' }]} />;
        })}
        {totalKnown && (
          <View style={[styles.playhead, { left: `${ratio * 100}%` }]} pointerEvents="none">
            <View style={styles.playheadKnob} />
          </View>
        )}
      </View>

      {/* live timecode */}
      <View style={styles.times}>
        <Text style={[styles.timeText, tabularNums]}>{mmss(positionMs / 1000)}</Text>
        <Text style={[styles.timeText, tabularNums]}>{totalKnown ? mmss(totalMs / 1000) : '--:--'}</Text>
      </View>

      {/* transport */}
      <View style={styles.transport}>
        <Pressable onPress={onCycleSpeed} style={styles.speedBtn} accessibilityLabel={`播放速度 ${formatSpeed(speed)}`}>
          <Text style={[styles.speedText, tabularNums]}>{formatSpeed(speed)}</Text>
        </Pressable>

        <Pressable onPress={() => onSkip(-SKIP_BACK_MS)} style={styles.skip} accessibilityLabel="倒退 15 秒">
          <Text style={styles.skipArrow}>↺</Text>
          <Text style={[styles.skipNum, tabularNums]}>15</Text>
        </Pressable>

        <Pressable
          testID={`play-${index}`}
          onPress={onTogglePlay}
          style={styles.play}
          accessibilityLabel={isPlaying ? '暫停' : '播放'}
        >
          <Text style={styles.playIcon}>{isPlaying ? '❚❚' : '▶'}</Text>
        </Pressable>

        <Pressable onPress={() => onSkip(SKIP_FWD_MS)} style={styles.skip} accessibilityLabel="快進 30 秒">
          <Text style={styles.skipArrow}>↻</Text>
          <Text style={[styles.skipNum, tabularNums]}>30</Text>
        </Pressable>

        {/* spacer to balance the speed button on the left, matching the mockup's transport row */}
        <View style={styles.speedBtn} />
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
  missingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  missingIcon: { fontSize: 20 },
  missingTextWrap: { flex: 1 },
  missingTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  missingHint: { fontSize: 12.5, color: colors.ink3, marginTop: 2, lineHeight: 17 },

  wave: { height: 72, marginTop: 12, marginBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  wbar: { width: 3, borderRadius: 2, marginHorizontal: 1.25 },
  playhead: { position: 'absolute', top: 2, bottom: 2, width: 2.5, marginLeft: -1.25, backgroundColor: colors.ink, borderRadius: 2, alignItems: 'center' },
  playheadKnob: { position: 'absolute', top: -6, width: 11, height: 11, borderRadius: 6, backgroundColor: colors.ink },

  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  timeText: { fontSize: 12.5, color: colors.ink2, fontWeight: '500' },

  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
  speedBtn: { width: 44, height: 34, borderRadius: 9, backgroundColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
  speedText: { fontSize: 13, fontWeight: '700', color: colors.ink2 },
  skip: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  skipArrow: { fontSize: 40, lineHeight: 46, color: colors.ink, fontWeight: '300' },
  skipNum: { position: 'absolute', top: 21, fontSize: 11, fontWeight: '700', color: colors.ink },
  play: {
    width: 66, height: 66, borderRadius: 33, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.brand, shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 4,
  },
  playIcon: { color: '#fff', fontSize: 22, fontWeight: '700' },
});
