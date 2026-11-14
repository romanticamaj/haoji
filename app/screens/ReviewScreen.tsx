import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useStore } from '../lib/store-context';
import { SavedSession } from '../lib/store';
import { deleteSessionFiles } from '../lib/recordings';
import RecordingsList from './RecordingsList';
import { AppText } from '../components/AppText';
import { IconTrash } from '../components/icons';
import { TranscribeButton } from '../components/TranscribeButton';
import { useServerStatus } from '../hooks/useServerStatus';
import { transcribeGate } from '../lib/serverStatus';
import { colors, layout, spacing } from '../lib/theme';

// Sits between recording and analysis: listen back to what was just captured, then either kick off
// transcription (開始分析) or throw the take away (捨棄). Nothing is transcribed until the user opts in,
// so a bad recording never forces a backend round-trip.
export default function ReviewScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const store = useStore();
  const insets = useSafeAreaInsets();
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
  // Transcribing needs the server. Unpaired → 「連接主機後就能生成逐字稿」; offline → disabled, with a
  // line saying the recording is safe. Either way 稍後再說 still saves the take (local-first).
  const srv = useServerStatus();
  const gate = transcribeGate(srv.summary, srv.loading);

  const discard = () => {
    if (hasTranscript) {
      // This meeting has earlier content — never let 捨棄 delete the whole thing from here.
      Alert.alert('這場會議會保留', '它已經有逐字稿，補錄的段落也存進去了。要刪除整場會議，請回到首頁左滑刪除。');
      return;
    }
    Alert.alert('捨棄這段錄音？', '錄音會從這支手機移除，捨棄後無法復原。', [
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

  if (!session) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <AppText variant="screenTitle" color="heading" accessibilityRole="header">
          {hasTranscript ? '補錄好了' : '錄好了，先聽聽看'}
        </AppText>
        <AppText variant="body" color="muted">
          {hasTranscript
            ? '新的段落已經加進這場會議。重新辨識會把整場一起整理，之後再重新寫會議記錄。'
            : '沒問題就生成逐字稿。也可以先存起來，之後再生成。'}
        </AppText>
      </View>

      <View style={styles.player}>
        {ready ? (
          <RecordingsList parts={parts} />
        ) : (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        )}
      </View>

      {/* Sticky CTA (KEEPLACE FormScreen): one primary on the canvas, a hairline rule above it. */}
      <View style={[styles.actions, { paddingBottom: insets.bottom + spacing.md }]}>
        <TranscribeButton
          gate={gate}
          label={hasTranscript ? '重新辨識整場' : '生成逐字稿'}
          onPress={generate}
          onConnect={() => nav.navigate('Pair')}
        />
        <View style={styles.secondaryRow}>
          <Pressable
            style={({ pressed }) => [styles.textBtn, pressed && styles.pressedIcon]}
            onPress={saveDraft}
            accessibilityRole="button"
            accessibilityLabel="稍後再說，先存起來"
            hitSlop={8}
          >
            <AppText variant="cardTitle" color="muted">稍後再說</AppText>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.textBtn, pressed && styles.pressedIcon]}
            onPress={discard}
            accessibilityRole="button"
            accessibilityLabel="捨棄這段錄音"
            hitSlop={8}
          >
            <IconTrash size={16} color={colors.danger} />
            <AppText variant="cardTitle" color="danger">捨棄</AppText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  head: { paddingHorizontal: layout.screenPaddingH, paddingTop: layout.screenPaddingV, gap: spacing.sm },

  player: { flex: 1, justifyContent: 'center' },

  actions: {
    paddingHorizontal: layout.screenPaddingH, paddingTop: spacing.md, gap: spacing.xs,
    backgroundColor: colors.background, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outline,
  },
  secondaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xxl },
  textBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    minHeight: layout.minTouchTarget, paddingHorizontal: spacing.lg,
  },
  pressedIcon: { opacity: 0.6 },
});
