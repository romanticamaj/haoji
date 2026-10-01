import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Animated, PanResponder,
} from 'react-native';
import {
  Waveform, type IWaveformRef, FinishMode, PlayerState, useAudioPlayer,
} from '@simform_solutions/react-native-audio-waveform';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useStore } from '../lib/store-context';
import { moveToPart, mergeSessionParts, fsPath } from '../lib/recordings';
import { storageExtFor, isVideo } from '../lib/importMedia';
import * as audioExtract from '../lib/audioExtract';
import * as audioMerge from '../lib/audioMerge';
import {
  buildCandidates, toggle, move, selected, canMerge, canImport, totalDurationMs, ImportCandidate,
} from '../lib/importSelection';
import { mmss } from '../lib/transcript';
import { IconCheck, IconAlert, IconPlay, IconPause, IconGrip } from '../components/icons';
import { colors, radius } from '../lib/theme';

const ROW_GAP = 8;

const makeLocalId = () => `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Confirm what was picked before committing to it.
 *
 * Several picked files usually mean "these are one meeting", but not always — a pick can include the
 * wrong file, something that isn't audio at all, or recordings that shouldn't be welded together.
 * Joining is not undoable, so we show what each file actually IS (decoded, not guessed from the
 * extension) and let the user decide what to include and whether to join it.
 */
export default function ImportConfirmScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const store = useStore();
  const files: { uri: string; name: string }[] = route.params?.files ?? [];

  const [list, setList] = useState<ImportCandidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Only one preview plays at a time — otherwise checking the order turns into a mess of overlapping
  // audio. Holding it here (not per row) is what makes starting one stop the others.
  const [playingUri, setPlayingUri] = useState<string | null>(null);
  // Every row's measured height, so a drag knows how far each neighbour's slot is — rows differ (an
  // unusable file has no waveform). The list is locked while dragging so the two gestures never fight.
  const rowHeights = useRef<Record<string, number>>({});
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    (async () => {
      const probes = await audioMerge.probe(files.map((f) => fsPath(f.uri)));
      // probe answers are keyed by the decoded path we sent, so map them back onto the picked uris
      const byUri = files.map((f, i) => ({ ...probes[i], path: f.uri }));
      setList(buildCandidates(files, byUri));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function commit(merge: boolean) {
    if (!list) return;
    const chosen = selected(list);
    if (chosen.length === 0) return;
    setBusy('準備中…');

    const id = makeLocalId();
    const createdAt = Date.now();
    const title = new Date().toLocaleString();
    const parts: { uri: string; durationMs: number }[] = [];
    try {
      for (let i = 0; i < chosen.length; i++) {
        const src = chosen[i].uri;
        let rel: string;
        if (isVideo(src) && audioExtract.available) {
          setBusy(`擷取音訊中… ${i + 1}/${chosen.length}`);
          const tmp = `${require('react-native-fs').CachesDirectoryPath}/extract-${id}-${i}.m4a`;
          try {
            await audioExtract.extractAudio(fsPath(src), tmp);
            rel = await moveToPart(id, i, tmp, 'm4a');
          } catch {
            rel = await moveToPart(id, i, src, 'm4a');
          }
        } else {
          rel = await moveToPart(id, i, src, storageExtFor(src));
        }
        parts.push({ uri: rel, durationMs: chosen[i].durationMs || 0 });
      }
      await store.upsert({ id, createdAt, title, names: {}, unlocked: false, parts });

      if (merge && parts.length > 1) {
        setBusy('合併音檔中…');
        const merged = await mergeSessionParts(id, parts);
        if (merged) await store.upsert({ id, createdAt, title, names: {}, unlocked: false, parts: merged });
      }
      nav.replace('Review', { sessionId: id });
    } catch (e: any) {
      setBusy(null);
      nav.goBack();
    }
  }

  if (busy) return (
    <View style={styles.center}><ActivityIndicator size="large" color={colors.brand} /><Text style={styles.busy}>{busy}</Text></View>
  );
  if (!list) return (
    <View style={styles.center}><ActivityIndicator color={colors.brand} /><Text style={styles.busy}>檢查音檔中…</Text></View>
  );

  const usable = selected(list).length;
  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={styles.title}>確認要匯入的音檔</Text>
        <Text style={styles.sub}>
          已選 {usable}/{list.length} 個{usable > 0 ? ` · 共 ${mmss(Math.floor(totalDurationMs(list) / 1000))}` : ''}
        </Text>
        <Text style={styles.hint}>由上而下就是合併順序 · 可播放確認、按住右側 ☰ 拖曳調整</Text>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 12 }} scrollEnabled={!dragging}>
        {list.map((c, i) => (
          <CandidateRow
            key={c.uri}
            candidate={c}
            index={i}
            playingUri={playingUri}
            onPlayingChange={setPlayingUri}
            onToggle={() => setList(toggle(list, c.uri))}
            // Functional update: a drag fires several moves before React re-renders, and each must
            // apply to the list the previous one produced, not the one this render saw.
            onMove={(dir: -1 | 1) => setList((l) => l && move(l, c.uri, dir))}
            order={list.map((x) => x.uri)}
            rowHeights={rowHeights.current}
            onDragChange={setDragging}
          />
        ))}
      </ScrollView>

      <View style={styles.actions}>
        <Pressable
          style={[styles.primary, !canMerge(list) && styles.disabled]}
          disabled={!canMerge(list)}
          onPress={() => commit(true)}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>合併成一段並繼續</Text>
        </Pressable>
        <Pressable
          style={[styles.secondary, !canImport(list) && styles.disabled]}
          disabled={!canImport(list)}
          onPress={() => commit(false)}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>保持分開</Text>
        </Pressable>
        <Pressable style={styles.cancel} onPress={() => nav.goBack()} accessibilityRole="button">
          <Text style={styles.cancelText}>取消</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * One picked file: tick it, hear it, and move it. Playback matters as much as the checkbox — the list
 * order is the merge order, and the only way to know the order is right is to listen.
 */
function CandidateRow(
  { candidate: c, index, playingUri, onPlayingChange, onToggle, onMove, order, rowHeights, onDragChange }: {
    candidate: ImportCandidate;
    index: number;
    playingUri: string | null;
    onPlayingChange: (uri: string | null) => void;
    onToggle: () => void;
    onMove: (dir: -1 | 1) => void;
    order: string[];
    rowHeights: Record<string, number>;
    onDragChange: (dragging: boolean) => void;
  },
) {
  const ref = useRef<IWaveformRef>(null);
  const { stopAllPlayers } = useAudioPlayer();
  const path = fsPath(c.uri);
  const isPlaying = playingUri === c.uri;

  // Drag-to-reorder on core RN (PanResponder + Animated) — gesture-handler is incompatible with this
  // RN version, and SwipeRow already establishes this approach in the app.
  //
  // The row is reordered LIVE as the finger passes each neighbour, and `shiftPx` records how far the
  // row has already moved down the list so the lift stays under the finger instead of jumping.
  //
  // The responder is created once, so it must never read props directly — they'd be frozen at the
  // first render (which is exactly how every drag used to restart from the original order). It reads
  // `latest` instead, and tracks the order it has produced itself during a drag, since several moves
  // can land before the next render.
  const [dragging, setDragging] = useState(false);
  const lift = useRef(new Animated.Value(0)).current;
  const latest = useRef({ order, rowHeights, onMove, onDragChange });
  latest.current = { order, rowHeights, onMove, onDragChange };
  const drag = useRef({ order: [] as string[], shiftPx: 0 });

  // One slot = the neighbour's height plus the gap between rows.
  const slotOf = (uri: string) => (latest.current.rowHeights[uri] ?? 96) + ROW_GAP;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 2,
      // Don't let the ScrollView take the gesture back mid-drag.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        drag.current = { order: [...latest.current.order], shiftPx: 0 };
        setDragging(true); latest.current.onDragChange(true);
      },
      onPanResponderMove: (_e, g) => {
        const d = drag.current;
        // Crossed into the next slot: reorder now so the list under the finger matches what it will be.
        // Loop, because a quick flick can cover more than one slot between two move events.
        for (;;) {
          const i = d.order.indexOf(c.uri);
          const offset = g.dy - d.shiftPx;
          const below = d.order[i + 1];
          const above = d.order[i - 1];
          if (below && offset > slotOf(below) * 0.6) {
            latest.current.onMove(1);
            d.shiftPx += slotOf(below);
            [d.order[i], d.order[i + 1]] = [below, c.uri];
          } else if (above && offset < -slotOf(above) * 0.6) {
            latest.current.onMove(-1);
            d.shiftPx -= slotOf(above);
            [d.order[i], d.order[i - 1]] = [above, c.uri];
          } else break;
        }
        lift.setValue(g.dy - d.shiftPx);
      },
      onPanResponderRelease: () => {
        setDragging(false); latest.current.onDragChange(false);
        Animated.spring(lift, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
      },
      onPanResponderTerminate: () => {
        setDragging(false); latest.current.onDragChange(false);
        lift.setValue(0);
      },
    }),
  ).current;

  // Another row started: stop this one so only one preview is ever audible.
  useEffect(() => {
    if (!isPlaying) void ref.current?.stopPlayer();
  }, [isPlaying]);
  useEffect(() => () => { void stopAllPlayers(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePlay = async () => {
    if (isPlaying) { onPlayingChange(null); await ref.current?.stopPlayer(); return; }
    onPlayingChange(c.uri);
    await ref.current?.startPlayer({ finishMode: FinishMode.stop });
  };

  return (
    <Animated.View
      onLayout={(e) => { rowHeights[c.uri] = e.nativeEvent.layout.height; }}
      style={[
        styles.row,
        !c.ok && styles.rowBad,
        // Lift the dragged row above its neighbours so it reads as being picked up.
        dragging && styles.rowDragging,
        { transform: [{ translateY: lift }], zIndex: dragging ? 10 : 0 },
      ]}
    >
      <View style={styles.rowTop}>
        <Pressable
          testID={`file-${c.name}`}
          style={styles.tick}
          onPress={onToggle}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: c.selected, disabled: !c.ok }}
        >
          <View style={[styles.box, c.selected && styles.boxOn, !c.ok && styles.boxOff]}>
            {c.selected && <IconCheck size={13} color="#fff" strokeWidth={3} />}
          </View>
          <Text style={styles.seq}>{index + 1}</Text>
          <View style={styles.rowText}>
            <Text style={[styles.name, !c.ok && styles.nameBad]} numberOfLines={1}>{c.name}</Text>
            <Text style={styles.meta}>
              {c.ok ? mmss(Math.floor(c.durationMs / 1000)) : (c.reason || '無法使用')}
            </Text>
          </View>
        </Pressable>

        {!c.ok ? <IconAlert size={18} color={colors.brand} /> : (
          <View style={styles.rowActions}>
            <Pressable
              testID={`play-${c.name}`}
              style={styles.play}
              onPress={togglePlay}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? `停止試聽 ${c.name}` : `試聽 ${c.name}`}
            >
              {isPlaying ? <IconPause size={16} color="#fff" /> : <IconPlay size={16} color="#fff" />}
            </Pressable>
            {/* The pan lives on the HANDLE alone, so dragging never fights the list's own scroll and
                the row stays tappable. Dragging is a pointing gesture, so VoiceOver gets explicit
                move actions instead — the same reorder, reachable without one. */}
            <View
              testID={`grip-${c.name}`}
              style={styles.grip}
              {...pan.panHandlers}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel={`調整 ${c.name} 的順序，目前第 ${index + 1} 個`}
              accessibilityActions={[
                { name: 'moveUp', label: '往前移' },
                { name: 'moveDown', label: '往後移' },
              ]}
              onAccessibilityAction={(e) => {
                if (e.nativeEvent.actionName === 'moveUp') onMove(-1);
                if (e.nativeEvent.actionName === 'moveDown') onMove(1);
              }}
            >
              <IconGrip size={20} color={dragging ? colors.brand : colors.ink3} />
            </View>
          </View>
        )}
      </View>

      {/* Only render the waveform for a file we know decodes — extraction on a bad file errors out. */}
      {c.ok && (
        <Waveform
          mode="static"
          ref={ref}
          path={path}
          candleSpace={2}
          candleWidth={2}
          candleHeightScale={4}
          waveColor={colors.neutralSoft}
          scrubColor={colors.brand}
          containerStyle={styles.wave}
          onPlayerStateChange={(st: PlayerState) => {
            if (st === PlayerState.stopped || st === PlayerState.paused) {
              if (playingUri === c.uri) onPlayingChange(null);
            }
          }}
          onError={() => {}}
        />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
  busy: { marginTop: 14, color: colors.ink2, fontSize: 15 },

  head: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 19, fontWeight: '800', color: colors.ink, letterSpacing: -0.3 },
  sub: { fontSize: 13, color: colors.ink2, marginTop: 5 },

  list: { flex: 1, paddingHorizontal: 16 },
  row: { backgroundColor: colors.card, borderRadius: radius.card, padding: 14, marginBottom: ROW_GAP },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tick: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  seq: { fontSize: 12, fontWeight: '700', color: colors.ink3, width: 14, textAlign: 'center' },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  play: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 38, height: 44, alignItems: 'center', justifyContent: 'center' },
  rowDragging: {
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  wave: { height: 44, marginTop: 10, width: '100%' },
  hint: { fontSize: 12, color: colors.ink3, marginTop: 6, lineHeight: 17 },
  rowBad: { backgroundColor: colors.chipBg },
  box: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.neutralSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  boxOff: { borderStyle: 'dashed' },
  rowText: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: colors.ink },
  nameBad: { color: colors.ink3 },
  meta: { fontSize: 12.5, color: colors.ink3, marginTop: 3 },

  actions: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 26, gap: 8 },
  primary: { backgroundColor: colors.brand, borderRadius: radius.card, height: 50, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondary: { backgroundColor: colors.chipBg, borderRadius: radius.card, height: 46, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  cancel: { height: 40, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: colors.ink3, fontSize: 14, fontWeight: '600' },
});
