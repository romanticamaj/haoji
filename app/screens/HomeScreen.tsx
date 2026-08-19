import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, SectionList, Pressable, TextInput, StyleSheet } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useStore } from '../lib/store-context';
import { SavedSession } from '../lib/store';
import { deleteSessionFiles, recoverOrphanedRecordings, repairWavParts } from '../lib/recordings';
import { RootStackParamList } from '../navigation';
import SwipeRow from '../components/SwipeRow';
import { IconSearch } from '../components/icons';
import { colors, radius, tabularNums, cardShadow, speakerColor } from '../lib/theme';
import {
  groupSessions, relativeDay, durationLabel, speakerCount, avatarSpec, hasTranscript, hasNotes,
} from '../lib/sessionList';
import { promoteTitleFromNotes } from '../lib/notesDoc';
import { resumeAllJobs, onJobChange } from '../lib/jobRunner';
import { isActive, overallPct } from '../lib/job';
import { isNotesActive } from '../lib/notesJob';

// Repair crash-truncated WAV headers once per app launch (not on every screen focus).
let wavRepairDone = false;

export default function HomeScreen() {
  const store = useStore();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [items, setItems] = useState<SavedSession[]>([]);
  // Free-text filter over the meeting list (matches the title, case-insensitive).
  const [query, setQuery] = useState('');

  // On load, auto-replace any still-default (timestamp) title with the AI notes' topic, then persist
  // the ones that changed (sequential writes — AsyncStorage upsert is read-modify-write of the whole
  // map, so parallel writes would clobber each other).
  // Reload + resume. Resuming is the other half of durable jobs (lib/job.ts): a transcription that
  // was still uploading or still being processed when the app was backgrounded / killed gets picked
  // back up here, so progress keeps advancing across launches instead of being silently dropped.
  const load = useCallback(async () => {
    const list = await store.list();
    // Once per launch, repair the RIFF header of any WAV left truncated by a crash. Incremental
    // persistence means a crashed recording is usually ALREADY in the store, so it never reaches the
    // orphan scan below — without this it would sit in the list as an unplayable '音檔無法播放'.
    if (!wavRepairDone) { wavRepairDone = true; await repairWavParts(list); }
    // Recover any on-disk recordings with no store entry (e.g. the app crashed mid-recording before
    // the session was saved) so they reappear as drafts instead of being silently lost.
    const recovered = await recoverOrphanedRecordings(new Set(list.map((s) => s.id)));
    for (const r of recovered) await store.upsert(r);
    const full = recovered.length ? await store.list() : list;
    const promoted = full.map(promoteTitleFromNotes);
    setItems(promoted);
    for (let i = 0; i < full.length; i++) {
      if (promoted[i] !== full[i]) await store.upsert(promoted[i]);
    }
    void resumeAllJobs(store);
  }, [store]);

  useFocusEffect(useCallback(() => {
    void load();
    // Live-refresh the list while a job runs in the background (progress badge on the card).
    return onJobChange(() => { void load(); });
  }, [load]));

  // Permanently remove a recording: drop it from the list immediately, then delete its audio files
  // and the stored entry. The device is the source of truth, so this frees the on-device storage.
  const onDelete = async (id: string) => {
    setItems((prev) => prev.filter((s) => s.id !== id));
    await store.remove(id);
    await deleteSessionFiles(id);
  };

  // Apply the search filter (title contains the query, case-insensitive) before grouping.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((s) => s.title.toLowerCase().includes(q));
  }, [items, query]);

  // Bucket into 今天 / 本週 / 更早 for the section headers. `now` is captured per render; groupSessions
  // preserves the store's newest-first order within each group.
  const sections = useMemo(() => {
    const now = Date.now();
    return groupSessions(filtered, now).map((g) => ({ title: g.key, data: g.items, now }));
  }, [filtered]);

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={styles.h1}>好記</Text>
        {items.length > 0 && <Text style={styles.count}>{items.length} 場會議</Text>}
      </View>

      {items.length > 0 && (
        <View style={styles.searchWrap}>
          <IconSearch size={17} color={colors.ink3} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="搜尋會議"
            placeholderTextColor={colors.ink3}
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoCorrect={false}
          />
        </View>
      )}

      {items.length === 0 ? (
        <Text style={styles.empty} accessibilityRole="text">還沒有錄音，點下面開始第一筆。</Text>
      ) : filtered.length === 0 ? (
        <Text style={styles.empty} accessibilityRole="text">找不到符合「{query.trim()}」的會議。</Text>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text style={styles.dayGroup}>{section.title}</Text>
          )}
          renderItem={({ item, section }) => (
            <SwipeRow
              testID={`session-${item.id}`}
              confirmTitle={`刪除「${item.title}」`}
              onDelete={() => onDelete(item.id)}
            >
              <SessionCard
                session={item}
                now={section.now}
                // Pass the already-loaded session so Results renders instantly during the push (no
                // empty-loading flash mid-transition on device).
                onPress={() => nav.navigate('Results', { sessionId: item.id, session: item })}
              />
            </SwipeRow>
          )}
        />
      )}

      <View style={styles.fabbar}>
        <Pressable style={styles.primary} onPress={() => nav.navigate('Record')} accessibilityRole="button">
          <Text style={styles.primaryText}>新會議</Text>
        </Pressable>
      </View>
    </View>
  );
}

