import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Share from 'react-native-share';
import RNFS from 'react-native-fs';
import Markdown from 'react-native-markdown-display';
import { analyze, getModels } from '../lib/api';
import { splitNotesForPreview } from '../lib/gating';
import { markdownToPlainText } from '../lib/notes';
import { SavedSession } from '../lib/store';

const mdStyles = {
  body: { fontSize: 15, lineHeight: 24, color: '#1c1c1e' },
  heading2: { fontSize: 16, fontWeight: '700', color: '#E5342B', marginTop: 14, marginBottom: 4 },
  heading3: { fontSize: 15, fontWeight: '700', color: '#1c1c1e', marginTop: 10 },
  strong: { fontWeight: '700' },
  bullet_list: { marginVertical: 4 },
  list_item: { marginVertical: 2 },
} as const;

export default function AnalysisTab({ session, onUpdate, onUnlock, onGoToTranscript }:
  { session: SavedSession; onUpdate(s: SavedSession): void; onUnlock(): void; onGoToTranscript?(): void }) {
  const hasTranscript = (session.transcript?.segments?.length ?? 0) > 0;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showAdv, setShowAdv] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string | undefined>(undefined);

  useEffect(() => { if (showAdv && models.length === 0) getModels().then((r) => setModels(r.models)).catch(() => {}); }, [showAdv]);

  async function generate() {
    setBusy(true); setErr(null);
    try {
      // analyze runs against the backend draft session (holds the transcript), not the local id.
      const r = await analyze(session.backendId ?? session.id, { model, names: session.names });
      onUpdate({ ...session, notes: r.notes });
    } catch (e: any) { setErr(e?.message || '生成失敗'); }
    setBusy(false);
  }
  function copyMarkdown() { Clipboard.setString(session.notes ?? ''); }
  function copyPlainText() { Clipboard.setString(markdownToPlainText(session.notes ?? '')); }
  async function exportMd() {
    const path = `${RNFS.DocumentDirectoryPath}/會議記錄.md`;
    try {
      await RNFS.writeFile(path, session.notes ?? '', 'utf8');
      await Share.open({ url: `file://${path}`, type: 'text/markdown', filename: '會議記錄.md' });
    } catch (e) {
      // Share.open rejects when the user dismisses the sheet — not an error; do not crash.
    } finally {
      try { await RNFS.unlink(path); } catch {}
    }
  }

  if (!session.notes) {
    // Flow gate: meeting notes are generated FROM the transcript, so block generation until a
    // transcript exists (e.g. the backend died mid-transcription and never produced one).
    if (!hasTranscript) {
      return (
        <View style={styles.center}>
          <Text style={styles.hint}>還沒有逐字稿。請先完成「逐字稿」，才能生成 AI 會議記錄。</Text>
          {onGoToTranscript && (
            <Pressable style={styles.primary} onPress={onGoToTranscript}><Text style={styles.primaryText}>前往逐字稿</Text></Pressable>
          )}
        </View>
      );
    }
    return (
      <View style={styles.center}>
        {busy ? <><ActivityIndicator color="#E5342B" /><Text style={styles.hint}>本機 LLM 生成中…</Text></>
          : <>
              <Text style={styles.hint}>把逐字稿整理成會議記錄（摘要 / 重點 / 決議 / 待辦）。</Text>
              <Pressable style={styles.primary} onPress={generate}><Text style={styles.primaryText}>生成會議記錄</Text></Pressable>
              <Pressable onPress={() => setShowAdv((v) => !v)}><Text style={styles.adv}>進階</Text></Pressable>
              {showAdv && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                  {models.map((m) => (
                    <Pressable key={m} onPress={() => setModel(m)}>
                      <Text style={styles.advList}>{(m === model || (!model && models[0] === m) ? '● ' : '○ ') + m}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              {err && <Text style={styles.err}>{err}</Text>}
            </>}
      </View>
    );
  }

  const { preview, locked } = splitNotesForPreview(session.notes);
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 48 }}>
      <Markdown style={mdStyles}>{preview}</Markdown>
      {session.unlocked ? (
        <>
          <Markdown style={mdStyles}>{locked}</Markdown>
          <View style={styles.actions}>
            <Pressable style={styles.ghost} onPress={copyMarkdown}><Text style={styles.ghostText}>複製 Markdown</Text></Pressable>
            <Pressable style={styles.ghost} onPress={copyPlainText}><Text style={styles.ghostText}>複製純文字</Text></Pressable>
            <Pressable style={styles.ghost} onPress={exportMd}><Text style={styles.ghostText}>匯出</Text></Pressable>
          </View>
        </>
      ) : (
        <View style={styles.lockWrap}>
          <View style={styles.blurred}>
            <Markdown style={mdStyles}>{locked}</Markdown>
          </View>
          <View style={styles.lockOverlay}>
            <Pressable style={styles.primary} onPress={onUnlock}><Text style={styles.primaryText}>🔒 解鎖完整內容</Text></Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}
const RED = '#E5342B';
const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 18, paddingTop: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', padding: 24 },
  hint: { color: '#8e8e93', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  md: { fontSize: 15, lineHeight: 24, color: '#1c1c1e' },
  primary: { backgroundColor: RED, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 28, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  adv: { color: '#8e8e93', marginTop: 16, fontSize: 13 },
  advList: { color: '#1c1c1e', marginTop: 8, fontSize: 13 },
  err: { color: RED, marginTop: 14 },
  lockWrap: { marginTop: 8 },
  blurred: { opacity: 0.25 },
  lockOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 24 },
  ghost: { paddingVertical: 10, paddingHorizontal: 22, borderRadius: 20, backgroundColor: '#f2f2f7' },
  ghostText: { color: '#1c1c1e', fontWeight: '600' },
});
