import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { pick, keepLocalCopy, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { useRecorder } from '../hooks/useRecorder';
import { moveToPart } from '../lib/recordings';
import { mmss } from '../lib/transcript';
import { useStore } from '../lib/store-context';
import Waveform from '../components/Waveform';
import BreathingRing from '../components/BreathingRing';

// Recording is local-first: the session id is generated on-device so the record button is never
// gated on a backend round-trip (the GPU box is often unreachable from the phone unless Tailscale
// is up). The backend draft session is created lazily in ProcessingScreen at upload time.
const makeLocalId = () => `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function RecordScreen() {
  const store = useStore();
  const nav = useNavigation<any>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Local id available immediately — recording works fully offline.
  const [sid] = useState(makeLocalId);

  React.useEffect(() => {
    store.upsert({ id: sid, createdAt: Date.now(), title: new Date().toLocaleString(), names: {}, unlocked: false, parts: [] });
  }, [sid]);

  const rec = useRecorder(sid);

  async function onStop() {
    const parts = await rec.stop();
    const id = sid!;
    const existing = await store.get(id);
    await store.upsert({ ...(existing as any), parts });
    nav.replace('Processing', { sessionId: id });
  }

  async function onUpload() {
    let file: { uri: string; name?: string | null } | undefined;
    try {
      [file] = await pick({ type: [types.audio, types.video] });
    } catch (e) {
      if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return; // user dismissed picker
      setErr('選取失敗');
      return;
    }
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      // The picker hands back a security-scoped iOS uri whose access is released once we navigate
      // away — ProcessingScreen then can't read it to upload, so it hung on "上傳中…". Copy the file
      // into the app's cache, then move it into the persistent per-session dir (same place
      // recordings live) so it survives app restarts/updates. We persist the RELATIVE path.
      // C2: still no backend call here — ProcessingScreen owns all backend work.
      const [copied] = await keepLocalCopy({
        files: [{ uri: file.uri, fileName: file.name || `upload-${Date.now()}.m4a` }],
        destination: 'cachesDirectory',
      });
      if (copied.status !== 'success') throw new Error(copied.copyError || '檔案複製失敗，請再試一次');
      const id = makeLocalId();
      const createdAt = Date.now();
      const title = new Date().toLocaleString();
      const rel = await moveToPart(id, 0, copied.localUri);
      await store.upsert({ id, createdAt, title, names: {}, unlocked: false, parts: [{ uri: rel, durationMs: 0 }] });
      nav.replace('Processing', { sessionId: id });
    } catch (e: any) { setErr(e?.message || '上傳失敗'); setBusy(false); }
  }

  const isRec = rec.state === 'recording';
  const isPaused = rec.state === 'paused';
  const isStarting = rec.state === 'starting';

  if (busy) return <View style={styles.center}><ActivityIndicator color="#E5342B" size="large" /><Text style={styles.hint}>上傳中…</Text></View>;

  return (
    <View style={styles.container}>
      <Text style={styles.time}>{mmss(Math.floor(rec.durationMs / 1000))}</Text>
      <Waveform level={rec.meteringLevel} active={isRec} />
      <View style={styles.recordWrap}>
        <BreathingRing active={isRec} level={rec.meteringLevel} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isRec ? '停止錄音' : '開始錄音'}
          accessibilityState={{ busy: isStarting, disabled: !sid || isStarting }}
          style={[styles.recordBtn, (isRec || isPaused) && styles.recordBtnActive]}
          onPress={isRec || isPaused ? onStop : rec.start}
          disabled={!sid || isStarting}
        >
          {isStarting ? <ActivityIndicator color="#fff" /> : <View style={isRec ? styles.squareIcon : styles.circleIcon} />}
        </Pressable>
      </View>
      {isStarting && <Text style={styles.hint}>啟動麥克風中…</Text>}
      {rec.error && (
        <View style={styles.recErrWrap}>
          <Text style={styles.err}>{rec.error}</Text>
          {/權限|麥克風|設定/.test(rec.error) && (
            <Pressable onPress={() => Linking.openSettings()} accessibilityRole="button">
              <Text style={styles.settingsLink}>前往設定開啟麥克風</Text>
            </Pressable>
          )}
        </View>
      )}
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
  recordBtn: { width: 120, height: 120, borderRadius: 60, backgroundColor: RED, alignItems: 'center', justifyContent: 'center' },
  recordBtnActive: { backgroundColor: '#fff', borderWidth: 4, borderColor: RED },
  circleIcon: { width: 0, height: 0 },
  squareIcon: { width: 34, height: 34, borderRadius: 6, backgroundColor: RED },
  secondary: { marginTop: 36, paddingVertical: 10, paddingHorizontal: 28, borderRadius: 22, backgroundColor: '#f2f2f7' },
  secondaryText: { color: '#1c1c1e', fontSize: 16, fontWeight: '600' },
  uploadBtn: { marginTop: 48, paddingVertical: 12, paddingHorizontal: 24 },
  uploadText: { color: RED, fontSize: 16, fontWeight: '600' },
  err: { color: RED, marginTop: 20, textAlign: 'center', paddingHorizontal: 24 },
  recErrWrap: { alignItems: 'center', marginTop: 8 },
  settingsLink: { color: RED, fontSize: 15, fontWeight: '700', marginTop: 10, textDecorationLine: 'underline' },
  resumeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 24, gap: 12 },
  resumeText: { color: '#1c1c1e', fontSize: 15 },
  resumeBtn: { color: RED, fontSize: 15, fontWeight: '600' },
});
