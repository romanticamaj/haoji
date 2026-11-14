import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, ActivityIndicator, Linking, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useRecorder } from '../hooks/useRecorder';
import { useImport } from '../hooks/useImport';
import { useAndroidBack } from '../hooks/useAndroidBack';
import { mergeSessionParts } from '../lib/recordings';
import { mmss } from '../lib/transcript';
import { useStore } from '../lib/store-context';
import Waveform from '../components/Waveform';
import BreathingRing from '../components/BreathingRing';
import { AppText } from '../components/AppText';
import { IconImage, IconFile, IconMic, IconStop, IconPause, IconPlay } from '../components/icons';
import { colors, layout, radius, spacing, tabularNums, typography } from '../lib/theme';
import { haptic } from '../lib/haptics';

// Recording is local-first: the session id is generated on-device so the record button is never
// gated on a backend round-trip (the GPU box is often unreachable from the phone unless Tailscale
// is up). The backend draft session is created lazily in ProcessingScreen at upload time.
const makeLocalId = () => `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function RecordScreen() {
  const store = useStore();
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  // Appending to an existing meeting (結果頁的「繼續錄音」) rather than starting a new one.
  const appendTo: string | undefined = route.params?.appendTo;
  // Non-null while an upload/import is in flight — its text is shown full-screen so the user always
  // has feedback (picking a big video can spend many seconds copying with the picker already gone).
  const [stopBusy, setBusyMsg] = useState<string | null>(null);
  const imp = useImport({ leave: 'replace' });
  const busyMsg = stopBusy ?? imp.busyMsg;
  const err = imp.err;

  // Local id available immediately — recording works fully offline. NOTE: we deliberately do NOT
  // persist a session on mount. Doing so left a blank record every time the user opened this screen
  // (or uploaded) without recording. The session is created only when there's a real recorded part.
  const [sid] = useState(() => appendTo ?? makeLocalId());

  // In append mode we must know what the meeting already holds, so new takes continue the part
  // numbering instead of overwriting part-0. Until it loads we don't let recording start.
  const [existing, setExisting] = useState<{ uri: string; durationMs: number }[] | null>(appendTo ? null : []);
  useEffect(() => {
    if (!appendTo) return;
    void store.get(appendTo).then((s) => setExisting(s?.parts ?? []));
  }, [appendTo, store]);

  // Stable identity, or useRecorder's effect would re-run every render.
  const existingParts = useMemo(() => existing ?? [], [existing]);
  const rec = useRecorder(sid, existingParts);
  const existingMs = useMemo(() => existingParts.reduce((a, p) => a + (p.durationMs || 0), 0), [existingParts]);
  // Append mode is a CONTINUATION: show the meeting's running total, not this take's clock, so the
  // timer reads as one recording carrying on rather than a separate second recording.
  //
  // rec.parts — not existingParts — because an interruption FINALISES a part mid-session. Counting
  // only what the meeting held on entry made the clock jump backwards the moment a call ended
  // (00:11 → 00:03), which reads exactly like the earlier audio was wiped. It never was; the timer
  // was just no longer counting it.
  const recordedMs = useMemo(
    () => rec.parts.reduce((a, p) => a + (p.durationMs || 0), 0), [rec.parts]);
  const shownMs = (rec.parts.length ? recordedMs : existingMs) + rec.durationMs;
  // Don't let a take start before we know what the meeting already holds — starting early is exactly
  // how a continued recording used to overwrite part-0.
  const loading = appendTo != null && existing === null;
  const insets = useSafeAreaInsets();

  // Stable session metadata so the incremental saves and the final save all agree on id/date/title.
  const [meta] = useState(() => ({ createdAt: Date.now(), title: new Date().toLocaleString() }));
  // MERGE, don't overwrite: appending to an existing meeting must keep its title, transcript, notes
  // and speaker names — a plain upsert here would wipe them.
  const persist = useCallback(async (parts: { uri: string; durationMs: number }[]) => {
    const cur = await store.get(sid);
    await store.upsert({
      id: sid,
      createdAt: cur?.createdAt ?? meta.createdAt,
      title: cur?.title ?? meta.title,
      names: cur?.names ?? {},
      unlocked: cur?.unlocked ?? false,
      ...(cur ?? {}),
      parts,
    });
  }, [sid, meta, store]);
  // Save the session the moment a part is finalized (a pause, or an OS interruption like an incoming
  // call). This means a crash can never lose the audio — the recording is already a draft on Home,
  // and the launch-time recovery scan backfills anything that wasn't stored yet.
  useEffect(() => { if (rec.parts.length > 0) void persist(rec.parts); }, [rec.parts, persist]);

  function onStart() { haptic('recordStart'); rec.start(); }
  function onPauseResume() {
    haptic('pause');
    if (rec.state === 'paused') rec.resume(); else rec.pause();
  }

  async function onStop() {
    haptic('recordStop');
    const parts = await rec.stop();
    // Nothing was captured (opened + left, or a zero-length take) → don't create an empty record.
    if (parts.length === 0) { nav.goBack(); return; }
    await persist(parts);
    // Segments exist only to protect audio DURING recording. Now that it has stopped cleanly, join
    // them into one file so the meeting is a single recording everywhere — one player, one waveform,
    // one export — instead of 段 1 / 段 2 / 段 3. Lossless (identical PCM), and if it can't be done
    // the parts simply stay as they were.
    if (parts.length > 1) {
      setBusyMsg('正在整理錄音…');
      const merged = await mergeSessionParts(sid, parts);
      if (merged) await persist(merged);
      setBusyMsg(null);
    }
    // Don't jump straight into analysis — land on Review so the user can listen back and decide
    // whether to analyze or discard (a bad take shouldn't force a transcription round-trip).
    nav.replace('Review', { sessionId: sid });
  }

  const isRec = rec.state === 'recording';
  const isPaused = rec.state === 'paused';
  const isStarting = rec.state === 'starting';

  // Android back mid-take asks first. 結束 is exactly the stop button (onStop → rec.stop(), which
  // finalizes the part per useRecorder's C1/I2 ordering, then saves and opens Review) — back never
  // drops a take on the floor. Idle → back is left to navigation.
  useAndroidBack(() => {
    Alert.alert('要結束這段錄音嗎？', '錄好的部分會留在手機上。', [
      { text: '繼續錄音', style: 'cancel' },
      { text: '結束', onPress: () => { void onStop(); } },
    ]);
    return true;
  }, isRec || isPaused);

  if (busyMsg) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
        <AppText variant="body" color="muted" style={styles.busy}>{busyMsg}</AppText>
      </View>
    );
  }

  const statusText = loading ? '讀取中…'
    : isRec ? '錄音中' : isPaused ? '已暫停' : isStarting ? '準備麥克風…'
    : appendTo ? '準備接著錄' : '準備錄音';
  const stopMode = isRec || isPaused;
  const permissionDenied = !!rec.error && /麥克風權限/.test(rec.error);

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + spacing.xl }]}>
      {/* status + timer */}
      <View style={styles.header}>
        <View style={styles.status}>
          {/* The peach dot is the ONLY accent here, and only while actually recording. */}
          {isRec && <View style={styles.liveDot} />}
          <AppText variant="small" color="muted">{statusText}</AppText>
        </View>
        {/* The timer is the focal point of this screen, so it is set larger than `display` (30) —
            a light weight keeps it calm. Tabular digits so it never jitters. */}
        <AppText
          variant="display"
          color="heading"
          style={[styles.timer, tabularNums]}
          accessibilityLabel={`已錄 ${mmss(Math.floor(shownMs / 1000))}`}
          maxFontSizeMultiplier={1.3}
        >
          {mmss(Math.floor(shownMs / 1000))}
        </AppText>
        {appendTo && existingParts.length > 0 && (
          <AppText variant="small" color="muted" style={styles.continueNote}>
            接著這場會議錄下去。前面已經有 {mmss(Math.floor(existingMs / 1000))}，新錄的會接在後面。
          </AppText>
        )}
      </View>

      {/* stage: live waveform + the controls */}
      <View style={styles.stage}>
        <View style={styles.waveArea}>
          <Waveform level={rec.meteringLevel} active={isRec} />
        </View>

        <View style={styles.controls}>
          {stopMode && !rec.wasInterrupted ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isPaused ? '繼續錄音' : '暫停錄音'}
              onPress={onPauseResume}
              style={({ pressed }) => [styles.side, pressed && styles.pressedIcon]}
            >
              <View style={styles.pauseBtn}>
                {isPaused ? <IconPlay size={20} color={colors.heading} /> : <IconPause size={20} color={colors.heading} />}
              </View>
              <AppText variant="small" color="muted">{isPaused ? '繼續' : '暫停'}</AppText>
            </Pressable>
          ) : <View style={styles.side} />}

          <View style={styles.recordWrap}>
            <BreathingRing active={isRec} level={rec.meteringLevel} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={stopMode ? '停止錄音' : '開始錄音'}
              accessibilityState={{ busy: isStarting || loading, disabled: !sid || isStarting || loading }}
              style={({ pressed }) => [styles.recordBtn, pressed && styles.pressedFill]}
              onPress={stopMode ? onStop : onStart}
              disabled={!sid || isStarting || loading}
            >
              {isStarting
                ? <ActivityIndicator color={colors.onPrimary} />
                : stopMode ? <IconStop size={26} /> : <IconMic size={30} strokeWidth={2} />}
            </Pressable>
          </View>

          <View style={styles.side} />
        </View>

        <AppText variant="small" color="muted" style={styles.hint}>
          {isStarting ? '正在準備麥克風…' : isRec ? '再按一次就結束錄音' : isPaused ? '已暫停，按「繼續」接著錄' : ''}
        </AppText>
      </View>

      {/* footer: permission / interruption / import */}
      <View style={styles.footer}>
        {rec.error && (
          permissionDenied ? (
            <View style={styles.card}>
              <AppText variant="cardTitle" color="heading" style={styles.cardTitle}>沒有麥克風權限</AppText>
              <AppText variant="body" color="muted">到「設定」開啟麥克風後，就能開始錄音。</AppText>
              <Pressable
                onPress={() => Linking.openSettings()}
                accessibilityRole="button"
                accessibilityLabel="前往設定開啟麥克風"
                style={({ pressed }) => [styles.secondary, pressed && styles.pressedRow]}
              >
                <AppText variant="body" color="heading">前往設定</AppText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.card}>
              <AppText variant="cardTitle" color="heading" style={styles.cardTitle}>沒有開始錄音</AppText>
              <AppText variant="body" color="muted">{rec.error}</AppText>
            </View>
          )
        )}

        {rec.wasInterrupted && (
          <View style={styles.card}>
            <AppText variant="cardTitle" color="heading" style={styles.cardTitle}>錄音被中斷了</AppText>
            <AppText variant="body" color="muted">已經錄下的部分都保存好了。要接著錄嗎？</AppText>
            <View style={styles.resumeRow}>
              <Pressable
                style={({ pressed }) => [styles.primary, styles.flex, pressed && styles.pressedFill]}
                onPress={rec.resume}
                accessibilityRole="button"
                accessibilityLabel="繼續"
              >
                <AppText variant="cardTitle" color="onPrimary" style={styles.cardTitle}>繼續</AppText>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.secondary, styles.flex, pressed && styles.pressedRow]}
                onPress={onStop}
                accessibilityRole="button"
                accessibilityLabel="結束"
              >
                <AppText variant="body" color="heading">結束</AppText>
              </Pressable>
            </View>
          </View>
        )}

        {rec.state === 'idle' && !rec.error && (
          <View style={styles.uploadRow}>
            <Pressable
              style={({ pressed }) => [styles.secondary, pressed && styles.pressedRow]}
              onPress={imp.pickFiles}
              accessibilityRole="button"
            >
              <IconFile size={18} color={colors.heading} />
              <AppText variant="body" color="heading">匯入音檔（可多選）</AppText>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.secondary, pressed && styles.pressedRow]}
              onPress={imp.pickVideo}
              accessibilityRole="button"
            >
              <IconImage size={18} color={colors.heading} />
              <AppText variant="body" color="heading">從相簿選影片</AppText>
            </Pressable>
          </View>
        )}

        {err && <AppText variant="small" color="danger" style={styles.err}>{err}</AppText>}
      </View>
    </View>
  );
}

const RECORD_SIZE = 72;
const PAUSE_SIZE = 52;
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: layout.screenPaddingH },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  busy: { marginTop: spacing.md },

  header: { alignItems: 'center', paddingTop: spacing.xxl, gap: spacing.sm },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 17 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  timer: { fontSize: 56, lineHeight: 64, fontWeight: '300', letterSpacing: 1 },
  continueNote: { textAlign: 'center', paddingHorizontal: spacing.xl },

  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  waveArea: { height: 72, alignSelf: 'stretch', justifyContent: 'center', marginBottom: spacing.xxl },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  side: { width: 88, alignItems: 'center', gap: spacing.xs },
  pauseBtn: {
    width: PAUSE_SIZE, height: PAUSE_SIZE, borderRadius: PAUSE_SIZE / 2,
    backgroundColor: colors.surface, borderWidth: layout.border, borderColor: colors.outline,
    alignItems: 'center', justifyContent: 'center',
  },
  recordWrap: { width: 168, height: 168, alignItems: 'center', justifyContent: 'center' },
  recordBtn: {
    width: RECORD_SIZE, height: RECORD_SIZE, borderRadius: RECORD_SIZE / 2, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  hint: { marginTop: spacing.sm, minHeight: typography.small.lineHeight },

  footer: { alignSelf: 'stretch', gap: spacing.md, minHeight: 116, justifyContent: 'flex-end' },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg, gap: spacing.sm,
    borderWidth: layout.border, borderColor: colors.outline,
  },
  cardTitle: { fontWeight: '600' },
  resumeRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  flex: { flex: 1 },
  primary: {
    height: layout.buttonHeight, borderRadius: radius.button, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  // Secondary (KEEPLACE settings `action`): ivory fill, 1px outline, icon + body label.
  secondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    height: 48, borderRadius: radius.input, backgroundColor: colors.background,
    borderWidth: layout.border, borderColor: colors.outline,
  },
  uploadRow: { gap: spacing.md },
  err: { textAlign: 'center' },

  pressedFill: { opacity: 0.8 },
  pressedRow: { opacity: 0.7 },
  pressedIcon: { opacity: 0.6 },
});
