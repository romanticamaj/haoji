import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, TextInput, Alert, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useStore } from '../lib/store-context';
import { SavedSession } from '../lib/store';
import TranscriptTab from './TranscriptTab';
import AnalysisTab from './AnalysisTab';
import RecordingsList, { exportParts, type PlayerStatus, type RecordingsHandle } from './RecordingsList';
import { IconMic, IconPencil, IconRegenerate, IconShare, IconTrash } from '../components/icons';
import { AppText } from '../components/AppText';
import { Sheet } from '../components/Sheet';
import { PrimaryButton } from '../components/Buttons';
import { ResultsHeader } from '../components/ResultsHeader';
import { OverflowMenu, type OverflowItem } from '../components/OverflowMenu';
import { MiniPlayer } from '../components/MiniPlayer';
import { TranscriptSkeleton } from '../components/TranscriptSkeleton';
import { promoteTitleFromNotes } from '../lib/notesDoc';
import { onJobChange } from '../lib/jobRunner';
import { deleteSessionFiles } from '../lib/recordings';
import { colors, fontScale, layout, radius, spacing, typography } from '../lib/theme';
import { isActive } from '../lib/job';
import { haptic } from '../lib/haptics';
import { duration, motion } from '../lib/motion';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useServerStatus } from '../hooks/useServerStatus';
import { transcribeGate } from '../lib/serverStatus';

type Tab = 'transcript' | 'analysis';

