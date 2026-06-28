import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useStore } from '../lib/store-context';
import { SavedSession } from '../lib/store';
import { RootStackParamList } from '../navigation';

export default function HomeScreen() {
  const store = useStore();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [items, setItems] = useState<SavedSession[]>([]);

  useFocusEffect(useCallback(() => { store.list().then(setItems); }, [store]));

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>好記</Text>
      {items.length === 0 ? (
        <Text style={styles.empty} accessibilityRole="text">還沒有錄音，點下面開始第一筆。</Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => nav.navigate('Results', { sessionId: item.id })}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowMeta}>{new Date(item.createdAt).toLocaleString()}</Text>
            </Pressable>
          )}
        />
      )}
      <Pressable style={styles.primary} onPress={() => nav.navigate('Record')} accessibilityRole="button">
        <Text style={styles.primaryText}>＋ 新錄音</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 20, paddingTop: 60 },
  h1: { fontSize: 28, fontWeight: '800', color: '#1c1c1e', marginBottom: 16 },
  empty: { color: '#8e8e93', fontSize: 15, marginTop: 40, textAlign: 'center' },
  row: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  rowTitle: { fontSize: 16, fontWeight: '600', color: '#1c1c1e' },
  rowMeta: { fontSize: 12, color: '#8e8e93', marginTop: 2 },
  primary: { backgroundColor: '#E5342B', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 12 },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
