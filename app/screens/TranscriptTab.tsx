import React from 'react';
import {
  ScrollView, View, TextInput, Pressable, StyleSheet,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { SavedSession } from '../lib/store';
import { mmss, nameOf, mergedParagraphs, applyTurnEdit, activeParagraph, transcriptPlainText, speakerStats, speakersByFirstAppearance } from '../lib/transcript';
import { STACK_MAX, avatarInitial } from '../lib/sessionList';
import SpeakerSheet from '../components/SpeakerSheet';
import { IconCheck, IconCopy, IconLoader, IconTranscript, IconTrash, IconAudioLines } from '../components/icons';
import { AppText } from '../components/AppText';
import { EmptyState } from '../components/EmptyState';
import { Chip, DangerButton } from '../components/Buttons';
import { TranscribeButton } from '../components/TranscribeButton';
import type { Gate } from '../lib/serverStatus';
import { isActive, overallPct } from '../lib/job';
import { colors, fontScale, layout, radius, spacing, tabularNums, speakerColor, typography } from '../lib/theme';

export default function TranscriptTab(
  { session, onUpdate, onRegenerate, onViewProgress, onSeek, activeMs = 0, onDelete, gate = 'ok', onConnect }:
  {
    session: SavedSession; onUpdate(s: SavedSession): void; onRegenerate?(): void;
    onViewProgress?(): void; onSeek?(globalMs: number): void; activeMs?: number;
    /** Can a transcript be made now (lib/serverStatus transcribeGate)? The transcript itself always shows. */
    gate?: Gate; onConnect?(): void;
    /** 刪除這場會議 — always the last thing on the page. */
    onDelete?(): void;
  },
) {
  const segs = session.transcript?.segments ?? [];
  const speakers = session.transcript?.speakers ?? [];
  const hasParts = (session.parts?.length ?? 0) > 0;
  // A transcription already in flight must NOT offer "生成逐字稿": that path restarts the job from
  // scratch (fresh backend session + full re-upload), throwing away work in progress. Offer a way to
  // watch it instead.
  const busy = isActive(session.job);
  const busyPct = session.job ? Math.round(overallPct(session.job) * 100) : 0;

  // Stable per-speaker color index: position in the transcript's speaker list. Any speaker seen in
  // segments but missing from `speakers` falls back to 0 (still valid, just shares the first hue).
  const speakerIndex = React.useMemo(() => {
    const m: Record<string, number> = {};
    speakers.forEach((sp, i) => { m[sp] = i; });
    return m;
  }, [speakers]);

  // The speaker sheet: null = closed, '' = opened from the toolbar, otherwise the speaker to focus.
  const [editing, setEditing] = React.useState<string | null>(null);
  const stats = React.useMemo(() => speakerStats(segs, speakers), [segs, speakers]);
  // The toolbar's avatar stack: first to speak first, the same order and cap as the Home card.
  const stackOrder = React.useMemo(() => speakersByFirstAppearance(segs, speakers), [segs, speakers]);
  // 生成逐字稿 (empty state) fires once. The button stays disabled from the tap until this screen is
  // replaced by 分析中 — without it a second tap in that window starts the whole job twice.
  // A ref, not just state: taps arrive faster than React re-renders, so a state read inside the
  // handler is still false on the second tap and both would fire. The state exists only to redraw
  // the button as disabled. (Re-running an existing transcript lives in Results' `…` menu.)
  const [regenStarted, setRegenStarted] = React.useState(false);
  const regenStartedRef = React.useRef(false);
  const startRegenerate = () => {
    if (regenStartedRef.current) return;
    regenStartedRef.current = true;
    setRegenStarted(true);
    onRegenerate?.();
  };
  const namedCount = stats.filter((x) => !!session.names[x.speaker]).length;
  // Which paragraph is being edited INLINE (index into `turns`), plus its working draft text. Long-press
  // a paragraph to enter; 完成 writes the correction back into the transcript segments, 取消 discards.
  const [editIdx, setEditIdx] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState('');
  // Copy feedback: flips the copy button to a green ✓ 已複製 for ~1.6s after a tap.
  const [copied, setCopied] = React.useState(false);
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  const copyTranscript = () => {
    Clipboard.setString(transcriptPlainText(segs, session.names));
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1600);
  };

  const beginEdit = (i: number, text: string) => { setDraft(text); setEditIdx(i); };
  const commitEdit = (startIdx: number, endIdx: number) => {
    const next = applyTurnEdit(segs, startIdx, endIdx, draft.trim());
    onUpdate({ ...session, transcript: { ...(session.transcript!), segments: next } });
    setEditIdx(null);
  };

  // No transcript yet — either a saved draft the user hasn't generated, or a run that dropped
  // mid-transcription. Either way, offer to generate: it uploads the on-device parts to a fresh
  // backend session and runs the pipeline (interruptible — the recording stays saved until then).
  if (segs.length === 0) {
    return (
      <ScrollView style={styles.wrap} contentContainerStyle={styles.emptyContent}>
        {busy ? (
          <EmptyState
            icon={<IconLoader size={28} color={colors.primaryDark} />}
            title="正在整理逐字稿…"
            description={`${session.job?.message || '處理中…'}（${busyPct}%）\n離開 App 也會繼續，完成後會通知你。`}
            actionLabel={onViewProgress ? '查看進度' : undefined}
            onAction={onViewProgress}
          />
        ) : hasParts ? (
          <View style={styles.emptyBlock}>
            <EmptyState
              icon={<IconTranscript size={28} color={colors.muted} />}
              title="還沒有逐字稿"
              description="這段錄音還沒整理成逐字稿。準備好了就按下面開始。"
            />
            {onRegenerate && (
              <TranscribeButton
                gate={gate}
                label={regenStarted ? '準備中…' : '生成逐字稿'}
                onPress={startRegenerate}
                onConnect={() => onConnect?.()}
                disabled={regenStarted}
                style={styles.emptyCta}
              />
            )}
          </View>
        ) : (
          <EmptyState
            icon={<IconAudioLines size={28} color={colors.muted} />}
            title="還沒有逐字稿"
            description="這段錄音裡沒有可以辨識的聲音。"
          />
        )}
        {onDelete && <DangerButton label="刪除這場會議" icon={<IconTrash size={18} />} onPress={onDelete} style={styles.delete} />}
      </ScrollView>
    );
  }

  const turns = React.useMemo(() => mergedParagraphs(segs), [segs]);
  // The naming prompt shows once per speaker — on their first turn — not on every paragraph they speak.
  const firstTurn = React.useMemo(() => {
    const seen = new Set<string>();
    return turns.map((t) => { const first = !seen.has(t.speaker); seen.add(t.speaker); return first; });
  }, [turns]);
  // Paragraph currently being spoken (for follow-along highlight); -1 when not playing.
  const activeIdx = React.useMemo(() => activeParagraph(turns.map((t) => t.start), activeMs), [turns, activeMs]);

  // Follow the player: when the active paragraph changes (playback advancing OR a waveform scrub jump),
  // scroll it into view so the transcript tracks the audio position. Each turn reports its content-Y via
  // onLayout; we scroll only on index change (not every progress tick) so steady playback stays gentle.
  const scrollRef = React.useRef<ScrollView>(null);
  const turnY = React.useRef<Record<number, number>>({});
  React.useEffect(() => {
    if (activeIdx < 0) return;
    const y = turnY.current[activeIdx];
    if (y == null) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 88), animated: true });
  }, [activeIdx]);

  return (
    <View style={styles.wrap}>
      {/* Sticky: the transcript scrolls under these. One fixed row: 講者, 複製 and at most one
          contextual chip (查看進度 / 連接主機). 重新生成逐字稿 lives in Results' `…` menu only. */}
      <View style={styles.toolbar}>
        <View testID="transcript-toolbar" style={styles.toolbarRow}>
          {stats.length > 0 && (
            // Avatar stack: who is in this meeting at a glance, in the same colours as the turns below.
            <Pressable
              testID="open-speakers"
              onPress={() => setEditing('')}
              accessibilityRole="button"
              accessibilityLabel={`管理講者，${stats.length} 位，已命名 ${namedCount} 位`}
              hitSlop={4}
              style={({ pressed }) => [styles.stackChip, pressed && styles.pressedRow]}
            >
              <View style={styles.stack}>
                {stackOrder.slice(0, STACK_MAX).map(({ speaker: sp, index }, k) => (
                  <View
                    key={sp}
                    testID={`stack-avatar-${sp}`}
                    style={[styles.stackAv, k > 0 && styles.stackOverlap, { backgroundColor: speakerColor(index) }]}
                  >
                    <AppText variant="small" color="onPrimary" style={styles.stackText} maxFontSizeMultiplier={fontScale.chrome}>
                      {avatarInitial(sp, index, session.names)}
                    </AppText>
                  </View>
                ))}
                {stackOrder.length > STACK_MAX && (
                  <View style={[styles.stackAv, styles.stackOverlap, styles.stackMore]}>
                    <AppText variant="small" color="heading" style={styles.stackText} maxFontSizeMultiplier={fontScale.chrome}>
                      +{stackOrder.length - STACK_MAX}
                    </AppText>
                  </View>
                )}
              </View>
              <AppText variant="cardTitle" color="heading" maxFontSizeMultiplier={fontScale.chrome}>{`講者 ${namedCount}/${stats.length}`}</AppText>
            </Pressable>
          )}
          <Chip
            testID="copy-transcript"
            label={copied ? '已複製' : '複製'}
            icon={copied ? <IconCheck size={16} strokeWidth={2} /> : <IconCopy size={16} />}
            onPress={copyTranscript}
            accessibilityLabel="複製逐字稿"
          />
          {busy && onViewProgress ? (
            <Chip testID="view-progress" label={`查看進度（${busyPct}%）`} onPress={onViewProgress} />
          ) : hasParts && onRegenerate && gate === 'unpaired' && onConnect ? (
            <Chip testID="connect-server" label="連接主機" onPress={onConnect} />
          ) : null}
        </View>
      </View>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <AppText variant="small" color="muted" style={styles.howto}>點一下段落就從那裡播放，長按可以修改文字。</AppText>
        {turns.map((p, i) => {
          const idx = speakerIndex[p.speaker] ?? 0;
          const color = speakerColor(idx);
          const named = !!session.names[p.speaker];
          const display = named ? nameOf(p.speaker, session.names) : `講者 ${idx + 1}`;
          const initial = named ? display.trim().charAt(0) : String(idx + 1);
          const active = i === activeIdx;
          return (
            <View
              key={i}
              style={[styles.turn, active && styles.turnActive]}
              testID={active ? 'turn-active' : undefined}
              onLayout={(e) => { turnY.current[i] = e.nativeEvent.layout.y; }}
            >
              <Pressable
                // The speaker's first turn keeps the plain id (it carries the naming prompt).
                testID={firstTurn[i] ? `turn-head-${p.speaker}` : `turn-head-${p.speaker}-${i}`}
                style={({ pressed }) => [styles.turnHead, pressed && styles.pressedRow]}
                onPress={() => setEditing(p.speaker)}
                accessibilityRole="button"
                // Never read the raw diarisation code (SPEAKER_01) aloud — an unnamed speaker is 講者 N.
                accessibilityLabel={named ? `${display}，點兩下改名` : `講者 ${idx + 1}，還沒命名，點兩下命名`}
              >
                {named || !firstTurn[i] ? (
                  // Every avatar wears the speaker's palette colour, named or not, so you can follow
                  // one person down the page before anyone has been named.
                  <>
                    <View testID={`turn-avatar-${i}`} style={[styles.av, { backgroundColor: color }]}>
                      <AppText variant="small" color="onPrimary" style={styles.avText} maxFontSizeMultiplier={fontScale.chrome}>{initial}</AppText>
                    </View>
                    <AppText variant="cardTitle" color="heading" style={styles.who} maxFontSizeMultiplier={fontScale.chrome}>{display}</AppText>
                  </>
                ) : (
                  // An unnamed speaker's FIRST turn asks to be named: the dashed peach chip, once.
                  <View style={styles.chipUnset}>
                    <View testID={`turn-avatar-${i}`} style={[styles.av, styles.avUnset, { backgroundColor: color }]}>
                      <AppText variant="small" color="onPrimary" style={styles.avText} maxFontSizeMultiplier={fontScale.chrome}>{initial}</AppText>
                    </View>
                    <AppText variant="small" color="accent" style={styles.unsetText} maxFontSizeMultiplier={fontScale.chrome}>
                      講者 {idx + 1} · 點一下命名
                    </AppText>
                  </View>
                )}
                <AppText variant="small" color="muted" style={[styles.tc, tabularNums]} maxFontSizeMultiplier={fontScale.chrome}>{mmss(p.start)}</AppText>
              </Pressable>
              {editIdx === i ? (
                <View style={styles.editBox}>
                  <TextInput
                    testID={`edit-input-${i}`}
                    autoFocus
                    multiline
                    style={styles.editInput}
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="修改這段文字"
                    placeholderTextColor={colors.hint}
                    scrollEnabled={false}
                    accessibilityLabel="修改這段文字"
                  />
                  <View style={styles.editActions}>
                    <Pressable testID={`edit-cancel-${i}`} onPress={() => setEditIdx(null)} style={styles.editBtn} accessibilityRole="button" hitSlop={8}>
                      <AppText variant="cardTitle" color="muted">取消</AppText>
                    </Pressable>
                    <Pressable
                      testID={`edit-done-${i}`}
                      onPress={() => commitEdit(p.startIdx, p.endIdx)}
                      style={({ pressed }) => [styles.editBtn, styles.editDone, pressed && styles.pressedFill]}
                      accessibilityRole="button"
                    >
                      <AppText variant="cardTitle" color="onPrimary" style={styles.bold}>完成</AppText>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  testID={`turn-body-${i}`}
                  onPress={() => onSeek?.(Math.round(p.start * 1000))}
                  onLongPress={() => beginEdit(i, p.text)}
                  delayLongPress={280}
                  accessibilityRole="button"
                  accessibilityLabel={`跳到 ${mmss(p.start)} 播放，長按可修改文字`}
                  // VoiceOver / TalkBack: the rotor offers 從這裡播放 and 修改文字 by name.
                  accessibilityActions={[{ name: 'activate', label: '從這裡播放' }, { name: 'longpress', label: '修改文字' }]}
                  onAccessibilityAction={(e) => {
                    if (e.nativeEvent.actionName === 'activate') onSeek?.(Math.round(p.start * 1000));
                    else if (e.nativeEvent.actionName === 'longpress') beginEdit(i, p.text);
                  }}
                >
                  <AppText variant="body" color={active ? 'heading' : 'body'} maxFontSizeMultiplier={fontScale.content}>{p.text}</AppText>
                </Pressable>
              )}
            </View>
          );
        })}
        {onDelete && <DangerButton label="刪除這場會議" icon={<IconTrash size={18} />} onPress={onDelete} style={styles.delete} />}
      </ScrollView>

      {editing != null && (
        <SpeakerSheet
          stats={stats}
          names={session.names}
          focus={editing || null}
          onClose={() => setEditing(null)}
          onCommit={(names) => { onUpdate({ ...session, names }); setEditing(null); }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1, paddingHorizontal: layout.screenPaddingH },
  scrollContent: { paddingBottom: spacing.xxxl },

  emptyContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: layout.screenPaddingH, paddingBottom: spacing.xxl },
  emptyBlock: { alignItems: 'stretch' },
  emptyCta: { alignSelf: 'center', marginTop: -spacing.xxxl },

  toolbar: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.outline, backgroundColor: colors.background },
  toolbarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: layout.screenPaddingH, paddingVertical: spacing.md },
  // teaches the two paragraph gestures (tap = seek, long-press = edit)
  howto: { paddingTop: spacing.md, paddingBottom: spacing.xs },

  turn: { paddingVertical: spacing.md },
  // follow-along highlight on the paragraph currently being played
  turnActive: {
    backgroundColor: colors.primarySoft, borderRadius: radius.input,
    marginHorizontal: -spacing.md, paddingHorizontal: spacing.md,
  },
  turnHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs, minHeight: 32 },
  who: { fontWeight: '600' },
  tc: { marginLeft: 'auto' },

  // inline editor (long-press a paragraph)
  editBox: {
    backgroundColor: colors.surface, borderRadius: radius.input, borderWidth: layout.border, borderColor: colors.primary,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  editInput: { ...typography.body, color: colors.heading, padding: 0, minHeight: 44, textAlignVertical: 'top' },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  editBtn: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.lg, borderRadius: radius.chip },
  editDone: { backgroundColor: colors.primary },
  bold: { fontWeight: '600' },

  av: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avText: { fontWeight: '600', fontSize: 12 },

  chipUnset: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: layout.border, borderStyle: 'dashed', borderColor: colors.accent,
    borderRadius: radius.chip, paddingVertical: 2, paddingLeft: 2, paddingRight: spacing.md,
  },
  avUnset: { width: 24, height: 24, borderRadius: 12 },

  // toolbar avatar stack (opens the speaker sheet)
  stackChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    height: layout.chipHeight, borderRadius: radius.chip, paddingLeft: spacing.xs, paddingRight: spacing.lg,
    backgroundColor: colors.surface, borderWidth: layout.border, borderColor: colors.outline,
  },
  stack: { flexDirection: 'row', alignItems: 'center' },
  // A surface-coloured ring separates overlapping faces without a shadow.
  stackAv: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.surface,
  },
  stackOverlap: { marginLeft: -8 },
  stackMore: { backgroundColor: colors.primarySoft },
  stackText: { fontWeight: '600', fontSize: 11, lineHeight: 14 },
  unsetText: { fontWeight: '500' },

  delete: { marginTop: spacing.xxxl },
  pressedRow: { opacity: 0.7 },
  pressedFill: { opacity: 0.8 },
});
