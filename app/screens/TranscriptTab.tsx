import React from 'react';
import {
  ScrollView, View, TextInput, Pressable, StyleSheet, Alert,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { SavedSession } from '../lib/store';
import { mmss, nameOf, mergedParagraphs, applyTurnEdit, activeParagraph, transcriptPlainText, speakerStats } from '../lib/transcript';
import SpeakerSheet from '../components/SpeakerSheet';
import { IconCheck, IconCopy, IconLoader, IconSpeakers, IconTranscript, IconTrash, IconAudioLines } from '../components/icons';
import { AppText } from '../components/AppText';
import { EmptyState } from '../components/EmptyState';
import { Chip, DangerButton, PrimaryButton } from '../components/Buttons';
import { isActive, overallPct } from '../lib/job';
import { colors, layout, radius, spacing, tabularNums, speakerColor, typography } from '../lib/theme';

export default function TranscriptTab(
  { session, onUpdate, onRegenerate, onViewProgress, onSeek, activeMs = 0, onDelete }:
  {
    session: SavedSession; onUpdate(s: SavedSession): void; onRegenerate?(): void;
    onViewProgress?(): void; onSeek?(globalMs: number): void; activeMs?: number;
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
  // One trigger only. The chip stays disabled from the moment it is confirmed until this screen is
  // replaced by 分析中 — without it a second tap in that window starts the whole job twice.
  // A ref, not just state: taps arrive faster than React re-renders, so a state read inside the
  // handler is still false on the second tap and both would fire. The state exists only to redraw
  // the button as disabled.
  const [regenStarted, setRegenStarted] = React.useState(false);
  const regenStartedRef = React.useRef(false);
  const confirmOpenRef = React.useRef(false);   // one dialog at a time
  const startRegenerate = () => {
    if (regenStartedRef.current) return;
    regenStartedRef.current = true;
    setRegenStarted(true);
    onRegenerate?.();
  };
  // Unlike the meeting notes, a transcript has NO version history: re-running overwrites it, taking
  // any text corrections with it. Say so rather than discovering it afterwards.
  const confirmRegenerate = () => {
    if (regenStartedRef.current || confirmOpenRef.current) return;
    confirmOpenRef.current = true;
    Alert.alert(
      '重新生成逐字稿？',
      '會用原本的錄音重新辨識一次。目前的逐字稿會被取代，包含你修改過的文字；逐字稿沒有版本紀錄，無法還原。',
      [{ text: '取消', style: 'cancel', onPress: () => { confirmOpenRef.current = false; } },
       { text: '重新生成', style: 'destructive', onPress: startRegenerate }],
    );
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
              <PrimaryButton
                label={regenStarted ? '準備中…' : '生成逐字稿'}
                onPress={startRegenerate}
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
      {/* Sticky: the transcript scrolls under these. Burying 講者 / 複製 / 重新生成 in the scroll
          meant they vanished as soon as you started reading, which is exactly when they are wanted. */}
      <View style={styles.toolbar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.toolbarRow}
          keyboardShouldPersistTaps="handled"
        >
          {stats.length > 0 && (
            <Chip
              testID="open-speakers"
              label={`講者 ${namedCount}/${stats.length}`}
              icon={<IconSpeakers size={16} />}
              onPress={() => setEditing('')}
              accessibilityLabel="管理講者"
            />
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
          ) : hasParts && onRegenerate ? (
            <Chip
              testID="regenerate-transcript"
              label={regenStarted ? '準備中…' : '重新生成逐字稿'}
              onPress={confirmRegenerate}
              disabled={regenStarted}
            />
          ) : null}
        </ScrollView>
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
          const display = nameOf(p.speaker, session.names);
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
                testID={`turn-head-${p.speaker}`}
                style={({ pressed }) => [styles.turnHead, pressed && styles.pressedRow]}
                onPress={() => setEditing(p.speaker)}
                accessibilityRole="button"
                // Never read the raw diarisation code (SPEAKER_01) aloud — an unnamed speaker is 講者 N.
                accessibilityLabel={named ? `重新命名 ${display}` : `講者 ${idx + 1}，點一下命名`}
              >
                {named ? (
                  <>
                    <View style={[styles.av, { backgroundColor: color }]}>
                      <AppText variant="small" color="onPrimary" style={styles.avText}>{initial}</AppText>
                    </View>
                    <AppText variant="cardTitle" color="heading" style={styles.who}>{display}</AppText>
                  </>
                ) : (
                  // Unnamed speakers wear the one peach accent: a dashed chip asking to be named.
                  <View style={styles.chipUnset}>
                    <View style={[styles.av, styles.avUnset]}>
                      <AppText variant="small" color="onPrimary" style={styles.avText}>{initial}</AppText>
                    </View>
                    <AppText variant="small" color="accent" style={styles.unsetText}>
                      講者 {idx + 1} · 點一下命名
                    </AppText>
                  </View>
                )}
                <AppText variant="small" color="muted" style={[styles.tc, tabularNums]}>{mmss(p.start)}</AppText>
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
                >
                  <AppText variant="body" color={active ? 'heading' : 'body'}>{p.text}</AppText>
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
  toolbarRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: layout.screenPaddingH, paddingVertical: spacing.md },
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
  avUnset: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.accent },
  unsetText: { fontWeight: '500' },

  delete: { marginTop: spacing.xxxl },
  pressedRow: { opacity: 0.7 },
  pressedFill: { opacity: 0.8 },
});
