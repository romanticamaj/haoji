import React from 'react';
import { ScrollView, View, Text, TextInput, StyleSheet } from 'react-native';
import { SavedSession } from '../lib/store';
import { mmss, nameOf, mergedParagraphs } from '../lib/transcript';

export default function TranscriptTab({ session, onUpdate }: { session: SavedSession; onUpdate(s: SavedSession): void }) {
  const segs = session.transcript?.segments ?? [];
  const speakers = session.transcript?.speakers ?? [];
  const setName = (sp: string, name: string) =>
    onUpdate({ ...session, names: { ...session.names, [sp]: name } });

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.speakerRow}>
        {speakers.map((sp) => (
          <TextInput key={sp} style={styles.nameInput} placeholder="講者名稱"
            defaultValue={session.names[sp] ?? ''} onChangeText={(t) => setName(sp, t)} />
        ))}
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
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 16 },
  speakerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 12 },
  nameInput: { borderWidth: 1, borderColor: '#e5e5ea', borderRadius: 16, paddingVertical: 5, paddingHorizontal: 12, minWidth: 96, fontSize: 13 },
  para: { flexDirection: 'row', gap: 10, paddingVertical: 8 },
  ts: { width: 44, color: '#8e8e93', fontSize: 12, fontVariant: ['tabular-nums'], paddingTop: 2 },
  body: { flex: 1 },
  who: { fontSize: 12, fontWeight: '700', color: '#E5342B', marginBottom: 1 },
  txt: { fontSize: 15, color: '#1c1c1e', lineHeight: 22 },
});
