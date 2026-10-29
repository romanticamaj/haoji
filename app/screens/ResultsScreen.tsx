import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, ActivityIndicator, TextInput, Alert } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useStore } from '../lib/store-context';
import { SavedSession } from '../lib/store';
import TranscriptTab from './TranscriptTab';
import AnalysisTab from './AnalysisTab';
import RecordingsList, { type RecordingsHandle } from './RecordingsList';
import { IconMic, IconPencil } from '../components/icons';
import { AppText } from '../components/AppText';
import { Sheet } from '../components/Sheet';
import { Chip, PrimaryButton } from '../components/Buttons';
import { promoteTitleFromNotes } from '../lib/notesDoc';
import { onJobChange } from '../lib/jobRunner';
import { deleteSessionFiles } from '../lib/recordings';
import { colors, layout, radius, spacing, typography } from '../lib/theme';

export default function ResultsScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const store = useStore();
  const id: string = route.params.sessionId;
  // Seed from the snapshot Home passed (if any) so the screen is fully rendered during the push
  // animation — the useFocusEffect below still refreshes from storage for the latest data.
  const [session, setSession] = useState<SavedSession | null>(route.params.session ?? null);
  const [tab, setTab] = useState<'transcript' | 'analysis'>('transcript');
  const [editingTitle, setEditingTitle] = useState(false);
  // Lets a transcript tap drive the player above (seek to that moment + play).
  const playerRef = useRef<RecordingsHandle>(null);
  // Global playhead (ms) reported by the player → drives the transcript's follow-along highlight.
  const [playheadMs, setPlayheadMs] = useState(0);
  const parts = useMemo(() => session?.parts ?? [], [session?.parts]);

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

  // Show the meeting name in the nav bar with a pencil to rename it (tap → bottom sheet).
  useLayoutEffect(() => {
    nav.setOptions({
      title: session?.title ?? '',
      headerRight: () =>
        session ? (
          <Pressable onPress={() => setEditingTitle(true)} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="重新命名會議">
            <IconPencil size={20} color={colors.heading} />
          </Pressable>
        ) : undefined,
    });
  }, [nav, session?.title]);

  // Re-run transcription. `regen: true` makes ProcessingScreen create a FRESH backend session and
  // re-upload the on-device parts (the old backend session's parts are deleted after each attempt).
  // We don't touch the store here, so if the re-run fails (e.g. backend down) the existing
  // transcript/backendId are preserved. ProcessingScreen persists the new ids only on success.
  const regenerate = () => nav.replace('Processing', { sessionId: id, regen: true });
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
          await store.remove(id);
          await deleteSessionFiles(id);
          nav.popToTop();
        },
      },
    ]);
  };

  if (!session) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  return (
    <View style={styles.container}>
      {ready ? (
        <>
          <RecordingsList ref={playerRef} parts={parts} onProgress={setPlayheadMs} />
          {/* Carry on recording INTO this meeting — an interrupted or resumed discussion stays one
              session, so it is transcribed and analysed as a single conversation. */}
          <Chip
            label="繼續錄音"
            icon={<IconMic size={16} color={colors.heading} />}
            onPress={() => nav.navigate('Record', { appendTo: id })}
            accessibilityLabel="繼續錄音"
            style={styles.appendBtn}
          />
          {/* KEEPLACE StatusTabs: equal-width labels, a 2px heading underline over a 1px rule. */}
          <View style={styles.tabs} accessibilityRole="tablist">
            {(['transcript', 'analysis'] as const).map((t) => {
              const on = tab === t;
              return (
                <Pressable
                  key={t}
                  style={({ pressed }) => [styles.tab, pressed && styles.pressedRow]}
                  onPress={() => setTab(t)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                >
                  <AppText variant="cardTitle" color={on ? 'heading' : 'muted'} style={on && styles.bold}>
                    {t === 'transcript' ? '逐字稿' : '會議記錄'}
                  </AppText>
                  <View style={[styles.underline, on && styles.underlineOn]} />
                </Pressable>
              );
            })}
          </View>
          <View style={{ flex: 1, display: tab === 'transcript' ? 'flex' : 'none' }}>
            <TranscriptTab session={session} onUpdate={update} onRegenerate={regenerate} onViewProgress={viewProgress}
              onDelete={confirmDelete}
              onSeek={(ms) => playerRef.current?.seekToGlobal(ms)}
              activeMs={tab === 'transcript' ? playheadMs : 0} />
          </View>
          <View style={{ flex: 1, display: tab === 'analysis' ? 'flex' : 'none' }}>
            <AnalysisTab session={session} onUpdate={update}
              onGoToTranscript={() => setTab('transcript')} onDelete={confirmDelete} />
          </View>
        </>
      ) : (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      )}

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
  // iOS 26 draws a glass capsule around this button whose vertical center sits above the button's own
  // center, so a plain center-aligned icon renders low. flex-start + a small top pad lifts the icon to
  // the capsule center. (Tuned on iPhone 12 / iOS 26.3; close enough across iOS 26 devices.)
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 6 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  appendBtn: { alignSelf: 'center', marginBottom: spacing.sm },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.outline, paddingHorizontal: layout.screenPaddingH },
  tab: { flex: 1, alignItems: 'center', paddingTop: spacing.md, minHeight: layout.minTouchTarget },
  underline: { height: 2, alignSelf: 'stretch', marginTop: spacing.md - 2, backgroundColor: 'transparent' },
  underlineOn: { backgroundColor: colors.heading },
  bold: { fontWeight: '600' },
  pressedRow: { opacity: 0.7 },

  sheetInput: {
    ...typography.body, lineHeight: undefined, color: colors.heading, marginTop: spacing.md,
    height: 48, paddingHorizontal: spacing.md, borderRadius: radius.input,
    backgroundColor: colors.background, borderWidth: layout.border, borderColor: colors.outline,
  },
  sheetCta: { marginTop: spacing.lg },
});
