import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Linking } from 'react-native';
// NOTE: only the transform-based press spring below uses reanimated. We deliberately do NOT use
// layout animations (entering/exiting) here — they leave a ghost/afterimage during react-native-
// screens native push/pop transitions (the exiting animation runs as the screen is removed).
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { pick, keepLocalCopy, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { launchImageLibrary } from 'react-native-image-picker';
import { useRecorder } from '../hooks/useRecorder';
import RNFS from 'react-native-fs';
import { moveToPart, mergeSessionParts } from '../lib/recordings';
import { isVideo, storageExtFor } from '../lib/importMedia';
import * as audioExtract from '../lib/audioExtract';
import { mmss } from '../lib/transcript';
import { useStore } from '../lib/store-context';
import Waveform from '../components/Waveform';
import BreathingRing from '../components/BreathingRing';
import { IconImage, IconFile } from '../components/icons';
import { colors, radius } from '../lib/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Recording is local-first: the session id is generated on-device so the record button is never
// gated on a backend round-trip (the GPU box is often unreachable from the phone unless Tailscale
// is up). The backend draft session is created lazily in ProcessingScreen at upload time.
const makeLocalId = () => `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function RecordScreen() {
  const store = useStore();
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  // Appending to an existing meeting (結果頁的「繼續錄音」) rather than starting a new one.
  const appendTo: string | undefined = route.params?.appendTo;
  // Non-null while an upload/import is in flight — its text is shown full-screen so the user always
  // has feedback (picking a big video can spend many seconds copying with the picker already gone).
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Local id available immediately — recording works fully offline. NOTE: we deliberately do NOT
  // persist a session on mount. Doing so left a blank record every time the user opened this screen
  // (or uploaded) without recording. The session is created only when there's a real recorded part.
  const [sid] = useState(() => appendTo ?? makeLocalId());

  // In append mode we must know what the meeting already holds, so new takes continue the part
  // numbering instead of overwriting part-0. Until it loads we don't let recording start.
  const [existing, setExisting] = useState<{ uri: string; durationMs: number }[] | null>(appendTo ? null : []);
  useEffect(() => {
    if (!appendTo) return;
    void store.get(appendTo).then((s) => setExisting(s?.parts ?? []));
  }, [appendTo, store]);

  // Stable identity, or useRecorder's effect would re-run every render.
  const existingParts = useMemo(() => existing ?? [], [existing]);
  const rec = useRecorder(sid, existingParts);
  const existingMs = useMemo(() => existingParts.reduce((a, p) => a + (p.durationMs || 0), 0), [existingParts]);
  // Append mode is a CONTINUATION: show the meeting's running total, not this take's clock, so the
  // timer reads as one recording carrying on rather than a separate second recording.
  const shownMs = existingMs + rec.durationMs;
  // Don't let a take start before we know what the meeting already holds — starting early is exactly
  // how a continued recording used to overwrite part-0.
  const loading = appendTo != null && existing === null;
  const insets = useSafeAreaInsets();

  // Stable session metadata so the incremental saves and the final save all agree on id/date/title.
  const [meta] = useState(() => ({ createdAt: Date.now(), title: new Date().toLocaleString() }));
  // MERGE, don't overwrite: appending to an existing meeting must keep its title, transcript, notes
  // and speaker names — a plain upsert here would wipe them.
  const persist = useCallback(async (parts: { uri: string; durationMs: number }[]) => {
    const cur = await store.get(sid);
    await store.upsert({
      id: sid,
      createdAt: cur?.createdAt ?? meta.createdAt,
      title: cur?.title ?? meta.title,
      names: cur?.names ?? {},
      unlocked: cur?.unlocked ?? false,
      ...(cur ?? {}),
      parts,
    });
  }, [sid, meta, store]);
  // Save the session the moment a part is finalized (a pause, or an OS interruption like an incoming
  // call). This means a crash can never lose the audio — the recording is already a draft on Home,
  // and the launch-time recovery scan backfills anything that wasn't stored yet.
  useEffect(() => { if (rec.parts.length > 0) void persist(rec.parts); }, [rec.parts, persist]);

  // Spring press-feedback for the record button (motion, no new deps — reanimated is already here).
  const pressScale = useSharedValue(1);
  const btnAnim = useAnimatedStyle(() => ({ transform: [{ scale: pressScale.value }] }));
  const onPressIn = () => { pressScale.value = withSpring(0.93, { damping: 15, stiffness: 320 }); };
  const onPressOut = () => { pressScale.value = withSpring(1, { damping: 12, stiffness: 260 }); };

  async function onStop() {
    const parts = await rec.stop();
    // Nothing was captured (opened + left, or a zero-length take) → don't create an empty record.
    if (parts.length === 0) { nav.goBack(); return; }
    await persist(parts);
    // Segments exist only to protect audio DURING recording. Now that it has stopped cleanly, join
    // them into one file so the meeting is a single recording everywhere — one player, one waveform,
    // one export — instead of 段 1 / 段 2 / 段 3. Lossless (identical PCM), and if it can't be done
    // the parts simply stay as they were.
    if (parts.length > 1) {
      setBusyMsg('整理錄音中…');
      const merged = await mergeSessionParts(sid, parts);
      if (merged) await persist(merged);
      setBusyMsg(null);
    }
    // Don't jump straight into analysis — land on Review so the user can listen back and decide
    // whether to analyze or discard (a bad take shouldn't force a transcription round-trip).
    nav.replace('Review', { sessionId: sid });
  }

  // Shared ingest for the upload sources: move each (already app-local) file into the persistent
  // per-session dir as a sequential RELATIVE part, then hand off to ProcessingScreen. No backend call
  // here — ProcessingScreen owns all backend work (C2). Multiple files become multiple PARTS of ONE
  // session, so the backend concatenates them (part-0, part-1, …) into a single combined transcript +
  // analysis — this is how importing several Voice Memos "依次" into one meeting works. The backend
  // re-encodes whatever we send to 16 kHz mono WAV via ffmpeg, so a video container works too.
  async function ingestLocalFiles(localUris: string[]) {
    const id = makeLocalId();
    const createdAt = Date.now();
    const title = new Date().toLocaleString();
    const parts: { uri: string; durationMs: number }[] = [];
    for (let i = 0; i < localUris.length; i++) {
      const src = localUris[i];
      let rel: string;
      if (isVideo(src) && audioExtract.available) {
        // A video's bytes can be transcribed but not PLAYED by an audio player, so pull its audio
        // track out once here — that makes the import behave like a recording in the preview.
        const tmp = `${RNFS.CachesDirectoryPath}/extract-${id}-${i}.m4a`;
        setBusyMsg(localUris.length > 1 ? `擷取音訊中… ${i + 1}/${localUris.length}` : '擷取音訊中…');
        try {
          await audioExtract.extractAudio(src, tmp);
          rel = await moveToPart(id, i, tmp, 'm4a');
        } catch {
          // Extraction failed (no audio track, odd codec) — keep the original so transcription still
          // works; only the on-device preview is lost.
          rel = await moveToPart(id, i, src, 'm4a');
        }
      } else {
        // Keep a real audio file's own extension: storing everything as .m4a was what made an
        // imported .wav/.mp3 unplayable even though nothing was wrong with it.
        rel = await moveToPart(id, i, src, storageExtFor(src));
      }
      parts.push({ uri: rel, durationMs: 0 });
    }
    await store.upsert({ id, createdAt, title, names: {}, unlocked: false, parts });
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
    try { await ingestLocalFiles([uri]); }
    catch (e: any) { setBusyMsg(null); setErr(e?.message || '上傳失敗'); }
  }

  // Pick one OR MORE audio/video files from the Files app (iCloud Drive, On My iPhone, and — once
  // saved to Files — Voice Memos 語音備忘錄). Multi-selected files become sequential PARTS of one
  // session, so they're transcribed + analysed together as a single meeting.
  async function onPickFile() {
    let files: { uri: string; name?: string | null }[];
    try {
      files = await pick({ allowMultiSelection: true, type: [types.audio, types.video] });
    } catch (e) {
      if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return; // user dismissed picker
      setErr('選取失敗');
      return;
    }
    if (!files || files.length === 0) return;
    setBusyMsg(files.length > 1 ? `讀取 ${files.length} 個檔案中…` : '讀取檔案中…'); setErr(null);
    try {
      // The picker hands back security-scoped iOS uris whose access is released once we navigate away
      // — ProcessingScreen then can't read them to upload. Copy them all into the app's cache first,
      // then ingestLocalFiles moves them into the persistent per-session dir as ordered parts.
      const reqs = files.map((f, i) => ({ uri: f.uri, fileName: f.name || `upload-${Date.now()}-${i}.m4a` }));
      const copied = await keepLocalCopy({
        files: [reqs[0], ...reqs.slice(1)],
        destination: 'cachesDirectory',
      });
      const localUris: string[] = [];
      for (const c of copied) {
        if (c.status !== 'success') throw new Error(c.copyError || '檔案複製失敗，請再試一次');
        localUris.push(c.localUri);
      }
      await ingestLocalFiles(localUris);
    } catch (e: any) { setBusyMsg(null); setErr(e?.message || '上傳失敗'); }
  }

  const isRec = rec.state === 'recording';
  const isPaused = rec.state === 'paused';
  const isStarting = rec.state === 'starting';

  if (busyMsg) return <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /><Text style={styles.hint}>{busyMsg}</Text></View>;

  const statusText = loading ? '讀取中'
    : isRec ? '錄音中' : isPaused ? '已暫停' : isStarting ? '啟動中'
    : appendTo ? '準備接續錄音' : '準備錄音';
  const stopMode = isRec || isPaused;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }]}>
      {/* status + timer */}
      <View style={styles.header}>
        <View style={styles.statusPill}>
          <View style={[styles.statusDot, isRec && styles.statusDotLive]} />
          <Text style={styles.statusText}>{statusText}</Text>
        </View>
        <Text style={styles.timer}>{mmss(Math.floor(shownMs / 1000))}</Text>
        {appendTo && existingParts.length > 0 && (
          <Text style={styles.continueNote}>
            接續這場會議 · 已有 {existingParts.length} 段（{mmss(Math.floor(existingMs / 1000))}），新錄的會接在後面
          </Text>
        )}
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
            accessibilityState={{ busy: isStarting || loading, disabled: !sid || isStarting || loading }}
            style={[styles.recordBtn, btnAnim]}
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            onPress={stopMode ? onStop : rec.start}
            disabled={!sid || isStarting || loading}
          >
            {isStarting
              ? <ActivityIndicator color="#fff" />
              : <View style={stopMode ? styles.stopIcon : styles.dotIcon} />}
          </AnimatedPressable>
        </View>

        <Text style={styles.hint}>
          {isStarting ? '啟動麥克風中…' : isRec ? '再按一次結束錄音' : ''}
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
            <Pressable style={styles.uploadBtn} onPress={onPickVideo} accessibilityRole="button">
              <IconImage size={18} color="#fff" />
              <Text style={styles.uploadText}>從圖庫選影片</Text>
            </Pressable>
            <Pressable style={styles.uploadBtn} onPress={onPickFile} accessibilityRole="button">
              <IconFile size={18} color="#fff" />
              <Text style={styles.uploadText}>匯入音檔（可多選）</Text>
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
  continueNote: { fontSize: 12.5, color: colors.ink3, textAlign: 'center', marginTop: 2, paddingHorizontal: 20, lineHeight: 18 },
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
  uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 28, borderRadius: radius.control, backgroundColor: colors.brand, alignSelf: 'stretch', justifyContent: 'center' },
  uploadText: { color: '#fff', fontSize: 16, fontWeight: '700' },

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
