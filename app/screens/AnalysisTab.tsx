import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView, View, Text, Pressable, ActivityIndicator, StyleSheet, TextInput, Modal,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Share from 'react-native-share';
import RNFS from 'react-native-fs';
import Markdown from 'react-native-markdown-display';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getModels } from '../lib/api';
import { markdownToPlainText } from '../lib/notes';
import { cleanNotesMarkdown } from '../lib/notesClean';
import { pushNotesVersion } from '../lib/notesEdit';
import { notesMetaLine, parseTaskItem, extractNotesTitle, stripLeadingH1, looksLikeAutoTitle } from '../lib/notesDoc';
import { applyRulesToSession, countMatches, KeywordRule } from '../lib/keywords';
import KeywordSheet from '../components/KeywordSheet';
import { relativeDay } from '../lib/sessionList';
import { speakerColor, colors, radius, tabularNums } from '../lib/theme';
import { IconCheck, IconPencil } from '../components/icons';
import { SavedSession } from '../lib/store';
import { useStore } from '../lib/store-context';
import { ensureNotesJob, restartNotesJob } from '../lib/jobRunner';
import { isNotesActive } from '../lib/notesJob';

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
  // # title — normally stripped from the body (promoted to the meeting title), but styled defensively
  // with a real lineHeight so a stray H1 renders cleanly instead of clipping.
  heading1: { fontSize: 20, fontWeight: '800', color: colors.ink, lineHeight: 28, marginTop: 6, marginBottom: 10 },
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

