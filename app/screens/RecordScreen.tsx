import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Linking } from 'react-native';
// NOTE: only the transform-based press spring below uses reanimated. We deliberately do NOT use
// layout animations (entering/exiting) here — they leave a ghost/afterimage during react-native-
// screens native push/pop transitions (the exiting animation runs as the screen is removed).
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { pick, keepLocalCopy, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { launchImageLibrary } from 'react-native-image-picker';
import { useRecorder } from '../hooks/useRecorder';
import { moveToPart } from '../lib/recordings';
import { mmss } from '../lib/transcript';
import { useStore } from '../lib/store-context';
import Waveform from '../components/Waveform';
import BreathingRing from '../components/BreathingRing';
import { IconImage } from '../components/icons';
import { colors, radius } from '../lib/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Recording is local-first: the session id is generated on-device so the record button is never
// gated on a backend round-trip (the GPU box is often unreachable from the phone unless Tailscale
// is up). The backend draft session is created lazily in ProcessingScreen at upload time.
const makeLocalId = () => `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function RecordScreen() {
  const store = useStore();
  const nav = useNavigation<any>();
  // Non-null while an upload/import is in flight — its text is shown full-screen so the user always
  // has feedback (picking a big video can spend many seconds copying with the picker already gone).
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Local id available immediately — recording works fully offline. NOTE: we deliberately do NOT
  // persist a session on mount. Doing so left a blank record every time the user opened this screen
  // (or uploaded) without recording. The session is created only when there's a real recorded part.
  const [sid] = useState(makeLocalId);

  const rec = useRecorder(sid);
  const insets = useSafeAreaInsets();

  // Spring press-feedback for the record button (motion, no new deps — reanimated is already here).
  const pressScale = useSharedValue(1);
  const btnAnim = useAnimatedStyle(() => ({ transform: [{ scale: pressScale.value }] }));
  const onPressIn = () => { pressScale.value = withSpring(0.93, { damping: 15, stiffness: 320 }); };
  const onPressOut = () => { pressScale.value = withSpring(1, { damping: 12, stiffness: 260 }); };

  async function onStop() {
    const parts = await rec.stop();
    // Nothing was captured (opened + left, or a zero-length take) → don't create an empty record.
    if (parts.length === 0) { nav.goBack(); return; }
    await store.upsert({ id: sid, createdAt: Date.now(), title: new Date().toLocaleString(), names: {}, unlocked: false, parts });
    nav.replace('Processing', { sessionId: sid });
  }

  // Shared ingest for both upload sources: move the (already app-local) file into the persistent
  // per-session dir as a RELATIVE part, then hand off to ProcessingScreen. No backend call here —
  // ProcessingScreen owns all backend work (C2). The backend re-encodes whatever we send to 16 kHz
  // mono WAV via ffmpeg, so a video container works too (it just keeps the audio track).
  async function ingestLocalFile(localUri: string) {
    const id = makeLocalId();
    const createdAt = Date.now();
    const title = new Date().toLocaleString();
    const rel = await moveToPart(id, 0, localUri);
    await store.upsert({ id, createdAt, title, names: {}, unlocked: false, parts: [{ uri: rel, durationMs: 0 }] });
    nav.replace('Processing', { sessionId: id });
  }

  // Pick a video from the Photos library (圖庫). Videos shot on the phone live in Photos, not the
  // Files app, so the document picker below can't see them.
  //
  // IMPORTANT: on iOS the picker sheet dismisses the instant you tap a video, but launchImageLibrary
  // does NOT resolve until it has finished COPYING that video into the app's tmp dir — seconds for a
  // big clip. So we show the busy screen BEFORE awaiting; otherwise the screen just sits there with
  // no feedback during the copy (looked like "縮小了然後完全沒反應"). We reset it only on cancel/error.
  async function onPickVideo() {
    setErr(null);
    setBusyMsg('讀取影片中…');
    let res;
    try {
      res = await launchImageLibrary({ mediaType: 'video', selectionLimit: 1 });
    } catch { setBusyMsg(null); setErr('選取失敗'); return; }
    if (res.didCancel) { setBusyMsg(null); return; }
    const asset = res.assets?.[0];
    const uri = asset?.uri || asset?.originalPath; // uri is the tmp copy; fall back to the source path
    if (!uri) {
      setBusyMsg(null);
      setErr(res.errorMessage || '無法讀取這支影片，可能是 iCloud 尚未下載或格式不支援，請改用「從檔案上傳」。');
      return;
    }
    setBusyMsg('準備中…');
    try { await ingestLocalFile(uri); }
    catch (e: any) { setBusyMsg(null); setErr(e?.message || '上傳失敗'); }
  }

  // Pick an audio/video file from the Files app (iCloud Drive, On My iPhone, etc.).
  async function onPickFile() {
    let file: { uri: string; name?: string | null } | undefined;
    try {
      [file] = await pick({ type: [types.audio, types.video] });
    } catch (e) {
      if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return; // user dismissed picker
      setErr('選取失敗');
      return;
    }
    if (!file) return;
    setBusyMsg('讀取檔案中…'); setErr(null);
    try {
      // The picker hands back a security-scoped iOS uri whose access is released once we navigate
      // away — ProcessingScreen then can't read it to upload, so it hung on "上傳中…". Copy the file
      // into the app's cache first, then ingestLocalFile moves it into the persistent per-session dir.
      const [copied] = await keepLocalCopy({
        files: [{ uri: file.uri, fileName: file.name || `upload-${Date.now()}.m4a` }],
        destination: 'cachesDirectory',
      });
      if (copied.status !== 'success') throw new Error(copied.copyError || '檔案複製失敗，請再試一次');
      await ingestLocalFile(copied.localUri);
    } catch (e: any) { setBusyMsg(null); setErr(e?.message || '上傳失敗'); }
  }

  const isRec = rec.state === 'recording';
  const isPaused = rec.state === 'paused';
  const isStarting = rec.state === 'starting';

  if (busyMsg) return <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /><Text style={styles.hint}>{busyMsg}</Text></View>;

  const statusText = isRec ? '錄音中' : isPaused ? '已暫停' : isStarting ? '啟動中' : '準備錄音';
  const stopMode = isRec || isPaused;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }]}>
      {/* status + timer */}
      <View style={styles.header}>
        <View style={styles.statusPill}>
          <View style={[styles.statusDot, isRec && styles.statusDotLive]} />
          <Text style={styles.statusText}>{statusText}</Text>
        </View>
        <Text style={styles.timer}>{mmss(Math.floor(rec.durationMs / 1000))}</Text>
      </View>

      {/* stage: live waveform + the record button */}
      <View style={styles.stage}>
        <View style={styles.waveArea}>
          <Waveform level={rec.meteringLevel} active={isRec} />
        </View>

        <View style={styles.recordWrap}>
          <BreathingRing active={isRec} level={rec.meteringLevel} />
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel={stopMode ? '停止錄音' : '開始錄音'}
            accessibilityState={{ busy: isStarting, disabled: !sid || isStarting }}
            style={[styles.recordBtn, btnAnim]}
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            onPress={stopMode ? onStop : rec.start}
            disabled={!sid || isStarting}
          >
            {isStarting
              ? <ActivityIndicator color="#fff" />
              : <View style={stopMode ? styles.stopIcon : styles.dotIcon} />}
          </AnimatedPressable>
        </View>

        <Text style={styles.hint}>
          {isStarting ? '啟動麥克風中…' : isRec ? '再按一次結束錄音' : isPaused ? '' : '點一下開始錄音'}
        </Text>
      </View>

      {/* footer controls */}
      <View style={styles.footer}>
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

        {stopMode && !rec.wasInterrupted && (
          <Pressable style={styles.secondary} onPress={isPaused ? rec.resume : rec.pause} accessibilityRole="button">
            <Text style={styles.secondaryText}>{isPaused ? '繼續錄音' : '暫停'}</Text>
          </Pressable>
        )}

        {rec.wasInterrupted && (
          <View style={styles.resumeCard}>
            <Text style={styles.resumeText}>錄音被中斷，要接著錄嗎？</Text>
            <View style={styles.resumeRow}>
              <Pressable style={styles.resumeBtnPrimary} onPress={rec.resume}><Text style={styles.resumeBtnPrimaryText}>繼續</Text></Pressable>
              <Pressable style={styles.resumeBtnGhost} onPress={onStop}><Text style={styles.resumeBtnGhostText}>結束</Text></Pressable>
            </View>
          </View>
        )}

        {rec.state === 'idle' && (
          <View style={styles.uploadRow}>
            <Text style={styles.uploadDivider}>或匯入既有檔案</Text>
            <Pressable style={styles.uploadBtn} onPress={onPickVideo} accessibilityRole="button">
              <IconImage size={18} color="#fff" />
              <Text style={styles.uploadText}>從圖庫選影片</Text>
            </Pressable>
            <Pressable style={styles.uploadBtnGhost} onPress={onPickFile} accessibilityRole="button">
              <Text style={styles.uploadTextGhost}>從檔案上傳音檔</Text>
            </Pressable>
          </View>
        )}

        {err && <Text style={styles.err}>{err}</Text>}
      </View>
    </View>
  );
}

const RECORD_SIZE = 116;
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper, alignItems: 'center', paddingHorizontal: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
  hint: { color: colors.ink3, marginTop: 22, fontSize: 14, height: 20 },

  header: { alignItems: 'center', gap: 14 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.card, paddingVertical: 6, paddingHorizontal: 14, borderRadius: radius.pill },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ink3 },
  statusDotLive: { backgroundColor: colors.brand },
  statusText: { fontSize: 13, fontWeight: '600', color: colors.ink2 },
  timer: { fontSize: 68, fontWeight: '200', color: colors.ink, fontVariant: ['tabular-nums'], letterSpacing: 1 },

  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  waveArea: { height: 72, alignSelf: 'stretch', justifyContent: 'center', marginBottom: 28 },
  recordWrap: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center' },
  recordBtn: {
    width: RECORD_SIZE, height: RECORD_SIZE, borderRadius: RECORD_SIZE / 2, backgroundColor: colors.brand,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.brand, shadowOpacity: 0.35, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 6,
  },
  dotIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff' },
  stopIcon: { width: 34, height: 34, borderRadius: 8, backgroundColor: '#fff' },

  footer: { alignSelf: 'stretch', alignItems: 'center', minHeight: 150, justifyContent: 'flex-end' },
  secondary: { paddingVertical: 12, paddingHorizontal: 34, borderRadius: radius.pill, backgroundColor: colors.card },
  secondaryText: { color: colors.ink, fontSize: 16, fontWeight: '600' },

  uploadRow: { alignItems: 'center', gap: 10, alignSelf: 'stretch' },
  uploadDivider: { color: colors.ink3, fontSize: 12.5, marginBottom: 2 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 28, borderRadius: radius.control, backgroundColor: colors.brand, alignSelf: 'stretch', justifyContent: 'center' },
  uploadText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  uploadBtnGhost: { paddingVertical: 10, paddingHorizontal: 24 },
  uploadTextGhost: { color: colors.brand, fontSize: 15, fontWeight: '600' },

  err: { color: colors.brand, marginTop: 16, textAlign: 'center', paddingHorizontal: 24 },
  recErrWrap: { alignItems: 'center', marginBottom: 12 },
  settingsLink: { color: colors.brand, fontSize: 15, fontWeight: '700', marginTop: 10, textDecorationLine: 'underline' },

  resumeCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: 18, alignItems: 'center', gap: 14, alignSelf: 'stretch' },
  resumeText: { color: colors.ink, fontSize: 15, fontWeight: '500' },
  resumeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  resumeBtnPrimary: { paddingVertical: 10, paddingHorizontal: 30, borderRadius: radius.pill, backgroundColor: colors.brand },
  resumeBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  resumeBtnGhost: { paddingVertical: 10, paddingHorizontal: 26, borderRadius: radius.pill, backgroundColor: colors.chipBg },
  resumeBtnGhostText: { color: colors.ink2, fontSize: 15, fontWeight: '600' },
});
