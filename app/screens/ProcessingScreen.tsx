import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { getSession } from '../lib/api';
import { useStore } from '../lib/store-context';

export default function ProcessingScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const store = useStore();
  const sessionId: string = route.params.sessionId;
  const [message, setMessage] = useState('準備中…');
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    (async () => {
      while (!cancelled.current) {
        let s; try { s = await getSession(sessionId); } catch { await delay(1500); continue; }
        setMessage(s.message || s.status);
        if (s.status === 'done') {
          const existing = await store.get(sessionId);
          await store.upsert({
            id: sessionId, createdAt: existing?.createdAt ?? Date.now(),
            title: existing?.title ?? new Date().toLocaleString(),
            transcript: s.transcript, names: existing?.names ?? {},
            notes: existing?.notes, unlocked: existing?.unlocked ?? false,
          });
          nav.replace('Results', { sessionId });
          return;
        }
        if (s.status === 'error') { setError(s.error || s.message || '辨識失敗'); return; }
        await delay(1500);
      }
    })();
    return () => { cancelled.current = true; };
  }, [sessionId]);

  if (error) return (
    <View style={styles.center}>
      <Text style={styles.err}>{error}</Text>
      <Pressable style={styles.back} onPress={() => nav.navigate('Home')}><Text style={styles.backText}>返回</Text></Pressable>
    </View>
  );
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color="#E5342B" />
      <Text style={styles.msg}>{message}</Text>
    </View>
  );
}
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', padding: 24 },
  msg: { marginTop: 16, color: '#8e8e93', fontSize: 15 },
  err: { color: '#E5342B', fontSize: 16, textAlign: 'center' },
  back: { marginTop: 24, paddingVertical: 10, paddingHorizontal: 24, borderRadius: 20, backgroundColor: '#f2f2f7' },
  backText: { color: '#1c1c1e', fontWeight: '600' },
});
