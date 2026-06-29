import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { useRecorder } from '../hooks/useRecorder';
import { createSession, uploadPart } from '../lib/api';
import { mmss } from '../lib/transcript';
import { useStore } from '../lib/store-context';

export default function RecordScreen() {
  const sidRef = React.useRef<string | null>(null);
  const store = useStore();
  const nav = useNavigation<any>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  React.useEffect(() => {
    createSession().then((id) => {
      sidRef.current = id;
      store.upsert({ id, createdAt: Date.now(), title: new Date().toLocaleString(), names: {}, unlocked: false, parts: [] });
    });
  }, []);

  const rec = useRecorder(sidRef.current || 'pending');

  async function onStop() {
    const parts = await rec.stop();
    const id = sidRef.current!;
    const existing = await store.get(id);
    await store.upsert({ ...(existing as any), parts });
    nav.replace('Processing', { sessionId: id });
  }

  async function onUpload() {
    const res = await DocumentPicker.getDocumentAsync({ type: ['audio/*', 'video/*'], copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    setBusy(true); setErr(null);
    try {
      const a = res.assets[0];
      const id = await createSession();
      const createdAt = Date.now();
      const title = new Date().toLocaleString();
      await store.upsert({ id, createdAt, title, names: {}, unlocked: false, parts: [] });
      const file = { uri: a.uri, name: a.name, mime: a.mimeType || 'application/octet-stream' };
      await uploadPart(id, file);
      await store.upsert({ id, createdAt, title, names: {}, unlocked: false, parts: [{ uri: a.uri, durationMs: 0 }] });
      nav.replace('Processing', { sessionId: id });
    } catch (e: any) { setErr(e?.message || '上傳失敗'); setBusy(false); }
  }

  const isRec = rec.state === 'recording';
  const isPaused = rec.state === 'paused';
  const scale = 1 + Math.min(0.25, rec.meteringLevel * 0.25);

  if (busy) return <View style={styles.center}><ActivityIndicator color="#E5342B" size="large" /><Text style={styles.hint}>上傳中…</Text></View>;

  return (
    <View style={styles.container}>
      <Text style={styles.time}>{mmss(Math.floor(rec.durationMs / 1000))}</Text>
      <View style={styles.recordWrap}>
        <View style={[styles.ring, { transform: [{ scale }], opacity: isRec ? 0.35 : 0 }]} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isRec ? '停止錄音' : '開始錄音'}
          style={[styles.recordBtn, (isRec || isPaused) && styles.recordBtnActive]}
          onPress={isRec || isPaused ? onStop : rec.start}
        >
          <View style={isRec ? styles.squareIcon : styles.circleIcon} />
        </Pressable>
      </View>
      {(isRec || isPaused) && !rec.wasInterrupted && (
        <Pressable style={styles.secondary} onPress={isPaused ? rec.resume : rec.pause} accessibilityRole="button">
          <Text style={styles.secondaryText}>{isPaused ? '繼續' : '暫停'}</Text>
        </Pressable>
      )}
      {rec.wasInterrupted && (
        <View style={styles.resumeRow}>
          <Text style={styles.resumeText}>錄音被中斷，要接著錄嗎？</Text>
          <Pressable onPress={rec.resume}><Text style={styles.resumeBtn}>繼續</Text></Pressable>
          <Pressable onPress={onStop}><Text style={styles.resumeBtn}>結束</Text></Pressable>
        </View>
      )}
      {rec.state === 'idle' && (
        <Pressable style={styles.uploadBtn} onPress={onUpload} accessibilityRole="button">
          <Text style={styles.uploadText}>上傳音檔 / 影片</Text>
        </Pressable>
      )}
      {err && <Text style={styles.err}>{err}</Text>}
    </View>
  );
}

const RED = '#E5342B';
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  hint: { color: '#8e8e93', marginTop: 12 },
  time: { fontSize: 44, fontWeight: '300', color: '#1c1c1e', fontVariant: ['tabular-nums'], marginBottom: 40 },
  recordWrap: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 200, height: 200, borderRadius: 100, backgroundColor: RED },
  recordBtn: { width: 120, height: 120, borderRadius: 60, backgroundColor: RED, alignItems: 'center', justifyContent: 'center' },
  recordBtnActive: { backgroundColor: '#fff', borderWidth: 4, borderColor: RED },
  circleIcon: { width: 0, height: 0 },
  squareIcon: { width: 34, height: 34, borderRadius: 6, backgroundColor: RED },
  secondary: { marginTop: 36, paddingVertical: 10, paddingHorizontal: 28, borderRadius: 22, backgroundColor: '#f2f2f7' },
  secondaryText: { color: '#1c1c1e', fontSize: 16, fontWeight: '600' },
  uploadBtn: { marginTop: 48, paddingVertical: 12, paddingHorizontal: 24 },
  uploadText: { color: RED, fontSize: 16, fontWeight: '600' },
  err: { color: RED, marginTop: 20 },
  resumeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 24, gap: 12 },
  resumeText: { color: '#1c1c1e', fontSize: 15 },
  resumeBtn: { color: RED, fontSize: 15, fontWeight: '600' },
});
