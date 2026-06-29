import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { usePlayer } from '../hooks/usePlayer';
import { mmss } from '../lib/transcript';

type Part = { uri: string; durationMs: number };

export default function RecordingsList({ parts }: { parts: Part[] }) {
  const player = usePlayer();
  if (parts.length === 0) return null;
  return (
    <View style={styles.container}>
      {parts.map((part, i) => (
        <View key={i} style={styles.row}>
          <Text style={styles.label}>段 {i + 1}</Text>
          <Text style={styles.duration}>{mmss(part.durationMs / 1000)}</Text>
          <Pressable
            testID={`play-${i}`}
            onPress={() => player.load(part.uri).then(() => player.toggle())}
            style={styles.playBtn}
          >
            <Text style={styles.playIcon}>▶</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  label: { fontWeight: '600', minWidth: 36, color: '#1c1c1e' },
  duration: { flex: 1, color: '#8e8e93', fontSize: 14 },
  playBtn: { padding: 8 },
  playIcon: { fontSize: 16, color: '#E5342B' },
});
