import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { analyze, getModels } from '../lib/api';
import { splitNotesForPreview } from '../lib/gating';
import { SavedSession } from '../lib/store';

export default function AnalysisTab({ session, onUpdate, onUnlock }:
  { session: SavedSession; onUpdate(s: SavedSession): void; onUnlock(): void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showAdv, setShowAdv] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string | undefined>(undefined);

  useEffect(() => { if (showAdv && models.length === 0) getModels().then((r) => setModels(r.models)).catch(() => {}); }, [showAdv]);

  async function generate() {
    setBusy(true); setErr(null);
    try {
      const r = await analyze(session.id, { model, names: session.names });
      onUpdate({ ...session, notes: r.notes });
    } catch (e: any) { setErr(e?.message || '生成失敗'); }
    setBusy(false);
  }
  async function copy() { await Clipboard.setStringAsync(session.notes ?? ''); }
  async function exportMd() {
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync('data:text/markdown,' + encodeURIComponent(session.notes ?? ''));
  }

  if (!session.notes) {
    return (
      <View style={styles.center}>
        {busy ? <><ActivityIndicator color="#E5342B" /><Text style={styles.hint}>本機 LLM 生成中…</Text></>
          : <>
              <Text style={styles.hint}>把逐字稿整理成會議記錄（摘要 / 重點 / 決議 / 待辦）。</Text>
              <Pressable style={styles.primary} onPress={generate}><Text style={styles.primaryText}>生成會議記錄</Text></Pressable>
              <Pressable onPress={() => setShowAdv((v) => !v)}><Text style={styles.adv}>進階</Text></Pressable>
              {showAdv && <Text style={styles.advList}>{models.map((m) => (m === model || (!model && models[0] === m) ? `● ${m}` : `○ ${m}`)).join('   ')}</Text>}
              {err && <Text style={styles.err}>{err}</Text>}
            </>}
      </View>
    );
  }

  const { preview, locked } = splitNotesForPreview(session.notes);
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 48 }}>
      <Text style={styles.md}>{preview}</Text>
      {session.unlocked ? (
        <>
          <Text style={styles.md}>{locked}</Text>
          <View style={styles.actions}>
            <Pressable style={styles.ghost} onPress={copy}><Text style={styles.ghostText}>複製</Text></Pressable>
            <Pressable style={styles.ghost} onPress={exportMd}><Text style={styles.ghostText}>匯出</Text></Pressable>
          </View>
        </>
      ) : (
        <View style={styles.lockWrap}>
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
  actions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  ghost: { paddingVertical: 10, paddingHorizontal: 22, borderRadius: 20, backgroundColor: '#f2f2f7' },
  ghostText: { color: '#1c1c1e', fontWeight: '600' },
});
