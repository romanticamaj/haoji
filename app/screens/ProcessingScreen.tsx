import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useStore } from '../lib/store-context';
import { SavedSession } from '../lib/store';
import { ensureJob, restartJob, onJobChange } from '../lib/jobRunner';
import { overallPct } from '../lib/job';
import { colors, radius } from '../lib/theme';

// This screen no longer OWNS the work — it just watches it.
//
// The job lives in lib/jobRunner and persists every step, so it keeps running when you navigate away
// and is resumed on the next launch if the app is backgrounded, crashes, or is swiped away. That is
// why leaving here is safe (and why there's a "在背景繼續" button): the backend finishes the
// transcription on its own, and the app only has to collect the result whenever it next runs.
export default function ProcessingScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const store = useStore();
  const sessionId: string = route.params.sessionId;
  // regen (from "重新生成逐字稿"): drop the old backend session/job and start a clean one — the old
  // session's uploaded parts are deleted server-side after each attempt.
  const regen: boolean = route.params.regen ?? false;
  const [session, setSession] = useState<SavedSession | null>(null);
  // Whether THIS visit has actually (re)started the job. A meeting that was analysed before arrives
  // still carrying job.stage === 'done', and acting on that before the restart cleared it bounced
  // straight back to the results — "重新生成逐字稿 一進去就跳出".
  const [started, setStarted] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = () => { void store.get(sessionId).then((s) => { if (alive) setSession(s); }); };
    const off = onJobChange(refresh);
    (async () => {
      // Defensive: the recording/import flow always persists the session first, but never start a job
      // against a missing record — create a minimal one so the pipeline has something to write to.
      if (!(await store.get(sessionId))) {
        await store.upsert({
          id: sessionId, createdAt: Date.now(), title: new Date().toLocaleString(),
          names: {}, unlocked: false, parts: [],
        });
      }
      if (!alive) return;
      // regen must be AWAITED: it clears the previous run's stage, and only then is a 'done' we see
      // this one's rather than last time's.
      if (regen) await restartJob(sessionId, store);
      else void ensureJob(sessionId, store);
      if (!alive) return;
      setStarted(true);
    })();
    refresh();
    return () => { alive = false; off(); };
  }, [sessionId, regen, store]);

  const job = session?.job;

  // Finished while we were watching → go straight to the result. Only ever act on a stage produced
  // by this visit (see `started`), never on one left over from a previous analysis.
  useEffect(() => {
    if (started && job?.stage === 'done' && session) nav.replace('Results', { sessionId, session });
  }, [started, job?.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  if (started && job?.stage === 'error') return (
    <View style={styles.center}>
      <Text style={styles.err}>{job.error || '處理失敗'}</Text>
      <View style={styles.errActions}>
        <Pressable style={styles.retry} onPress={() => void restartJob(sessionId, store)} accessibilityRole="button">
          <Text style={styles.retryText}>重試</Text>
        </Pressable>
        <Pressable style={styles.back} onPress={() => nav.navigate('Home')} accessibilityRole="button">
          <Text style={styles.backText}>返回</Text>
        </Pressable>
      </View>
    </View>
  );

  const pct = job ? Math.round(overallPct(job) * 100) : 0;
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.brand} />
      <Text style={styles.msg}>{job?.message || '準備中…'}</Text>
      <View style={styles.barTrack}><View style={[styles.barFill, { width: `${pct}%` }]} /></View>
      <Text style={styles.pct}>{pct}%</Text>

      <Text style={styles.note}>
        {job?.stage === 'transcribing'
          ? '已送出給後端處理，離開 App 也會繼續。'
          : '上傳完成後就會在後端繼續處理。'}
      </Text>
      <Pressable style={styles.bg} onPress={() => nav.navigate('Home')} accessibilityRole="button">
        <Text style={styles.bgText}>在背景繼續</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper, padding: 24 },
  msg: { marginTop: 16, color: colors.ink2, fontSize: 15 },
  barTrack: { width: '78%', height: 6, borderRadius: 3, backgroundColor: colors.chipBg, marginTop: 16, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.brand },
  pct: { marginTop: 8, fontSize: 12.5, color: colors.ink3, fontVariant: ['tabular-nums'] },
  note: { marginTop: 22, fontSize: 12.5, color: colors.ink3, textAlign: 'center', lineHeight: 18 },
  bg: { marginTop: 12, paddingVertical: 10, paddingHorizontal: 22, borderRadius: radius.pill, backgroundColor: colors.chipBg },
  bgText: { color: colors.ink, fontSize: 14, fontWeight: '600' },

  err: { color: colors.brand, fontSize: 16, textAlign: 'center' },
  errActions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  retry: { paddingVertical: 10, paddingHorizontal: 24, borderRadius: 20, backgroundColor: colors.brand },
  retryText: { color: '#fff', fontWeight: '700' },
  back: { paddingVertical: 10, paddingHorizontal: 24, borderRadius: 20, backgroundColor: colors.chipBg },
  backText: { color: colors.ink, fontWeight: '600' },
});
