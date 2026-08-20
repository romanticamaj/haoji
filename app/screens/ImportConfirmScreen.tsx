import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useStore } from '../lib/store-context';
import { moveToPart, mergeSessionParts, fsPath } from '../lib/recordings';
import { storageExtFor, isVideo } from '../lib/importMedia';
import * as audioExtract from '../lib/audioExtract';
import * as audioMerge from '../lib/audioMerge';
import {
  buildCandidates, toggle, selected, canMerge, canImport, totalDurationMs, ImportCandidate,
} from '../lib/importSelection';
import { mmss } from '../lib/transcript';
import { IconCheck, IconAlert } from '../components/icons';
import { colors, radius } from '../lib/theme';

const makeLocalId = () => `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Confirm what was picked before committing to it.
 *
 * Several picked files usually mean "these are one meeting", but not always — a pick can include the
 * wrong file, something that isn't audio at all, or recordings that shouldn't be welded together.
 * Joining is not undoable, so we show what each file actually IS (decoded, not guessed from the
 * extension) and let the user decide what to include and whether to join it.
 */
export default function ImportConfirmScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const store = useStore();
  const files: { uri: string; name: string }[] = route.params?.files ?? [];

  const [list, setList] = useState<ImportCandidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const probes = await audioMerge.probe(files.map((f) => fsPath(f.uri)));
      // probe answers are keyed by the decoded path we sent, so map them back onto the picked uris
      const byUri = files.map((f, i) => ({ ...probes[i], path: f.uri }));
      setList(buildCandidates(files, byUri));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function commit(merge: boolean) {
    if (!list) return;
    const chosen = selected(list);
    if (chosen.length === 0) return;
    setBusy('準備中…');

    const id = makeLocalId();
    const createdAt = Date.now();
    const title = new Date().toLocaleString();
    const parts: { uri: string; durationMs: number }[] = [];
    try {
      for (let i = 0; i < chosen.length; i++) {
        const src = chosen[i].uri;
        let rel: string;
        if (isVideo(src) && audioExtract.available) {
          setBusy(`擷取音訊中… ${i + 1}/${chosen.length}`);
          const tmp = `${require('react-native-fs').CachesDirectoryPath}/extract-${id}-${i}.m4a`;
          try {
            await audioExtract.extractAudio(fsPath(src), tmp);
            rel = await moveToPart(id, i, tmp, 'm4a');
          } catch {
            rel = await moveToPart(id, i, src, 'm4a');
          }
        } else {
          rel = await moveToPart(id, i, src, storageExtFor(src));
        }
        parts.push({ uri: rel, durationMs: chosen[i].durationMs || 0 });
      }
      await store.upsert({ id, createdAt, title, names: {}, unlocked: false, parts });

      if (merge && parts.length > 1) {
        setBusy('合併音檔中…');
        const merged = await mergeSessionParts(id, parts);
        if (merged) await store.upsert({ id, createdAt, title, names: {}, unlocked: false, parts: merged });
      }
      nav.replace('Review', { sessionId: id });
    } catch (e: any) {
      setBusy(null);
      nav.goBack();
    }
  }

  if (busy) return (
    <View style={styles.center}><ActivityIndicator size="large" color={colors.brand} /><Text style={styles.busy}>{busy}</Text></View>
  );
  if (!list) return (
    <View style={styles.center}><ActivityIndicator color={colors.brand} /><Text style={styles.busy}>檢查音檔中…</Text></View>
  );

  const usable = selected(list).length;
  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={styles.title}>確認要匯入的音檔</Text>
        <Text style={styles.sub}>
          已選 {usable}/{list.length} 個{usable > 0 ? ` · 共 ${mmss(Math.floor(totalDurationMs(list) / 1000))}` : ''}
        </Text>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 12 }}>
        {list.map((c) => (
          <Pressable
            key={c.uri}
            testID={`file-${c.name}`}
            style={[styles.row, !c.ok && styles.rowBad]}
            onPress={() => setList(toggle(list, c.uri))}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: c.selected, disabled: !c.ok }}
          >
            <View style={[styles.box, c.selected && styles.boxOn, !c.ok && styles.boxOff]}>
              {c.selected && <IconCheck size={13} color="#fff" strokeWidth={3} />}
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.name, !c.ok && styles.nameBad]} numberOfLines={1}>{c.name}</Text>
              <Text style={styles.meta}>
                {c.ok ? mmss(Math.floor(c.durationMs / 1000)) : (c.reason || '無法使用')}
              </Text>
            </View>
            {!c.ok && <IconAlert size={18} color={colors.brand} />}
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.actions}>
        <Pressable
          style={[styles.primary, !canMerge(list) && styles.disabled]}
          disabled={!canMerge(list)}
          onPress={() => commit(true)}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>合併成一段並繼續</Text>
        </Pressable>
        <Pressable
          style={[styles.secondary, !canImport(list) && styles.disabled]}
          disabled={!canImport(list)}
          onPress={() => commit(false)}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>保持分開</Text>
        </Pressable>
        <Pressable style={styles.cancel} onPress={() => nav.goBack()} accessibilityRole="button">
          <Text style={styles.cancelText}>取消</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
  busy: { marginTop: 14, color: colors.ink2, fontSize: 15 },

  head: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 19, fontWeight: '800', color: colors.ink, letterSpacing: -0.3 },
  sub: { fontSize: 13, color: colors.ink2, marginTop: 5 },

  list: { flex: 1, paddingHorizontal: 16 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderRadius: radius.card, padding: 14, marginBottom: 8,
  },
  rowBad: { backgroundColor: colors.chipBg },
  box: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.neutralSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  boxOff: { borderStyle: 'dashed' },
  rowText: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: colors.ink },
  nameBad: { color: colors.ink3 },
  meta: { fontSize: 12.5, color: colors.ink3, marginTop: 3 },

  actions: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 26, gap: 8 },
  primary: { backgroundColor: colors.brand, borderRadius: radius.card, height: 50, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondary: { backgroundColor: colors.chipBg, borderRadius: radius.card, height: 46, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  cancel: { height: 40, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: colors.ink3, fontSize: 14, fontWeight: '600' },
});