// Results (spec §5.3 C): our own header (back · title · …), the tabs right under it, the transcript or
// notes filling the screen, and the player docked at the bottom as a 64pt bar that expands on tap.
// The old layout stacked the native header, the full player card, 繼續錄音 and 匯出錄音 above the
// tabs, so the transcript started about 63% of the way down the screen.
export default function ResultsScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const store = useStore();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const id: string = route.params.sessionId;
  // Only server actions are gated by the server's state; playback and the transcript never are.
  const srv = useServerStatus();
  const gate = transcribeGate(srv.summary, srv.loading);
  // Seed from the snapshot Home passed (if any) so the screen is fully rendered during the push
  // animation — the useFocusEffect below still refreshes from storage for the latest data.
  const [session, setSession] = useState<SavedSession | null>(route.params.session ?? null);
  const [tab, setTab] = useState<Tab>('transcript');
  const [editingTitle, setEditingTitle] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Lets a transcript tap drive the player (seek to that moment + play).
  const playerRef = useRef<RecordingsHandle>(null);
  // Global playhead (ms) reported by the player → drives the transcript's follow-along highlight and
  // the mini player's time.
  const [playheadMs, setPlayheadMs] = useState(0);
  const parts = useMemo(() => session?.parts ?? [], [session?.parts]);
  const [player, setPlayer] = useState<PlayerStatus>({ playing: false, totalMs: 0, speed: 1 });
  const [playerOpen, setPlayerOpen] = useState(false);

  // Defer the heavy content (native waveform extraction + full transcript/notes render) until the
  // push animation finishes, so the slide-in stays smooth. Mounting all of it during the transition
  // was the on-device '破圖' jank; we show a light loading state first, then swap in the real UI.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // native-stack emits transitionEnd exactly when the slide completes — the ideal moment to load.
    const sub = nav.addListener?.('transitionEnd', () => setReady(true));
    // Safety net: a no-animation replace (Processing→Results) won't emit transitionEnd, and the test
    // renderer's nav has no addListener. Longer than a normal push so it never preempts the animation.
    const timer = setTimeout(() => setReady(true), 600);
    return () => { sub?.(); clearTimeout(timer); };
  }, [nav]);

  useFocusEffect(useCallback(() => {
    const refresh = () => store.get(id).then((s) => {
      if (!s) { setSession(s); return; }
      // Auto-replace a still-default (timestamp) title with the AI notes' topic, and persist it.
      const promoted = promoteTitleFromNotes(s);
      if (promoted !== s) store.upsert(promoted);
      setSession(promoted);
    });
    refresh();
    // Stay live while a transcription runs in the background: the progress shown here keeps ticking
    // and the transcript appears by itself the moment the job finishes — no need to leave and return.
    return onJobChange(() => { void refresh(); });
  }, [id, store]));

  const update = async (s: SavedSession) => { setSession(s); await store.upsert(s); };

  // Re-run transcription. `regen: true` makes ProcessingScreen create a FRESH backend session and
  // re-upload the on-device parts (the old backend session's parts are deleted after each attempt).
  // We don't touch the store here, so if the re-run fails (e.g. backend down) the existing
  // transcript/backendId are preserved. ProcessingScreen persists the new ids only on success.
  // One run only: a second confirm (or tap) before the screen is replaced must not start the job twice.
  // A ref, because taps arrive faster than a re-render.
  const regenStartedRef = useRef(false);
  const regenerate = () => {
    if (regenStartedRef.current) return;
    regenStartedRef.current = true;
    nav.replace('Processing', { sessionId: id, regen: true });
  };
  // Watch a job that's already running — no `regen`, so it attaches instead of restarting.
  const viewProgress = () => nav.navigate('Processing', { sessionId: id });

  // GUIDELINE §5.4: the title asks about the object; the body says what goes and that it is final.
  const confirmDelete = () => {
    if (!session) return;
    Alert.alert(`刪除「${session.title}」？`, '錄音、逐字稿和會議記錄都會從這支手機移除，刪除後無法復原。', [
      { text: '取消', style: 'cancel' },
      {
        text: '刪除', style: 'destructive',
        onPress: async () => {
          haptic('delete');
          await store.remove(id);
          await deleteSessionFiles(id);
          nav.popToTop();
        },
      },
    ]);
  };

  const changeTab = (t: Tab) => {
    if (t === tab) return;
    haptic('tab');
    setTab(t);
  };

  // Sliding underline (180 ms, instant under Reduce Motion) under the two equal-width tabs.
  const [tabW, setTabW] = useState(0);
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(slide, {
      toValue: tab === 'transcript' ? 0 : 1,
      duration: duration('content', reduced),
      easing: motion.easing,
      useNativeDriver: true,
    }).start();
  }, [tab, reduced, slide]);

  if (!session) return <View style={styles.container}><TranscriptSkeleton /></View>;

  const hasParts = parts.length > 0;
  const hasTranscript = (session.transcript?.segments?.length ?? 0) > 0;
  const busy = isActive(session.job);
  // The `…` menu: everything about this meeting as a whole. Only 重新生成 needs the server.
  const regenHint = !hasParts ? '這場會議沒有錄音可以重新辨識。'
    : busy ? '正在整理逐字稿，完成後就能重新生成。'
      : gate === 'offline' ? '主機沒有回應，錄音還在手機上。' : undefined;
  const menu: OverflowItem[] = [
    { key: 'rename', label: '重新命名', icon: <IconPencil size={20} />, onPress: () => setEditingTitle(true) },
    {
      key: 'export', label: '匯出錄音', icon: <IconShare size={20} />, onPress: () => { void exportParts(parts); },
      disabled: !hasParts, hint: '這場會議沒有錄音可以匯出。',
    },
    {
      key: 'append', label: '繼續錄音', icon: <IconMic size={20} color={colors.heading} />,
      // Carry on recording INTO this meeting — an interrupted or resumed discussion stays one
      // session, so it is transcribed and analysed as a single conversation.
      onPress: () => nav.navigate('Record', { appendTo: id }),
    },
    {
      key: 'regen', label: '重新生成逐字稿', icon: <IconRegenerate size={20} />,
      disabled: !!regenHint, hint: regenHint,
      onPress: () => {
        if (gate === 'unpaired') { nav.navigate('Pair'); return; }
        if (!hasTranscript) { regenerate(); return; }
        // A transcript has no version history: re-running overwrites it, corrections included.
        Alert.alert(
          '重新生成逐字稿？',
          '會用原本的錄音重新辨識一次。目前的逐字稿會被取代，包含你修改過的文字；逐字稿沒有版本紀錄，無法還原。',
          [{ text: '取消', style: 'cancel' }, { text: '重新生成', style: 'destructive', onPress: regenerate }],
        );
      },
    },
    { key: 'delete', label: '刪除這場會議', icon: <IconTrash size={20} />, danger: true, onPress: confirmDelete },
  ];

  return (
    <View style={styles.container}>
      <ResultsHeader title={session.title} onBack={() => nav.goBack()} onMore={() => setMenuOpen(true)} />

      {/* KEEPLACE StatusTabs, directly under the header: equal-width labels, a 2px heading underline
          that slides between them over a 1px rule. */}
      <View
        style={styles.tabs}
        accessibilityRole="tablist"
        onLayout={(e) => setTabW((e.nativeEvent.layout.width - layout.screenPaddingH * 2) / 2)}
      >
        {(['transcript', 'analysis'] as const).map((t) => {
          const on = tab === t;
          const label = t === 'transcript' ? '逐字稿' : '會議記錄';
          return (
            <Pressable
              key={t}
              style={({ pressed }) => [styles.tab, pressed && styles.pressedRow]}
              onPress={() => changeTab(t)}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: on }}
            >
              <AppText variant="cardTitle" color={on ? 'heading' : 'muted'} style={on && styles.bold} maxFontSizeMultiplier={fontScale.chrome}>
                {label}
              </AppText>
            </Pressable>
          );
        })}
        <Animated.View
          testID="tab-underline"
          pointerEvents="none"
          style={tabW > 0
            ? [styles.underline, { width: tabW, transform: [{ translateX: Animated.multiply(slide, tabW) }] }]
            // Before the row is measured: a plain half-width bar on the selected side.
            : [styles.underline, styles.underlineStatic, tab === 'analysis' && styles.underlineRight]}
        />
      </View>

      {ready ? (
        <>
          <View style={{ flex: 1, display: tab === 'transcript' ? 'flex' : 'none' }}>
            <TranscriptTab session={session} onUpdate={update} onRegenerate={regenerate} onViewProgress={viewProgress}
              onDelete={confirmDelete}
              gate={gate} onConnect={() => nav.navigate('Pair')}
              onSeek={(ms) => playerRef.current?.seekToGlobal(ms)}
              activeMs={tab === 'transcript' ? playheadMs : 0} />
          </View>
          <View style={{ flex: 1, display: tab === 'analysis' ? 'flex' : 'none' }}>
            <AnalysisTab session={session} onUpdate={update}
              onGoToTranscript={() => changeTab('transcript')} onDelete={confirmDelete} />
          </View>
          {hasParts && (
            // Local only: the player never depends on the server, so it works offline and unpaired.
            // The dock's surface runs under the home indicator (surface, not canvas, below the bar).
            <View style={{ paddingBottom: insets.bottom, backgroundColor: colors.surface }}>
              <MiniPlayer
                playing={player.playing}
                positionMs={playheadMs}
                totalMs={player.totalMs}
                speed={player.speed}
                expanded={playerOpen}
                onExpandChange={setPlayerOpen}
                onToggle={() => playerRef.current?.toggle()}
                onCycleSpeed={() => playerRef.current?.cycleSpeed()}
              >
                <RecordingsList ref={playerRef} parts={parts} onProgress={setPlayheadMs} onState={setPlayer} showExport={false} />
              </MiniPlayer>
            </View>
          )}
        </>
      ) : (
        // The transcript's shape while the push finishes (and the heavy content waits to mount).
        <TranscriptSkeleton />
      )}

      {menuOpen && <OverflowMenu title="這場會議" items={menu} onClose={() => setMenuOpen(false)} />}

      {editingTitle && (
        <TitleSheet
          current={session.title}
          onClose={() => setEditingTitle(false)}
          onCommit={(name) => { const t = name.trim(); update({ ...session, title: t || session.title, ...(t ? { titleSource: 'user' as const } : {}) }); setEditingTitle(false); }}
        />
      )}
    </View>
  );
}