function SessionCard({ session, now, onPress }: { session: SavedSession; now: number; onPress: () => void }) {
  const dur = durationLabel(session);
  const speakers = speakerCount(session);
  const { initials, overflow } = avatarSpec(session);
  const transcribed = hasTranscript(session);
  const noted = hasNotes(session);

  return (
    <Pressable style={styles.card} onPress={onPress} accessibilityRole="button">
      <View style={styles.cardTop}>
        <Text style={styles.cardTitle} numberOfLines={1}>{session.title}</Text>
        <Text style={styles.chev}>›</Text>
      </View>

      <View style={styles.meta}>
        <Text style={[styles.metaText, tabularNums]}>{relativeDay(session.createdAt, now)}</Text>
        {dur && (
          <>
            <Text style={styles.metaSep}>·</Text>
            <Text style={[styles.metaText, tabularNums]}>{dur}</Text>
          </>
        )}
        {speakers > 0 && (
          <>
            <Text style={styles.metaSep}>·</Text>
            <Text style={styles.metaText}>{speakers} 位講者</Text>
          </>
        )}
      </View>

      <View style={styles.foot}>
        <View style={styles.avatars}>
          {initials.map((ch, i) => (
            <View key={i} style={[styles.av, { backgroundColor: speakerColor(i), marginLeft: i === 0 ? 0 : -7 }]}>
              <Text style={styles.avText}>{ch}</Text>
            </View>
          ))}
          {overflow > 0 && (
            <View style={[styles.av, styles.avMore, { marginLeft: initials.length === 0 ? 0 : -7 }]}>
              <Text style={styles.avMoreText}>+{overflow}</Text>
            </View>
          )}
        </View>

        <View style={styles.pills}>
          {isActive(session.job) && (
            <View style={[styles.pill, styles.pillBusy]}>
              <Text style={styles.pillBusyText}>處理中 {Math.round(overallPct(session.job!) * 100)}%</Text>
            </View>
          )}
          {/* Notes generation is the slowest step, so surface its progress right here in the list
              rather than making the user open the meeting to find out whether anything is happening. */}
          {isNotesActive(session.notesJob) && (
            <View style={[styles.pill, session.notesJob?.stage === 'queued' ? styles.pillWait : styles.pillBusy]}>
              <Text style={session.notesJob?.stage === 'queued' ? styles.pillWaitText : styles.pillBusyText}>
                {session.notesJob?.stage === 'queued'
                  ? (session.notesJob.message || '排隊中…')
                  : `生成記錄中${typeof session.notesJob?.pct === 'number' ? ` ${Math.round(session.notesJob.pct * 100)}%` : ''}`}
              </Text>
            </View>
          )}
          {transcribed && <DonePill label="逐字稿" />}
          {noted ? <DonePill label="記錄" /> : transcribed ? <TodoPill label="未生成記錄" /> : null}
        </View>
      </View>
    </Pressable>
  );
}

function DonePill({ label }: { label: string }) {
  return (
    <View style={[styles.pill, styles.pillDone]}>
      <View style={styles.tick}><Text style={styles.tickText}>✓</Text></View>
      <Text style={styles.pillDoneText}>{label}</Text>
    </View>
  );
}

function TodoPill({ label }: { label: string }) {
  return (
    <View style={[styles.pill, styles.pillTodo]}>
      <Text style={styles.pillTodoText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper, paddingTop: 60 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 8 },
  h1: { fontSize: 28, fontWeight: '800', color: colors.ink, letterSpacing: -0.5 },
  count: { fontSize: 13, color: colors.ink3, fontWeight: '500' },
  empty: { color: colors.ink3, fontSize: 15, marginTop: 40, textAlign: 'center' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 4, marginBottom: 4,
    backgroundColor: colors.card, borderRadius: radius.control,
    paddingHorizontal: 12, height: 40,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.ink, padding: 0 },

  listContent: { paddingHorizontal: 16, paddingBottom: 12 },
  dayGroup: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: colors.ink3, paddingHorizontal: 4, paddingTop: 12, paddingBottom: 8 },

  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 15, marginBottom: 10, ...cardShadow },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.ink, letterSpacing: -0.2 },
  chev: { color: colors.ink3, fontSize: 20, marginLeft: 8 },

  meta: { flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' },
  metaText: { fontSize: 12.5, color: colors.ink2 },
  metaSep: { fontSize: 12.5, color: colors.ink3, marginHorizontal: 7 },

  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  av: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.card },
  avText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  avMore: { backgroundColor: colors.neutralSoft },
  avMoreText: { fontSize: 11, fontWeight: '700', color: colors.ink2 },

  pills: { flexDirection: 'row', alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 9, borderRadius: radius.pill, marginLeft: 6 },
  pillDone: { backgroundColor: colors.goodSoft },
  pillDoneText: { fontSize: 11, fontWeight: '600', color: colors.good },
  tick: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.good, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  tickText: { fontSize: 8, color: '#fff', fontWeight: '700', lineHeight: 10 },
  pillBusy: { backgroundColor: colors.brandSoft },
  // waiting for a worker — deliberately quieter than the active-work badge
  pillWait: { backgroundColor: colors.chipBg },
  pillWaitText: { fontSize: 11, fontWeight: '600', color: colors.ink2 },
  pillBusyText: { fontSize: 11, fontWeight: '700', color: colors.brand },
  pillTodo: { backgroundColor: colors.chipBg },
  pillTodoText: { fontSize: 11, fontWeight: '600', color: colors.ink3 },

  fabbar: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 22 },
  primary: { flexDirection: 'row', backgroundColor: colors.brand, borderRadius: radius.card, height: 50, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