export default function AnalysisTab({ session, onUpdate, onGoToTranscript }:
  { session: SavedSession; onUpdate(s: SavedSession): void; onGoToTranscript?(): void }) {
  const hasTranscript = (session.transcript?.segments?.length ?? 0) > 0;
  const store = useStore();
  // Generation state lives on the session (lib/notesJob.ts), not in local state: the LLM run happens
  // on the backend, so it must survive leaving this screen, backgrounding, and being killed.
  const busy = isNotesActive(session.notesJob);
  const err = session.notesJob?.stage === 'error' ? session.notesJob.error ?? null : null;
  const [showAdv, setShowAdv] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string | undefined>(undefined);
  // Copy feedback ('md' | 'plain' | null): flips the tapped button to a green ✓ 已複製 for ~1.6s.
  const [copied, setCopied] = useState<null | 'md' | 'plain'>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editing, setEditing] = useState(false);   // full-note editor open
  const [historyOpen, setHistoryOpen] = useState(false);
  const [kwOpen, setKwOpen] = useState(false);      // 修正關鍵字 sheet open
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (showAdv && models.length === 0) getModels().then((r) => setModels(r.models)).catch(() => {}); }, [showAdv]);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  function flashToast(m: string) {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  }
  function applyKeywords(rules: KeywordRule[]) {
    const n = countMatches(session, rules);
    onUpdate(applyRulesToSession(session, rules, Date.now())); // rewrites transcript + notes (archived)
    setKwOpen(false);
    flashToast(`已取代 ${n} 處`);
  }

  // The LLM output, normalised (LaTeX arrows → symbols, heading spacing) for display/copy/export/edit.
  const cleaned = useMemo(() => cleanNotesMarkdown(session.notes ?? ''), [session.notes]);

  // Queue generation on the backend and let the job own it. The notes, their version history and the
  // title promotion are applied by lib/notesJob.ts when the result lands — including when that only
  // happens on a later launch because the app was closed while the LLM was running.
  // `starting` covers the gap between the tap and the job actually registering: restartNotesJob
  // awaits whatever is in flight before it writes a stage, and until then `busy` is still false —
  // so the tap looked like it did nothing while the old notes sat there unchanged.
  const [starting, setStarting] = useState(false);
  useEffect(() => { if (busy) setStarting(false); }, [busy]);
  // Generation outlives this screen — leaving mid-run is normal and supported — so the settle
  // handler must not touch state once we are gone.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  function generate() {
    setStarting(true);
    void restartNotesJob(session.id, store, { model })
      .finally(() => { if (mounted.current) setStarting(false); });
  }
  // Regenerating costs a real LLM run and replaces what is on screen, so confirm first. The job
  // archives the previous notes to 版本紀錄 on the way, so nothing is lost either way.
  function confirmRegenerate() {
    Alert.alert(
      '重新分析這場會議？',
      '會用目前的逐字稿（含你改過的講者名字）重新產生會議記錄。原本的記錄會存進版本紀錄，可以還原。',
      [{ text: '取消', style: 'cancel' }, { text: '重新分析', onPress: generate }],
    );
  }

  // Reattach to a generation that was still running when this screen mounted (e.g. after relaunch),
  // so the spinner reflects real state instead of sitting there forever.
  useEffect(() => {
    if (isNotesActive(session.notesJob)) void ensureNotesJob(session.id, store, { model });
  }, [session.id, session.notesJob?.stage]); // eslint-disable-line react-hooks/exhaustive-deps
  function flashCopied(which: 'md' | 'plain') {
    setCopied(which);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1600);
  }
  function copyMarkdown() { Clipboard.setString(cleaned); flashCopied('md'); }
  function copyPlainText() { Clipboard.setString(markdownToPlainText(cleaned)); flashCopied('plain'); }
  async function exportMd() {
    const path = `${RNFS.DocumentDirectoryPath}/會議記錄.md`;
    try {
      await RNFS.writeFile(path, cleaned, 'utf8');
      await Share.open({ url: `file://${path}`, type: 'text/markdown', filename: '會議記錄.md' });
    } catch (e) {
      // Share.open rejects when the user dismisses the sheet — not an error; do not crash.
    } finally {
      try { await RNFS.unlink(path); } catch {}
    }
  }
  function saveEdit(next: string) { onUpdate(pushNotesVersion(session, next, Date.now())); setEditing(false); }
  function revertTo(version: string) { onUpdate(pushNotesVersion(session, version, Date.now())); setHistoryOpen(false); }

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

  if (busy || starting || !session.notes) {
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
        {busy || starting ? (
          <>
            <ActivityIndicator color={colors.brand} />
            <Text style={styles.hint}>{session.notesJob?.message || '本機 LLM 生成中…'}</Text>
            {typeof session.notesJob?.pct === 'number' && (
              <View style={styles.notesBarTrack}>
                <View style={[styles.notesBarFill, { width: `${Math.round(session.notesJob.pct * 100)}%` }]} />
              </View>
            )}
            <Text style={styles.hintSmall}>離開 App 也會繼續，完成後回來就看得到。</Text>
          </>
        )
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

  // The stored notes keep their H1 title (so copy/export are self-contained), but the on-screen body
  // drops it — we already show the title in the doc header above, and the raw H1 was overlapping it.
  const body = stripLeadingH1(cleaned);
  const meta = notesMetaLine(session, Date.now());
  const historyCount = session.notesHistory?.length ?? 0;
  return (
    <View style={styles.screen}>
      {/* Persistent action toolbar — always visible, so 編輯 isn't buried at the bottom of a long
          note. Horizontal-scroll so it never overflows narrow screens. */}
      <View style={styles.toolbar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbarRow} keyboardShouldPersistTaps="handled">
            <Pressable style={[styles.chip, styles.chipPrimary]} onPress={() => setEditing(true)} accessibilityRole="button" accessibilityLabel="編輯會議記錄">
              <IconPencil size={14} color="#fff" /><Text style={styles.chipPrimaryText}>編輯</Text>
            </Pressable>
            <Pressable style={styles.chip} onPress={confirmRegenerate} accessibilityRole="button" accessibilityLabel="重新分析">
              <Text style={styles.chipText}>重新分析</Text>
            </Pressable>
            <Pressable style={styles.chip} onPress={() => setKwOpen(true)}><Text style={styles.chipText}>修正關鍵字</Text></Pressable>
            <Pressable style={[styles.chip, copied === 'plain' && styles.chipDone]} onPress={copyPlainText}>
              {copied === 'plain'
                ? <><IconCheck size={14} color={colors.good} /><Text style={styles.chipDoneText}>已複製</Text></>
                : <Text style={styles.chipText}>複製純文字</Text>}
            </Pressable>
            <Pressable style={[styles.chip, copied === 'md' && styles.chipDone]} onPress={copyMarkdown}>
              {copied === 'md'
                ? <><IconCheck size={14} color={colors.good} /><Text style={styles.chipDoneText}>已複製</Text></>
                : <Text style={styles.chipText}>複製 Markdown</Text>}
            </Pressable>
            {historyCount > 0 && (
              <Pressable style={styles.chip} onPress={() => setHistoryOpen(true)}><Text style={styles.chipText}>版本紀錄（{historyCount}）</Text></Pressable>
            )}
            <Pressable style={styles.chip} onPress={exportMd}><Text style={styles.chipText}>匯出</Text></Pressable>
          </ScrollView>
      </View>

      <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 48 }}>
        {/* Document header */}
        <Text style={styles.docTitle}>{session.title}</Text>
        {!!meta && <Text style={[styles.docMeta, tabularNums]}>{meta}</Text>}

        <Markdown style={mdStyles} rules={rules}>{body}</Markdown>
      </ScrollView>

      {editing && <NotesEditor initial={cleaned} onCancel={() => setEditing(false)} onSave={saveEdit} />}
      {historyOpen && (
        <NotesHistory
          history={session.notesHistory ?? []}
          now={Date.now()}
          onClose={() => setHistoryOpen(false)}
          onRevert={revertTo}
        />
      )}
      {kwOpen && <KeywordSheet session={session} onClose={() => setKwOpen(false)} onApply={applyKeywords} />}

      {toast && (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

// Full-screen editor for the whole note (raw Markdown so headings/bullets/tasks survive). 儲存 pushes
// the previous version onto history via the caller; 取消 discards.
function NotesEditor({ initial, onCancel, onSave }: { initial: string; onCancel(): void; onSave(next: string): void }) {
  const [value, setValue] = useState(initial);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <View style={editorStyles.root}>
        {/* pad below the status bar / Dynamic Island so 取消/儲存 don't collide with the clock+battery */}
        <View style={[editorStyles.bar, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={onCancel} hitSlop={10}><Text style={editorStyles.cancel}>取消</Text></Pressable>
          <Text style={editorStyles.title}>編輯會議記錄</Text>
          <Pressable testID="notes-save" onPress={() => onSave(value)} hitSlop={10}><Text style={editorStyles.save}>儲存</Text></Pressable>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TextInput
            testID="notes-editor-input"
            style={editorStyles.input}
            value={value}
            onChangeText={setValue}
            multiline
            autoFocus
            textAlignVertical="top"
            placeholder="會議記錄內容（Markdown）"
            placeholderTextColor={colors.ink3}
          />
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// 版本紀錄: prior note versions, newest first. Tapping 復原 restores one (the caller archives the
// current version first, so a revert is itself undoable).
function NotesHistory(
  { history, now, onClose, onRevert }:
  { history: { notes: string; at: number }[]; now: number; onClose(): void; onRevert(v: string): void },
) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={histStyles.root}>
        <Pressable style={histStyles.scrim} onPress={onClose} accessibilityLabel="關閉" />
        <View style={histStyles.sheet}>
          <View style={histStyles.grab} />
          <Text style={histStyles.title}>版本紀錄</Text>
          <Text style={histStyles.sub}>還原到先前的版本（目前版本會先被保留）</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {history.map((v, i) => (
              <View key={i} style={histStyles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[histStyles.when, tabularNums]}>{relativeDay(v.at, now)}</Text>
                  <Text style={histStyles.snippet} numberOfLines={2}>{markdownToPlainText(v.notes).replace(/\n+/g, ' ') || '（空白）'}</Text>
                </View>
                <Pressable style={histStyles.revert} onPress={() => onRevert(v.notes)}><Text style={histStyles.revertText}>復原</Text></Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
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
  screen: { flex: 1, backgroundColor: colors.paper },
  wrap: { flex: 1, backgroundColor: colors.paper, paddingHorizontal: 20, paddingTop: 14 },

  // persistent action toolbar
  toolbar: { borderBottomWidth: 1, borderBottomColor: colors.hairline, backgroundColor: colors.card },
  toolbarRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.chipBg },
  chipText: { color: colors.ink, fontWeight: '600', fontSize: 13.5 },
  chipPrimary: { backgroundColor: colors.brand },
  chipPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13.5 },
  chipDone: { backgroundColor: colors.goodSoft },
  chipDoneText: { color: colors.good, fontWeight: '700', fontSize: 13.5 },

  toast: { position: 'absolute', left: 0, right: 0, bottom: 28, alignItems: 'center' },
  toastText: {
    backgroundColor: colors.ink, color: '#fff', fontSize: 13.5, fontWeight: '600',
    paddingVertical: 9, paddingHorizontal: 18, borderRadius: radius.pill, overflow: 'hidden',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper, padding: 24 },
  hint: { color: colors.ink3, fontSize: 14, textAlign: 'center', marginBottom: 16, lineHeight: 20 },

  docTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.ink, marginTop: 2, marginBottom: 6, lineHeight: 26 },
  docMeta: { fontSize: 12.5, color: colors.ink2, marginBottom: 2 },

  primary: { backgroundColor: colors.brand, borderRadius: radius.control, paddingVertical: 13, paddingHorizontal: 28, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  adv: { color: colors.ink3, marginTop: 16, fontSize: 13 },
  advList: { color: colors.ink, marginTop: 8, fontSize: 13 },
  err: { color: colors.brand, marginTop: 14 },
  hintSmall: { color: colors.ink3, fontSize: 12, marginTop: 8, textAlign: 'center' },
  notesBarTrack: { width: 200, height: 5, borderRadius: 3, backgroundColor: colors.chipBg, marginTop: 12, overflow: 'hidden' },
  notesBarFill: { height: 5, borderRadius: 3, backgroundColor: colors.brand },

});

const editorStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: colors.hairline, backgroundColor: colors.card,
  },
  cancel: { fontSize: 16, color: colors.ink2, fontWeight: '600' },
  title: { fontSize: 16, fontWeight: '700', color: colors.ink },
  save: { fontSize: 16, color: colors.brand, fontWeight: '800' },
  input: { flex: 1, fontSize: 14.5, lineHeight: 23, color: colors.ink, padding: 18 },
});

const histStyles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,16,14,0.35)' },
  sheet: {
    backgroundColor: colors.card, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30,
  },
  grab: { width: 38, height: 5, borderRadius: 3, backgroundColor: colors.neutralSoft, alignSelf: 'center', marginBottom: 14 },
  title: { fontSize: 17, fontWeight: '700', color: colors.ink, marginBottom: 3 },
  sub: { fontSize: 12.5, color: colors.ink2, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderTopWidth: 1, borderTopColor: colors.hairline },
  when: { fontSize: 12.5, color: colors.ink2, fontWeight: '600', marginBottom: 3 },
  snippet: { fontSize: 13, color: colors.ink3, lineHeight: 18 },
  revert: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.brandSoft },
  revertText: { color: colors.brand, fontWeight: '700', fontSize: 13.5 },
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