// Rename the meeting — the shared KEEPLACE bottom sheet.
function TitleSheet({ current, onClose, onCommit }: { current: string; onClose(): void; onCommit(name: string): void }) {
  const [value, setValue] = useState(current);
  return (
    <Sheet
      title="會議名稱"
      onClose={onClose}
      scrimTestID="title-scrim"
      footer={<PrimaryButton testID="title-done" label="完成" onPress={() => onCommit(value)} style={styles.sheetCta} />}
    >
      <TextInput
        testID="title-input"
        autoFocus
        style={styles.sheetInput}
        value={value}
        onChangeText={setValue}
        placeholder="輸入會議名稱"
        placeholderTextColor={colors.hint}
        returnKeyType="done"
        onSubmitEditing={() => onCommit(value)}
        accessibilityLabel="會議名稱"
      />
    </Sheet>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  tabs: {
    flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.outline,
    paddingHorizontal: layout.screenPaddingH,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: layout.minTouchTarget },
  underline: { position: 'absolute', bottom: 0, left: layout.screenPaddingH, height: 2, backgroundColor: colors.heading },
  underlineStatic: { width: '45%' },
  underlineRight: { left: undefined, right: layout.screenPaddingH },
  bold: { fontWeight: '600' },
  pressedRow: { opacity: 0.7 },

  sheetInput: {
    ...typography.body, lineHeight: undefined, color: colors.heading, marginTop: spacing.md,
    height: 48, paddingHorizontal: spacing.md, borderRadius: radius.input,
    backgroundColor: colors.background, borderWidth: layout.border, borderColor: colors.outline,
  },
  sheetCta: { marginTop: spacing.lg },
});
