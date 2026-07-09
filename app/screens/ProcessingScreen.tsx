import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { createSession, uploadPart, transcribe, getSession } from '../lib/api';
import { resolvePartUri } from '../lib/recordings';
import { useStore } from '../lib/store-context';

export default function ProcessingScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const store = useStore();
  // Local id (device source of truth). The backend draft session is created lazily below; all
  // results are persisted back under this local id.
  const sessionId: string = route.params.sessionId;
  // regen (from "重新生成逐字稿"): force a brand-new backend session instead of reusing the old
  // backendId, whose uploaded parts were already deleted server-side after the previous attempt.
  const regen: boolean = route.params.regen ?? false;
  const [message, setMessage] = useState('準備中…');
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  // Ensures the upload pipeline runs at most once per mount — a second run would re-upload the same
  // audio and, combined with any backend hiccup, is exactly how duplicates crept in.
  const started = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    (async () => {
      if (started.current) return;
      started.current = true;
      const s0 = await store.get(sessionId);
      const parts = s0?.parts ?? [];

      // Create the backend draft session now (recording/upload up to this point was fully offline).
      // Reuse an existing backendId if this screen is retried; otherwise create one keyed on the
      // local session id (idempotency/task key) so a duplicated pipeline maps to ONE server session.
      setMessage('連線後端…');
      let backendId: string;
      try { backendId = (!regen && s0?.backendId) ? s0.backendId : (await createSession(regen ? undefined : sessionId)); }
      catch { setError('無法連線後端，請確認手機已連上 Tailscale／後端已啟動。'); return; }
      if (cancelled.current) return;
      // Persist backendId immediately so a retry/analyze reuses the same server session.
      if (backendId !== s0?.backendId) {
        const cur = await store.get(sessionId);
        if (cur) await store.upsert({ ...cur, backendId });
      }

      for (let i = 0; i < parts.length; i++) {
        setMessage(`上傳中… ${i + 1}/${parts.length}`);
        try { await uploadPart(backendId, { uri: resolvePartUri(parts[i].uri), name: `part-${i}.m4a`, mime: 'audio/mp4' }, i); }
        catch (e: any) { setError('上傳失敗：' + (e?.message || '')); return; }
      }
      setMessage('開始辨識…');
      try { await transcribe(backendId); }
      catch (e: any) { setError(e?.message || '辨識失敗'); return; }
      while (!cancelled.current) {
        let s; try { s = await getSession(backendId); } catch { await delay(1500); continue; }
        setMessage(s.message || s.status);
        if (s.status === 'done') {
          const existing = await store.get(sessionId);
          await store.upsert({
            id: sessionId, createdAt: existing?.createdAt ?? Date.now(),
            title: existing?.title ?? new Date().toLocaleString(),
            transcript: s.transcript, names: existing?.names ?? {},
            notes: existing?.notes, unlocked: existing?.unlocked ?? false,
            parts: existing?.parts ?? [], backendId,
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
      <View style={styles.errActions}>
        {/* retry with a fresh backend session (regen) so a partial/failed upload starts clean */}
        <Pressable style={styles.retry} onPress={() => nav.replace('Processing', { sessionId, regen: true })}>
          <Text style={styles.retryText}>重試</Text>
        </Pressable>
        <Pressable style={styles.back} onPress={() => nav.navigate('Home')}><Text style={styles.backText}>返回</Text></Pressable>
      </View>
    </View>
  );
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color="#E5342B" />
      <Text style={styles.msg}>{message}</Text>
    </View>
  );
}
const delay = (ms: number) => new Promise<void>((r) => setTimeout(() => r(), ms));
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', padding: 24 },
  msg: { marginTop: 16, color: '#8e8e93', fontSize: 15 },
  err: { color: '#E5342B', fontSize: 16, textAlign: 'center' },
  errActions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  retry: { paddingVertical: 10, paddingHorizontal: 24, borderRadius: 20, backgroundColor: '#E5342B' },
  retryText: { color: '#fff', fontWeight: '700' },
  back: { paddingVertical: 10, paddingHorizontal: 24, borderRadius: 20, backgroundColor: '#f2f2f7' },
  backText: { color: '#1c1c1e', fontWeight: '600' },
});
