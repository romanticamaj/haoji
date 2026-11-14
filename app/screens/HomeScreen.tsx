import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, SectionList, Pressable, TextInput, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../lib/store-context';
import { SavedSession } from '../lib/store';
import { deleteSessionFiles, recoverOrphanedRecordings, repairWavParts } from '../lib/recordings';
import { RootStackParamList } from '../navigation';
import SwipeRow from '../components/SwipeRow';
import { AppText } from '../components/AppText';
import { BrandHeader } from '../components/BrandHeader';
import { BottomActionBar } from '../components/BottomActionBar';
import { EmptyState } from '../components/EmptyState';
import { UndoSnackbar } from '../components/UndoSnackbar';
import { ImportSheet } from '../components/ImportSheet';
import { SearchResults } from '../components/SearchResults';
import { IconAudioLines, IconFile, IconSearch, IconUser } from '../components/icons';
import { colors, layout, radius, spacing, tabularNums, speakerColor, typography } from '../lib/theme';
import {
  groupSessions, relativeDay, durationLabel, speakerCount, avatarSpec, inlineStatus,
} from '../lib/sessionList';
import { searchSessions, type SearchHit } from '../lib/search';
import { promoteTitleFromNotes } from '../lib/notesDoc';
import { resumeAllJobs, onJobChange } from '../lib/jobRunner';
import { useImport } from '../hooks/useImport';
import { useServerStatus } from '../hooks/useServerStatus';
import { deleteRemote } from '../lib/api';

/** Search runs this long after the last keystroke, so typing a word doesn't search every letter. */
export const SEARCH_DEBOUNCE_MS = 150;
// The import sheet slides away before a picker is presented: iOS refuses to present the picker over
// a modal that is still dismissing.
const SHEET_CLOSE_MS = 350;

// Repair crash-truncated WAV headers once per app launch (not on every screen focus).
let wavRepairDone = false;

export default function HomeScreen() {
  const store = useStore();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<SavedSession[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const imp = useImport({ leave: 'navigate' });
  const srv = useServerStatus();

  // Soft delete: the meeting disappears at once and 復原 brings it back; only when the snackbar
  // times out (or another delete / leaving the screen supersedes it) are its files actually removed.
  const [pending, setPending] = useState<SavedSession | null>(null);
  const pendingRef = useRef<SavedSession | null>(null);
  pendingRef.current = pending;

  const commitDelete = useCallback(async (s: SavedSession | null) => {
    if (!s) return;
    await store.remove(s.id);
    await deleteSessionFiles(s.id);
    // Final now, so the server may drop its copy too. Fire-and-forget: never blocks or fails a delete.
    if (s.backendId) void deleteRemote(s.backendId);
  }, [store]);

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
    // Auto-replace any still-default (timestamp) title with the notes' topic, then persist the ones
    // that changed (sequential writes — AsyncStorage upsert is read-modify-write of the whole map).
    const promoted = full.map(promoteTitleFromNotes);
    setItems(promoted);
    setLoaded(true);
    for (let i = 0; i < full.length; i++) {
      if (promoted[i] !== full[i]) await store.upsert(promoted[i]);
    }
    void resumeAllJobs(store);
  }, [store]);

  useFocusEffect(useCallback(() => {
    void load();
    // Live-refresh the list while a job runs in the background (progress on the card).
    const off = onJobChange(() => { void load(); });
    return () => {
      off();
      // Leaving Home makes a pending delete final — the 復原 offer is gone with the snackbar.
      if (pendingRef.current) { void commitDelete(pendingRef.current); setPending(null); }
    };
  }, [load, commitDelete]));

  const onDelete = (s: SavedSession) => {
    // A second delete supersedes the first offer, so the first becomes permanent now.
    if (pendingRef.current) void commitDelete(pendingRef.current);
    setPending(s);
  };
  const onTimeout = useCallback(() => {
    void commitDelete(pendingRef.current);
    setPending(null);
  }, [commitDelete]);

  // Import failures are stated plainly: what failed, that the original is untouched, what to do.
  useEffect(() => {
    if (!imp.err) return;
    Alert.alert('沒有匯入', imp.err, [{ text: '好', onPress: () => imp.setErr(null) }]);
  }, [imp.err]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => items.filter((s) => s.id !== pending?.id), [items, pending]);

  // Search (lib/search): title, speaker names, notes and transcript, debounced.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);
  const activeQuery = searching ? debounced : '';
  const hits = useMemo(() => (activeQuery ? searchSessions(visible, activeQuery) : []), [visible, activeQuery]);
  const byId = useMemo(() => new Map(visible.map((s) => [s.id, s])), [visible]);
  const openHit = (h: SearchHit) => {
    const session = byId.get(h.sessionId);
    nav.navigate('Results', {
      sessionId: h.sessionId,
      ...(session ? { session } : {}),
      // Results scrolling to this turn lands separately; the param is already passed.
      ...(h.segmentIndex != null ? { focusSegment: h.segmentIndex } : {}),
    });
  };

  // Bucket into 今天 / 本週 / 更早. `now` is captured per render; order within a group is newest-first.
  const sections = useMemo(() => {
    const now = Date.now();
    return groupSessions(visible, now).map((g) => ({ title: g.key, data: g.items, now }));
  }, [visible]);

  const toggleSearch = () => {
    setSearching((on) => { if (on) { setQuery(''); setDebounced(''); } return !on; });
  };

  const importAfterClose = (run: () => void) => {
    setImportOpen(false);
    setTimeout(run, SHEET_CLOSE_MS);
  };

  if (imp.busyMsg) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <AppText variant="body" color="muted" style={styles.busy}>{imp.busyMsg}</AppText>
      </View>
    );
  }

  const barBottom = layout.bottomBarHeight + Math.max(insets.bottom, spacing.sm) + spacing.md;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <BrandHeader
        onSearch={visible.length > 0 ? toggleSearch : undefined}
        searching={searching}
        status={{
          tone: srv.summary.tone,
          label: srv.loading ? '正在確認…' : srv.summary.label,
          onPress: () => nav.navigate('Settings'),
        }}
      />

      {searching && (
        <View style={styles.searchWrap}>
          <IconSearch size={18} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="搜尋會議"
            placeholderTextColor={colors.hint}
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoCorrect={false}
            autoFocus
            accessibilityLabel="搜尋會議"
          />
        </View>
      )}

      {!loaded ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<IconAudioLines size={30} color={colors.primaryDark} />}
          title="還沒有任何會議"
          description="按下方的「記下來」開始錄音，或匯入一段音檔。"
        />
      ) : activeQuery && hits.length === 0 ? (
        <EmptyState
          icon={<IconSearch size={28} color={colors.muted} />}
          title={`找不到「${activeQuery}」`}
          description="換個關鍵字試試，或清除搜尋看全部會議。"
        />
      ) : activeQuery ? (
        <SearchResults hits={hits} titleOf={(id) => byId.get(id)?.title ?? ''} onOpen={openHit} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <AppText variant="section" color="heading" style={styles.group} accessibilityRole="header">
              {section.title}
            </AppText>
          )}
          renderItem={({ item, section }) => (
            <SwipeRow
              testID={`session-${item.id}`}
              deleteLabel={`刪除「${item.title}」`}
              onDelete={() => onDelete(item)}
              style={styles.rowGap}
            >
              <SessionCard
                session={item}
                now={section.now}
                // Pass the already-loaded session so Results renders instantly during the push.
                onPress={() => nav.navigate('Results', { sessionId: item.id, session: item })}
              />
            </SwipeRow>
          )}
        />
      )}

      <UndoSnackbar
        title={pending?.title ?? null}
        onUndo={() => setPending(null)}
        onTimeout={onTimeout}
        bottom={barBottom}
      />

      <BottomActionBar
        left={{ label: '匯入', a11y: '匯入音檔或影片', Icon: IconFile, onPress: () => setImportOpen(true), testID: 'home-import' }}
        onRecord={() => nav.navigate('Record')}
        right={{ label: '設定', a11y: '設定與資料', Icon: IconUser, onPress: () => nav.navigate('Settings'), testID: 'home-settings' }}
      />

      {importOpen && (
        <ImportSheet
          onClose={() => setImportOpen(false)}
          onAudio={() => importAfterClose(imp.pickFiles)}
          onVideo={() => importAfterClose(imp.pickVideo)}
        />
      )}
    </View>
  );
}

