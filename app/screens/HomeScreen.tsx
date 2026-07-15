import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, SectionList, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useStore } from '../lib/store-context';
import { SavedSession } from '../lib/store';
import { deleteSessionFiles } from '../lib/recordings';
import { RootStackParamList } from '../navigation';
import SwipeRow from '../components/SwipeRow';
import { colors, radius, tabularNums, cardShadow, speakerColor } from '../lib/theme';
import {
  groupSessions, relativeDay, durationLabel, speakerCount, avatarSpec, hasTranscript, hasNotes,
} from '../lib/sessionList';
import { promoteTitleFromNotes } from '../lib/notesDoc';

export default function HomeScreen() {
  const store = useStore();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [items, setItems] = useState<SavedSession[]>([]);

  // On load, auto-replace any still-default (timestamp) title with the AI notes' topic, then persist
  // the ones that changed (sequential writes — AsyncStorage upsert is read-modify-write of the whole
  // map, so parallel writes would clobber each other).
  useFocusEffect(useCallback(() => {
    store.list().then(async (list) => {
      const promoted = list.map(promoteTitleFromNotes);
      setItems(promoted);
      for (let i = 0; i < list.length; i++) {
        if (promoted[i] !== list[i]) await store.upsert(promoted[i]);
      }
    });
  }, [store]));

  // Permanently remove a recording: drop it from the list immediately, then delete its audio files
  // and the stored entry. The device is the source of truth, so this frees the on-device storage.
  const onDelete = async (id: string) => {
    setItems((prev) => prev.filter((s) => s.id !== id));
    await store.remove(id);
    await deleteSessionFiles(id);
  };

  // Bucket into 今天 / 本週 / 更早 for the section headers. `now` is captured per render; groupSessions
  // preserves the store's newest-first order within each group.
  const sections = useMemo(() => {
    const now = Date.now();
    return groupSessions(items, now).map((g) => ({ title: g.key, data: g.items, now }));
  }, [items]);

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={styles.h1}>好記</Text>
        {items.length > 0 && <Text style={styles.count}>{items.length} 場會議</Text>}
      </View>

      {items.length === 0 ? (
        <Text style={styles.empty} accessibilityRole="text">還沒有錄音，點下面開始第一筆。</Text>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.listContent}
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
                onPress={() => nav.navigate('Results', { sessionId: item.id })}
              />
            </SwipeRow>
          )}
        />
      )}

      <View style={styles.fabbar}>
        <Pressable style={styles.primary} onPress={() => nav.navigate('Record')} accessibilityRole="button">
          <View style={styles.recDot} />
          <Text style={styles.primaryText}>＋ 新錄音</Text>
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
  pillTodo: { backgroundColor: colors.chipBg },
  pillTodoText: { fontSize: 11, fontWeight: '600', color: colors.ink3 },

  fabbar: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 22 },
  primary: { flexDirection: 'row', backgroundColor: colors.brand, borderRadius: radius.card, height: 50, alignItems: 'center', justifyContent: 'center' },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff', marginRight: 8 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
