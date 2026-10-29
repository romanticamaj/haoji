import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useStore } from '../lib/store-context';
import { SavedSession } from '../lib/store';
import { ensureJob, restartJob, onJobChange } from '../lib/jobRunner';
import { overallPct } from '../lib/job';
import { AppText } from '../components/AppText';
import { PrimaryButton, SecondaryButton } from '../components/Buttons';
import { IconAlert, IconLoader } from '../components/icons';
import { colors, layout, spacing, tabularNums } from '../lib/theme';

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

  // Failure: say what failed, what is still safe, and what to do (GUIDELINE §5.5).
  if (started && job?.stage === 'error') return (
    <View style={styles.center}>
      <View style={styles.iconCircle}><IconAlert size={28} /></View>
      <AppText variant="section" color="heading" accessibilityRole="header">逐字稿沒有整理完成</AppText>
      <AppText variant="body" color="muted" style={styles.centerText}>錄音還在手機上，沒有不見。</AppText>
      {!!job.error && <AppText variant="small" color="muted" style={styles.centerText}>{job.error}</AppText>}
      <View style={styles.actions}>
        <PrimaryButton label="重試" onPress={() => void restartJob(sessionId, store)} />
        <SecondaryButton label="返回" onPress={() => nav.popToTop()} />
      </View>
    </View>
  );

  const pct = job ? Math.round(overallPct(job) * 100) : 0;
  return (
    <View style={styles.center}>
      <View style={styles.iconCircle}><IconLoader size={28} color={colors.primaryDark} /></View>
      <AppText variant="section" color="heading" accessibilityRole="header">正在整理逐字稿…</AppText>
      <AppText variant="small" color="muted">{job?.message || '準備中…'}</AppText>
      <View style={styles.barTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
      <AppText variant="small" color="muted" style={tabularNums}>{pct}%</AppText>

      <AppText variant="body" color="muted" style={[styles.centerText, styles.note]}>
        {job?.stage === 'transcribing'
          ? '已開始整理，離開 App 也會繼續。完成後會通知你。'
          : '上傳完成後會自己繼續整理，不用一直開著 App。'}
      </AppText>
      <SecondaryButton label="在背景繼續" onPress={() => nav.popToTop()} style={styles.bg} />
    </View>
  );
}

const styles = StyleSheet.create({
  // EmptyState-like centre layout: 72 circle + section title + muted description.
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background,
    paddingHorizontal: layout.screenPaddingH * 2, gap: spacing.md,
  },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surface,
    borderWidth: layout.border, borderColor: colors.outline, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
  },
  centerText: { textAlign: 'center' },
  barTrack: { width: '100%', height: 4, borderRadius: 2, backgroundColor: colors.outline, marginTop: spacing.sm, overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },
  note: { marginTop: spacing.md },
  bg: { alignSelf: 'stretch', marginTop: spacing.sm },
  actions: { alignSelf: 'stretch', gap: spacing.md, marginTop: spacing.lg },
});
