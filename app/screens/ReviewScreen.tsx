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

  // A meeting that already has a transcript is here because audio was APPENDED to it, so the whole
  // thing has to be recognised again — speaker labels are assigned per run, so transcribing only the
  // new part would give it speaker numbers that don't line up with the existing text.
  const hasTranscript = (session?.transcript?.segments?.length ?? 0) > 0;
  const generate = () => nav.replace('Processing', { sessionId: id, regen: hasTranscript });
  // Save as a draft and leave: the recording is already persisted (RecordScreen upserts it on stop),
  // so we just go Home. The user can open it later and tap 生成逐字稿 — the work is fully interruptible.
  const saveDraft = () => nav.popToTop();

  const discard = () => {
    if (hasTranscript) {
      // This meeting has earlier content — never let 捨棄 delete the whole thing from here.
      Alert.alert('保留這場會議', '這場會議已經有逐字稿，補錄的段落已存在其中。若要刪除整場，請回到列表左滑刪除。');
      return;
    }
    Alert.alert('捨棄這段錄音？', '刪除後無法復原。', [
      { text: '取消', style: 'cancel' },
      {
        text: '捨棄', style: 'destructive',
        onPress: async () => {
          await store.remove(id);
          await deleteSessionFiles(id);
          nav.popToTop();
        },
      },
    ]);
  };

  if (!session) return <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>;

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={styles.title}>{hasTranscript ? '補錄好了' : '錄好了，先聽聽看'}</Text>
        <Text style={styles.sub}>
          {hasTranscript
            ? '新的段落已加進這場會議。重新辨識會把整場（含先前的段落）一起處理，之後再重新生成會議記錄。'
            : '確認沒問題就生成逐字稿；也可以先存起來稍後再生成，或直接捨棄重錄。'}
        </Text>
      </View>

      <View style={styles.player}>
        {ready ? (
          <RecordingsList parts={parts} />
        ) : (
          <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
        )}
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.primary} onPress={generate} accessibilityRole="button">
          <Text style={styles.primaryText}>{hasTranscript ? '重新辨識整場' : '生成逐字稿'}</Text>
        </Pressable>
        <View style={styles.secondaryRow}>
          <Pressable style={styles.later} onPress={saveDraft} accessibilityRole="button">
            <Text style={styles.laterText}>稍後再說</Text>
          </Pressable>
          <Pressable style={styles.discard} onPress={discard} accessibilityRole="button">
            <IconTrash size={17} color={colors.brand} />
            <Text style={styles.discardText}>捨棄</Text>
          </Pressable>
        </View>
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

  actions: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28, gap: 8 },
  primary: { backgroundColor: colors.brand, borderRadius: radius.card, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  later: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 46, paddingHorizontal: 20 },
  laterText: { color: colors.ink2, fontSize: 15, fontWeight: '600' },
  discard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 46, paddingHorizontal: 20 },
  discardText: { color: colors.brand, fontSize: 15, fontWeight: '600' },
});
