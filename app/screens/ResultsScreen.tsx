import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useStore } from '../lib/store-context';
import { SavedSession } from '../lib/store';
import TranscriptTab from './TranscriptTab';
import AnalysisTab from './AnalysisTab';
import RecordingsList from './RecordingsList';
import { colors } from '../lib/theme';

export default function ResultsScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const store = useStore();
  const id: string = route.params.sessionId;
  const [session, setSession] = useState<SavedSession | null>(null);
  const [tab, setTab] = useState<'transcript' | 'analysis'>('transcript');

  useFocusEffect(useCallback(() => { store.get(id).then(setSession); }, [id, store]));

  const update = async (s: SavedSession) => { setSession(s); await store.upsert(s); };

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
    </View>
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
});
