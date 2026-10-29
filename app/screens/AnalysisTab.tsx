import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView, View, Text, Pressable, StyleSheet, TextInput, Modal,
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
import { speakerColor, colors, layout, radius, spacing, tabularNums, typography } from '../lib/theme';
import {
  IconAlert, IconCheck, IconCopy, IconLoader, IconNotes, IconPencil, IconShare, IconTodo, IconTodoDone, IconTrash,
} from '../components/icons';
import { AppText } from '../components/AppText';
import { EmptyState } from '../components/EmptyState';
import { Sheet } from '../components/Sheet';
import { Chip, DangerButton, PrimaryButton } from '../components/Buttons';
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

// The notes read as a document (GUIDELINE §7.1): H2 = `section`, paragraphs = `body`, an 8pt bullet
// indent, no coloured section bars and no emoji markers.
const mdStyles = StyleSheet.create({
  body: { ...typography.body, color: colors.body },
  // # title — normally stripped from the body (promoted to the meeting title), styled defensively.
  heading1: { ...typography.screenTitle, color: colors.heading, marginTop: spacing.sm, marginBottom: spacing.md },
  heading2: { ...typography.section, color: colors.heading, marginTop: spacing.xxl, marginBottom: spacing.sm },
  heading3: { ...typography.cardTitle, fontWeight: '600', color: colors.heading, marginTop: spacing.lg, marginBottom: spacing.xs },
  strong: { fontWeight: '600', color: colors.heading },
  paragraph: { ...typography.body, color: colors.body, marginTop: 0, marginBottom: spacing.sm },
  bullet_list: { marginTop: 2, marginBottom: spacing.xs },
  list_item: { marginVertical: 3 },
  bullet_list_icon: { color: colors.muted, fontSize: 20, lineHeight: 24, marginRight: spacing.sm, marginLeft: spacing.sm },
});