function SessionCard({ session, now, onPress }: { session: SavedSession; now: number; onPress: () => void }) {
  const dur = durationLabel(session);
  const speakers = speakerCount(session);
  const { initials, overflow } = avatarSpec(session);
  // The status rides at the end of the meta line (· 已有逐字稿 / · 處理中 / · 還沒生成).
  const meta = [relativeDay(session.createdAt, now), dur, speakers > 0 ? `${speakers} 位講者` : null, inlineStatus(session)]
    .filter(Boolean).join(' · ');

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${session.title}，${meta}`}
    >
      <AppText variant="cardTitle" color="heading" numberOfLines={1} style={styles.cardTitle}>{session.title}</AppText>
      <AppText variant="small" color="muted" style={tabularNums}>{meta}</AppText>

      {initials.length > 0 && (
        <View style={styles.avatars}>
          {initials.map((ch, i) => (
            <View key={i} style={[styles.av, { backgroundColor: speakerColor(i), marginLeft: i === 0 ? 0 : -6 }]}>
              <AppText variant="small" color="onPrimary" style={styles.avText}>{ch}</AppText>
            </View>
          ))}
          {overflow > 0 && (
            <View style={[styles.av, styles.avMore, { marginLeft: -6 }]}>
              <AppText variant="small" color="muted" style={styles.avText}>+{overflow}</AppText>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  busy: { marginTop: spacing.md },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: layout.screenPaddingH, marginTop: spacing.lg,
    backgroundColor: colors.surface, borderRadius: radius.input,
    borderWidth: layout.border, borderColor: colors.outline,
    paddingHorizontal: spacing.md, height: 48,
  },
  searchInput: { flex: 1, ...typography.body, lineHeight: undefined, color: colors.heading, padding: 0 },

  listContent: { paddingHorizontal: layout.screenPaddingH, paddingBottom: spacing.xxl },
  group: { marginTop: spacing.xxl, marginBottom: spacing.md },
  rowGap: { marginBottom: layout.itemGap },

  card: {
    backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg, gap: spacing.xs,
    borderWidth: layout.border, borderColor: colors.outline,
  },
  cardPressed: { opacity: 0.8 },
  cardTitle: { fontWeight: '600' },

  avatars: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  av: {
    width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.surface,
  },
  avText: { fontSize: 11, lineHeight: 13, fontWeight: '600' },
  avMore: { backgroundColor: colors.primarySoft },
});
