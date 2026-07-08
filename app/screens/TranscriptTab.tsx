import React from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { SavedSession } from '../lib/store';
import { mmss, nameOf, mergedParagraphs } from '../lib/transcript';

export default function TranscriptTab(
  { session, onUpdate, onRegenerate }:
  { session: SavedSession; onUpdate(s: SavedSession): void; onRegenerate?(): void },
) {
  const segs = session.transcript?.segments ?? [];
  const speakers = session.transcript?.speakers ?? [];
  const hasParts = (session.parts?.length ?? 0) > 0;
  const [editing, setEditing] = React.useState<string | null>(null);
  const colorOf = (i: number) => ['#E5342B', '#1c7ed6', '#2f9e44', '#f08c00', '#9c36b5'][i % 5];
  const setName = (sp: string, name: string) => onUpdate({ ...session, names: { ...session.names, [sp]: name } });

  // Empty transcript (e.g. the backend dropped mid-transcription and never returned one) — offer a
  // full re-run rather than leaving the user stuck. Regeneration re-uploads the on-device parts to
  // a fresh backend session (the old one's parts are deleted after each attempt).
  if (segs.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>還沒有逐字稿</Text>
        <Text style={styles.emptyHint}>
          {hasParts ? '這次辨識沒有完成（後端可能中斷）。可以重新生成逐字稿再試一次。' : '找不到可辨識的錄音檔。'}
        </Text>
        {hasParts && onRegenerate && (
          <Pressable style={styles.primary} onPress={onRegenerate} accessibilityRole="button">
            <Text style={styles.primaryText}>重新生成逐字稿</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.speakerList}>
        {speakers.map((sp, i) => {
          const currentName = session.names[sp] || '';
          const isHint = !currentName;
          const displayName = currentName || '點此命名';
          return (
            <View key={sp}>
              <TouchableOpacity testID={`speaker-row-${sp}`} style={styles.speakerRow}
                onPress={() => setEditing(editing === sp ? null : sp)}>
                <View style={[styles.dot, { backgroundColor: colorOf(i) }]} />
                <Text style={styles.spLabel}>{sp}</Text>
                <Text style={[styles.spName, isHint && styles.spHint]}>
                  {displayName}
                </Text>
              </TouchableOpacity>
              {editing === sp && (
                <TextInput testID={`speaker-input-${sp}`} autoFocus style={styles.spInput}
                  defaultValue={currentName} placeholder="輸入名字"
                  onChangeText={(t) => setName(sp, t)} onSubmitEditing={() => setEditing(null)} />
              )}
            </View>
          );
        })}
      </View>
      {mergedParagraphs(segs).map((p, i) => (
        <View key={i} style={styles.para}>
          <Text style={styles.ts}>{mmss(p.start)}</Text>
          <View style={styles.body}>
            <Text style={styles.who}>{nameOf(p.speaker, session.names)}</Text>
            <Text style={styles.txt}>{p.text}</Text>
          </View>
        </View>
      ))}
      {hasParts && onRegenerate && (
        <Pressable style={styles.regenFooter} onPress={onRegenerate} accessibilityRole="button">
          <Text style={styles.regenText}>重新生成逐字稿</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
const RED = '#E5342B';
const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 16 },
  emptyWrap: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 28 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#1c1c1e', marginBottom: 8 },
  emptyHint: { color: '#8e8e93', fontSize: 14, textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  primary: { backgroundColor: RED, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 28, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  regenFooter: { marginTop: 20, marginBottom: 8, paddingVertical: 10, alignItems: 'center' },
  regenText: { color: RED, fontSize: 14, fontWeight: '600' },
  speakerList: { paddingVertical: 10 },
  speakerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  spLabel: { fontSize: 13, color: '#8e8e93', width: 96 },
  spName: { fontSize: 15, fontWeight: '600', color: '#1c1c1e', flex: 1 },
  spHint: { color: '#c7c7cc', fontWeight: '400' },
  spInput: { borderWidth: 1, borderColor: '#E5342B', borderRadius: 10, padding: 10, marginBottom: 6, fontSize: 15 },
  para: { flexDirection: 'row', gap: 10, paddingVertical: 8 },
  ts: { width: 44, color: '#8e8e93', fontSize: 12, fontVariant: ['tabular-nums'], paddingTop: 2 },
  body: { flex: 1 },
  who: { fontSize: 12, fontWeight: '700', color: '#E5342B', marginBottom: 1 },
  txt: { fontSize: 15, color: '#1c1c1e', lineHeight: 22 },
});
