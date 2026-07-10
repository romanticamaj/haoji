import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, Modal, TextInput, Animated,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useStore } from '../lib/store-context';
import { SavedSession } from '../lib/store';
import TranscriptTab from './TranscriptTab';
import AnalysisTab from './AnalysisTab';
import RecordingsList from './RecordingsList';
import { IconPencil } from '../components/icons';
import { colors, radius } from '../lib/theme';

export default function ResultsScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const store = useStore();
  const id: string = route.params.sessionId;
  const [session, setSession] = useState<SavedSession | null>(null);
  const [tab, setTab] = useState<'transcript' | 'analysis'>('transcript');
  const [editingTitle, setEditingTitle] = useState(false);

  useFocusEffect(useCallback(() => { store.get(id).then(setSession); }, [id, store]));

  const update = async (s: SavedSession) => { setSession(s); await store.upsert(s); };

  // Show the meeting name in the nav bar with a pencil to rename it (tap → bottom sheet).
  useLayoutEffect(() => {
    nav.setOptions({
      title: session?.title ?? '結果',
      headerRight: () =>
        session ? (
          <Pressable onPress={() => setEditingTitle(true)} hitSlop={12} accessibilityRole="button" accessibilityLabel="重新命名會議">
            <IconPencil size={19} color={colors.brand} />
          </Pressable>
        ) : undefined,
    });
  }, [nav, session?.title]);

  // Re-run transcription. `regen: true` makes ProcessingScreen create a FRESH backend session and
  // re-upload the on-device parts (the old backend session's parts are deleted after each attempt).
  // We don't touch the store here, so if the re-run fails (e.g. backend down) the existing
  // transcript/backendId are preserved. ProcessingScreen persists the new ids only on success.
  const regenerate = () => nav.replace('Processing', { sessionId: id, regen: true });

  if (!session) return <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>;
  return (
    <View style={styles.container}>
      <RecordingsList parts={session.parts ?? []} />
      <View style={styles.tabs}>
        {(['transcript', 'analysis'] as const).map((t) => (
          <Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t === 'transcript' ? '逐字稿' : 'AI 分析'}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flex: 1, display: tab === 'transcript' ? 'flex' : 'none' }}>
        <TranscriptTab session={session} onUpdate={update} onRegenerate={regenerate} />
      </View>
      <View style={{ flex: 1, display: tab === 'analysis' ? 'flex' : 'none' }}>
        <AnalysisTab session={session} onUpdate={update} onUnlock={() => update({ ...session, unlocked: true })}
          onGoToTranscript={() => setTab('transcript')} />
      </View>

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
