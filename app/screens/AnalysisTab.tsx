import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Share from 'react-native-share';
import RNFS from 'react-native-fs';
import Markdown from 'react-native-markdown-display';
import { analyze, getModels } from '../lib/api';
import { splitNotesForPreview } from '../lib/gating';
import { markdownToPlainText } from '../lib/notes';
import { notesMetaLine, parseTaskItem } from '../lib/notesDoc';
import { speakerColor, colors, radius, tabularNums } from '../lib/theme';
import { SavedSession } from '../lib/store';

// Pull the raw text out of a markdown-display AST node (walks descendants collecting text content).
// Used to detect GFM task-list items, which markdown-it 10 leaves as literal "[ ]"/"[x]" text
// (no task-list plugin available on RN 0.81 — see deviation note in the redesign report).
function nodeText(node: any): string {
  if (!node) return '';
  if (typeof node.content === 'string' && (!node.children || node.children.length === 0)) return node.content;
  if (Array.isArray(node.children)) return node.children.map(nodeText).join('');
  return typeof node.content === 'string' ? node.content : '';
}

// Document-quality markdown styles matching the mockup's `.doc`/`.sec` look.
const mdStyles = StyleSheet.create({
  body: { fontSize: 13.5, lineHeight: 22, color: colors.ink },
  // ## section heading → `.sec-label`: small, brand, letter-spaced, generous space above.
  heading2: {
    fontSize: 12, fontWeight: '700', letterSpacing: 1, color: colors.brand,
    textTransform: 'uppercase', marginTop: 24, marginBottom: 6,
  },
  // ### sub-heading → ink, bold.
  heading3: { fontSize: 14.5, fontWeight: '700', color: colors.ink, marginTop: 14, marginBottom: 4 },
  strong: { fontWeight: '700', color: colors.ink },
  paragraph: { marginTop: 0, marginBottom: 8, fontSize: 13.5, lineHeight: 22, color: colors.ink },
  bullet_list: { marginTop: 2, marginBottom: 4 },
  list_item: { marginVertical: 3 },
  bullet_list_icon: { color: colors.ink3, fontSize: 22, lineHeight: 22, marginRight: 8, marginLeft: 2 },
});

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

  // Custom render rules: turn GFM task-list items ("- [ ]"/"- [x]") into checklist rows.
  const rules = useMemo(() => ({
    list_item: (node: any, children: any, parent: any, styles: any, inheritedStyles: any = {}) => {
      const task = parseTaskItem(nodeText(node));
      if (task) {
        return (
          <View key={node.key} style={docStyles.todo}>
            <View style={[docStyles.ck, task.done && docStyles.ckOn]}>
              {task.done && <Text style={docStyles.ckMark}>✓</Text>}
            </View>
            <Text style={[docStyles.tt, task.done && docStyles.ttDone]}>{task.text}</Text>
            {task.owner ? <OwnerAvatar name={task.owner} session={session} /> : null}
          </View>
        );
      }
      // Fall back to the library's default bullet rendering.
      return defaultListItem(node, children, styles);
    },
  }), [session]);

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
        {busy ? <><ActivityIndicator color={colors.brand} /><Text style={styles.hint}>本機 LLM 生成中…</Text></>
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
  const meta = notesMetaLine(session, Date.now());
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 48 }}>
      {/* Document header */}
      <Text style={styles.docTitle}>{session.title}</Text>
      {!!meta && <Text style={[styles.docMeta, tabularNums]}>{meta}</Text>}

      <Markdown style={mdStyles} rules={rules}>{preview}</Markdown>

      {session.unlocked ? (
        <>
          {!!locked && <Markdown style={mdStyles} rules={rules}>{locked}</Markdown>}
          <View style={styles.actions}>
            <Pressable style={styles.ghost} onPress={copyMarkdown}><Text style={styles.ghostText}>複製 Markdown</Text></Pressable>
            <Pressable style={styles.ghost} onPress={copyPlainText}><Text style={styles.ghostText}>複製純文字</Text></Pressable>
            <Pressable style={styles.ghost} onPress={exportMd}><Text style={styles.ghostText}>匯出</Text></Pressable>
          </View>
        </>
      ) : (
        <View style={styles.lockWrap}>
          {/* Locked content sits underneath; the gradient-fade + CTA overlay it. */}
          <View pointerEvents="none">
            {!!locked && <Markdown style={mdStyles} rules={rules}>{locked}</Markdown>}
          </View>
          {/* Faux gradient: stacked paper Views at increasing opacity fade the locked text out. */}
          <View style={styles.paywall} pointerEvents="box-none">
            <View style={[styles.fade, styles.fade1]} pointerEvents="none" />
            <View style={[styles.fade, styles.fade2]} pointerEvents="none" />
            <View style={[styles.fade, styles.fade3]} pointerEvents="none" />
            <Pressable style={styles.unlock} onPress={onUnlock} accessibilityRole="button">
              <Text style={styles.unlockText}>🔒 解鎖完整會議記錄</Text>
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// Small colored avatar for a task owner. Colors by the owner's speaker index when the name maps to
// a known speaker; otherwise brand. Shows the first character of the name.
function OwnerAvatar({ name, session }: { name: string; session: SavedSession }) {
  const speakers = session.transcript?.speakers ?? [];
  const idx = speakers.findIndex((sp) => (session.names[sp] || '').trim() === name.trim());
  const color = idx >= 0 ? speakerColor(idx) : colors.brand;
  const initial = [...name.trim()][0] ?? '?';
  return (
    <View style={[docStyles.av, { backgroundColor: color }]}>
      <Text style={docStyles.avText}>{initial}</Text>
    </View>
  );
}

// The library's own bullet rendering (from renderRules.js) — reused for non-task list items so
// they keep the clean grey-dot bullet without us reimplementing the icon/content layout.
function defaultListItem(node: any, children: any, styles: any) {
  return (
    <View key={node.key} style={styles._VIEW_SAFE_list_item}>
      <Text style={styles.bullet_list_icon} accessible={false}>{'•'}</Text>
      <View style={styles._VIEW_SAFE_bullet_list_content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.paper, paddingHorizontal: 20, paddingTop: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper, padding: 24 },
  hint: { color: colors.ink3, fontSize: 14, textAlign: 'center', marginBottom: 16, lineHeight: 20 },

  docTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.ink, marginTop: 2, marginBottom: 6, lineHeight: 26 },
  docMeta: { fontSize: 12.5, color: colors.ink2, marginBottom: 2 },

  primary: { backgroundColor: colors.brand, borderRadius: radius.control, paddingVertical: 13, paddingHorizontal: 28, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  adv: { color: colors.ink3, marginTop: 16, fontSize: 13 },
  advList: { color: colors.ink, marginTop: 8, fontSize: 13 },
  err: { color: colors.brand, marginTop: 14 },

  lockWrap: { marginTop: 8, position: 'relative' },
  // Gradient-fade paywall: absolutely positioned over the top of the locked content.
  paywall: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end', paddingBottom: 20 },
  fade: { position: 'absolute', left: 0, right: 0, backgroundColor: colors.paper },
  fade1: { top: 0, height: 120, opacity: 0.55 },
  fade2: { top: 60, height: 140, opacity: 0.8 },
  fade3: { top: 150, bottom: 0, opacity: 1 },
  unlock: { height: 48, borderRadius: 14, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  unlockText: { color: '#fff', fontSize: 14.5, fontWeight: '700' },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 24 },
  ghost: { paddingVertical: 10, paddingHorizontal: 22, borderRadius: radius.pill, backgroundColor: colors.chipBg },
  ghostText: { color: colors.ink, fontWeight: '600' },
});

const docStyles = StyleSheet.create({
  todo: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.hairline },
  ck: { width: 19, height: 19, borderRadius: 6, borderWidth: 2, borderColor: colors.neutralSoft, alignItems: 'center', justifyContent: 'center' },
  ckOn: { backgroundColor: colors.good, borderColor: colors.good },
  ckMark: { color: '#fff', fontSize: 11, fontWeight: '700', lineHeight: 13 },
  tt: { flex: 1, fontSize: 13.5, color: colors.ink, lineHeight: 19 },
  ttDone: { color: colors.ink3, textDecorationLine: 'line-through' },
  av: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  avText: { fontSize: 10, fontWeight: '700', color: '#fff' },
});