export default function AnalysisTab({ session, onUpdate, onGoToTranscript, onDelete }:
  { session: SavedSession; onUpdate(s: SavedSession): void; onGoToTranscript?(): void; onDelete?(): void }) {
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
            {task.done ? <IconTodoDone size={20} /> : <IconTodo size={20} />}
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
    // Flow gate: meeting notes are written FROM the transcript, so block generation until one exists.
    if (!hasTranscript) {
      return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.emptyContent}>
          <EmptyState
            icon={<IconNotes size={28} color={colors.muted} />}
            title="還沒有逐字稿"
            description="會議記錄是從逐字稿整理出來的，請先完成逐字稿。"
            actionLabel={onGoToTranscript ? '前往逐字稿' : undefined}
            onAction={onGoToTranscript}
          />
        </ScrollView>
      );
    }
    if (busy || starting) {
      const pct = typeof session.notesJob?.pct === 'number' ? Math.round(session.notesJob.pct * 100) : null;
      return (
        <View style={[styles.screen, styles.center]}>
          <View style={styles.iconCircle}><IconLoader size={28} color={colors.primaryDark} /></View>
          <AppText variant="section" color="heading" accessibilityRole="header">正在寫會議記錄…</AppText>
          {!!session.notesJob?.message && <AppText variant="small" color="muted">{session.notesJob.message}</AppText>}
          {pct != null && (
            <View style={styles.barTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
              <View style={[styles.barFill, { width: `${pct}%` }]} />
            </View>
          )}
          <AppText variant="body" color="muted" style={styles.centerText}>離開 App 也會繼續，回來就看得到。</AppText>
        </View>
      );
    }
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.emptyContent}>
        <EmptyState
          icon={<IconNotes size={28} color={colors.muted} />}
          title="還沒有會議記錄"
          description="把逐字稿整理成摘要、重點、決議和待辦。"
        />
        <PrimaryButton label="生成會議記錄" onPress={generate} style={styles.emptyCta} />
        {err && (
          <View style={styles.errCard}>
            <IconAlert size={18} />
            <View style={styles.flex}>
              <AppText variant="cardTitle" color="heading" style={styles.bold}>會議記錄沒有寫完</AppText>
              <AppText variant="small" color="muted">逐字稿還在，請再試一次。</AppText>
            </View>
          </View>
        )}
        <Pressable onPress={() => setShowAdv((v) => !v)} style={styles.advBtn} accessibilityRole="button" hitSlop={8}>
          <AppText variant="small" color="muted">進階</AppText>
        </Pressable>
        {showAdv && (
          <View style={styles.advRow}>
            {models.map((m) => (
              <Chip key={m} label={m} selected={m === model || (!model && models[0] === m)} onPress={() => setModel(m)} />
            ))}
          </View>
        )}
        {onDelete && <DangerButton label="刪除這場會議" icon={<IconTrash size={18} />} onPress={onDelete} style={styles.delete} />}
      </ScrollView>
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
          <Chip label="編輯" icon={<IconPencil size={16} />} onPress={() => setEditing(true)} accessibilityLabel="編輯會議記錄" />
          <Chip label="重新分析" onPress={confirmRegenerate} />
          <Chip label="修正關鍵字" onPress={() => setKwOpen(true)} />
          <Chip
            label={copied === 'plain' ? '已複製' : '複製純文字'}
            icon={copied === 'plain' ? <IconCheck size={16} strokeWidth={2} /> : <IconCopy size={16} />}
            onPress={copyPlainText}
            accessibilityLabel="複製純文字"
          />
          <Chip
            label={copied === 'md' ? '已複製' : '複製 Markdown'}
            icon={copied === 'md' ? <IconCheck size={16} strokeWidth={2} /> : <IconCopy size={16} />}
            onPress={copyMarkdown}
            accessibilityLabel="複製 Markdown"
          />
          {historyCount > 0 && <Chip label={`版本紀錄（${historyCount}）`} onPress={() => setHistoryOpen(true)} />}
          <Chip label="匯出" icon={<IconShare size={16} />} onPress={exportMd} accessibilityLabel="匯出會議記錄" />
        </ScrollView>
      </View>

      <ScrollView style={styles.wrap} contentContainerStyle={styles.docContent}>
        {/* Document header */}
        <AppText variant="screenTitle" color="heading" accessibilityRole="header">{session.title}</AppText>
        {!!meta && <AppText variant="small" color="muted" style={[styles.docMeta, tabularNums]}>{meta}</AppText>}

        <Markdown style={mdStyles} rules={rules}>{body}</Markdown>
        {onDelete && <DangerButton label="刪除這場會議" icon={<IconTrash size={18} />} onPress={onDelete} style={styles.delete} />}
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
        <View style={styles.toast} pointerEvents="none" accessibilityLiveRegion="polite">
          <IconCheck size={16} color={colors.onPrimary} strokeWidth={2} />
          <AppText variant="body" color="onPrimary">{toast}</AppText>
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
          <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button"><AppText variant="cardTitle" color="muted">取消</AppText></Pressable>
          <AppText variant="cardTitle" color="heading" style={editorStyles.title}>編輯會議記錄</AppText>
          <Pressable testID="notes-save" onPress={() => onSave(value)} hitSlop={10} accessibilityRole="button">
            <AppText variant="cardTitle" color="primaryDark" style={editorStyles.title}>儲存</AppText>
          </Pressable>
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
            placeholder="會議記錄內容"
            placeholderTextColor={colors.hint}
            accessibilityLabel="會議記錄內容"
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
    <Sheet title="版本紀錄" subtitle="還原到之前的版本。目前的版本會先保留下來。" onClose={onClose}>
      <ScrollView style={histStyles.list}>
        {history.map((v, i) => (
          <View key={i} style={histStyles.row}>
            <View style={histStyles.flex}>
              <AppText variant="small" color="muted" style={tabularNums}>{relativeDay(v.at, now)}</AppText>
              <AppText variant="body" color="body" numberOfLines={2}>{markdownToPlainText(v.notes).replace(/\n+/g, ' ') || '（空白）'}</AppText>
            </View>
            <Chip label="復原" onPress={() => onRevert(v.notes)} accessibilityLabel={`復原 ${relativeDay(v.at, now)} 的版本`} />
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

// Small colored avatar for a task owner. Colors by the owner's speaker index when the name maps to
// a known speaker; otherwise brand. Shows the first character of the name.
function OwnerAvatar({ name, session }: { name: string; session: SavedSession }) {
  const speakers = session.transcript?.speakers ?? [];
  const idx = speakers.findIndex((sp) => (session.names[sp] || '').trim() === name.trim());
  const color = idx >= 0 ? speakerColor(idx) : colors.primary;
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
  screen: { flex: 1, backgroundColor: colors.background },
  wrap: { flex: 1, backgroundColor: colors.background, paddingHorizontal: layout.screenPaddingH },
  docContent: { paddingTop: spacing.lg, paddingBottom: spacing.xxxl },
  docMeta: { marginTop: spacing.xs },
  flex: { flex: 1 },
  bold: { fontWeight: '600' },

  toolbar: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.outline, backgroundColor: colors.background },
  toolbarRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: layout.screenPaddingH, paddingVertical: spacing.md },

  // Dark snackbar (KEEPLACE UndoSnackbar look) for 「已取代 N 處」.
  toast: {
    position: 'absolute', left: layout.screenPaddingH, right: layout.screenPaddingH, bottom: spacing.xxl,
    minHeight: layout.buttonHeight, borderRadius: radius.button, backgroundColor: colors.heading,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg,
  },

  emptyContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: layout.screenPaddingH, paddingBottom: spacing.xxl },
  emptyCta: { alignSelf: 'center', marginTop: -spacing.xxxl },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: layout.screenPaddingH * 2, gap: spacing.md },
  centerText: { textAlign: 'center' },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surface,
    borderWidth: layout.border, borderColor: colors.outline, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
  },
  barTrack: { width: 200, height: 4, borderRadius: 2, backgroundColor: colors.outline, overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },

  errCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginTop: spacing.xl, padding: spacing.lg,
    backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: layout.border, borderColor: colors.outline,
  },
  advBtn: { alignSelf: 'center', marginTop: spacing.xl, minHeight: layout.minTouchTarget, justifyContent: 'center' },
  advRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  delete: { marginTop: spacing.xxxl },
});

const editorStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: layout.screenPaddingH, paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.outline, backgroundColor: colors.background,
  },
  title: { fontWeight: '600' },
  input: { flex: 1, ...typography.body, color: colors.heading, padding: layout.screenPaddingH },
});

const histStyles = StyleSheet.create({
  list: { maxHeight: 360, marginTop: spacing.sm },
  flex: { flex: 1, gap: 2 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outline,
  },
});

const docStyles = StyleSheet.create({
  todo: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outline,
  },
  tt: { flex: 1, ...typography.body, color: colors.body },
  ttDone: { color: colors.muted, textDecorationLine: 'line-through' },
  av: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  avText: { fontSize: 11, fontWeight: '600', color: colors.onPrimary },
});
