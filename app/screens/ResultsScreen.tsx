import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, Modal, TextInput, Animated,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useStore } from '../lib/store-context';
import { SavedSession } from '../lib/store';
import TranscriptTab from './TranscriptTab';
import AnalysisTab from './AnalysisTab';
import RecordingsList, { type RecordingsHandle } from './RecordingsList';
import { IconPencil } from '../components/icons';
import { promoteTitleFromNotes } from '../lib/notesDoc';
import { onJobChange } from '../lib/jobRunner';
import { colors, radius } from '../lib/theme';

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
      title: session?.title ?? '結果',
      headerRight: () =>
        session ? (
          <Pressable onPress={() => setEditingTitle(true)} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="重新命名會議">
            <IconPencil size={22} color={colors.brand} />
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

  if (!session) return <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>;
  return (
    <View style={styles.container}>
      {ready ? (
        <>
          <RecordingsList ref={playerRef} parts={parts} onProgress={setPlayheadMs} />
          <View style={styles.tabs}>
            {(['transcript', 'analysis'] as const).map((t) => (
              <Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
                <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t === 'transcript' ? '逐字稿' : 'AI 分析'}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flex: 1, display: tab === 'transcript' ? 'flex' : 'none' }}>
            <TranscriptTab session={session} onUpdate={update} onRegenerate={regenerate} onViewProgress={viewProgress}
              onSeek={(ms) => playerRef.current?.seekToGlobal(ms)}
              activeMs={tab === 'transcript' ? playheadMs : 0} />
          </View>
          <View style={{ flex: 1, display: tab === 'analysis' ? 'flex' : 'none' }}>
            <AnalysisTab session={session} onUpdate={update} onUnlock={() => update({ ...session, unlocked: true })}
              onGoToTranscript={() => setTab('transcript')} />
          </View>
        </>
      ) : (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      )}

      {editingTitle && (
        <TitleSheet
          current={session.title}
          onClose={() => setEditingTitle(false)}
          onCommit={(name) => { update({ ...session, title: name.trim() || session.title }); setEditingTitle(false); }}
        />
      )}
    </View>
  );
}

// Rename the meeting — bottom sheet on core RN (Modal + Animated), matching the speaker-rename sheet.
function TitleSheet({ current, onClose, onCommit }: { current: string; onClose(): void; onCommit(name: string): void }) {
  const [value, setValue] = useState(current);
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start(); }, [anim]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [320, 0] });
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="關閉" testID="title-scrim" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetKav} pointerEvents="box-none">
          <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
            <View style={styles.grab} />
            <Text style={styles.sheetTitle}>會議名稱</Text>
            <TextInput
              testID="title-input"
              autoFocus
              style={styles.sheetInput}
              value={value}
              onChangeText={setValue}
              placeholder="輸入會議名稱"
              placeholderTextColor={colors.ink3}
              returnKeyType="done"
              onSubmitEditing={() => onCommit(value)}
            />
            <Pressable testID="title-done" style={styles.sheetCta} onPress={() => onCommit(value)} accessibilityRole="button">
              <Text style={styles.sheetCtaText}>完成</Text>
            </Pressable>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  // iOS 26 draws a glass capsule around this button whose vertical center sits above the button's own
  // center, so a plain center-aligned icon renders low. flex-start + a small top pad lifts the icon to
  // the capsule center. (Tuned on iPhone 12 / iOS 26.3; close enough across iOS 26 devices.)
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 6 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.hairline, backgroundColor: colors.card },
  tab: { flex: 1, paddingVertical: 13, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.brand },
  tabText: { fontSize: 15, color: colors.ink2, fontWeight: '600' },
  tabTextActive: { color: colors.brand },

  sheetRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,16,14,0.35)' },
  scrim: { ...StyleSheet.absoluteFillObject },
  sheetKav: { justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: 22, paddingTop: 10, paddingBottom: 34 },
  grab: { width: 38, height: 5, borderRadius: 3, backgroundColor: colors.neutralSoft, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, marginBottom: 14 },
  sheetInput: { backgroundColor: colors.paper, borderRadius: radius.control, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colors.ink, borderWidth: 1, borderColor: colors.hairline },
  sheetCta: { marginTop: 18, backgroundColor: colors.brand, borderRadius: radius.control, height: 50, alignItems: 'center', justifyContent: 'center' },
  sheetCtaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
