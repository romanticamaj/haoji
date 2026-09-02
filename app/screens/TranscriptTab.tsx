import React from 'react';
import {
  ScrollView, View, Text, TextInput, Pressable, StyleSheet,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { SavedSession } from '../lib/store';
import { mmss, nameOf, mergedParagraphs, applyTurnEdit, activeParagraph, transcriptPlainText, speakerStats } from '../lib/transcript';
import SpeakerSheet from '../components/SpeakerSheet';
import { IconCheck, IconCopy } from '../components/icons';
import { isActive, overallPct } from '../lib/job';
import { colors, radius, tabularNums, speakerColor } from '../lib/theme';

export default function TranscriptTab(
  { session, onUpdate, onRegenerate, onViewProgress, onSeek, activeMs = 0 }:
  {
    session: SavedSession; onUpdate(s: SavedSession): void; onRegenerate?(): void;
    onViewProgress?(): void; onSeek?(globalMs: number): void; activeMs?: number;
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
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>{busy ? '正在生成逐字稿' : '還沒有逐字稿'}</Text>
        <Text style={styles.emptyHint}>
          {busy
            ? `${session.job?.message || '處理中…'}（${busyPct}%）\n離開 App 也會繼續，完成後回來就看得到。`
            : hasParts ? '這段錄音還沒有生成逐字稿。準備好了就點下面開始。' : '找不到可辨識的錄音檔。'}
        </Text>
        {busy ? (
          onViewProgress && (
            <Pressable style={styles.primary} onPress={onViewProgress} accessibilityRole="button">
              <Text style={styles.primaryText}>查看進度</Text>
            </Pressable>
          )
        ) : hasParts && onRegenerate && (
          <Pressable style={styles.primary} onPress={onRegenerate} accessibilityRole="button">
            <Text style={styles.primaryText}>生成逐字稿</Text>
          </Pressable>
        )}
      </View>
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
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <View style={styles.toolbar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.toolbarRow}
            keyboardShouldPersistTaps="handled"
          >
            {stats.length > 0 && (
              <Pressable
                testID="open-speakers"
                style={styles.chip}
                onPress={() => setEditing('')}
                accessibilityRole="button"
                accessibilityLabel="管理講者"
              >
                <Text style={styles.chipText}>講者 {namedCount}/{stats.length}</Text>
              </Pressable>
            )}
            <Pressable
              testID="copy-transcript"
              style={[styles.chip, copied && styles.chipDone]}
              onPress={copyTranscript}
              accessibilityRole="button"
              accessibilityLabel="複製逐字稿"
            >
              {copied
                ? <><IconCheck size={14} color={colors.good} /><Text style={styles.chipDoneText}>已複製</Text></>
                : <><IconCopy size={14} color={colors.brand} /><Text style={styles.chipText}>複製</Text></>}
            </Pressable>
            {busy && onViewProgress ? (
              <Pressable
                testID="view-progress"
                style={styles.chip}
                onPress={onViewProgress}
                accessibilityRole="button"
              >
                <Text style={styles.chipText}>查看進度（{busyPct}%）</Text>
              </Pressable>
            ) : hasParts && onRegenerate ? (
              <Pressable
                testID="regenerate-transcript"
                style={styles.chip}
                onPress={onRegenerate}
                accessibilityRole="button"
              >
                <Text style={styles.chipText}>重新生成逐字稿</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
        <Text style={styles.howto}>點段落跳到該處播放 · 長按可修改文字</Text>
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
                style={styles.turnHead}
                onPress={() => setEditing(p.speaker)}
                accessibilityRole="button"
                accessibilityLabel={`命名講者 ${display}`}
              >
                {named ? (
                  <>
                    <View style={[styles.av, { backgroundColor: color }]}>
                      <Text style={styles.avText}>{initial}</Text>
                    </View>
                    <Text style={styles.who}>{display}</Text>
                  </>
                ) : (
                  <View style={styles.chipUnset}>
                    <View style={[styles.av, styles.avUnset]}>
                      <Text style={styles.avText}>{initial}</Text>
                    </View>
                    <Text style={styles.chipUnsetText}>
                      講者 {idx + 1} <Text style={styles.chipUnsetHint}>· 點一下命名</Text>
                    </Text>
                  </View>
                )}
                <Text style={[styles.tc, tabularNums]}>{mmss(p.start)}</Text>
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
                    placeholderTextColor={colors.ink3}
                    scrollEnabled={false}
                  />
                  <View style={styles.editActions}>
                    <Pressable testID={`edit-cancel-${i}`} onPress={() => setEditIdx(null)} style={styles.editBtn} accessibilityRole="button">
                      <Text style={styles.editCancelText}>取消</Text>
                    </Pressable>
                    <Pressable testID={`edit-done-${i}`} onPress={() => commitEdit(p.startIdx, p.endIdx)} style={[styles.editBtn, styles.editDone]} accessibilityRole="button">
                      <Text style={styles.editDoneText}>完成</Text>
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
                  <Text style={[styles.body, active && styles.bodyActive]}>{p.text}</Text>
                </Pressable>
              )}
            </View>
          );
        })}
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
  wrap: { flex: 1, backgroundColor: colors.paper },
  scroll: { flex: 1, paddingHorizontal: 18 },

  emptyWrap: { flex: 1, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center', padding: 28 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  emptyHint: { color: colors.ink3, fontSize: 14, textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  primary: { backgroundColor: colors.brand, borderRadius: radius.control, paddingVertical: 13, paddingHorizontal: 28, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // header row: gesture hint on the left, copy button on the right
  toolbar: { marginHorizontal: -18, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  toolbarRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, paddingVertical: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.chipBg },
  chipText: { color: colors.ink, fontWeight: '600', fontSize: 13.5 },
  chipDone: { backgroundColor: colors.goodSoft },
  chipDoneText: { color: colors.good, fontWeight: '600', fontSize: 13.5 },
  // teaches the two paragraph gestures (tap = seek, long-press = edit)
  howto: { fontSize: 11.5, color: colors.ink3, paddingTop: 10, paddingBottom: 2 },

  // turns
  turn: { paddingVertical: 12 },
  // follow-along highlight on the paragraph currently being played
  turnActive: {
    backgroundColor: colors.brandSoft, borderRadius: 12,
    marginHorizontal: -10, paddingHorizontal: 10, paddingVertical: 10,
  },
  turnHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  who: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  tc: { marginLeft: 'auto', fontSize: 11.5, color: colors.ink3 },
  body: { fontSize: 14, lineHeight: 22, color: colors.ink },
  bodyActive: { color: colors.brandPress },

  // inline editor (long-press a paragraph)
  editBox: {
    backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.brandSoft,
    paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10,
  },
  editInput: { fontSize: 14, lineHeight: 22, color: colors.ink, padding: 0, minHeight: 44, textAlignVertical: 'top' },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 },
  editBtn: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 9 },
  editCancelText: { fontSize: 14, fontWeight: '600', color: colors.ink2 },
  editDone: { backgroundColor: colors.brand },
  editDoneText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  av: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  avText: { fontSize: 10, fontWeight: '700', color: '#fff' },

  // unnamed dashed pill
  chipUnset: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: colors.brandSoft, borderWidth: 1, borderStyle: 'dashed',
    borderColor: colors.speakerUnset, borderRadius: radius.pill, paddingVertical: 2, paddingLeft: 3, paddingRight: 10,
  },
  avUnset: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.speakerUnset },
  chipUnsetText: { color: colors.brand, fontSize: 12.5, fontWeight: '600' },
  chipUnsetHint: { color: colors.speakerUnsetText, fontWeight: '500' },

  // rename sheet
});
