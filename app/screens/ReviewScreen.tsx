import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useStore } from '../lib/store-context';
import { SavedSession } from '../lib/store';
import { deleteSessionFiles } from '../lib/recordings';
import RecordingsList from './RecordingsList';
import { IconTrash } from '../components/icons';
import { colors, radius } from '../lib/theme';

// Sits between recording and analysis: listen back to what was just captured, then either kick off
// transcription (開始分析) or throw the take away (捨棄). Nothing is transcribed until the user opts in,
// so a bad recording never forces a backend round-trip.
export default function ReviewScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const store = useStore();
  const id: string = route.params.sessionId;
  const [session, setSession] = useState<SavedSession | null>(null);
  const parts = useMemo(() => session?.parts ?? [], [session?.parts]);

  useFocusEffect(useCallback(() => {
    store.get(id).then(setSession);
  }, [id, store]));

  // Defer the heavy waveform mount until the push finishes, so the slide-in stays smooth.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sub = nav.addListener?.('transitionEnd', () => setReady(true));
    const timer = setTimeout(() => setReady(true), 600);
    return () => { sub?.(); clearTimeout(timer); };
  }, [nav]);

  const analyze = () => nav.replace('Processing', { sessionId: id });

  const discard = () => {
    Alert.alert('捨棄這段錄音？', '刪除後無法復原。', [
      { text: '取消', style: 'cancel' },
      {
        text: '捨棄', style: 'destructive',
        onPress: async () => {
          await store.remove(id);
          await deleteSessionFiles(id);
          nav.navigate('Home');
        },
      },
    ]);
  };

  if (!session) return <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>;

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={styles.title}>錄好了，先聽聽看</Text>
        <Text style={styles.sub}>確認沒問題再開始分析，或直接捨棄重錄。</Text>
      </View>

      <View style={styles.player}>
        {ready ? (
          <RecordingsList parts={parts} />
        ) : (
          <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
        )}
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.primary} onPress={analyze} accessibilityRole="button">
          <Text style={styles.primaryText}>開始分析</Text>
        </Pressable>
        <Pressable style={styles.discard} onPress={discard} accessibilityRole="button">
          <IconTrash size={18} color={colors.brand} />
          <Text style={styles.discardText}>捨棄錄音</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
  head: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 6 },
  title: { fontSize: 20, fontWeight: '800', color: colors.ink, letterSpacing: -0.3 },
  sub: { fontSize: 13.5, color: colors.ink2, marginTop: 6, lineHeight: 19 },

  player: { flex: 1, justifyContent: 'center' },

  actions: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28, gap: 12 },
  primary: { backgroundColor: colors.brand, borderRadius: radius.card, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  discard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 46 },
  discardText: { color: colors.brand, fontSize: 15, fontWeight: '600' },
});
