import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { pick, keepLocalCopy, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { launchImageLibrary } from 'react-native-image-picker';
import RNFS from 'react-native-fs';
import { moveToPart, fsPath } from '../lib/recordings';
import { isVideo, storageExtFor } from '../lib/importMedia';
import * as audioExtract from '../lib/audioExtract';
import { useStore } from '../lib/store-context';

// Importing audio/video into a new meeting — shared by Home's bottom bar (匯入) and the Record screen.
//
// `leave` decides how we get to Review afterwards: Record REPLACES itself (it was only a way station),
// Home NAVIGATES (replacing Home would drop the root of the stack).
const makeLocalId = () => `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function useImport({ leave }: { leave: 'replace' | 'navigate' }) {
  const store = useStore();
  const nav = useNavigation<any>();
  // Non-null while an import is in flight — shown full-screen so the user always has feedback (picking
  // a big video can spend many seconds copying with the picker already gone).
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const go = (sessionId: string) =>
    leave === 'replace' ? nav.replace('Review', { sessionId }) : nav.navigate('Review', { sessionId });

  // Move each (already app-local) file into the persistent per-session dir as a sequential RELATIVE
  // part. No backend call here — ProcessingScreen owns all backend work (C2). Several files become
  // several PARTS of ONE meeting, so they're transcribed + analysed together.
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
        setBusyMsg(localUris.length > 1 ? `正在取出聲音… ${i + 1}/${localUris.length}` : '正在取出聲音…');
        try {
          // decode first: the native side takes a filesystem path, not a percent-encoded URI
          await audioExtract.extractAudio(fsPath(src), tmp);
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

    // NOTE: imports are deliberately NOT auto-joined (recordings are — those are our own files, all
    // identical PCM). A picked file may not be audio at all, may be the wrong file, or may not belong
    // with the others; joining is confirmed on ImportConfirm when several are picked.
    setBusyMsg(null);
    go(id);
  }

  // Pick a video from the Photos library. Videos shot on the phone live in Photos, not the Files app.
  //
  // IMPORTANT: on iOS the picker sheet dismisses the instant you tap a video, but launchImageLibrary
  // does NOT resolve until it has finished COPYING that video into the app's tmp dir — seconds for a
  // big clip. So we show the busy screen BEFORE awaiting; otherwise the screen just sits there with
  // no feedback during the copy. We reset it only on cancel/error.
  async function pickVideo() {
    setErr(null);
    setBusyMsg('正在讀取影片…');
    let res;
    try {
      res = await launchImageLibrary({ mediaType: 'video', selectionLimit: 1 });
    } catch { setBusyMsg(null); setErr('沒辦法打開相簿，請再試一次。'); return; }
    if (res.didCancel) { setBusyMsg(null); return; }
    const asset = res.assets?.[0];
    const uri = asset?.uri || asset?.originalPath; // uri is the tmp copy; fall back to the source path
    if (!uri) {
      setBusyMsg(null);
      setErr(res.errorMessage || '讀不到這支影片，可能還在 iCloud 裡沒下載，或格式不支援。可以改用「匯入檔案」。');
      return;
    }
    setBusyMsg('準備中…');
    try { await ingestLocalFiles([uri]); }
    catch { setBusyMsg(null); setErr('匯入沒有完成，原本的影片沒有變動，請再試一次。'); }
  }

  // Pick one OR MORE audio/video files from the Files app (iCloud Drive, On My iPhone, Voice Memos
  // saved to Files). Several files go to ImportConfirm first.
  async function pickFiles() {
    let files: { uri: string; name?: string | null }[];
    try {
      files = await pick({ allowMultiSelection: true, type: [types.audio, types.video] });
    } catch (e) {
      if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return; // user dismissed picker
      setErr('沒辦法打開檔案，請再試一次。');
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
        if (c.status !== 'success') throw new Error('檔案複製失敗，原本的檔案沒有變動，請再試一次。');
        localUris.push(c.localUri);
      }
      // More than one file is a decision, not a formality: they may not all be audio, and joining
      // them is not undoable. Confirm what was actually picked before committing to it.
      if (localUris.length > 1) {
        setBusyMsg(null);
        nav.navigate('ImportConfirm', {
          files: localUris.map((uri, i) => ({ uri, name: files[i]?.name || `檔案 ${i + 1}` })),
        });
        return;
      }
      await ingestLocalFiles(localUris);
    } catch (e: any) { setBusyMsg(null); setErr(e?.message || '匯入沒有完成，原本的檔案沒有變動，請再試一次。'); }
  }

  return { busyMsg, err, setErr, pickFiles, pickVideo };
}
