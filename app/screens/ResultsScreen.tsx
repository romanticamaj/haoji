import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { useStore } from '../lib/store-context';
import { SavedSession } from '../lib/store';
import TranscriptTab from './TranscriptTab';
import AnalysisTab from './AnalysisTab';
import RecordingsList from './RecordingsList';

export default function ResultsScreen() {
  const route = useRoute<any>();
  const store = useStore();
  const id: string = route.params.sessionId;
  const [session, setSession] = useState<SavedSession | null>(null);
  const [tab, setTab] = useState<'transcript' | 'analysis'>('transcript');

  useFocusEffect(useCallback(() => { store.get(id).then(setSession); }, [id, store]));

  const update = async (s: SavedSession) => { setSession(s); await store.upsert(s); };

  if (!session) return <View style={styles.center}><ActivityIndicator color="#E5342B" /></View>;
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
        <TranscriptTab session={session} onUpdate={update} />
      </View>
      <View style={{ flex: 1, display: tab === 'analysis' ? 'flex' : 'none' }}>
        <AnalysisTab session={session} onUpdate={update} onUnlock={() => update({ ...session, unlocked: true })} />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  tab: { flex: 1, paddingVertical: 13, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#E5342B' },
  tabText: { fontSize: 15, color: '#8e8e93', fontWeight: '600' },
  tabTextActive: { color: '#E5342B' },
});
